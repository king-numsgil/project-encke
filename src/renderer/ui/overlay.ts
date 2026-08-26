// The debug HUD: what the renderer is doing, drawn on top of what it drew.
//
// This is the first consumer of `draw.ts` and it exists partly to be one — a UI
// layer with nothing built on it is a layer nobody has checked. Everything here
// is ordinary calls into the draw list, so a second panel is a second function
// like `build` and needs nothing from this file.
//
// **The frame-time history is kept here rather than in `Profiler`.** They
// measure different things on purpose: the profiler waits on a fence and reports
// GPU wall time, which is only taken under `--bench` because the wait flattens
// the CPU/GPU overlap a real frame depends on. This is the wall clock between
// two `Clock.tick` calls — the interval the window is actually being repainted
// at, which is the number a HUD should show and is free to collect.
//
// The graph's ceiling is fixed at two vblanks' worth rather than fitted to the
// data. An autoscaling graph rescales whenever the peak moves, so the shape of
// the trace changes for reasons that have nothing to do with the renderer, and
// two screenshots cannot be compared.

import { fvec4 } from "std/linalg";
import { uiGraphSamples } from "../config.ts";
import { uiFontMono, uiFontSans, type UiAtlas } from "./atlas.ts";
import { type UiDrawList, uiFade, uiWhite } from "./draw.ts";

/** Milliseconds at the top of the graph: two frames at 60Hz. */
function graphCeiling(): f32 {
    return 33.34;
}

/** One frame at 60Hz, drawn as a reference line. */
function targetFrameMs(): f32 {
    return 16.67;
}

/** How quickly the readout follows the frame time. Small enough that the digits settle. */
function readoutSmoothing(): f32 {
    return 0.05;
}

/** What the overlay reports that it cannot work out for itself. */
export class OverlayInfo {
    width: u32;
    height: u32;

    /** Point lights in the scene, not counting the shadow-casting spots. */
    lights: u32;

    /** Present mode's name — see `app/options.ts`. */
    present: string;

    /** Debug view's name. */
    debug: string;

    constructor() {
        this.width = 0;
        this.height = 0;
        this.lights = 0;
        this.present = "";
        this.debug = "";
    }
}

export class Overlay {
    /** Frame durations in milliseconds, oldest first once {@link head} has wrapped. */
    private samples: f32[];
    private head: usize;

    /** Exponential average of the frame time, for the readout. */
    private smoothed: f32;

    /** Toggled by F1 in the frame loop. */
    visible: boolean;

    constructor() {
        this.samples = [];
        this.head = 0;
        this.smoothed = 0.0;
        this.visible = true;
    }

    /**
     * Add this frame's duration.
     *
     * Called every frame whether or not the overlay is visible, so that toggling
     * it on shows history rather than a graph filling in from empty.
     */
    record(deltaSeconds: f32): void {
        const milliseconds = deltaSeconds * 1000.0;

        if (this.samples.length < cast<usize>(uiGraphSamples())) {
            this.samples.push(milliseconds);
        } else {
            this.samples[this.head] = milliseconds;
            this.head = (this.head + 1) % this.samples.length;
        }

        // Seeded rather than eased from zero, so the first readout is a frame
        // time instead of a number climbing towards one.
        this.smoothed =
            this.smoothed === 0.0
                ? milliseconds
                : this.smoothed + (milliseconds - this.smoothed) * readoutSmoothing();
    }

    /** Build this frame's overlay into `list`. A no-op while hidden. */
    build(
        list: Reference<UiDrawList>,
        atlas: Reference<UiAtlas>,
        info: Reference<OverlayInfo>,
    ): void {
        if (!this.visible) {
            return;
        }

        const margin: f32 = 16.0;
        const padding: f32 = 10.0;
        const width: f32 = 244.0;
        const row: f32 = 17.0;
        const graphHeight: f32 = 46.0;

        // Five stat rows plus the title row and the graph. Written out because
        // the panel has to be drawn before the things on top of it, so its height
        // cannot be discovered by laying the contents out first.
        const height = padding * 2.0 + row + 6.0 + graphHeight + 8.0 + row * 5.0;

        const x = margin;
        const y = margin;

        list.rect(atlas, x, y, width, height, new fvec4(0.02, 0.02, 0.03, 0.72));
        list.frame(atlas, x, y, width, height, 1.0, uiFade(uiWhite(), 0.10));

        const left = x + padding;
        const right = x + width - padding;
        let cursor = y + padding;

        this.buildTitle(list, atlas, left, right, cursor);
        cursor += row + 6.0;

        this.buildGraph(list, atlas, left, cursor, right - left, graphHeight);
        cursor += graphHeight + 8.0;

        statRow(list, atlas, left, right, cursor, "frame", `${fixed(this.smoothed, 2)} ms`);
        cursor += row;
        statRow(list, atlas, left, right, cursor, "size", `${info.width}x${info.height}`);
        cursor += row;
        statRow(list, atlas, left, right, cursor, "lights", `${info.lights}`);
        cursor += row;
        statRow(list, atlas, left, right, cursor, "present", info.present);
        cursor += row;
        statRow(list, atlas, left, right, cursor, "debug", info.debug);
    }

    /** The name, a status dot, and the frame rate. */
    private buildTitle(
        list: Reference<UiDrawList>,
        atlas: Reference<UiAtlas>,
        left: f32,
        right: f32,
        y: f32,
    ): void {
        const health = healthColor(this.smoothed);

        list.text(atlas, uiFontSans(), left, y, "encke", new fvec4(0.90, 0.92, 0.96, 1.0));
        list.circle(atlas, right - 4.0, y + 8.0, 4.0, health);

        const fps = this.smoothed > 0.0 ? 1000.0 / this.smoothed : 0.0;
        list.textRight(atlas, uiFontMono(), right - 14.0, y, `${fixed(fps, 1)} fps`, health);
    }

    /**
     * One bar per sample, coloured by how close it came to a missed frame.
     *
     * Bars rather than a polyline: at one pixel per sample the two cost the same
     * quad each, and a bar chart reads as a distribution while a line at that
     * density reads as noise. The oldest sample is on the left, so the trace
     * scrolls the way a chart is expected to.
     */
    private buildGraph(
        list: Reference<UiDrawList>,
        atlas: Reference<UiAtlas>,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
    ): void {
        list.rect(atlas, x, y, width, height, new fvec4(0.0, 0.0, 0.0, 0.35));

        const total = this.samples.length;
        if (total > 0) {
            const barWidth = width / cast<f32>(uiGraphSamples());
            const bottom = y + height;

            for (let i: usize = 0; i < total; i++) {
                // `head` is the oldest sample once the ring has wrapped, and is
                // zero until then — so this reads oldest to newest either way.
                const sample = this.samples[(this.head + i) % total];

                let fraction = sample / graphCeiling();
                if (fraction > 1.0) {
                    fraction = 1.0;
                }

                const barHeight = fraction * height;
                list.rect(
                    atlas,
                    x + cast<f32>(i) * barWidth,
                    bottom - barHeight,
                    barWidth,
                    barHeight,
                    uiFade(healthColor(sample), 0.85),
                );
            }
        }

        // The 60Hz line, drawn over the bars so it stays readable through them.
        const targetY = y + height * (1.0 - targetFrameMs() / graphCeiling());
        list.line(atlas, x, targetY, x + width, targetY, 1.0, uiFade(uiWhite(), 0.25));

        list.frame(atlas, x, y, width, height, 1.0, uiFade(uiWhite(), 0.08));
    }
}

/** A label on the left, its value right-aligned in the monospaced face. */
function statRow(
    list: Reference<UiDrawList>,
    atlas: Reference<UiAtlas>,
    left: f32,
    right: f32,
    y: f32,
    label: string,
    value: string,
): void {
    list.text(atlas, uiFontSans(), left, y, label, new fvec4(0.62, 0.65, 0.72, 1.0));
    list.textRight(atlas, uiFontMono(), right, y, value, new fvec4(0.88, 0.90, 0.94, 1.0));
}

/**
 * Green comfortably inside a 60Hz frame, amber approaching it, red past it.
 *
 * The thresholds are the frame budget rather than round numbers, because what a
 * frame-time graph is for is seeing the moment the budget stops being met.
 */
function healthColor(milliseconds: f32): fvec4 {
    if (milliseconds <= targetFrameMs() * 0.75) {
        return new fvec4(0.36, 0.82, 0.47, 1.0);
    }
    if (milliseconds <= targetFrameMs()) {
        return new fvec4(0.94, 0.78, 0.31, 1.0);
    }
    return new fvec4(0.91, 0.36, 0.36, 1.0);
}

/**
 * A number with a fixed number of decimals.
 *
 * `Profiler` has one of these too, at three decimals and with its own padding
 * rules. Sharing them would mean a formatting module with a precision parameter
 * for two call sites that each want one thing; this is eleven lines.
 */
function fixed(value: f32, decimals: u32): string {
    let scale: i64 = 1;
    for (let i: u32 = 0; i < decimals; i++) {
        scale *= 10;
    }

    const scaled = cast<i64>(value * cast<f32>(scale) + 0.5);
    const whole = scaled / scale;
    const fraction = scaled % scale;

    let text = `${fraction}`;
    while (cast<u32>(text.length) < decimals) {
        text = `0${text}`;
    }
    return `${whole}.${text}`;
}
