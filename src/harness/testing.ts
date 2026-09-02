// Assertions, and a tally of them.
//
// Deliberately small. There is no `expect`, no matcher chain and no fixture
// mechanism, because a check here is nearly always "this number should be that
// number" and the elaborate spelling of it buys nothing in a project this size.
//
// Two rules the surface follows:
//
//   * **A failure prints both values.** A check that only says "failed" makes you
//     rerun it under a debugger to learn what a debugger would have told you.
//     That is why there is a comparison per width rather than one generic one —
//     `${}` cannot interpolate a struct, and a generic `equal<T>` therefore has
//     nothing to print. It is still here, for the POD structs that need it.
//   * **Nothing throws and nothing stops.** There are no exceptions in this
//     language, and a suite that stopped at the first failure would hide every
//     other one behind it. A failing check records itself and the suite carries
//     on, so one run tells you everything that is wrong.

import { format } from "../core/stats.ts";

export class Tester {
    /** Every check attempted, across every suite. */
    checks: u32;
    /** Every check that failed. Non-zero is the process's exit status. */
    failures: u32;

    /** The suite currently running, for the failure lines. */
    private suite: string;
    /** {@link failures} as it stood when the current suite began. */
    private entryFailures: u32;
    private entryChecks: u32;

    constructor() {
        this.checks = 0;
        this.failures = 0;
        this.suite = "";
        this.entryFailures = 0;
        this.entryChecks = 0;
    }

    begin(suite: string): void {
        this.suite = suite;
        this.entryFailures = this.failures;
        this.entryChecks = this.checks;
    }

    /** Print the suite's one-line result. Returns whether it passed. */
    end(): boolean {
        const failed = this.failures - this.entryFailures;
        const ran = this.checks - this.entryChecks;
        if (failed === 0) {
            console.log(`  ok    ${this.suite}  (${ran} checks)`);
            return true;
        }
        console.log(`  FAIL  ${this.suite}  (${failed} of ${ran} checks)`);
        return false;
    }

    ok(name: string, condition: boolean): boolean {
        this.checks += 1;
        if (condition) {
            return true;
        }
        this.report(name, "was false");
        return false;
    }

    /**
     * Equality by the type, for anything `equalsOf` answers for — which includes
     * a POD struct, compared field by field.
     *
     * No values in the message, because there is no way to interpolate an
     * arbitrary `T`. Reach for one of the width-specific comparisons below where
     * the numbers would help, which is nearly always.
     */
    equal<T>(name: string, actual: T, expected: T): boolean {
        this.checks += 1;
        if (equalsOf<T>(actual, expected)) {
            return true;
        }
        this.report(name, "values differ");
        return false;
    }

    equalU64(name: string, actual: u64, expected: u64): boolean {
        this.checks += 1;
        if (actual === expected) {
            return true;
        }
        this.report(name, `got ${actual}, want ${expected}`);
        return false;
    }

    equalUsize(name: string, actual: usize, expected: usize): boolean {
        this.checks += 1;
        if (actual === expected) {
            return true;
        }
        this.report(name, `got ${actual}, want ${expected}`);
        return false;
    }

    equalI32(name: string, actual: i32, expected: i32): boolean {
        this.checks += 1;
        if (actual === expected) {
            return true;
        }
        this.report(name, `got ${actual}, want ${expected}`);
        return false;
    }

    /**
     * Exact float equality, which is what you want for a value that was *stored*
     * rather than computed — a UV of 1.0, a handedness of -1. Anything that came
     * out of arithmetic wants {@link nearly}.
     */
    equalF32(name: string, actual: f32, expected: f32): boolean {
        this.checks += 1;
        if (actual === expected) {
            return true;
        }
        this.report(name, `got ${format(actual)}, want ${format(expected)}`);
        return false;
    }

    equalText(name: string, actual: string, expected: string): boolean {
        this.checks += 1;
        if (actual === expected) {
            return true;
        }
        this.report(name, `got '${actual}', want '${expected}'`);
        return false;
    }

    /** Within `epsilon`, absolute. The comparison for anything computed. */
    nearly(name: string, actual: f32, expected: f32, epsilon: f32): boolean {
        this.checks += 1;
        const difference = actual - expected;
        if (difference <= epsilon && difference >= -epsilon) {
            return true;
        }
        this.report(name, `got ${format(actual)}, want ${format(expected)} +/- ${format(epsilon)}`);
        return false;
    }

    /** Record a failure that no comparison above expresses. */
    fail(name: string, why: string): void {
        this.checks += 1;
        this.report(name, why);
    }

    private report(name: string, why: string): void {
        this.failures += 1;
        console.log(`  ----  ${this.suite} / ${name}: ${why}`);
    }
}

/**
 * One named group of checks.
 *
 * A plain function pointer rather than anything with state: a suite that needed
 * setup and teardown would be a suite doing too much, and the ones here build
 * whatever they need inside `run`.
 */
export interface Suite {
    name: string;
    run: (t: Reference<Tester>) => void;
}
