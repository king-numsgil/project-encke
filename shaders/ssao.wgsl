// Screen-space ambient occlusion, from depth alone.
//
// Three deliberate cheats, in the renderer's stated spirit:
//
//   * **No normal buffer.** Normals are reconstructed from the depth buffer's
//     neighbours, which keeps the depth pre-pass genuinely depth-only — the
//     fastest thing a GPU does — instead of turning it into a partial G-buffer
//     for one consumer.
//   * **Half resolution.** Occlusion is low-frequency; the forward pass samples
//     this target with a linear sampler at full-resolution UVs, so the upsample
//     is the hardware's bilinear filter and costs nothing. There is no separate
//     upsample pass because there does not need to be one.
//   * **Alchemy-style obscurance**, not a hemisphere of oriented kernel samples.
//     One spiral of taps, no kernel to upload, no random-vector texture to bind,
//     and it degrades to noise rather than to banding — which the blur removes.
//
// HBAO is not here and is not coming: it was tried, it cost more, and it did not
// look better on this content.

//!include "frame.wgsl"
//!include "fullscreen.wgsl"

struct SsaoParams {
    /** `x`: world-space radius. `y`: depth bias. `z`: intensity. `w`: max screen radius, pixels. */
    settings : vec4<f32>,
    /** `xy`: this target's size in pixels. `zw`: its reciprocal. */
    extent : vec4<f32>,
}

@group(2) @binding(0) var depth_texture : texture_depth_2d;
@group(3) @binding(0) var<uniform> frame : Frame;
@group(3) @binding(1) var<uniform> params : SsaoParams;

const TAP_COUNT : u32 = 12u;
const SPIRAL_TURNS : f32 = 7.0;
const TAU : f32 = 6.28318530718;

/**
 * View-space position of a full-resolution depth texel, clamped to the image.
 *
 * Reconstructed from the *linear* distance rather than by multiplying the NDC
 * position through `inv_proj`. This runs seventeen times per pixel — once for
 * the centre, four times for the reconstructed normal, and once per tap — so a
 * 4x4 multiply here was the single largest piece of arithmetic in the pass.
 * See `view_position_from_linear` for what makes the collapse legal.
 */
fn load_view_position(coord : vec2<i32>, size : vec2<i32>) -> vec3<f32> {
    let clamped = clamp(coord, vec2<i32>(0), size - vec2<i32>(1));
    let depth = textureLoad(depth_texture, clamped, 0);
    let uv = (vec2<f32>(clamped) + vec2<f32>(0.5)) / vec2<f32>(size);
    let view_z = linear_depth(depth, frame.cluster_z.z, frame.cluster_z.w);
    return view_position_from_linear(uv, view_z, frame.proj);
}

/**
 * A view-space normal from four depth neighbours.
 *
 * The naive version takes forward differences and produces a normal that
 * straddles every silhouette, drawing a bright halo around each object. Choosing
 * the *closer* neighbour on each axis keeps the basis on one surface, which is
 * the cheapest fix that works.
 */
fn reconstruct_normal(coord : vec2<i32>, center : vec3<f32>, size : vec2<i32>) -> vec3<f32> {
    let left = load_view_position(coord + vec2<i32>(-1, 0), size);
    let right = load_view_position(coord + vec2<i32>(1, 0), size);
    // Screen y grows downward, so `north` is the row above and the one whose
    // view-space y is greater.
    let north = load_view_position(coord + vec2<i32>(0, -1), size);
    let south = load_view_position(coord + vec2<i32>(0, 1), size);

    let dx = select(right - center, center - left, abs(left.z - center.z) < abs(right.z - center.z));
    let dy = select(north - center, center - south, abs(south.z - center.z) < abs(north.z - center.z));

    let normal = normalize(cross(dx, dy));
    // View space is right-handed with the camera down -z, so a visible surface
    // faces +z. A degenerate cross can come out backwards; flipping is cheaper
    // than detecting it.
    return select(normal, -normal, normal.z < 0.0);
}

/**
 * One of sixteen rotations, chosen by the pixel's place in a 4x4 tile.
 *
 * **Sixteen, on a 4x4 grid, because the blur is a 4x4 box.** That pairing is the
 * whole design: every 4x4 neighbourhood contains each rotation exactly once, so
 * averaging one is averaging the complete set and the sampling pattern cancels
 * out entirely.
 *
 * Interleaved gradient noise was here first and was the wrong choice. It is a
 * continuous function with no period on a 4-pixel grid, so a 4x4 box averages an
 * arbitrary subset of rotations rather than all of them, and what survives is a
 * regular diagonal hatch across every surface — more objectionable than the
 * noise it replaced, because the eye reads structure as geometry.
 */
fn tap_rotation(pixel : vec2<f32>) -> f32 {
    let cell = vec2<u32>(pixel) & vec2<u32>(3u, 3u);
    let index = cell.y * 4u + cell.x;
    return f32(index) * (TAU / 16.0);
}

@vertex
fn vs_main(@builtin(vertex_index) index : u32) -> FullscreenOut {
    return fullscreen_vertex(index);
}

@fragment
fn fs_main(in : FullscreenOut) -> @location(0) vec4<f32> {
    let depth_size = vec2<i32>(frame.screen.xy);
    // This target is half resolution; `* 2` is the full-resolution texel it
    // stands for. The rounding is deliberate — occlusion is being blurred anyway.
    let center_coord = vec2<i32>(in.position.xy) * 2;

    let center_depth = textureLoad(
        depth_texture,
        clamp(center_coord, vec2<i32>(0), depth_size - vec2<i32>(1)),
        0,
    );

    // Nothing was drawn here. Unoccluded, so the sky is not darkened.
    if center_depth >= 1.0 {
        return vec4<f32>(1.0, 0.0, 0.0, 1.0);
    }

    // Reconstructed from `center_coord`, **not** from `in.uv`. This target is
    // half resolution, so `in.uv` is the centre of a 2x2 block of depth texels
    // while the depth above came from one corner of it. Mixing the two puts the
    // centre position half a texel away from its own depth, and the error is a
    // function of sub-pixel alignment — which is to say it varies in a regular
    // pattern across the screen and prints a hatch over every surface.
    let center = load_view_position(center_coord, depth_size);
    let normal = reconstruct_normal(center_coord, center, depth_size);
    let center_z = -center.z;

    // How many pixels the world-space radius covers at this depth. `proj[1][1]`
    // is `1 / tan(fovY / 2)`, so this is the perspective divide written out.
    let projected = params.settings.x * frame.proj[1][1] * 0.5 * frame.screen.y / max(center_z, 1e-4);
    let radius_px = min(projected, params.settings.w);

    if radius_px < 1.0 {
        return vec4<f32>(1.0, 0.0, 0.0, 1.0);
    }

    let rotation = tap_rotation(in.position.xy);
    var occlusion = 0.0;

    for (var i = 0u; i < TAP_COUNT; i = i + 1u) {
        // A spiral rather than a disc: the radius grows with the tap index, so
        // near and far occluders are both sampled without a second loop.
        let alpha = (f32(i) + 0.5) / f32(TAP_COUNT);
        let angle = alpha * SPIRAL_TURNS * TAU + rotation;
        let offset = vec2<f32>(cos(angle), sin(angle)) * (alpha * radius_px);

        let tap_coord = center_coord + vec2<i32>(offset);
        let tap_depth = textureLoad(
            depth_texture,
            clamp(tap_coord, vec2<i32>(0), depth_size - vec2<i32>(1)),
            0,
        );
        if tap_depth >= 1.0 {
            continue;
        }

        let tap_uv = (vec2<f32>(clamp(tap_coord, vec2<i32>(0), depth_size - vec2<i32>(1))) + vec2<f32>(0.5))
            / frame.screen.xy;
        // Not `load_view_position`: the depth is already in hand from the early
        // out above, and loading it a second time is the one thing this loop
        // cannot afford.
        let tap_z = linear_depth(tap_depth, frame.cluster_z.z, frame.cluster_z.w);
        let tap_view = view_position_from_linear(tap_uv, tap_z, frame.proj);

        // Alchemy's estimator: how far the tap rises above the tangent plane,
        // divided by how far away it is.
        //
        // The bias is in **world units**, not scaled by depth. Scaling it by
        // `center_z` looks defensible — depth precision does degrade with
        // distance — but the numbers do not work: `dot(delta, normal)` is bounded
        // by the sampling radius, 0.6 units here, while `bias * center_z` reaches
        // 0.4 at twenty metres. The subtraction goes negative everywhere and the
        // whole buffer comes back white. Distant geometry needs no protection
        // anyway, because its projected radius falls below a pixel and the early
        // return above has already skipped it.
        let delta = tap_view - center;
        let above = dot(delta, normal) - params.settings.y;
        occlusion = occlusion + max(above, 0.0) / (dot(delta, delta) + 0.01);
    }

    let ao = saturate(1.0 - occlusion * params.settings.z / f32(TAP_COUNT));
    return vec4<f32>(ao, 0.0, 0.0, 1.0);
}
