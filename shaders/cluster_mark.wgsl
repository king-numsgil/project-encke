// Mark the clusters a visible fragment actually landed in.
//
// This is the pass that makes the depth pre-pass mandatory rather than merely
// helpful. Without it, light culling has to consider all 3456 froxels, most of
// which are empty air between the geometry and the far plane. With it, culling
// runs against the scene's real depth complexity: an indoor scene where every
// pixel is a metre away leaves the far twenty slices untouched and their culling
// never happens.
//
// One thread per pixel, deliberately not one per 2x2. A subsampled mark can miss
// a thin sliver of geometry, which leaves its cluster inactive, which drops
// *every* light there — a black speck that moves with the camera. The kernel is
// one texture load and one store; it is not worth being clever with.
//
// The store races — many pixels land in one cluster — and that is fine. Every
// racing thread writes the same value.

//!include "frame.wgsl"
//!include "cluster.wgsl"

@group(0) @binding(0) var depth_texture : texture_depth_2d;
@group(1) @binding(0) var<storage, read_write> cluster_active : array<u32>;
@group(2) @binding(0) var<uniform> frame : Frame;

@compute @workgroup_size(8, 8, 1)
fn cs_main(@builtin(global_invocation_id) id : vec3<u32>) {
    let size = vec2<u32>(frame.screen.xy);
    if id.x >= size.x || id.y >= size.y {
        return;
    }

    let depth = textureLoad(depth_texture, vec2<i32>(id.xy), 0);

    // Nothing was drawn here — the pre-pass cleared to 1.0 and left it. Marking
    // the far slice active for empty sky is exactly the waste this pass exists
    // to avoid.
    if depth >= 1.0 {
        return;
    }

    let view_z = linear_depth(depth, frame.cluster_z.z, frame.cluster_z.w);
    let coord = cluster_of_fragment(
        vec2<f32>(id.xy) + vec2<f32>(0.5),
        view_z,
        frame.tile.xy,
        frame.cluster_z.x,
        frame.cluster_z.y,
    );

    cluster_active[cluster_index(coord)] = 1u;
}
