// Frustum culling.
//
// The one piece of per-frame CPU work in this renderer that scales with the
// scene rather than with the screen: every instance is tested against the camera
// frustum, and every caster against each of the four cascades and each shadow
// spotlight. So the number that matters is nanoseconds per sphere, and six
// planes of `dot` with an early out is what it should be.
//
// The centres are laid out once outside the timed region — allocating them
// inside would be benchmarking the allocator.

import { fmat4, fvec3 } from "std/linalg";
import { fpi } from "std/math";
import { Frustum } from "../../renderer/scene/frustum.ts";
import type { Bench } from "../bench.ts";

/** A cheap deterministic spread, so every run culls exactly the same set. */
function scatter(total: usize, extent: f32): fvec3[] {
    const centres: fvec3[] = [];
    centres.reserve(total);

    // A 32-bit xorshift. Deterministic across platforms, which is what a
    // benchmark that will be compared against itself next month needs.
    let state: u32 = 0x9e3779b9;
    for (let i: usize = 0; i < total; i++) {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        const x = cast<f32>(state % 2000) * 0.001 - 1.0;
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        const y = cast<f32>(state % 2000) * 0.001 - 1.0;
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        const z = cast<f32>(state % 2000) * 0.001 - 1.0;
        centres.push(new fvec3(x * extent, y * extent, z * extent));
    }

    return centres;
}

export function benchFrustum(b: Reference<Bench>): void {
    const view = fmat4.lookAt(fvec3.zero(), new fvec3(0.0, 0.0, -1.0), new fvec3(0.0, 1.0, 0.0));
    const frustum = new Frustum();
    frustum.build(fmat4.perspective(fpi() / 3.0, 16.0 / 9.0, 0.1, 500.0).mul(view));

    // Spread across a cube the camera sits in the middle of, so roughly a third
    // survive — the mixed case, where the early out fires often but not always.
    // A set that is entirely inside or entirely outside measures one branch.
    const batches: usize = 20;
    const perBatch: usize = 4096;
    const centres = scatter(perBatch, 200.0);
    let kept: usize = 0;

    b.run("frustum/containsSphere", batches, perBatch, (count) => {
        for (let i: usize = 0; i < count; i++) {
            if (frustum.containsSphere(centres[i], 1.0)) {
                kept += 1;
            }
        }
    });

    // The warmup batch is in this count too, which is why it is `batches + 1`.
    const tested = (batches + 1) * perBatch;
    console.log(`    ${kept} of ${tested} tests passed, so the early out is exercised`);
}
