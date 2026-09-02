// Cascade fitting.
//
// The README makes two claims about this file that nothing has ever checked:
// that the cascade extent is a **bounding sphere** and therefore does not change
// when the camera rotates, and that the projection origin is **snapped to whole
// texels** and therefore does not slide when the camera translates. Both exist
// to stop shadow edges crawling, and both fail silently — the shadows still
// render, they just boil, and by the time anyone notices it is attributed to PCF
// or to the bias.
//
// So those two are pinned here as arithmetic rather than as prose. The atlas
// layout is checked alongside them because a tile rect that disagrees with the
// tile the pass rasterises into is the other failure that looks like a shading
// bug.

import { fvec3, fvec4 } from "std/linalg";
import { fabs } from "std/math";
import {
    cameraFar,
    cameraFovY,
    cameraNear,
    cascadeAtlasHeight,
    cascadeAtlasWidth,
    cascadeCount,
    farCascadeSize,
    nearCascadeSize,
    shadowDistance,
    spotAtlasSize,
    spotShadowSize,
} from "../../renderer/config.ts";
import type { ShadowUniform } from "../../renderer/frame/uniforms.ts";
import { Camera } from "../../renderer/scene/camera.ts";
import {
    cascadeSize,
    cascadeTileX,
    computeCascades,
    spotTileX,
    spotTileY,
} from "../../renderer/scene/cascades.ts";
import type { Tester } from "../testing.ts";

/** The test scene's own camera placement, so the numbers are ones that ship. */
function sceneCamera(yaw: f32, pitch: f32, x: f32, y: f32, z: f32): Camera {
    const camera = new Camera();
    camera.fovY = cameraFovY();
    camera.near = cameraNear();
    camera.far = cameraFar();
    camera.place(new fvec3(x, y, z), yaw, pitch);
    return camera;
}

function sun(): fvec3 {
    return new fvec3(-0.45, -1.0, -0.3);
}

function aspect(): f32 {
    return 1600.0 / 900.0;
}

/**
 * How far the world origin's shadow-space position is from a whole texel.
 *
 * The snap works by pushing the projection's translation so that this lands on
 * an integer, so the distance to the nearest one is the residual it left behind
 * — zero, up to what `f32` can hold at the magnitude of a 2048-texel grid.
 */
function texelResidual(coordinate: f32, size: f32): f32 {
    const texel = coordinate * size * 0.5;
    const nearest = cast<f32>(cast<i64>(texel < 0.0 ? texel - 0.5 : texel + 0.5));
    return fabs(texel - nearest);
}

/** The component of an `fvec4` at `index`, since there is no indexing on one. */
function componentOf(value: fvec4, index: usize): f32 {
    if (index === 0) {
        return value.x;
    }
    if (index === 1) {
        return value.y;
    }
    if (index === 2) {
        return value.z;
    }
    return value.w;
}

export function testCascades(t: Reference<Tester>): void {
    const count = cast<usize>(cascadeCount());

    // -- the atlas layout ----------------------------------------------------
    //
    // A far cascade covers an enormous area at a density nobody can resolve, so
    // the near two are larger and the far two are not. The tile offsets follow
    // from that and from nothing else, which is why they are worth pinning: a
    // wrong offset samples a neighbouring cascade's depths.

    t.equalUsize("cascade 0 is a near tile", cast<usize>(cascadeSize(0)), cast<usize>(nearCascadeSize()));
    t.equalUsize("cascade 1 is a near tile", cast<usize>(cascadeSize(1)), cast<usize>(nearCascadeSize()));
    t.equalUsize("cascade 2 is a far tile", cast<usize>(cascadeSize(2)), cast<usize>(farCascadeSize()));
    t.equalUsize("cascade 3 is a far tile", cast<usize>(cascadeSize(3)), cast<usize>(farCascadeSize()));

    t.equalUsize("tile 0 starts at 0", cast<usize>(cascadeTileX(0)), 0);
    t.equalUsize("tile 1 follows tile 0", cast<usize>(cascadeTileX(1)), cast<usize>(nearCascadeSize()));
    t.equalUsize(
        "tile 2 follows both near tiles",
        cast<usize>(cascadeTileX(2)),
        cast<usize>(nearCascadeSize()) * 2,
    );
    t.equalUsize(
        "tile 3 follows tile 2",
        cast<usize>(cascadeTileX(3)),
        cast<usize>(nearCascadeSize()) * 2 + cast<usize>(farCascadeSize()),
    );
    t.equalUsize(
        "the four tiles exactly fill the atlas width",
        cast<usize>(cascadeTileX(3)) + cast<usize>(farCascadeSize()),
        cast<usize>(cascadeAtlasWidth()),
    );

    // Four spot tiles in a 2x2, which is the only arrangement that fits four
    // square tiles in a square atlas.
    t.equalUsize("spot tile 0 x", cast<usize>(spotTileX(0)), 0);
    t.equalUsize("spot tile 1 x", cast<usize>(spotTileX(1)), cast<usize>(spotShadowSize()));
    t.equalUsize("spot tile 2 x", cast<usize>(spotTileX(2)), 0);
    t.equalUsize("spot tile 0 y", cast<usize>(spotTileY(0)), 0);
    t.equalUsize("spot tile 1 y", cast<usize>(spotTileY(1)), 0);
    t.equalUsize("spot tile 2 y", cast<usize>(spotTileY(2)), cast<usize>(spotShadowSize()));
    t.equalUsize("spot tile 3 y", cast<usize>(spotTileY(3)), cast<usize>(spotShadowSize()));
    t.equalUsize(
        "the 2x2 exactly fills the spot atlas",
        cast<usize>(spotShadowSize()) * 2,
        cast<usize>(spotAtlasSize()),
    );

    // -- the fit -------------------------------------------------------------

    const shadows = alloc<ShadowUniform>();
    const camera = sceneCamera(-0.61, -0.24, 14.0, 7.0, 20.0);
    computeCascades(shadows, camera, aspect(), sun());

    // Splits are strictly increasing and the last one is the shadow distance,
    // beyond which nothing is shadowed at all. A non-monotonic split would put
    // two cascades in the wrong order and the selection in the shader picks the
    // first that contains the depth.
    let previous = camera.near;
    for (let i: usize = 0; i < count; i++) {
        const split = componentOf(shadows.cascadeSplit, i);
        t.ok(`split ${i} is beyond the one before it`, split > previous);
        previous = split;
    }
    t.nearly(
        "the last split is the shadow distance",
        componentOf(shadows.cascadeSplit, count - 1),
        shadowDistance(),
        0.01,
    );

    // World units per texel grows with the cascade, which is the entire reason
    // there are four of them. It is also what the normal offset is scaled by, so
    // a non-monotonic run here means a receiver bias that is too small far away
    // and too large near — acne at one end, peter-panning at the other.
    let previousTexel: f32 = 0.0;
    for (let i: usize = 0; i < count; i++) {
        const texel = componentOf(shadows.cascadeTexelWorld, i);
        t.ok(`cascade ${i} covers more world per texel than the one before it`, texel > previousTexel);
        previousTexel = texel;
    }

    // Clip depth per world unit shrinks as the volume deepens. This is what
    // turns a bias stated in metres into the right number of clip units in each
    // cascade, instead of four centimetres in one and half a metre in another.
    let previousDepth = componentOf(shadows.cascadeDepthScale, 0);
    t.ok("cascade 0 depth scale is positive", previousDepth > 0.0);
    for (let i: usize = 1; i < count; i++) {
        const scale = componentOf(shadows.cascadeDepthScale, i);
        t.ok(`cascade ${i} has a shallower depth scale than the one before it`, scale < previousDepth);
        previousDepth = scale;
    }

    // The tile rects, in UV, against the layout checked above.
    const atlasWidth = cast<f32>(cascadeAtlasWidth());
    const atlasHeight = cast<f32>(cascadeAtlasHeight());
    for (let i: usize = 0; i < count; i++) {
        const cascade = cast<u32>(i);
        const size = cast<f32>(cascadeSize(cascade));
        const rect = shadows.cascadeRect[i];
        t.nearly(`rect ${i} offset`, rect.x, cast<f32>(cascadeTileX(cascade)) / atlasWidth, 1e-6);
        t.equalF32(`rect ${i} sits at the top of the atlas`, rect.y, 0.0);
        t.nearly(`rect ${i} width`, rect.z, size / atlasWidth, 1e-6);
        t.nearly(`rect ${i} height`, rect.w, size / atlasHeight, 1e-6);
    }

    t.nearly("atlas texel x", shadows.atlasTexel.x, 1.0 / atlasWidth, 1e-9);
    t.nearly("atlas texel y", shadows.atlasTexel.y, 1.0 / atlasHeight, 1e-9);

    // -- the texel snap ------------------------------------------------------
    //
    // The world origin projected through each cascade must land on a whole
    // texel. That is the whole mechanism: without it the grid slides by a
    // fraction of a texel every frame the camera moves and the shadow edges
    // crawl.

    for (let i: usize = 0; i < count; i++) {
        const size = cast<f32>(cascadeSize(cast<u32>(i)));
        const origin = shadows.cascadeViewProj[i].mulVec(new fvec4(0.0, 0.0, 0.0, 1.0));
        t.nearly(`cascade ${i} origin is on a texel in x`, texelResidual(origin.x, size), 0.0, 0.02);
        t.nearly(`cascade ${i} origin is on a texel in y`, texelResidual(origin.y, size), 0.0, 0.02);
    }

    // -- rotation invariance --------------------------------------------------
    //
    // A bounding *box* fitted to the frustum slice changes size as the camera
    // turns, so every texel moves and the edges crawl. A bounding sphere does
    // not. The extent is what `cascadeTexelWorld` is derived from, so if it is
    // identical after a 63-degree yaw and a pitch change, the fit is rotation
    // invariant — and if somebody swaps the sphere for a box, this is what
    // catches it.

    const turned = alloc<ShadowUniform>();
    computeCascades(turned, sceneCamera(1.5, 0.4, 14.0, 7.0, 20.0), aspect(), sun());
    for (let i: usize = 0; i < count; i++) {
        t.nearly(
            `cascade ${i} extent survives a rotation`,
            componentOf(turned.cascadeTexelWorld, i),
            componentOf(shadows.cascadeTexelWorld, i),
            1e-4,
        );
    }

    // -- translation invariance -----------------------------------------------
    //
    // Moving the camera changes where a cascade *is* but not how big it is, and
    // the snap keeps the grid on whole texels wherever it lands. A sub-texel
    // move is the case that used to shimmer.

    const moved = alloc<ShadowUniform>();
    computeCascades(moved, sceneCamera(-0.61, -0.24, 14.003, 7.0, 20.0), aspect(), sun());
    for (let i: usize = 0; i < count; i++) {
        t.nearly(
            `cascade ${i} extent survives a translation`,
            componentOf(moved.cascadeTexelWorld, i),
            componentOf(shadows.cascadeTexelWorld, i),
            1e-4,
        );

        const size = cast<f32>(cascadeSize(cast<u32>(i)));
        const origin = moved.cascadeViewProj[i].mulVec(new fvec4(0.0, 0.0, 0.0, 1.0));
        t.nearly(
            `cascade ${i} stays on a texel after a sub-texel move`,
            texelResidual(origin.x, size),
            0.0,
            0.02,
        );
    }

    // -- a sun straight down ---------------------------------------------------
    //
    // `lookAt` crosses its forward vector with an up vector, so a sun parallel
    // to world up would give a zero cross product and a matrix of NaNs. The
    // `upFor` switch exists for it, and a NaN here would silently blank every
    // shadow in the scene.

    const overhead = alloc<ShadowUniform>();
    computeCascades(overhead, sceneCamera(0.0, -0.3, 0.0, 5.0, 0.0), aspect(), new fvec3(0.0, -1.0, 0.0));
    for (let i: usize = 0; i < count; i++) {
        const texel = componentOf(overhead.cascadeTexelWorld, i);
        // A NaN fails both comparisons, which is exactly what should happen.
        t.ok(`a sun straight overhead gives cascade ${i} a real extent`, texel > 0.0 && texel < 1000.0);
    }

    overhead.free();
    moved.free();
    turned.free();
    shadows.free();
}
