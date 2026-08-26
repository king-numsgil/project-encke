// Fitting the sun's four cascades to the camera frustum.
//
// Three decisions here account for almost all of the visual quality, and each
// one exists to kill a specific artefact:
//
//   * **Practical split scheme.** A uniform split wastes the near cascades on
//     distance; a purely logarithmic one puts the first split so close that
//     cascade 1 does all the work. The blend of the two is `cascadeSplitLambda`.
//   * **Bounding sphere, not bounding box.** A box fitted to the frustum slice
//     changes size as the camera *rotates*, so every texel moves and the shadow
//     edges crawl. A sphere is rotation-invariant, so turning the camera changes
//     nothing about the cascade's extent.
//   * **Texel snapping.** Even with a fixed extent, *translating* the camera
//     slides the projection by fractions of a texel and the edges shimmer.
//     Rounding the projection's origin to whole texels pins them.
//
// Drop any of the three and the shadows look like they are boiling.

import { fmat4, fvec3, fvec4 } from "std/linalg";
import { fabs, facos, ffloor, fpow, ftan } from "std/math";
import {
    cascadeAtlasHeight,
    cascadeAtlasWidth,
    cascadeCount,
    cascadeSplitLambda,
    farCascadeSize,
    nearCascadeSize,
    shadowDistance,
    spotAtlasSize,
    spotShadowSize,
} from "../config.ts";
import type { ShadowUniform } from "../frame/uniforms.ts";
import type { Camera } from "./camera.ts";

/**
 * How far behind the slice the light's near plane reaches.
 *
 * Casters between the sun and the visible slice are not themselves visible but
 * still cast into it. Without this margin they fall outside the light's frustum
 * and their shadows simply are not there — a wall that stops shadowing the floor
 * as soon as the camera looks away from it.
 */
function casterMargin(): f32 {
    return 60.0;
}

/** Side of cascade `index`, in texels. The near two are larger; see `config.ts`. */
export function cascadeSize(index: u32): u32 {
    return index < 2 ? nearCascadeSize() : farCascadeSize();
}

/** Left edge of cascade `index` in the atlas, in texels. */
export function cascadeTileX(index: u32): u32 {
    if (index === 0) {
        return 0;
    }
    if (index === 1) {
        return nearCascadeSize();
    }
    // The far pair sit past both near ones, side by side.
    return nearCascadeSize() * 2 + (index - 2) * farCascadeSize();
}

/** Left edge of spot tile `index`, in texels. Four tiles in a 2x2. */
export function spotTileX(index: u32): u32 {
    return (index % 2) * spotShadowSize();
}

/** Top edge of spot tile `index`, in texels. */
export function spotTileY(index: u32): u32 {
    return (index / 2) * spotShadowSize();
}

/**
 * Split distances, in view-space units from the camera.
 *
 * Entry `i` is where cascade `i` ends. The last one is `shadowDistance`, beyond
 * which nothing is shadowed at all.
 */
function splitDistances(near: f32): FixedArray<f32, 4> {
    const splits: FixedArray<f32, 4> = fixedArray(4, 0.0);
    const far = shadowDistance();
    const count = cascadeCount();
    const lambda = cascadeSplitLambda();
    const ratio = far / near;

    for (let i: usize = 0; i < cast<usize>(count); i++) {
        const fraction = cast<f32>(i + 1) / cast<f32>(count);
        const logarithmic = near * fpow(ratio, fraction);
        const uniform = near + (far - near) * fraction;
        splits[i] = lambda * logarithmic + (1.0 - lambda) * uniform;
    }

    return splits;
}

/**
 * Fill the cascade half of the shadow block.
 *
 * Returns nothing; everything lands in `shadows`. The matrices are what the
 * shadow pass rasterises with *and* what the forward pass projects with, so
 * there is exactly one copy of them and no chance of the two disagreeing.
 */
export function computeCascades(
    shadows: Pointer<ShadowUniform>,
    camera: Reference<Camera>,
    aspect: f32,
    sunDirection: fvec3,
): void {
    const splits = splitDistances(camera.near);
    const count = cascadeCount();
    const sun = sunDirection.normalize();

    const view = camera.view();
    const invView = view.inverse();

    const tanHalfV = ftan(camera.fovY * 0.5);
    const tanHalfH = tanHalfV * aspect;

    const atlasWidth = cast<f32>(cascadeAtlasWidth());
    const atlasHeight = cast<f32>(cascadeAtlasHeight());

    const splitVector = new fvec4(splits[0], splits[1], splits[2], splits[3]);
    const texelWorld: FixedArray<f32, 4> = fixedArray(4, 0.0);
    const depthScale: FixedArray<f32, 4> = fixedArray(4, 0.0);

    let sliceNear = camera.near;

    for (let i: usize = 0; i < cast<usize>(count); i++) {
        const cascade = cast<u32>(i);
        const sliceFar = splits[i];
        const size = cascadeSize(cascade);

        // The slice's eight corners, in world space.
        const center = sliceCenter(invView, tanHalfH, tanHalfV, sliceNear, sliceFar);
        const radius = sliceRadius(invView, tanHalfH, tanHalfV, sliceNear, sliceFar, center);

        const distance = radius + casterMargin();
        const eye = center.addScaled(sun, distance);
        const lightView = fmat4.lookAt(eye, center, upFor(sun));

        const lightProj = snapToTexels(
            fmat4.ortho(-radius, radius, -radius, radius, 0.0, distance + radius),
            lightView,
            cast<f32>(size),
        );

        shadows.cascadeViewProj[i] = lightProj.mul(lightView);

        // The tile's place in the atlas, in UV.
        const tileX = cast<f32>(cascadeTileX(cascade));
        const tileSize = cast<f32>(size);
        shadows.cascadeRect[i] = new fvec4(
            tileX / atlasWidth,
            0.0,
            tileSize / atlasWidth,
            tileSize / atlasHeight,
        );

        texelWorld[i] = (radius * 2.0) / tileSize;

        // The orthographic projection maps `[0, distance + radius]` along the
        // light onto clip depth `[0, 1]`, linearly — so this is how much clip
        // depth one world unit is worth here. A bias stated in metres is
        // multiplied by it, which is what stops the same bias meaning four
        // centimetres in cascade 0 and half a metre in cascade 3.
        depthScale[i] = 1.0 / (distance + radius);

        sliceNear = sliceFar;
    }

    shadows.cascadeSplit = splitVector;
    shadows.cascadeTexelWorld = new fvec4(texelWorld[0], texelWorld[1], texelWorld[2], texelWorld[3]);
    shadows.cascadeDepthScale = new fvec4(depthScale[0], depthScale[1], depthScale[2], depthScale[3]);
    shadows.atlasTexel = new fvec4(
        1.0 / atlasWidth,
        1.0 / atlasHeight,
        1.0 / cast<f32>(spotAtlasSize()),
        1.0 / cast<f32>(spotAtlasSize()),
    );
}

/**
 * A shadow-casting spotlight's world-to-clip matrix.
 *
 * The projection's field of view is the *outer* cone angle doubled, so the map
 * covers exactly the cone and not a texel more — a spotlight's shadow resolution
 * is entirely a question of not wasting the map on darkness.
 *
 * The near plane is a fixed small number rather than something derived. A
 * spotlight here is short-range by design (four of them, no cascades), so the
 * depth range is never wide enough for the near plane to matter to precision.
 */
export function computeSpotViewProj(
    position: fvec3,
    direction: fvec3,
    cosOuter: f32,
    range: f32,
): fmat4 {
    const forward = direction.normalize();
    const view = fmat4.lookAt(position, position.add(forward), upFor(forward));

    // `cos_outer` is the cosine of the half-angle, so the full field of view is
    // twice its arc cosine. Clamped away from a degenerate cone.
    const halfAngle = facos(cosOuter < -0.999 ? -0.999 : (cosOuter > 0.999 ? 0.999 : cosOuter));
    const projection = fmat4.perspective(halfAngle * 2.0, 1.0, 0.05, range);

    return projection.mul(view);
}

/** Fill one spotlight's tile rect. The matrix is the caller's, from the light. */
export function setSpotShadow(shadows: Pointer<ShadowUniform>, slot: u32, viewProj: fmat4): void {
    const atlas = cast<f32>(spotAtlasSize());
    const tile = cast<f32>(spotShadowSize());

    const index = cast<usize>(slot);
    shadows.spotViewProj[index] = viewProj;
    shadows.spotRect[index] = new fvec4(
        cast<f32>(spotTileX(slot)) / atlas,
        cast<f32>(spotTileY(slot)) / atlas,
        tile / atlas,
        tile / atlas,
    );
}

/** The average of the slice's eight corners. */
function sliceCenter(
    invView: fmat4,
    tanHalfH: f32,
    tanHalfV: f32,
    sliceNear: f32,
    sliceFar: f32,
): fvec3 {
    let sum = fvec3.zero();
    for (let i: u32 = 0; i < 8; i++) {
        sum = sum.add(corner(invView, tanHalfH, tanHalfV, sliceNear, sliceFar, i));
    }
    return sum.scale(1.0 / 8.0);
}

/** The distance from `center` to the furthest of the eight corners. */
function sliceRadius(
    invView: fmat4,
    tanHalfH: f32,
    tanHalfV: f32,
    sliceNear: f32,
    sliceFar: f32,
    center: fvec3,
): f32 {
    let radius: f32 = 0.0;
    for (let i: u32 = 0; i < 8; i++) {
        const distance = corner(invView, tanHalfH, tanHalfV, sliceNear, sliceFar, i).distance(center);
        if (distance > radius) {
            radius = distance;
        }
    }
    // A hair of slack, so a corner exactly on the sphere is not clipped by
    // floating-point luck.
    return radius * 1.001;
}

/**
 * One of the slice's eight corners, in world space.
 *
 * Bit 0 picks the far plane, bit 1 the right side, bit 2 the top. View space is
 * right-handed with the camera down `-Z`, so a corner at distance `d` has
 * `z = -d`.
 */
function corner(
    invView: fmat4,
    tanHalfH: f32,
    tanHalfV: f32,
    sliceNear: f32,
    sliceFar: f32,
    index: u32,
): fvec3 {
    const depth = (index & 1) === 0 ? sliceNear : sliceFar;
    const x = ((index & 2) === 0 ? -1.0 : 1.0) * depth * tanHalfH;
    const y = ((index & 4) === 0 ? -1.0 : 1.0) * depth * tanHalfV;

    const world = invView.mulVec(new fvec4(x, y, -depth, 1.0));
    return new fvec3(world.x, world.y, world.z);
}

/**
 * An up vector that is not parallel to the light.
 *
 * `lookAt` crosses its forward vector with this one, so a sun directly overhead
 * with world up would give a zero cross product and a matrix of NaNs.
 */
function upFor(sun: fvec3): fvec3 {
    return fabs(sun.y) > 0.99 ? new fvec3(0.0, 0.0, 1.0) : new fvec3(0.0, 1.0, 0.0);
}

/**
 * Round the projection's origin to whole shadow texels.
 *
 * Without this the cascade slides continuously as the camera moves, every texel
 * boundary lands somewhere slightly different each frame, and shadow edges
 * crawl — very visible on a slow pan and impossible to ignore once seen. The
 * offset goes into the projection's translation column rather than into the
 * view, so it moves the sampling grid without moving the camera's idea of where
 * anything is.
 */
function snapToTexels(projection: fmat4, lightView: fmat4, size: f32): fmat4 {
    const shadowMatrix = projection.mul(lightView);
    const origin = shadowMatrix.mulVec(new fvec4(0.0, 0.0, 0.0, 1.0));

    const half = size * 0.5;
    const texelX = origin.x * half;
    const texelY = origin.y * half;

    const offsetX = (ffloor(texelX + 0.5) - texelX) / half;
    const offsetY = (ffloor(texelY + 0.5) - texelY) / half;

    const translation = new fvec4(
        projection.c3.x + offsetX,
        projection.c3.y + offsetY,
        projection.c3.z,
        projection.c3.w,
    );

    return fmat4.fromColumns(projection.c0, projection.c1, projection.c2, translation);
}
