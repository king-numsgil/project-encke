// The uniform blocks, mirrored from WGSL by hand.
//
// There is no shared header between Goblin and WGSL, so each of these structs
// exists twice and keeping the pair in step is a manual obligation. Two things
// make that survivable:
//
//   * **Every member is a multiple of 16 bytes.** `mat4x4` is 64 and `vec4` is
//     16, and the `u32` fields come in groups of four. So every offset is a
//     multiple of 16 under *either* language's alignment rules, and the layouts
//     cannot disagree even if the two compilers align differently.
//   * Each struct names its WGSL counterpart. Change one, change the other.
//
// A `vec3` is deliberately never used. WGSL aligns it to 16 but sizes it 12, so
// what follows one depends on a padding rule rather than on arithmetic — and
// that is exactly the kind of disagreement the point above is meant to rule out.

import { fmat4, fvec3, fvec4 } from "std/linalg";
import { flog } from "std/math";
import {
    cascadeBlendFraction,
    clusterGridX,
    clusterGridY,
    clusterGridZ,
    shadowNormalBias,
    shadowPcfRadius,
    shadowWorldBias,
    spotDepthBias,
    spotNormalBias,
} from "../config.ts";

/** Mirrors `struct Frame` in `shaders/include/frame.wgsl`. 432 bytes. */
export interface FrameUniform {
    view: fmat4;
    proj: fmat4;
    viewProj: fmat4;
    invProj: fmat4;
    invView: fmat4;

    /** `xyz`: camera position in world space. */
    cameraPos: fvec4;

    /** `xyz`: unit vector pointing *towards* the sun. */
    sunDirection: fvec4;

    /** `rgb`: sun radiance with intensity folded in. `a`: ambient intensity. */
    sunColor: fvec4;

    /** `x`: z scale, `y`: z bias, `z`: near, `w`: far. */
    clusterZ: fvec4;

    /** `xy`: render size in pixels, `zw`: its reciprocal. */
    screen: fvec4;

    gridX: u32;
    gridY: u32;
    gridZ: u32;

    /** How many lights the scene buffer actually holds this frame. */
    lightCount: u32;

    /** `xy`: cluster tile size in pixels. `z`: shadow distance. `w`: elapsed seconds. */
    tile: fvec4;

    /** Which debug view the forward pass draws. See `DEBUG_*` in `forward.wgsl`. */
    debugMode: u32;
    debugPad0: u32;
    debugPad1: u32;
    debugPad2: u32;
}

/** Mirrors `struct Object`. 128 bytes. Pushed per draw. */
export interface ObjectUniform {
    model: fmat4;
    /** Inverse-transpose of `model`; the upper 3x3 is the normal basis. */
    normal: fmat4;
}

/** Mirrors `struct ShadowView` in `shaders/shadow_depth.wgsl`. 128 bytes. */
export interface ShadowViewUniform {
    viewProj: fmat4;
    model: fmat4;
}

/** Mirrors `struct Material` in `shaders/forward.wgsl`. 48 bytes. */
export interface MaterialUniform {
    /** `rgb`: base colour, linear. */
    albedo: fvec4;
    /** `x`: metallic, `y`: roughness, `z`: how much SSAO applies. */
    params: fvec4;
    /** `rgb`: emissive radiance. */
    emissive: fvec4;
}

/** Mirrors `struct Shadows` in `shaders/include/shadow.wgsl`. 704 bytes. */
export interface ShadowUniform {
    cascadeViewProj: FixedArray<fmat4, 4>;
    spotViewProj: FixedArray<fmat4, 4>;

    /** `xy`: tile UV offset in the atlas, `zw`: tile UV scale. */
    cascadeRect: FixedArray<fvec4, 4>;
    spotRect: FixedArray<fvec4, 4>;

    /** View-space distance at which each cascade ends. */
    cascadeSplit: fvec4;
    /** World units per shadow texel, per cascade. Drives the normal offset. */
    cascadeTexelWorld: fvec4;

    /** Clip depth per world unit along the light, per cascade. See `shadowWorldBias`. */
    cascadeDepthScale: fvec4;

    /** `xy`: one CSM atlas texel in UV, `zw`: one spot atlas texel in UV. */
    atlasTexel: fvec4;

    /** `x`: sun bias in world units, `y`: normal bias in texels, `z`: PCF radius, `w`: cascade blend. */
    params: fvec4;

    /** `x`: spot bias in clip depth, `y`: spot normal bias in world units. */
    spotParams: fvec4;
}

/** Mirrors `struct SsaoParams` in `shaders/ssao.wgsl`. 32 bytes. */
export interface SsaoUniform {
    /** `x`: world radius, `y`: bias, `z`: intensity, `w`: max screen radius in pixels. */
    settings: fvec4;
    /** `xy`: target size, `zw`: its reciprocal. */
    extent: fvec4;
}

/** Mirrors `struct Tonemap` in `shaders/tonemap.wgsl`. 16 bytes. */
export interface TonemapUniform {
    /** `x`: exposure, `y`: 1 when the swapchain encodes sRGB itself. */
    settings: fvec4;
}

/** Mirrors `struct Ui` in `shaders/ui.wgsl`. 32 bytes. */
export interface UiUniform {
    /** `xy`: pixels-to-clip scale, `zw`: its offset. */
    transform: fvec4;
    /** `x`: 1 when the swapchain encodes sRGB itself. */
    flags: fvec4;
}

/**
 * The two constants that turn a view-space distance into a cluster slice.
 *
 * ```
 * slice = floor(log(z) * scale + bias)
 * ```
 *
 * which is the inverse of the exponential split `z(k) = near * (far/near)^(k/N)`.
 * Computed here rather than in the shader because it depends only on the
 * projection, and a `log` per fragment to recompute a constant is a poor trade.
 */
export function clusterDepthScaleBias(near: f32, far: f32): fvec4 {
    const slices = cast<f32>(clusterGridZ());
    const ratio = flog(far / near);
    const scale = slices / ratio;
    const bias = -slices * flog(near) / ratio;
    return new fvec4(scale, bias, near, far);
}

/**
 * Fill the per-frame block.
 *
 * The matrices are the camera's; everything else is arithmetic over the render
 * size and the projection. `lightCount` is how many lights the scene buffer
 * holds *this frame*, and the culling pass loops to exactly that — a stale
 * larger number would read uninitialised lights.
 */
export function fillFrame(
    frame: Pointer<FrameUniform>,
    view: fmat4,
    projection: fmat4,
    cameraPosition: fvec3,
    sunDirection: fvec3,
    sunColor: fvec3,
    ambient: f32,
    width: u32,
    height: u32,
    near: f32,
    far: f32,
    lightCount: u32,
    shadowDistance: f32,
    elapsed: f32,
    debugMode: u32,
): void {
    const w = cast<f32>(width);
    const h = cast<f32>(height);

    frame.view = view;
    frame.proj = projection;
    frame.viewProj = projection.mul(view);
    frame.invProj = projection.inverse();
    frame.invView = view.inverse();

    frame.cameraPos = new fvec4(cameraPosition.x, cameraPosition.y, cameraPosition.z, 1.0);

    const sun = sunDirection.normalize();
    frame.sunDirection = new fvec4(sun.x, sun.y, sun.z, 0.0);
    frame.sunColor = new fvec4(sunColor.x, sunColor.y, sunColor.z, ambient);

    frame.clusterZ = clusterDepthScaleBias(near, far);
    frame.screen = new fvec4(w, h, 1.0 / w, 1.0 / h);

    frame.gridX = clusterGridX();
    frame.gridY = clusterGridY();
    frame.gridZ = clusterGridZ();
    frame.lightCount = lightCount;

    // Exact division, not a ceiling. 16 tiles of `w / 16` cover exactly `w`, so
    // the last tile's far edge lands on 1.0 in UV and the grid neither
    // overshoots the screen nor leaves a column uncovered.
    frame.tile = new fvec4(
        w / cast<f32>(clusterGridX()),
        h / cast<f32>(clusterGridY()),
        shadowDistance,
        elapsed,
    );

    frame.debugMode = debugMode;
    frame.debugPad0 = 0;
    frame.debugPad1 = 0;
    frame.debugPad2 = 0;
}

/**
 * Fill the per-draw block.
 *
 * The normal matrix is `transpose(inverse(model))` and not `model`. They differ
 * exactly when the transform has non-uniform scale, and the failure mode is
 * quiet: normals come out no longer perpendicular to the surface, so a squashed
 * object lights as though it were not squashed. Uniform scale would let the
 * shortcut through, and nothing here guarantees uniform scale.
 */
export function fillObject(object: Pointer<ObjectUniform>, transform: fmat4): void {
    object.model = transform;
    object.normal = transform.inverse().transpose();
}

/**
 * Fill the overlay block.
 *
 * The transform takes a pixel position with `y` down and the origin at the
 * top-left to clip space: `x` maps `[0, w]` to `[-1, 1]`, and `y` maps `[0, h]`
 * to `[1, -1]` — the sign flip is what puts `y = 0` at the top. Clip `+Y` is up
 * on screen here because SDL_gpu's Vulkan backend flips its own viewport.
 */
export function fillUi(
    ui: Pointer<UiUniform>,
    width: u32,
    height: u32,
    swapchainIsSrgb: boolean,
): void {
    const w = cast<f32>(width);
    const h = cast<f32>(height);

    ui.transform = new fvec4(2.0 / w, -2.0 / h, -1.0, 1.0);
    ui.flags = new fvec4(swapchainIsSrgb ? 1.0 : 0.0, 0.0, 0.0, 0.0);
}

/** The scalars every shadow lookup shares. */
export function fillShadowParams(shadows: Pointer<ShadowUniform>): void {
    shadows.params = new fvec4(
        shadowWorldBias(),
        shadowNormalBias(),
        shadowPcfRadius(),
        cascadeBlendFraction(),
    );
    shadows.spotParams = new fvec4(spotDepthBias(), spotNormalBias(), 0.0, 0.0);
}
