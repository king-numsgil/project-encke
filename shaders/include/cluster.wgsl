// The cluster grid: 16 x 9 x 24 froxels, exponential in z.
//
// The x and y divisions are a plain screen-space tiling. The z divisions are
// *exponential*, so slices are dense near the camera and stretch out towards the
// far plane — which is where the depth complexity actually is, and a uniform
// split would spend most of its slices on the empty distance.
//
//     z(k) = near * (far / near) ^ (k / GRID_Z)
//
// Inverted, the slice a view-space distance falls in is a log and two constants,
// and those two constants are `Frame.cluster_z.xy`:
//
//     z_scale = GRID_Z / log(far / near)
//     z_bias  = -GRID_Z * log(near) / log(far / near)
//     slice   = floor(log(z) * z_scale + z_bias)
//
// They are computed CPU-side, once per projection change, in
// `src/renderer/frame/uniforms.ts`.

const GRID_X : u32 = 16u;
const GRID_Y : u32 = 9u;
const GRID_Z : u32 = 24u;
const CLUSTER_COUNT : u32 = GRID_X * GRID_Y * GRID_Z;

/**
 * Lights per cluster, hard cap.
 *
 * A cluster that overflows keeps the nearest 96 and drops the rest — see
 * `cluster_cull.wgsl`, which decides that by distance rather than by whichever
 * threads reached the atomic first. Dropping arbitrarily is what makes a
 * saturated cluster flicker as the camera moves.
 */
const MAX_LIGHTS_PER_CLUSTER : u32 = 96u;

/** Lights per scene, hard cap. The scene light buffer is exactly this long. */
const MAX_LIGHTS : u32 = 384u;

/** Flat index of a cluster, x fastest and z slowest. */
fn cluster_index(coord: vec3<u32>) -> u32 {
    return (coord.z * GRID_Y + coord.y) * GRID_X + coord.x;
}

/** The z slice a positive view-space distance falls in, clamped to the grid. */
fn cluster_slice(view_z: f32, z_scale: f32, z_bias: f32) -> u32 {
    let slice = i32(floor(log(max(view_z, 1e-4)) * z_scale + z_bias));
    return u32(clamp(slice, 0, i32(GRID_Z) - 1));
}

/**
 * The cluster a fragment belongs to.
 *
 * `frag_xy` is `@builtin(position).xy` — framebuffer pixels, origin top-left —
 * and `view_z` is the positive distance {@link linear_depth} returns.
 */
fn cluster_of_fragment(frag_xy: vec2<f32>, view_z: f32, tile_size: vec2<f32>, z_scale: f32, z_bias: f32) -> vec3<u32> {
    let tile = vec2<u32>(clamp(
        floor(frag_xy / tile_size),
        vec2<f32>(0.0),
        vec2<f32>(f32(GRID_X) - 1.0, f32(GRID_Y) - 1.0),
    ));
    return vec3<u32>(tile.x, tile.y, cluster_slice(view_z, z_scale, z_bias));
}

/** The near and far view-space distances of a z slice. */
fn slice_bounds(slice: u32, near: f32, far: f32) -> vec2<f32> {
    let ratio = far / near;
    let lo = near * pow(ratio, f32(slice) / f32(GRID_Z));
    let hi = near * pow(ratio, f32(slice + 1u) / f32(GRID_Z));
    return vec2<f32>(lo, hi);
}

/** Squared distance from `point` to the closest place inside an AABB. Zero when inside. */
fn aabb_distance_sq(point: vec3<f32>, box_min: vec3<f32>, box_max: vec3<f32>) -> f32 {
    let closest = clamp(point, box_min, box_max);
    let delta = point - closest;
    return dot(delta, delta);
}
