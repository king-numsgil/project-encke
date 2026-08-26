// The opaque depth pre-pass.
//
// Mandatory, and not merely an overdraw optimisation. Light culling runs against
// this buffer: a cluster is only considered if a visible fragment actually landed
// in it, so the culling cost tracks the scene's real depth complexity instead of
// the full 16 x 9 x 24 froxel volume. Without it, every froxel between the near
// and far planes is a candidate and the whole point of clustering is lost.
//
// Position only. The pipeline declares one vertex attribute even though the
// buffer carries four, which is legal and means the other three are never
// fetched — the cheapest this pass can be while still writing correct depth.

//!include "frame.wgsl"

struct Object {
    model : mat4x4<f32>,
    /** Inverse-transpose of `model`. Unused here; kept so one struct serves every pass. */
    normal : mat4x4<f32>,
}

@group(1) @binding(0) var<uniform> frame : Frame;
@group(1) @binding(1) var<uniform> object : Object;

@vertex
fn vs_main(@location(0) position : vec3<f32>) -> @builtin(position) vec4<f32> {
    return frame.view_proj * (object.model * vec4<f32>(position, 1.0));
}

// No colour target and nothing to return. SDL still wants a fragment shader on
// the pipeline, so this is the empty one rather than a null.
@fragment
fn fs_main() {
}
