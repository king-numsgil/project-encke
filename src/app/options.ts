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

import { SDL_GPUPresentMode } from "../graphics/sdl/index.ts";

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

    /** Report frame timing statistics on exit. */
    bench: boolean;

    /**
     * Which debug view the forward pass draws. Mirrors `DEBUG_*` in
     * `shaders/forward.wgsl`: 0 off, 1 clusters, 2 occlusion, 3 cascades.
     */
    debug: u32;

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
        this.debug = 0;
        this.bench = false;
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
    console.log("  --frames N           stop after N frames");
    console.log("  --bench N            run N frames and report frame timing");
    console.log("  --debug VIEW         off (default), clusters, ao, cascades");
    console.log("  --help               this");
    console.log("");
    console.log("  Benchmarks must use the present mode the build ships in — present()");
    console.log("  costs differ enough between modes to mask everything else.");
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
