// CPU benchmarks, on the same terms the renderer's benchmarks run on.
//
// The rule this project already follows for the GPU — that a measurement is
// meaningless without saying what it measured under — has a CPU equivalent, and
// it is the batch. Timing one call to something that takes 40 ns measures the
// clock; timing a hundred thousand of them measures the thing. So a body is
// handed a count and does that many iterations itself, and the reported number
// is the batch divided by it.
//
// The distribution is reported rather than the mean, for the reason
// `renderer/profiler.ts` gives at length: the tail is where a regression shows
// up first, and on the CPU it is also where the allocator shows up.

import { Stopwatch } from "../core/clock.ts";
import { format, percentile, sortAscending } from "../core/stats.ts";

export class Bench {
    /** Milliseconds per batch. */
    private samples: f32[];
    private watch: Stopwatch;

    constructor() {
        this.samples = [];
        this.watch = new Stopwatch();
    }

    /**
     * Time `body`, which must perform `perBatch` iterations of the thing being
     * measured, `batches` times over.
     *
     *     bench.run("box/makeBox", 20, 2000, (count) => {
     *         for (let i: usize = 0; i < count; i++) {
     *             const mesh = makeBox(1.0, 1.0, 1.0);
     *         }
     *     });
     *
     * One batch runs first and is thrown away. That is not superstition: the
     * first call through a path faults its pages in, warms the branch predictors,
     * and — here more than most places — makes mimalloc claim the arenas every
     * later batch reuses. Including it would put the allocator's first-touch cost
     * in the minimum, which is the one statistic that should be clean.
     */
    run(name: string, batches: usize, perBatch: usize, body: LocalFn<(count: usize) => void>): void {
        body(perBatch);

        this.samples = [];
        this.samples.reserve(batches);

        for (let i: usize = 0; i < batches; i++) {
            this.watch.begin();
            body(perBatch);
            this.samples.push(this.watch.end());
        }

        this.report(name, perBatch);
    }

    /**
     * Print the batch distribution, per iteration.
     *
     * Nanoseconds rather than milliseconds, because everything measured here is
     * well under a microsecond a call and a millisecond figure would be three
     * leading zeroes and no information.
     */
    private report(name: string, perBatch: usize): void {
        const total = this.samples.length;
        if (total === 0 || perBatch === 0) {
            console.log(`  ${name}: no samples`);
            return;
        }

        let sum: f64 = 0.0;
        for (let i: usize = 0; i < total; i++) {
            sum += cast<f64>(this.samples[i]);
        }

        sortAscending(this.samples);

        // Milliseconds for the whole batch into nanoseconds for one iteration.
        const scale = cast<f32>(1000000.0 / cast<f64>(perBatch));
        const mean = cast<f32>(sum / cast<f64>(total)) * scale;

        console.log(`  ${name}`);
        console.log(
            `    ${format(mean)} ns/op  ` +
            `min ${format(this.samples[0] * scale)}  ` +
            `median ${format(percentile(this.samples, 0.5) * scale)}  ` +
            `p95 ${format(percentile(this.samples, 0.95) * scale)}  ` +
            `max ${format(this.samples[total - 1] * scale)}`,
        );
        console.log(`    ${total} batches of ${perBatch}`);
    }
}

/** One named benchmark group, registered exactly as a {@link Suite} is. */
export interface Benchmark {
    name: string;
    run: (b: Reference<Bench>) => void;
}
