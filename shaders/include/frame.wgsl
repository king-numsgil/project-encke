// The per-frame constants, and the depth arithmetic that goes with them.
//
// This file declares no bindings — only the struct and pure functions over it.
// Bindings are each shader's own, because `shadercc` assigns SDL slots by rank
// among resources of the same kind, so a shared `var<uniform>` in here would
// silently take a different slot in every shader that included it.
//
// Mirrored on the CPU side by `src/renderer/frame/uniforms.ts`. Every member is
// a multiple of 16 bytes, so the offsets are the same under any alignment rule
// either side might apply — which is the only reason two hand-written layouts
// can be trusted to agree.

struct Frame {
    view      : mat4x4<f32>,
    proj      : mat4x4<f32>,
    view_proj : mat4x4<f32>,
    inv_proj  : mat4x4<f32>,
    inv_view  : mat4x4<f32>,

    /** Camera position in world space. `w` unused. */
    camera_pos : vec4<f32>,

    /** `xyz`: unit vector pointing *towards* the sun. `w` unused. */
    sun_direction : vec4<f32>,

    /** `rgb`: sun radiance, already scaled by intensity. `a`: ambient intensity. */
    sun_color : vec4<f32>,

    /** `x`: z_scale, `y`: z_bias, `z`: near, `w`: far. See `cluster.wgsl`. */
    cluster_z : vec4<f32>,

    /** `xy`: render target size in pixels. `zw`: its reciprocal. */
    screen : vec4<f32>,

    /** `xyz`: cluster grid dimensions. `w`: how many lights the scene buffer holds. */
    grid : vec4<u32>,

    /** `xy`: cluster tile size in pixels. `z`: shadow distance. `w`: frame time in seconds. */
    tile : vec4<f32>,

    /**
     * `x`: which debug view to draw, `yzw` unused.
     *
     * Not decoration. A clustered renderer that is subtly wrong looks exactly
     * like one that is right — a light assigned to the wrong froxel is a slightly
     * differently lit pixel, not a visible failure — so the occupancy heatmap is
     * the only practical way to see the culling actually working. See
     * `DEBUG_*` in `forward.wgsl`.
     */
    debug : vec4<u32>,
}

/**
 * View-space distance in front of the camera, from a depth buffer sample.
 *
 * Depth runs `[0, 1]` near-to-far — `fmat4.perspective` is the reverse-less
 * right-handed zero-to-one projection — so this is the plain inverse of that
 * mapping and it returns a *positive* distance, not the negative view-space z.
 */
fn linear_depth(depth: f32, near: f32, far: f32) -> f32 {
    return (far * near) / (far - depth * (far - near));
}

/**
 * Undo the projection: a view-space position from a UV and the positive
 * view-space distance {@link linear_depth} returns.
 *
 * `uv` is the ordinary texture convention with `v = 0` at the *top* of the
 * image, which is the row the rasteriser writes first. SDL_gpu's Vulkan backend
 * flips its own viewport so that clip `+Y` is up on screen, which is what makes
 * the `1 - 2v` here the right sign — established by rendering a triangle and
 * looking at it, per `tools/shadercc/README.md`, not by reasoning about it.
 *
 * **This assumes a symmetric perspective projection**, which is the only kind
 * `fmat4.perspective` builds and the only kind this renderer has. The general
 * form is `inv_proj * ndc` followed by a perspective divide, and for a
 * symmetric projection that whole 4x4 multiply collapses to two divides:
 * `inv_proj` is diagonal apart from the z row, so `view.xy` comes out as
 * `ndc.xy * distance` over the projection's own x and y scales, and `view.z` is
 * just the negated distance. A caller with an off-centre or sheared projection
 * would need the matrix back — `cluster_build.wgsl` still uses that form, since
 * it works from `ndc.z = 0` where there is no linear distance to start from.
 */
fn view_position_from_linear(uv: vec2<f32>, view_z: f32, proj: mat4x4<f32>) -> vec3<f32> {
    let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
    // `proj[0][0]` is `1 / (tan(fovY / 2) * aspect)` and `proj[1][1]` is
    // `1 / tan(fovY / 2)` — the two scales the projection applied on the way in.
    return vec3<f32>(ndc * view_z / vec2<f32>(proj[0][0], proj[1][1]), -view_z);
}

/** The UV a view-space position projects to, and its depth, packed as `xy` + `z`. */
fn project_to_uv(view_pos: vec3<f32>, proj: mat4x4<f32>) -> vec3<f32> {
    let clip = proj * vec4<f32>(view_pos, 1.0);
    let ndc = clip.xyz / clip.w;
    return vec3<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5, ndc.z);
}
