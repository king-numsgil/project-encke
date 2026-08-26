// Assign lights to clusters, sorted furthest-first.
//
// One workgroup per cluster, 128 lanes. A cluster no fragment landed in returns
// immediately — that test is uniform across the workgroup, so the early return
// is legal and it is where the depth pre-pass pays for itself.
//
// **Why the sort, and why furthest-first.** The shading loop accumulates one
// `vec3<f32>` across up to 96 lights. Summing floats smallest-first is the
// standard way to keep a running total from swallowing the small terms, and a
// distant light's contribution is the small term. Without the sort, two adjacent
// clusters holding the same lights in different orders accumulate to visibly
// different values, and the cluster grid prints itself on the image as squares.
// Sorting gives neighbouring clusters the same order and the squares go away.
//
// Overflow is handled by the same ordering. A cluster with more than 96
// candidates keeps the *last* 96 of the sorted list — the nearest, which are the
// ones that matter — rather than whichever 96 happened to win the atomic.

//!include "frame.wgsl"
//!include "cluster.wgsl"
//!include "light.wgsl"

struct ClusterBounds {
    min_view : vec4<f32>,
    max_view : vec4<f32>,
}

/**
 * Candidates considered per cluster before the sort.
 *
 * Wider than `MAX_LIGHTS_PER_CLUSTER` so that overflow is decided by distance
 * rather than by which thread reached the atomic first, and a power of two
 * because the sort below is a bitonic network. Beyond this a cluster does drop
 * lights arbitrarily — 128 punctual lights overlapping one froxel is a scene
 * problem, not a renderer one.
 */
const SORT_WIDTH : u32 = 128u;

@group(0) @binding(0) var<storage, read> bounds : array<ClusterBounds>;
@group(0) @binding(1) var<storage, read> lights : array<Light>;
@group(0) @binding(2) var<storage, read> cluster_active : array<u32>;

@group(1) @binding(0) var<storage, read_write> light_count : array<u32>;
@group(1) @binding(1) var<storage, read_write> light_index : array<u32>;

@group(2) @binding(0) var<uniform> frame : Frame;

var<workgroup> found : atomic<u32>;
var<workgroup> sort_key : array<f32, 128>;
var<workgroup> sort_value : array<u32, 128>;

/**
 * Sort `sort_key` descending, carrying `sort_value` with it.
 *
 * A bitonic network: 28 compare-exchange stages for 128 elements, each lane
 * owning one slot. Every barrier is at the top level of the loop rather than
 * inside the `partner > lane` test — a barrier reached by only some lanes of a
 * workgroup is undefined, and that test is exactly what makes control flow
 * non-uniform.
 */
fn bitonic_sort_descending(lane : u32) {
    for (var k = 2u; k <= SORT_WIDTH; k = k << 1u) {
        for (var j = k >> 1u; j > 0u; j = j >> 1u) {
            let partner = lane ^ j;

            if partner > lane {
                let a = sort_key[lane];
                let b = sort_key[partner];

                // Ascending would swap on `(a > b) == up`. Inverting the test
                // is what makes the whole network run the other way.
                let up = (lane & k) == 0u;
                if (a < b) == up {
                    sort_key[lane] = b;
                    sort_key[partner] = a;

                    let carried = sort_value[lane];
                    sort_value[lane] = sort_value[partner];
                    sort_value[partner] = carried;
                }
            }

            workgroupBarrier();
        }
    }
}

@compute @workgroup_size(128, 1, 1)
fn cs_main(
    @builtin(workgroup_id) group : vec3<u32>,
    @builtin(local_invocation_index) lane : u32,
) {
    let cluster = group.x;
    if cluster >= CLUSTER_COUNT {
        return;
    }

    // Uniform across the workgroup — `cluster` does not vary within one — so
    // returning here does not strand anybody at a barrier below.
    if cluster_active[cluster] == 0u {
        if lane == 0u {
            light_count[cluster] = 0u;
        }
        return;
    }

    // Padding sorts to the end: every real key is a squared distance and so is
    // non-negative.
    sort_key[lane] = -1.0;
    sort_value[lane] = 0u;
    if lane == 0u {
        atomicStore(&found, 0u);
    }
    workgroupBarrier();

    let lo = bounds[cluster].min_view.xyz;
    let hi = bounds[cluster].max_view.xyz;
    let center = (lo + hi) * 0.5;

    let total = frame.grid.w;
    for (var i = lane; i < total; i = i + SORT_WIDTH) {
        let light = lights[i];
        let view_pos = (frame.view * vec4<f32>(light.position, 1.0)).xyz;

        // Sphere against the froxel's AABB. A spotlight is culled by its
        // bounding sphere too — the cone test is a handful of instructions in
        // the shading loop, where it runs for the few clusters that kept the
        // light, rather than here where it would run for all of them.
        if aabb_distance_sq(view_pos, lo, hi) > light.range * light.range {
            continue;
        }

        let slot = atomicAdd(&found, 1u);
        if slot < SORT_WIDTH {
            sort_key[slot] = distance(view_pos, center);
            sort_value[slot] = i;
        }
    }
    workgroupBarrier();

    bitonic_sort_descending(lane);

    let candidates = min(atomicLoad(&found), SORT_WIDTH);
    let kept = min(candidates, MAX_LIGHTS_PER_CLUSTER);
    // The nearest `kept` are the tail of a descending sort, and copying from
    // there preserves furthest-first among the ones that survive.
    let first = candidates - kept;

    if lane < kept {
        light_index[cluster * MAX_LIGHTS_PER_CLUSTER + lane] = sort_value[first + lane];
    }
    if lane == 0u {
        light_count[cluster] = kept;
    }
}
