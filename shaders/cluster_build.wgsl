// Build the view-space bounding box of every cluster.
//
// Runs when the projection or the render size changes, not every frame: a
// cluster's bounds are a function of the frustum and the grid alone, and neither
// moves when the camera does. That is the whole reason clustering is done in
// *view* space — in world space these would be rebuilt every time the camera
// turned.
//
// A froxel is a truncated pyramid, and this stores its AABB instead. The box is
// looser than the froxel, so a light can be assigned to a cluster it does not
// quite touch; the cost of that is a few wasted iterations in the shading loop
// and the alternative is six plane tests per light per cluster.

//!include "frame.wgsl"
//!include "cluster.wgsl"

struct ClusterBounds {
    min_view : vec4<f32>,
    max_view : vec4<f32>,
}

@group(1) @binding(0) var<storage, read_write> bounds : array<ClusterBounds>;
@group(2) @binding(0) var<uniform> frame : Frame;

/** The view-space point where the ray through `uv` crosses the near plane. */
fn near_plane_point(uv: vec2<f32>) -> vec3<f32> {
    let ndc = vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
    let view = frame.inv_proj * ndc;
    return view.xyz / view.w;
}

@compute @workgroup_size(64, 1, 1)
fn cs_main(@builtin(global_invocation_id) id : vec3<u32>) {
    let index = id.x;
    if index >= CLUSTER_COUNT {
        return;
    }

    let x = index % GRID_X;
    let y = (index / GRID_X) % GRID_Y;
    let z = index / (GRID_X * GRID_Y);

    let tile = frame.tile.xy;
    let uv_min = (vec2<f32>(f32(x), f32(y)) * tile) * frame.screen.zw;
    let uv_max = (vec2<f32>(f32(x) + 1.0, f32(y) + 1.0) * tile) * frame.screen.zw;

    var corners : array<vec3<f32>, 4>;
    corners[0] = near_plane_point(vec2<f32>(uv_min.x, uv_min.y));
    corners[1] = near_plane_point(vec2<f32>(uv_max.x, uv_min.y));
    corners[2] = near_plane_point(vec2<f32>(uv_min.x, uv_max.y));
    corners[3] = near_plane_point(vec2<f32>(uv_max.x, uv_max.y));

    let range = slice_bounds(z, frame.cluster_z.z, frame.cluster_z.w);

    var lo = vec3<f32>(3.4e38);
    var hi = vec3<f32>(-3.4e38);

    for (var corner = 0u; corner < 4u; corner = corner + 1u) {
        let ray = corners[corner];
        // The corner sits on the near plane, so `-ray.z` is the near distance
        // and scaling by `distance / -ray.z` walks the same ray out to the
        // slice's own near and far planes. View space is right-handed, so a
        // point in front of the camera has a negative z.
        let inv_depth = 1.0 / max(-ray.z, 1e-6);

        for (var end = 0u; end < 2u; end = end + 1u) {
            let point = ray * (range[end] * inv_depth);
            lo = min(lo, point);
            hi = max(hi, point);
        }
    }

    bounds[index].min_view = vec4<f32>(lo, 0.0);
    bounds[index].max_view = vec4<f32>(hi, 0.0);
}
