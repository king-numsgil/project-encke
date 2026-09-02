// Command line.
//
// The present mode is here rather than buried in the renderer because of the
// benchmarking rule this project runs by: **a benchmark must run in the present
// mode the build ships in**. `present()` costs wildly different amounts under
// VSYNC, IMMEDIATE and MAILBOX, and a frame time measured under one says nothing
// about another — a VSYNC measurement in particular is mostly the wait for
// vblank and will hide every regression underneath it.
//
//     encke --present immediate --bench 600
//     encke --screenshot out.png
//     encke --width 2560 --height 1440

import { SDL_GPUPresentMode } from "../bindings/SDL3";

export class Options {
    width: i32;
    height: i32;

    /** What was asked for. Support is queried later, against the real window. */
    present: SDL_GPUPresentMode;

    /** Empty when no screenshot was asked for. */
    screenshot: string;

    /** Stop after this many frames. Zero means run until the window closes. */
    frames: u32;

    /**
     * Point lights in the test scene's moving field.
     *
     * The four shadow-casting spotlights are on top of this, and the renderer's
     * own per-scene cap is 384, so anything above 380 is clamped by the upload
     * with a line in the log. Exposed because light count is the axis this
     * renderer is built to scale along, and testing it should not need a rebuild.
     */
    lights: u32;

    /**
     * A `.gltf` or `.glb` to load beside the test scene. Empty for none.
     *
     * Beside, not instead of: the procedural geometry is what the renderer is
     * tuned against and a model dropped into it is easier to judge next to
     * surfaces whose materials are already known-good.
     */
    model: string;

    /**
     * Uniform scale applied to {@link model}.
     *
     * glTF's unit is the metre and a well-authored asset needs no help — but
     * "well-authored" covers a range of two or three orders of magnitude in
     * practice, and a model that loaded correctly and is a millimetre across
     * looks exactly like one that failed to load.
     */
    modelScale: f32;

    /** Report frame timing statistics on exit. */
    bench: boolean;

    /**
     * Which debug view the forward pass draws. Mirrors `DEBUG_*` in
     * `shaders/forward.wgsl`: 0 off, 1 clusters, 2 occlusion, 3 cascades.
     */
    debug: u32;

    /**
     * Whether the debug overlay starts visible. F1 toggles it either way.
     *
     * Off for a `--bench` run, set in {@link parseOptions} rather than here: the
     * overlay is a draw call and a few hundred triangles, which is nothing, but a
     * benchmark that measures something other than the renderer is a benchmark
     * with an argument in it.
     */
    overlay: boolean;

    /**
     * Run the console harness instead of opening a window.
     *
     * The branch is taken in `main.ts` immediately after SDL is up and before
     * anything asks for a GPU device, so a headless run needs no display, no
     * driver and no `SDL_ttf` — which is what makes it the mode a test suite and
     * a CPU benchmark can live in.
     */
    headless: boolean;

    /**
     * What the harness does: 0 tests, 1 benches, 2 list. See {@link runModeTests}.
     *
     * A `u32` with named accessors rather than an enum, mirroring {@link debug},
     * because the same shape is already how a mode reaches the rest of the
     * program from here.
     */
    harness: u32;

    /** Only run harness cases whose name contains this. Empty runs all of them. */
    filter: string;

    /** `--help` was passed; the caller should print usage and stop. */
    help: boolean;

    /** True when a flag could not be understood. */
    invalid: boolean;

    /**
     * The defaults, which is also what `--help` describes.
     *
     * In the constructor rather than in `parseOptions` so that every field has a
     * value the moment the object exists — `strictPropertyInitialization` is on
     * for this project, and a field that is only ever assigned by the parser is
     * a field the parser can forget.
     */
    constructor() {
        this.width = 1600;
        this.height = 900;
        // MAILBOX by default, falling back to VSYNC when the driver has not got
        // it. It is the mode with a known open SDL bug — early frames pacing to
        // vblank on some drivers even though mailbox should never block — so
        // defaulting to it is how that gets observed rather than assumed.
        // `--present vsync` still forces the safe mode.
        this.present = SDL_GPUPresentMode.MAILBOX;
        this.screenshot = "";
        this.frames = 0;
        this.lights = 160;
        this.model = "";
        this.modelScale = 1.0;
        this.debug = 0;
        this.bench = false;
        this.overlay = true;
        this.headless = false;
        this.harness = runModeTests();
        this.filter = "";
        this.help = false;
        this.invalid = false;
    }
}

/** Parse a non-negative decimal integer. `-1` when the text is not one. */
function parseInteger(text: string): i32 {
    if (text.length === 0) {
        return -1;
    }

    let value: i32 = 0;
    for (let i: usize = 0; i < text.length; i++) {
        const digit = cast<i32>(text.codePointAt(i)) - 48;
        if (digit < 0 || digit > 9) {
            return -1;
        }
        value = value * 10 + digit;
    }
    return value;
}

/**
 * Parse a positive decimal number, integer or fractional. `-1` when it is not one.
 *
 * Only what a scale factor needs: digits, one optional point, no sign and no
 * exponent. Accumulated as `f64` and narrowed once at the end rather than
 * summing in `f32`, so `0.001` is the nearest `f32` to a tenth of a percent
 * rather than the nearest `f32` to a sum of three `f32` divisions.
 */
function parseNumber(text: string): f32 {
    if (text.length === 0) {
        return -1.0;
    }

    let value: f64 = 0.0;
    let fraction: f64 = 0.0;
    let seenPoint = false;

    for (let i: usize = 0; i < text.length; i++) {
        const code = cast<i32>(text.codePointAt(i));

        if (code === 46) {
            if (seenPoint) {
                return -1.0;
            }
            seenPoint = true;
            fraction = 1.0;
            continue;
        }

        const digit = code - 48;
        if (digit < 0 || digit > 9) {
            return -1.0;
        }

        if (seenPoint) {
            fraction = fraction * 0.1;
            value = value + cast<f64>(digit) * fraction;
        } else {
            value = value * 10.0 + cast<f64>(digit);
        }
    }

    return cast<f32>(value);
}

/** Whether `text` names a debug view. Asked before {@link debugViewFrom}. */
function isDebugView(text: string): boolean {
    return text === "off" || text === "clusters" || text === "ao" || text === "cascades";
}

/** The named view's number. Must agree with `DEBUG_*` in `shaders/forward.wgsl`. */
function debugViewFrom(text: string): u32 {
    if (text === "clusters") {
        return 1;
    }
    if (text === "ao") {
        return 2;
    }
    if (text === "cascades") {
        return 3;
    }
    return 0;
}

// ---------------------------------------------------------------------------
// What the console harness runs.
//
// Functions rather than an enum or a top-level constant, because the language
// has no top-level `const` to bind one to and an enum here would be a second
// spelling of the same three numbers that `Options.harness` already carries as
// a `u32`. They are cheap calls and they are the only place the numbers appear.
// ---------------------------------------------------------------------------

/** Run every registered test suite. The default. */
export function runModeTests(): u32 {
    return 0;
}

/** Run every registered CPU benchmark. */
export function runModeBenches(): u32 {
    return 1;
}

/** Print what is registered and exit, without running any of it. */
export function runModeList(): u32 {
    return 2;
}

/** Whether `text` names a run mode. Asked before {@link runModeFrom}. */
function isRunMode(text: string): boolean {
    return text === "tests" || text === "benches" || text === "list";
}

/** The named mode. Tests for anything unrecognised, so this is never called blind. */
function runModeFrom(text: string): u32 {
    if (text === "benches") {
        return runModeBenches();
    }
    if (text === "list") {
        return runModeList();
    }
    return runModeTests();
}

/** The mode's name, for the harness header. The inverse of {@link runModeFrom}. */
export function runModeName(mode: u32): string {
    if (mode === runModeBenches()) {
        return "benches";
    }
    if (mode === runModeList()) {
        return "list";
    }
    return "tests";
}

/** Whether `text` names a present mode at all. Asked before {@link presentModeFrom}. */
function isPresentMode(text: string): boolean {
    return text === "vsync" || text === "immediate" || text === "mailbox";
}

/** The named mode. VSYNC for anything unrecognised, so this is never called blind. */
function presentModeFrom(text: string): SDL_GPUPresentMode {
    if (text === "immediate") {
        return SDL_GPUPresentMode.IMMEDIATE;
    }
    if (text === "mailbox") {
        return SDL_GPUPresentMode.MAILBOX;
    }
    return SDL_GPUPresentMode.VSYNC;
}

export function parseOptions(args: string[]): Options {
    const options = new Options();

    // `args` arrives as C's `argv`, so the first entry is the program's own
    // path. Skipped by shape rather than by position, so that a caller who has
    // already stripped it is not punished for it.
    let i: usize = args.length > 0 && args[0].indexOf("-") !== 0 ? 1 : 0;

    while (i < args.length) {
        const flag = args[i];
        const hasValue = i + 1 < args.length;

        if (flag === "--help" || flag === "-h") {
            options.help = true;
            i += 1;
        } else if (flag === "--width" && hasValue) {
            const value = parseInteger(args[i + 1]);
            if (value <= 0) {
                console.log(`options: --width wants a positive integer, got '${args[i + 1]}'`);
                options.invalid = true;
            } else {
                options.width = value;
            }
            i += 2;
        } else if (flag === "--height" && hasValue) {
            const value = parseInteger(args[i + 1]);
            if (value <= 0) {
                console.log(`options: --height wants a positive integer, got '${args[i + 1]}'`);
                options.invalid = true;
            } else {
                options.height = value;
            }
            i += 2;
        } else if (flag === "--present" && hasValue) {
            if (!isPresentMode(args[i + 1])) {
                console.log(`options: --present wants vsync, immediate or mailbox, got '${args[i + 1]}'`);
                options.invalid = true;
            } else {
                options.present = presentModeFrom(args[i + 1]);
            }
            i += 2;
        } else if (flag === "--lights" && hasValue) {
            const value = parseInteger(args[i + 1]);
            if (value < 0) {
                console.log(`options: --lights wants a non-negative integer, got '${args[i + 1]}'`);
                options.invalid = true;
            } else {
                options.lights = cast<u32>(value);
            }
            i += 2;
        } else if (flag === "--debug" && hasValue) {
            if (!isDebugView(args[i + 1])) {
                console.log(`options: --debug wants off, clusters, ao or cascades, got '${args[i + 1]}'`);
                options.invalid = true;
            } else {
                options.debug = debugViewFrom(args[i + 1]);
            }
            i += 2;
        } else if (flag === "--model" && hasValue) {
            options.model = args[i + 1];
            i += 2;
        } else if (flag === "--model-scale" && hasValue) {
            const value = parseNumber(args[i + 1]);
            if (value <= 0.0) {
                console.log(`options: --model-scale wants a positive number, got '${args[i + 1]}'`);
                options.invalid = true;
            } else {
                options.modelScale = value;
            }
            i += 2;
        } else if (flag === "--screenshot" && hasValue) {
            options.screenshot = args[i + 1];
            i += 2;
        } else if (flag === "--frames" && hasValue) {
            const value = parseInteger(args[i + 1]);
            if (value <= 0) {
                console.log(`options: --frames wants a positive integer, got '${args[i + 1]}'`);
                options.invalid = true;
            } else {
                options.frames = cast<u32>(value);
            }
            i += 2;
        } else if (flag === "--bench" && hasValue) {
            const value = parseInteger(args[i + 1]);
            if (value <= 0) {
                console.log(`options: --bench wants a positive integer, got '${args[i + 1]}'`);
                options.invalid = true;
            } else {
                options.bench = true;
                options.frames = cast<u32>(value);
                // See the note on `Options.overlay`. An explicit `--overlay on`
                // after `--bench` still wins, because this only fires here.
                options.overlay = false;
            }
            i += 2;
        } else if (flag === "--headless") {
            options.headless = true;
            i += 1;
        } else if (flag === "--run" && hasValue) {
            if (!isRunMode(args[i + 1])) {
                console.log(`options: --run wants tests, benches or list, got '${args[i + 1]}'`);
                options.invalid = true;
            } else {
                // Implied rather than required, the same way `--bench` implies
                // an overlay setting: asking for a run mode is asking for the
                // harness, and making somebody write both is a flag that exists
                // only to be forgotten.
                options.headless = true;
                options.harness = runModeFrom(args[i + 1]);
            }
            i += 2;
        } else if (flag === "--filter" && hasValue) {
            options.headless = true;
            options.filter = args[i + 1];
            i += 2;
        } else if (flag === "--overlay" && hasValue) {
            if (args[i + 1] !== "on" && args[i + 1] !== "off") {
                console.log(`options: --overlay wants on or off, got '${args[i + 1]}'`);
                options.invalid = true;
            } else {
                options.overlay = args[i + 1] === "on";
            }
            i += 2;
        } else {
            console.log(`options: unrecognised '${flag}'`);
            options.invalid = true;
            i += 1;
        }
    }

    return options;
}

export function printUsage(): void {
    console.log("encke — clustered forward renderer");
    console.log("");
    console.log("  --width N            render width, default 1600");
    console.log("  --height N           render height, default 900");
    console.log("  --present MODE       mailbox (default, falls back to vsync), vsync, immediate");
    console.log("  --screenshot PATH    write a PNG once the scene has settled, then exit");
    console.log("  --lights N           point lights in the test scene, default 160 (cap 380)");
    console.log("  --model PATH         a .gltf or .glb to load beside the test scene");
    console.log("  --model-scale N      uniform scale for --model, default 1");
    console.log("  --frames N           stop after N frames");
    console.log("  --bench N            run N frames and report frame timing");
    console.log("  --debug VIEW         off (default), clusters, ao, cascades");
    console.log("  --overlay on|off     debug HUD, on by default and off under --bench (F1 toggles)");
    console.log("  --headless           run the console harness instead of opening a window");
    console.log("  --run WHAT           tests (default), benches, list — implies --headless");
    console.log("  --filter TEXT        only harness cases whose name contains TEXT");
    console.log("  --help               this");
    console.log("");
    console.log("  Benchmarks must use the present mode the build ships in — present()");
    console.log("  costs differ enough between modes to mask everything else.");
}

/** The view's name, for the overlay. The inverse of {@link debugViewFrom}. */
export function debugViewName(view: u32): string {
    if (view === 1) {
        return "clusters";
    }
    if (view === 2) {
        return "ao";
    }
    if (view === 3) {
        return "cascades";
    }
    return "off";
}

/** The mode's name, for logs and for the benchmark header. */
export function presentModeName(mode: SDL_GPUPresentMode): string {
    if (mode === SDL_GPUPresentMode.IMMEDIATE) {
        return "immediate";
    }
    if (mode === SDL_GPUPresentMode.MAILBOX) {
        return "mailbox";
    }
    return "vsync";
}
