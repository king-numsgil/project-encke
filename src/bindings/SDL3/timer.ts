// Translated from SDL_timer.h — the clocks, and nothing that schedules.
//
// Two clocks, and the difference matters for a renderer:
//
//   * **`SDL_GetTicks` / `SDL_GetTicksNS`** are a monotonic wall clock since
//     `SDL_Init`, in milliseconds and nanoseconds. Cheap, and the right thing
//     for a frame delta or an animation phase.
//   * **`SDL_GetPerformanceCounter`** is the highest-resolution counter the
//     platform has, in units of `SDL_GetPerformanceFrequency` per second. It is
//     the one to measure a *pass* with, because the nanosecond clock's
//     resolution is not guaranteed to be a nanosecond.
//
// Neither is a GPU clock. SDL_gpu has no timestamp query API, so the only
// timing available to this program is CPU-side, around a fence — see
// `renderer/profiler.ts` for what that can and cannot tell you.
//
// The counters are `u64`. Goblin will not silently mix that with an `f64`, so
// a duration in seconds is `cast<f64>(end - start) / cast<f64>(frequency)`,
// written out.

/** Milliseconds since `SDL_Init`. Monotonic, and it does not wrap in any run that ends. */
export declare function SDL_GetTicks(): u64;

/** Nanoseconds since `SDL_Init`. The unit is nanoseconds; the *resolution* is the platform's. */
export declare function SDL_GetTicksNS(): u64;

/**
 * The platform's highest-resolution counter, in units of
 * {@link SDL_GetPerformanceFrequency} per second.
 *
 * Only differences mean anything — the origin is arbitrary.
 */
export declare function SDL_GetPerformanceCounter(): u64;

/** How many {@link SDL_GetPerformanceCounter} units make a second. Constant for the process. */
export declare function SDL_GetPerformanceFrequency(): u64;

/**
 * Sleep for at least `ms` milliseconds.
 *
 * *At least*: the granularity is the scheduler's, which on Windows is
 * milliseconds at best and often worse. Never the way to hit a frame deadline.
 */
export declare function SDL_Delay(ms: u32): void;

/** Sleep for at least `ns` nanoseconds, with the same caveat as {@link SDL_Delay}. */
export declare function SDL_DelayNS(ns: u64): void;

/**
 * Sleep for close to `ns` nanoseconds, spinning out the last of it.
 *
 * More accurate than {@link SDL_DelayNS} and more expensive: it burns CPU
 * rather than yielding it. For a frame limiter, not for a wait.
 */
export declare function SDL_DelayPrecise(ns: u64): void;
