// Frame timing, and an honest account of what it can and cannot measure.
//
// **SDL_gpu has no timestamp query API.** There is no `SDL_GPUQuery`, no
// `SDL_WriteGPUTimestamp`, nothing — it is an open issue upstream, not an
// omission in this binding. So per-pass GPU durations are not available at all,
// and no amount of instrumenting this renderer will produce them.
//
// What is available is a fence. `SDL_SubmitGPUCommandBufferAndAcquireFence`
// hands back something that signals when the whole submission has retired, and
// waiting on it from the CPU gives one number per frame. That number is:
//
//   * whole-frame, not per-pass;
//   * wall time, so it includes queue latency and whatever else the GPU was
//     asked to do;
//   * *serialising* — waiting on the fence stalls the CPU until the GPU is done,
//     which removes the overlap a real frame depends on.
//
// The last point is why the fence is only taken in benchmark mode. An ordinary
// frame submits and moves on. A benchmark that waits measures a pipeline it has
// itself flattened, which is fine for comparing two builds of this renderer
// against each other and is not a frame rate.

/**
 * Frame times, in milliseconds.
 *
 * Every sample is kept rather than folded into a running mean, because the
 * interesting number in a renderer is almost never the mean — it is the tail.
 * A build that is 1 ms faster on average and 20 ms worse at the 99th percentile
 * is a worse build, and an accumulator cannot tell you that.
 */
export class Profiler {
    private samples: f32[];
    private capacity: usize;

    constructor() {
        this.samples = [];
        this.capacity = 0;
    }

    /** Keep at most `capacity` samples. Later ones are counted but not stored. */
    begin(capacity: usize): void {
        this.samples = [];
        this.capacity = capacity;
    }

    record(milliseconds: f32): void {
        if (this.samples.length < this.capacity) {
            this.samples.push(milliseconds);
        }
    }

    count(): usize {
        return this.samples.length;
    }

    /**
     * Print the distribution.
     *
     * `label` should name the present mode. A frame time is meaningless without
     * it: under VSYNC most of the number is the wait for vblank, and two builds
     * will look identical right up until one of them misses.
     */
    report(label: string): void {
        const total = this.samples.length;
        if (total === 0) {
            console.log("profiler: no samples");
            return;
        }

        let sum: f64 = 0.0;
        for (let i: usize = 0; i < total; i++) {
            sum += cast<f64>(this.samples[i]);
        }

        sortAscending(this.samples);

        const mean = sum / cast<f64>(total);
        console.log("");
        console.log(`frame timing over ${total} frames, present ${label}`);
        console.log(`  mean    ${format(cast<f32>(mean))} ms  (${format(cast<f32>(1000.0 / mean))} fps)`);
        console.log(`  min     ${format(this.samples[0])} ms`);
        console.log(`  median  ${format(percentile(this.samples, 0.50))} ms`);
        console.log(`  p95     ${format(percentile(this.samples, 0.95))} ms`);
        console.log(`  p99     ${format(percentile(this.samples, 0.99))} ms`);
        console.log(`  max     ${format(this.samples[total - 1])} ms`);
        console.log("");
        console.log("  Whole-frame CPU wall time around a fence wait. SDL_gpu exposes no");
        console.log("  timestamp queries, so per-pass GPU timing does not exist to report.");
    }
}

/**
 * Insertion sort, ascending, **in place**.
 *
 * `Reference<f32[]>` and not `f32[]`, and that is not a micro-optimisation: an
 * array is a value here, so a by-value parameter is a copy and sorting it leaves
 * the caller's array exactly as it was. The symptom is a report whose median
 * exceeds its maximum.
 *
 * Quadratic, and the right choice anyway: a benchmark run is a few hundred
 * samples, this runs once at exit, and the alternative is a quicksort nobody
 * will ever read as carefully as they should.
 */
function sortAscending(values: Reference<f32[]>): void {
    for (let i: usize = 1; i < values.length; i++) {
        const key = values[i];
        let j = i;
        while (j > 0 && values[j - 1] > key) {
            values[j] = values[j - 1];
            j -= 1;
        }
        values[j] = key;
    }
}

/** The value at a fraction through a sorted array. Nearest rank, not interpolated. */
function percentile(sorted: Reference<f32[]>, fraction: f32): f32 {
    const total = sorted.length;
    let index = cast<usize>(cast<f32>(total) * fraction);
    if (index >= total) {
        index = total - 1;
    }
    return sorted[index];
}

/** Three decimal places, without a formatting library. */
function format(value: f32): string {
    const scaled = cast<i64>(value * 1000.0 + 0.5);
    const whole = scaled / 1000;
    const fraction = scaled % 1000;

    let text = `${fraction}`;
    while (text.length < 3) {
        text = `0${text}`;
    }
    return `${whole}.${text}`;
}
