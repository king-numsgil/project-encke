// Wall-clock time, and a running summary of frame durations.
//
// `SDL_GetPerformanceCounter` rather than `SDL_GetTicksNS`: the nanosecond clock
// is denominated in nanoseconds but not guaranteed to *resolve* to one, and a
// sub-millisecond pass measured with it can read as zero.
//
// The counters are `u64`. Goblin refuses to mix that with an `f64` implicitly —
// neither type holds the other — so every conversion to seconds is written out.

import { SDL_GetPerformanceCounter, SDL_GetPerformanceFrequency } from "../bindings/SDL3";

export class Clock {
    /** Seconds since the last {@link tick}. Zero on the first. */
    delta: f32;
    /** Seconds since {@link start}. */
    elapsed: f32;
    private frequency: f64;
    private origin: u64;
    private previous: u64;

    constructor() {
        this.frequency = 1.0;
        this.origin = 0;
        this.previous = 0;
        this.delta = 0.0;
        this.elapsed = 0.0;
    }

    start(): void {
        this.frequency = cast<f64>(SDL_GetPerformanceFrequency());
        this.origin = SDL_GetPerformanceCounter();
        this.previous = this.origin;
        this.delta = 0.0;
        this.elapsed = 0.0;
    }

    /** Advance to now. Returns the delta, which is also left in the field. */
    tick(): f32 {
        const now = SDL_GetPerformanceCounter();
        this.delta = cast<f32>(cast<f64>(now - this.previous) / this.frequency);
        this.elapsed = cast<f32>(cast<f64>(now - this.origin) / this.frequency);
        this.previous = now;
        return this.delta;
    }
}

/**
 * A stopwatch over one span, in milliseconds.
 *
 * Used around the frame's fence wait. What that measures is worth being precise
 * about: it is wall time from submit to signal, on the CPU, and it is the only
 * timing SDL_gpu makes available — there is no timestamp query API, so per-pass
 * GPU durations cannot be had at all. A number from this includes queue latency
 * and whatever else the driver was doing, so it is a trend line rather than a
 * measurement.
 */
export class Stopwatch {
    private frequency: f64;
    private begun: u64;

    constructor() {
        this.frequency = 1.0;
        this.begun = 0;
    }

    begin(): void {
        this.frequency = cast<f64>(SDL_GetPerformanceFrequency());
        this.begun = SDL_GetPerformanceCounter();
    }

    /** Milliseconds since {@link begin}. */
    end(): f32 {
        const now = SDL_GetPerformanceCounter();
        return cast<f32>((cast<f64>(now - this.begun) / this.frequency) * 1000.0);
    }
}
