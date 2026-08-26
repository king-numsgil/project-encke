// Zero the cluster_active-cluster flags.
//
// Its own dispatch rather than a buffer upload: 3456 words is 13 KB across the
// PCIe bus every frame against a kernel that finishes in microseconds and never
// leaves VRAM.
//
// The per-cluster light *counts* are deliberately not cleared here. The culling
// pass writes a count for every cluster it visits, cluster_active or not — zero for the
// incluster_active ones — so there is never a stale count for the forward pass to read.

//!include "cluster.wgsl"

@group(1) @binding(0) var<storage, read_write> cluster_active : array<u32>;

@compute @workgroup_size(64, 1, 1)
fn cs_main(@builtin(global_invocation_id) id : vec3<u32>) {
    if id.x >= CLUSTER_COUNT {
        return;
    }
    cluster_active[id.x] = 0u;
}
