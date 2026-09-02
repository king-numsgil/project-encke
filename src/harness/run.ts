// The console harness.
//
// `main.ts` branches here immediately after SDL is up, before a window or a GPU
// device exists, so nothing reachable from this file may touch either. That is
// the constraint that makes the harness useful: it runs on a machine with no
// display, in CI, and over a remote shell, and it is the only way to execute a
// line of this program without a driver.
//
// The exit status is the number of failures clamped to one, so a run is a single
// command with a meaningful result and needs no output parsing.

import { runModeBenches, runModeList, type Options } from "../app/options.ts";
import { Bench } from "./bench.ts";
import { allBenchmarks, allSuites } from "./suites.ts";
import { Tester } from "./testing.ts";

/**
 * Whether `name` is wanted, given the filter.
 *
 * A substring match rather than a glob, because the names are `area/what` and
 * the two things anyone ever wants are one area and one case. An empty filter
 * matches everything, which is what makes `--headless` on its own the full run.
 */
function selected(name: string, filter: string): boolean {
    return filter.length === 0 || name.indexOf(filter) >= 0;
}

export function runHeadless(options: Reference<Options>): i32 {
    if (options.harness === runModeList()) {
        return listCases(options.filter);
    }
    if (options.harness === runModeBenches()) {
        return runBenchmarks(options.filter);
    }
    return runTests(options.filter);
}

function listCases(filter: string): i32 {
    const suites = allSuites();
    const benchmarks = allBenchmarks();

    console.log("");
    console.log("tests");
    for (let i: usize = 0; i < suites.length; i++) {
        if (selected(suites[i].name, filter)) {
            console.log(`  ${suites[i].name}`);
        }
    }

    console.log("");
    console.log("benches");
    for (let i: usize = 0; i < benchmarks.length; i++) {
        if (selected(benchmarks[i].name, filter)) {
            console.log(`  ${benchmarks[i].name}`);
        }
    }
    console.log("");

    return 0;
}

function runTests(filter: string): i32 {
    const suites = allSuites();
    const tester = new Tester();

    let ran: u32 = 0;
    let failedSuites: u32 = 0;

    console.log("");
    for (let i: usize = 0; i < suites.length; i++) {
        if (!selected(suites[i].name, filter)) {
            continue;
        }
        ran += 1;
        tester.begin(suites[i].name);
        suites[i].run(tester);
        if (!tester.end()) {
            failedSuites += 1;
        }
    }

    console.log("");
    if (ran === 0) {
        // Not a pass. A filter that matches nothing is nearly always a typo, and
        // a green run is the worst possible answer to one.
        console.log(`harness: no suite matched '${filter}'`);
        return 1;
    }

    if (tester.failures === 0) {
        console.log(`harness: ${tester.checks} checks in ${ran} suites, all passed`);
        return 0;
    }

    console.log(
        `harness: ${tester.failures} of ${tester.checks} checks failed, ` +
        `in ${failedSuites} of ${ran} suites`,
    );
    return 1;
}

function runBenchmarks(filter: string): i32 {
    const benchmarks = allBenchmarks();
    const bench = new Bench();

    let ran: u32 = 0;

    console.log("");
    for (let i: usize = 0; i < benchmarks.length; i++) {
        if (!selected(benchmarks[i].name, filter)) {
            continue;
        }
        ran += 1;
        console.log(`${benchmarks[i].name}`);
        benchmarks[i].run(bench);
        console.log("");
    }

    if (ran === 0) {
        console.log(`harness: no benchmark matched '${filter}'`);
        return 1;
    }

    // The same caution the renderer's benchmark carries, for the CPU's version
    // of the same problem: a number here is comparable against another run of
    // this build on this machine, and against nothing else.
    console.log("  Wall time on the CPU, one process, no pinning and no governor control.");
    console.log("  Comparable against another run of this benchmark and not against anything else.");
    console.log("");
    return 0;
}
