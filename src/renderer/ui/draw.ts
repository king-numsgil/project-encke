// The immediate-mode draw list: shapes and text in, triangles out.
//
// Nothing here is retained between frames. `clear()` at the top of a frame,
// then whatever the caller wants to see, then the pass uploads the two arrays
// and issues one indexed draw. There is no widget tree, no layout engine and no
// identity — a debug overlay is redrawn from the numbers every frame anyway, and
// everything a retained UI buys is machinery for state this has none of.
//
// **Coordinates are pixels, `y` down, origin at the top-left of the window.**
// The pixels-to-clip conversion is one multiply-add in the vertex shader; see
// `UiPass.record`.
//
// **Colours are sRGB-encoded, `0..1` per channel, straight alpha.** That is how
// a UI is authored — see the note on `vs_main` in `shaders/ui.wgsl` for what
// happens to them afterwards.
//
// Every primitive is a quad sampling the shared atlas, so shapes and glyphs sit
// in the same buffer in submission order and there is exactly one draw call.
// The consequence worth knowing is that **the list is painted back to front in
// the order it was built**: a panel background has to be added before the text
// on it.

import { fvec4 } from "std/linalg";
import { ffloor, fsqrt } from "std/math";
import { uiMaxIndices, uiMaxVertices } from "../config.ts";
import type { UiAtlas } from "./atlas.ts";

/** Floats per vertex: `x y u v r g b a`. Mirrors the attributes in `passes/ui.ts`. */
export function uiVertexFloats(): u32 {
    return 8;
}

/** Bytes per vertex. */
export function uiVertexStride(): u32 {
    return 32;
}

/** Opaque white. Everything a UI draws in is this faded or tinted. */
export function uiWhite(): fvec4 {
    return new fvec4(1.0, 1.0, 1.0, 1.0);
}

/** The same colour with its alpha replaced. */
export function uiFade(color: fvec4, alpha: f32): fvec4 {
    return new fvec4(color.x, color.y, color.z, alpha);
}

export class UiDrawList {
    /**
     * Interleaved `x y u v r g b a`, {@link uiVertexFloats} per vertex.
     *
     * A fixed block rather than a `f32[]`, and the reason is the frame loop. A
     * growable array has to be emptied each frame, and Goblin's has no way to
     * drop its length while keeping its buffer — so every frame would reallocate
     * its way back up through a dozen doublings. This is allocated once at the
     * ceiling in `config.ts`, which also makes {@link reserve} a real bound
     * rather than a hope.
     */
    private vertexData: Pointer<f32> | null;
    private indexData: Pointer<u32> | null;

    private vertices: u32;
    private indices: u32;

    /**
     * True once a primitive has been dropped for want of room.
     *
     * Latched rather than counted, because the useful information is "the
     * overlay is incomplete" and the useless information is a number that grows
     * every frame in a log nobody is reading by then.
     */
    private overflowed: boolean;

    constructor() {
        this.vertexData = null;
        this.indexData = null;
        this.vertices = 0;
        this.indices = 0;
        this.overflowed = false;
    }

    /** Reserve the two blocks. Nothing can be added before this. */
    create(): void {
        this.vertexData = allocArray<f32>(cast<usize>(uiMaxVertices() * uiVertexFloats()));
        this.indexData = allocArray<u32>(cast<usize>(uiMaxIndices()));
    }

    release(): void {
        if (this.vertexData !== null) {
            this.vertexData.freeArray();
        }
        if (this.indexData !== null) {
            this.indexData.freeArray();
        }
        this.vertexData = null;
        this.indexData = null;
        this.vertices = 0;
        this.indices = 0;
    }

    /** Start a frame. The blocks are kept; only the counts go back to zero. */
    clear(): void {
        this.vertices = 0;
        this.indices = 0;
    }

    /** Vertices built so far. */
    vertexCount(): u32 {
        return this.vertices;
    }

    indexCount(): u32 {
        return this.indices;
    }

    /** Nothing to draw. The pass skips itself entirely on this. */
    empty(): boolean {
        return this.indices === 0;
    }

    /**
     * The interleaved vertices, for the pass to copy into its transfer buffer.
     *
     * `vertexCount() * uiVertexFloats()` of them are live; the rest of the block
     * is whatever the last frame left there.
     */
    vertexFloats(): Pointer<f32> | null {
        return this.vertexData;
    }

    /** The indices, `indexCount()` of them live. */
    indexWords(): Pointer<u32> | null {
        return this.indexData;
    }

    // -----------------------------------------------------------------------
    // Shapes.
    // -----------------------------------------------------------------------

    /** A filled rectangle. */
    rect(atlas: Reference<UiAtlas>, x: f32, y: f32, w: f32, h: f32, color: fvec4): void {
        this.quad(
            x,
            y,
            x + w,
            y + h,
            atlas.whiteU,
            atlas.whiteV,
            atlas.whiteU,
            atlas.whiteV,
            color,
        );
    }

    /**
     * A rectangle's outline, drawn inside the given box.
     *
     * Four rectangles rather than a line loop: the corners meet exactly, which a
     * loop of thick lines does not do without mitring them.
     */
    frame(atlas: Reference<UiAtlas>, x: f32, y: f32, w: f32, h: f32, thickness: f32, color: fvec4): void {
        this.rect(atlas, x, y, w, thickness, color);
        this.rect(atlas, x, y + h - thickness, w, thickness, color);
        this.rect(atlas, x, y + thickness, thickness, h - thickness * 2.0, color);
        this.rect(atlas, x + w - thickness, y + thickness, thickness, h - thickness * 2.0, color);
    }

    /**
     * A filled circle, centred on `cx, cy`.
     *
     * One quad over the baked disc — see `atlas.ts`. The quad is slightly larger
     * than the circle so that the disc's antialiased edge lands on `radius`
     * rather than short of it.
     */
    circle(atlas: Reference<UiAtlas>, cx: f32, cy: f32, radius: f32, color: fvec4): void {
        const half = radius * atlas.discOversize;
        this.quad(
            cx - half,
            cy - half,
            cx + half,
            cy + half,
            atlas.discU0,
            atlas.discV0,
            atlas.discU1,
            atlas.discV1,
            color,
        );
    }

    /**
     * A line of a given thickness between two points.
     *
     * A quad around the segment, with square ends. Round ends would be two more
     * circles per segment and a polyline of 180 segments would rather not pay
     * that; the joins in a frame-time graph are a pixel wide and nobody has ever
     * noticed one.
     */
    line(
        atlas: Reference<UiAtlas>,
        x0: f32,
        y0: f32,
        x1: f32,
        y1: f32,
        thickness: f32,
        color: fvec4,
    ): void {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const length = fsqrt(dx * dx + dy * dy);
        if (length <= 0.0) {
            return;
        }

        // The segment's normal, scaled to half the thickness.
        const nx = (-dy / length) * thickness * 0.5;
        const ny = (dx / length) * thickness * 0.5;

        this.triangleQuad(
            x0 + nx,
            y0 + ny,
            x1 + nx,
            y1 + ny,
            x1 - nx,
            y1 - ny,
            x0 - nx,
            y0 - ny,
            atlas.whiteU,
            atlas.whiteV,
            color,
        );
    }

    // -----------------------------------------------------------------------
    // Text.
    //
    // `x, y` is the **top-left** of the line, not the baseline. A caller
    // positioning a readout thinks in boxes, and the baseline is a property of
    // the face rather than of the layout.
    // -----------------------------------------------------------------------

    /** Draw a string. Returns the width it took, so runs can be chained. */
    text(atlas: Reference<UiAtlas>, font: usize, x: f32, y: f32, text: string, color: fvec4): f32 {
        if (font >= atlas.fonts.length) {
            return 0.0;
        }

        const face = atlas.fonts[font];
        // Snapped to whole pixels. The atlas is sampled linearly, so a glyph on a
        // fractional origin is resampled and comes out soft — and a readout that
        // moves by a third of a pixel between frames shimmers.
        const originX = ffloor(x);
        const baseline = ffloor(y) + face.ascent;

        let pen: f32 = 0.0;
        for (let i: usize = 0; i < text.length; i++) {
            const glyph = glyphFor(atlas, face.base, text.codePointAt(i));
            if (glyph < 0) {
                continue;
            }

            const record = atlas.glyphs[cast<usize>(glyph)];
            if (record.w > 0.0) {
                const left = originX + pen + record.bearingX;
                const top = baseline - record.bearingY;
                this.quad(
                    left,
                    top,
                    left + record.w,
                    top + record.h,
                    record.u0,
                    record.v0,
                    record.u1,
                    record.v1,
                    color,
                );
            }
            pen += record.advance;
        }

        return pen;
    }

    /** What {@link text} would return, without building anything. */
    measure(atlas: Reference<UiAtlas>, font: usize, text: string): f32 {
        if (font >= atlas.fonts.length) {
            return 0.0;
        }

        const base = atlas.fonts[font].base;
        let pen: f32 = 0.0;
        for (let i: usize = 0; i < text.length; i++) {
            const glyph = glyphFor(atlas, base, text.codePointAt(i));
            if (glyph >= 0) {
                pen += atlas.glyphs[cast<usize>(glyph)].advance;
            }
        }
        return pen;
    }

    /** {@link text}, right-aligned so that it *ends* at `right`. */
    textRight(
        atlas: Reference<UiAtlas>,
        font: usize,
        right: f32,
        y: f32,
        text: string,
        color: fvec4,
    ): void {
        this.text(atlas, font, right - this.measure(atlas, font, text), y, text, color);
    }

    // -----------------------------------------------------------------------
    // The two primitives everything above is built from.
    // -----------------------------------------------------------------------

    /** An axis-aligned quad with a UV rectangle. */
    private quad(
        x0: f32,
        y0: f32,
        x1: f32,
        y1: f32,
        u0: f32,
        v0: f32,
        u1: f32,
        v1: f32,
        color: fvec4,
    ): void {
        if (!this.reserve()) {
            return;
        }

        const base = this.vertexCount();
        this.vertex(x0, y0, u0, v0, color);
        this.vertex(x1, y0, u1, v0, color);
        this.vertex(x1, y1, u1, v1, color);
        this.vertex(x0, y1, u0, v1, color);
        this.triangles(base);
    }

    /** A quad of four arbitrary corners, all sampling one point. For lines. */
    private triangleQuad(
        ax: f32,
        ay: f32,
        bx: f32,
        by: f32,
        cx: f32,
        cy: f32,
        dx: f32,
        dy: f32,
        u: f32,
        v: f32,
        color: fvec4,
    ): void {
        if (!this.reserve()) {
            return;
        }

        const base = this.vertexCount();
        this.vertex(ax, ay, u, v, color);
        this.vertex(bx, by, u, v, color);
        this.vertex(cx, cy, u, v, color);
        this.vertex(dx, dy, u, v, color);
        this.triangles(base);
    }

    /**
     * Room for one more quad?
     *
     * Checked before any of its vertices are written, so a list that runs out
     * ends on a whole primitive rather than on three quarters of one.
     */
    private reserve(): boolean {
        if (this.vertexData === null || this.indexData === null) {
            return false;
        }
        if (this.vertices + 4 > uiMaxVertices() || this.indices + 6 > uiMaxIndices()) {
            if (!this.overflowed) {
                this.overflowed = true;
                console.log(
                    `ui: draw list full at ${uiMaxVertices()} vertices — the overlay is incomplete`,
                );
            }
            return false;
        }
        return true;
    }

    private vertex(x: f32, y: f32, u: f32, v: f32, color: fvec4): void {
        const data = this.vertexData;
        if (data === null) {
            return;
        }

        const at = cast<usize>(this.vertices * uiVertexFloats());
        data[at + 0] = x;
        data[at + 1] = y;
        data[at + 2] = u;
        data[at + 3] = v;
        data[at + 4] = color.x;
        data[at + 5] = color.y;
        data[at + 6] = color.z;
        data[at + 7] = color.w;
        this.vertices += 1;
    }

    /**
     * Two triangles over the four vertices starting at `base`.
     *
     * Wound counter-clockwise in a `y`-down space, which is clockwise on screen —
     * and it does not matter, because the pipeline in `passes/ui.ts` culls
     * nothing. A UI quad has no back to face away.
     */
    private triangles(base: u32): void {
        const data = this.indexData;
        if (data === null) {
            return;
        }

        const at = cast<usize>(this.indices);
        data[at + 0] = base + 0;
        data[at + 1] = base + 1;
        data[at + 2] = base + 2;
        data[at + 3] = base + 0;
        data[at + 4] = base + 2;
        data[at + 5] = base + 3;
        this.indices += 6;
    }
}

/**
 * The index into {@link UiAtlas.glyphs} for a codepoint, or `-1` if the face has
 * no record for it.
 *
 * Only printable ASCII is baked — see `atlas.ts` — so anything else, including
 * the zero `codePointAt` returns for a UTF-8 continuation byte, draws nothing
 * and advances nothing.
 */
function glyphFor(atlas: Reference<UiAtlas>, base: usize, code: u32): isize {
    if (code < 32 || code > 126) {
        return -1;
    }

    const index = base + cast<usize>(code - 32);
    if (index >= atlas.glyphs.length) {
        return -1;
    }
    return cast<isize>(index);
}
