// Summarising a run of samples, and printing one to three decimal places.
//
// Here rather than in `renderer/profiler.ts`, where these three started, because
// the headless benchmark runner wants exactly the same arithmetic and the
// renderer must not import the test harness. `core/` is the layer both sides
// already depend on.
//
// The distribution rather than the mean is the point, and it is the same point
// in both places: a build that is faster on average and worse at the 99th
// percentile is a worse build, and an accumulator cannot tell you that.

/**
 * Insertion sort, ascending, **in place**.
 *
 * `Reference<f32[]>` and not `f32[]`, and that is not a micro-optimisation: an
 * array is a value here, so a by-value parameter is a copy and sorting it leaves
 * the caller's array exactly as it was. The symptom is a report whose median
 * exceeds its maximum.
 *
 * Quadratic, and the right choice anyway: a run is a few hundred samples, this
 * happens once at the end of one, and the alternative is a quicksort nobody will
 * ever read as carefully as they should.
 */
export function sortAscending(values: Reference<f32[]>): void {
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
export function percentile(sorted: Reference<f32[]>, fraction: f32): f32 {
    const total = sorted.length;
    if (total === 0) {
        return 0.0;
    }
    let index = cast<usize>(cast<f32>(total) * fraction);
    if (index >= total) {
        index = total - 1;
    }
    return sorted[index];
}

/** Three decimal places, without a formatting library. */
export function format(value: f32): string {
    const scaled = cast<i64>(value * 1000.0 + 0.5);
    const whole = scaled / 1000;
    const fraction = scaled % 1000;

    let text = `${fraction}`;
    while (text.length < 3) {
        text = `0${text}`;
    }
    return `${whole}.${text}`;
}
