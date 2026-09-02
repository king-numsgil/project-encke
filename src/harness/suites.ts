// The registry.
//
// Explicit, and it has to be: there is no top-level code in this language and no
// static initialiser, so nothing can register itself by existing. A suite is in
// the harness because it is named here and for no other reason — which is worse
// for ceremony and better for reading, since this file is the whole list.
//
// Names are `area/what`, and the `--filter` match is a substring over the whole
// thing, so `--filter geometry` and `--filter ecs/` both do the obvious thing.

import type { Benchmark } from "./bench.ts";
import { benchFrustum } from "./suites/frustum_bench.ts";
import { testCascades } from "./suites/cascades_test.ts";
import { testFrustum } from "./suites/frustum_test.ts";
import { benchGeometry } from "./suites/geometry_bench.ts";
import { testGeometry } from "./suites/geometry_test.ts";
import { testOptions } from "./suites/options_test.ts";
import type { Suite } from "./testing.ts";

/**
 * Every test suite, in the order they run.
 *
 * Built inside a function rather than bound to a name at the top of the file,
 * because there is no top-level `const` here. It is called once per run.
 */
export function allSuites(): Suite[] {
    const suites: Suite[] = [];
    suites.push({name: "app/options", run: testOptions});
    suites.push({name: "geometry/meshes", run: testGeometry});
    suites.push({name: "scene/frustum", run: testFrustum});
    suites.push({name: "scene/cascades", run: testCascades});
    return suites;
}

/** Every CPU benchmark. */
export function allBenchmarks(): Benchmark[] {
    const benchmarks: Benchmark[] = [];
    benchmarks.push({name: "geometry", run: benchGeometry});
    benchmarks.push({name: "frustum", run: benchFrustum});
    return benchmarks;
}
