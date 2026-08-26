// One texture holding everything the overlay draws with.
//
// Rectangles, circles, lines and text are all quads sampling this atlas, which
// is what lets the whole overlay be a single draw call — see `shaders/ui.wgsl`.
// Three kinds of thing live in it:
//
//   * **A block of solid white.** Shapes sample its centre, so a rectangle is a
//     textured quad whose texture happens to be `1`. Four texels rather than one,
//     because a linear tap on a 1x1 cell reaches into the padding around it.
//   * **An antialiased disc.** A circle is one quad sampling this, upscaled. That
//     is two triangles instead of a fan, the edge is smooth for free, and the
//     cost is that a circle much larger than the baked cell goes soft — plot
//     markers and status dots, which is what a debug overlay draws, are far
//     below that. A distance field evaluated in the fragment shader would scale
//     without limit and would put a branch and a `length()` on every fragment of
//     every rectangle too.
//   * **Printable ASCII for each font**, rasterised once by SDL_ttf at a fixed
//     point size.
//
// **The glyphs are baked, not streamed.** SDL_ttf ships a GPU text engine that
// maintains an atlas of its own, and it is the right tool for text that is not
// known ahead of time. A debug overlay's text is 95 codepoints, decided at
// build time, and the engine's model — a retained `TTF_Text` per string, its own
// texture, its own vertex arrays — would mean a per-string cache to keep an
// immediate-mode API on top of, and a second texture to break the batch on.
// Baking gives one texture, no retained state, and layout this file controls.
//
// **No kerning.** `TTF_GetGlyphKerning` exists and a pair table would be another
// 9025 entries per font. At 13px the difference is sub-pixel on the sans and
// exactly zero on the mono, which is what the numbers are set in.

import { fsqrt } from "std/math";
import {
    SDL_AcquireGPUCommandBuffer,
    SDL_BeginGPUCopyPass,
    SDL_ConvertSurface,
    SDL_CreateGPUTexture,
    SDL_CreateGPUTransferBuffer,
    SDL_DestroySurface,
    SDL_EndGPUCopyPass,
    SDL_GetError,
    type SDL_GPUDevice,
    type SDL_GPUTexture,
    type SDL_GPUTextureCreateInfo,
    SDL_GPUTextureFormat,
    type SDL_GPUTextureRegion,
    type SDL_GPUTextureTransferInfo,
    SDL_GPUTextureUsageFlags,
    SDL_GPUTransferBufferUsage,
    type SDL_GPUTransferBufferCreateInfo,
    SDL_MapGPUTransferBuffer,
    SDL_PixelFormat,
    SDL_ReleaseGPUTexture,
    SDL_ReleaseGPUTransferBuffer,
    SDL_SetGPUTextureName,
    SDL_SubmitGPUCommandBuffer,
    type SDL_Surface,
    SDL_UnmapGPUTransferBuffer,
    SDL_UploadToGPUTexture,
    SDL_WaitForGPUIdle,
} from "../../bindings/SDL3";
import {
    TTF_CloseFont,
    TTF_GetFontAscent,
    TTF_GetFontDescent,
    TTF_GetFontHeight,
    TTF_GetFontLineSkip,
    TTF_GetGlyphImage,
    TTF_GetGlyphMetrics,
    TTF_OpenFont,
} from "../../bindings/SDL3_ttf";
import { uiAtlasPadding, uiAtlasWidth, uiDiscSize, uiFontSize } from "../config.ts";

/**
 * The proportional face's index, for {@link UiDrawList.text}.
 *
 * The indices are the order the paths were handed to {@link UiAtlas.build}, and
 * the renderer builds it from `uiSansFontPath()` then `uiMonoFontPath()`.
 */
export function uiFontSans(): usize {
    return 0;
}

/** The monospaced face's index. */
export function uiFontMono(): usize {
    return 1;
}

/** First codepoint baked, inclusive: space. */
function firstCodepoint(): u32 {
    return 32;
}

/** Last codepoint baked, inclusive: `~`. */
function lastCodepoint(): u32 {
    return 126;
}

/** Edge of the solid white block, in texels. See the note at the top of this file. */
function whiteSize(): u32 {
    return 4;
}

/**
 * Ceiling on the packed height, in texels.
 *
 * The CPU-side buffer has to exist before packing decides how tall the result
 * is, so it is allocated at this and the texture is created at whatever the
 * shelves actually came to. Two fonts of printable ASCII at 13px use about a
 * fifth of it.
 */
function maxAtlasHeight(): u32 {
    return 1024;
}

/** One glyph's place in the atlas and its metrics, in pixels. */
export class UiGlyph {
    /** How far the pen moves after drawing this. */
    advance: f32;

    /** Left edge of the bitmap relative to the pen. Negative for glyphs that reach left. */
    bearingX: f32;

    /** Top edge of the bitmap **above the baseline**. Positive for anything with a body. */
    bearingY: f32;

    /** Bitmap size. Zero for a space, which has an advance and nothing to draw. */
    w: f32;
    h: f32;

    /** The cell, in normalised atlas coordinates. */
    u0: f32;
    v0: f32;
    u1: f32;
    v1: f32;

    constructor() {
        this.advance = 0.0;
        this.bearingX = 0.0;
        this.bearingY = 0.0;
        this.w = 0.0;
        this.h = 0.0;
        this.u0 = 0.0;
        this.v0 = 0.0;
        this.u1 = 0.0;
        this.v1 = 0.0;
    }
}

/**
 * One baked face.
 *
 * `base` indexes {@link UiAtlas.glyphs}: the record for codepoint `c` is at
 * `base + (c - 32)`. Fonts share one glyph array so that a face is a small
 * value the draw list can be handed by index.
 */
export class UiFont {
    base: usize;

    /** Baseline to the top of the line. Text is positioned by its top, so this is the offset down to the baseline. */
    ascent: f32;

    /** Baseline to the bottom. Negative, as SDL_ttf reports it. */
    descent: f32;

    /** Baseline to baseline. What to advance by between lines. */
    lineSkip: f32;

    /** Ascent plus descent — the height of a glyph box, not of a line. */
    height: f32;

    constructor() {
        this.base = 0;
        this.ascent = 0.0;
        this.descent = 0.0;
        this.lineSkip = 0.0;
        this.height = 0.0;
    }
}

/** A shelf packer's cursor. Rows are filled left to right, then a new row starts. */
class Shelf {
    x: u32;
    y: u32;
    height: u32;

    constructor() {
        this.x = 0;
        this.y = 0;
        this.height = 0;
    }
}

export class UiAtlas {
    private texture: Pointer<SDL_GPUTexture> | null;

    /** Every baked glyph, for every font. Indexed through {@link UiFont.base}. */
    glyphs: UiGlyph[];

    fonts: UiFont[];

    /** Atlas coordinates of the centre of the white block. Shapes sample exactly this. */
    whiteU: f32;
    whiteV: f32;

    /** The disc's cell. */
    discU0: f32;
    discV0: f32;
    discU1: f32;
    discV1: f32;

    /**
     * How much wider than its drawn radius a circle's quad has to be.
     *
     * The disc is baked with a one-texel transparent margin so its edge has room
     * to fade, so the ink stops short of the cell. A quad of half-extent
     * `radius * this` puts the fade exactly on `radius`.
     */
    discOversize: f32;

    constructor() {
        this.texture = null;
        this.glyphs = [];
        this.fonts = [];
        this.whiteU = 0.0;
        this.whiteV = 0.0;
        this.discU0 = 0.0;
        this.discV0 = 0.0;
        this.discU1 = 0.0;
        this.discV1 = 0.0;
        this.discOversize = 1.0;
    }

    /** The atlas texture, or null before {@link build} has succeeded. */
    handle(): Pointer<SDL_GPUTexture> | null {
        return this.texture;
    }

    /**
     * Rasterise the white block, the disc and both fonts into one texture.
     *
     * Blocking: this is a load-time call and the texture is ready to bind when it
     * returns. A font that will not open costs its glyphs and nothing else — the
     * face is still registered, with zero metrics, so a caller drawing through it
     * gets no text rather than a crash.
     */
    build(device: Pointer<SDL_GPUDevice>, fontPaths: string[]): boolean {
        const width = uiAtlasWidth();
        const pad = uiAtlasPadding();
        const pixels = allocArray<u8>(cast<usize>(width) * cast<usize>(maxAtlasHeight()) * 4);
        const shelf = new Shelf();

        // The disc goes last on purpose. A shelf is as tall as its tallest cell,
        // so packing a 64-texel disc before a run of 18-texel glyphs would give
        // the whole first shelf the disc's height and waste most of it.
        this.packWhite(pixels, width, shelf, pad);
        for (let i: usize = 0; i < fontPaths.length; i++) {
            this.packFont(pixels, width, shelf, pad, fontPaths[i]);
        }
        this.packDisc(pixels, width, shelf, pad);

        // The last shelf's row, plus its height, plus a border to match the one
        // every cell has on its other three sides.
        const height = shelf.y + shelf.height + pad;
        if (height === 0 || height > maxAtlasHeight()) {
            console.log(`ui atlas: packed height ${height} does not fit ${maxAtlasHeight()}`);
            pixels.freeArray();
            return false;
        }

        this.normalise(width, height);

        const texture = createAtlasTexture(device, width, height);
        if (texture === null) {
            pixels.freeArray();
            return false;
        }

        if (!upload(device, texture, pixels, width, height)) {
            SDL_ReleaseGPUTexture(device, texture);
            pixels.freeArray();
            return false;
        }

        pixels.freeArray();
        this.texture = texture;
        console.log(`ui atlas: ${width}x${height}, ${this.glyphs.length} glyphs, ${this.fonts.length} fonts`);
        return true;
    }

    /** A block of opaque white. Its centre is what every shape's UV points at. */
    private packWhite(pixels: Pointer<u8>, width: u32, shelf: Reference<Shelf>, pad: u32): void {
        const size = whiteSize();
        const x = place(shelf, width, size, size, pad);
        const y = shelf.y;

        for (let row: u32 = 0; row < size; row++) {
            for (let column: u32 = 0; column < size; column++) {
                const at = (cast<usize>(y + row) * cast<usize>(width) + cast<usize>(x + column)) * 4;
                pixels[at + 0] = 255;
                pixels[at + 1] = 255;
                pixels[at + 2] = 255;
                pixels[at + 3] = 255;
            }
        }

        // Stored in texels for now; `normalise` divides through once the atlas
        // height is known. Half a texel in from the corner is the centre of the
        // block, which no linear tap can wander out of.
        this.whiteU = cast<f32>(x) + cast<f32>(size) * 0.5;
        this.whiteV = cast<f32>(y) + cast<f32>(size) * 0.5;
    }

    /**
     * A filled circle with a one-texel antialiased edge.
     *
     * Coverage is the linear ramp `radius + 0.5 - distance`, clamped — an
     * approximation to the area of the pixel inside the circle that is exact at
     * the extremes and within a percent or so between them, which is a great deal
     * cheaper than integrating and indistinguishable at this size.
     */
    private packDisc(pixels: Pointer<u8>, width: u32, shelf: Reference<Shelf>, pad: u32): void {
        const size = uiDiscSize();
        const x = place(shelf, width, size, size, pad);
        const y = shelf.y;

        const half = cast<f32>(size) * 0.5;
        // One texel short of the cell, so the fade has somewhere to happen and
        // the cell's own border stays clear for the linear tap.
        const radius = half - 1.0;

        for (let row: u32 = 0; row < size; row++) {
            for (let column: u32 = 0; column < size; column++) {
                const dx = cast<f32>(column) + 0.5 - half;
                const dy = cast<f32>(row) + 0.5 - half;
                const distance = fsqrt(dx * dx + dy * dy);

                let coverage = radius + 0.5 - distance;
                if (coverage < 0.0) {
                    coverage = 0.0;
                }
                if (coverage > 1.0) {
                    coverage = 1.0;
                }

                const at = (cast<usize>(y + row) * cast<usize>(width) + cast<usize>(x + column)) * 4;
                pixels[at + 0] = 255;
                pixels[at + 1] = 255;
                pixels[at + 2] = 255;
                pixels[at + 3] = cast<u8>(coverage * 255.0 + 0.5);
            }
        }

        this.discU0 = cast<f32>(x);
        this.discV0 = cast<f32>(y);
        this.discU1 = cast<f32>(x + size);
        this.discV1 = cast<f32>(y + size);
        this.discOversize = half / radius;
    }

    /** Open a face, rasterise its printable ASCII, and register it. */
    private packFont(
        pixels: Pointer<u8>,
        width: u32,
        shelf: Reference<Shelf>,
        pad: u32,
        path: string,
    ): void {
        const face = new UiFont();
        face.base = this.glyphs.length;

        const font = TTF_OpenFont(cstring(path), uiFontSize());
        if (font === null) {
            console.log(`ui atlas: cannot open ${path} : ${stringFromCString(SDL_GetError())}`);
            this.fonts.push(face);
            return;
        }

        face.ascent = cast<f32>(TTF_GetFontAscent(font));
        face.descent = cast<f32>(TTF_GetFontDescent(font));
        face.lineSkip = cast<f32>(TTF_GetFontLineSkip(font));
        face.height = cast<f32>(TTF_GetFontHeight(font));

        const minx: FixedArray<i32, 1> = fixedArray(1, 0);
        const maxx: FixedArray<i32, 1> = fixedArray(1, 0);
        const miny: FixedArray<i32, 1> = fixedArray(1, 0);
        const maxy: FixedArray<i32, 1> = fixedArray(1, 0);
        const advance: FixedArray<i32, 1> = fixedArray(1, 0);

        for (let code = firstCodepoint(); code <= lastCodepoint(); code++) {
            const glyph = new UiGlyph();

            if (TTF_GetGlyphMetrics(font, code, minx, maxx, miny, maxy, advance)) {
                glyph.advance = cast<f32>(advance[0]);
                glyph.bearingX = cast<f32>(minx[0]);
                glyph.bearingY = cast<f32>(maxy[0]);
            }

            // A space has metrics and no bitmap, and SDL_ttf reports that as
            // either a null surface or a zero-sized one depending on the face.
            const image = TTF_GetGlyphImage(font, code, null);
            if (image !== null && image.w > 0 && image.h > 0) {
                this.packGlyph(pixels, width, shelf, pad, glyph, image);
            }
            if (image !== null) {
                SDL_DestroySurface(image);
            }

            this.glyphs.push(glyph);
        }

        TTF_CloseFont(font);
        this.fonts.push(face);
    }

    /** Convert one rasterised glyph to RGBA, copy it into a cell, and record the cell. */
    private packGlyph(
        pixels: Pointer<u8>,
        width: u32,
        shelf: Reference<Shelf>,
        pad: u32,
        glyph: Reference<UiGlyph>,
        image: Pointer<SDL_Surface>,
    ): void {
        // Whatever the rasteriser produced — 8-bit paletted for a bitmap face,
        // ARGB for an antialiased one — becomes four bytes per pixel in a known
        // order. For an alpha glyph that is white with coverage in `a`, which is
        // exactly what `ui.wgsl` multiplies the tint by.
        const rgba = SDL_ConvertSurface(image, SDL_PixelFormat.RGBA32);
        if (rgba === null) {
            return;
        }

        const source = rgba.pixels;
        if (source === null) {
            SDL_DestroySurface(rgba);
            return;
        }

        const cellWidth = cast<u32>(rgba.w);
        const cellHeight = cast<u32>(rgba.h);
        const x = place(shelf, width, cellWidth, cellHeight, pad);
        const y = shelf.y;

        const bytes = source.reify<u8>();
        const pitch = cast<usize>(rgba.pitch);

        for (let row: u32 = 0; row < cellHeight; row++) {
            const from = cast<usize>(row) * pitch;
            const to = (cast<usize>(y + row) * cast<usize>(width) + cast<usize>(x)) * 4;
            for (let byte: usize = 0; byte < cast<usize>(cellWidth) * 4; byte++) {
                pixels[to + byte] = bytes[from + byte];
            }
        }

        glyph.w = cast<f32>(cellWidth);
        glyph.h = cast<f32>(cellHeight);
        glyph.u0 = cast<f32>(x);
        glyph.v0 = cast<f32>(y);
        glyph.u1 = cast<f32>(x + cellWidth);
        glyph.v1 = cast<f32>(y + cellHeight);
    }

    /**
     * Texel coordinates to normalised ones, once the height is known.
     *
     * Packing cannot do this as it goes: the atlas is exactly as tall as its
     * shelves, and that is not known until the last glyph has been placed.
     */
    private normalise(width: u32, height: u32): void {
        const du = 1.0 / cast<f32>(width);
        const dv = 1.0 / cast<f32>(height);

        this.whiteU *= du;
        this.whiteV *= dv;
        this.discU0 *= du;
        this.discV0 *= dv;
        this.discU1 *= du;
        this.discV1 *= dv;

        for (let i: usize = 0; i < this.glyphs.length; i++) {
            this.glyphs[i].u0 *= du;
            this.glyphs[i].v0 *= dv;
            this.glyphs[i].u1 *= du;
            this.glyphs[i].v1 *= dv;
        }
    }

    release(device: Pointer<SDL_GPUDevice>): void {
        const texture = this.texture;
        if (texture !== null) {
            SDL_ReleaseGPUTexture(device, texture);
        }
        this.texture = null;
        this.glyphs = [];
        this.fonts = [];
    }
}

/**
 * Reserve `w` by `h` on the current shelf and return its left edge.
 *
 * The shelf's `y` is left pointing at the row the cell was placed on, which is
 * why every caller reads `shelf.y` immediately after. A cell wider than the
 * atlas is placed anyway and overhangs; nothing here is close to that and the
 * check would cost more than it saves.
 */
function place(shelf: Reference<Shelf>, width: u32, w: u32, h: u32, pad: u32): u32 {
    if (shelf.x + w + pad > width) {
        shelf.y += shelf.height + pad;
        shelf.x = pad;
        shelf.height = 0;
    } else if (shelf.x === 0) {
        shelf.x = pad;
        shelf.y = pad;
    }

    const x = shelf.x;
    shelf.x += w + pad;
    if (h > shelf.height) {
        shelf.height = h;
    }
    return x;
}

/**
 * The atlas texture itself.
 *
 * `R8G8B8A8_UNORM` and deliberately not the `_SRGB` twin: these texels are
 * coverage, and coverage is a fraction of a pixel rather than a colour. Running
 * it through an sRGB decode would make every glyph's antialiasing too light.
 */
function createAtlasTexture(
    device: Pointer<SDL_GPUDevice>,
    width: u32,
    height: u32,
): Pointer<SDL_GPUTexture> | null {
    const info = alloc<SDL_GPUTextureCreateInfo>({
        format: SDL_GPUTextureFormat.R8G8B8A8_UNORM,
        usage: SDL_GPUTextureUsageFlags.SAMPLER,
        width: width,
        height: height,
        layer_count_or_depth: 1,
        num_levels: 1,
    });
    const texture = SDL_CreateGPUTexture(device, info);
    info.free();

    if (texture === null) {
        console.log(`ui atlas: texture ${width}x${height} failed : ${stringFromCString(SDL_GetError())}`);
        return null;
    }

    SDL_SetGPUTextureName(device, texture, cstring("ui.atlas"));
    return texture;
}

/** Copy the packed bytes up, on a command buffer of its own. Load time only. */
function upload(
    device: Pointer<SDL_GPUDevice>,
    texture: Pointer<SDL_GPUTexture>,
    pixels: Pointer<u8>,
    width: u32,
    height: u32,
): boolean {
    const bytes = width * height * 4;

    const bufferInfo = alloc<SDL_GPUTransferBufferCreateInfo>({
        usage: SDL_GPUTransferBufferUsage.UPLOAD,
        size: bytes,
    });
    const transfer = SDL_CreateGPUTransferBuffer(device, bufferInfo);
    bufferInfo.free();

    if (transfer === null) {
        console.log(`ui atlas: transfer buffer failed : ${stringFromCString(SDL_GetError())}`);
        return false;
    }

    const mapped = SDL_MapGPUTransferBuffer(device, transfer, false);
    if (mapped === null) {
        console.log(`ui atlas: map failed : ${stringFromCString(SDL_GetError())}`);
        SDL_ReleaseGPUTransferBuffer(device, transfer);
        return false;
    }

    // The packed buffer is exactly `width * 4` per row with no padding — it was
    // built that way — so this is one run rather than the row-by-row copy
    // `assets/texture.ts` needs for a surface with a pitch of its own.
    const destination = mapped.reify<u8>();
    for (let i: usize = 0; i < cast<usize>(bytes); i++) {
        destination[i] = pixels[i];
    }
    SDL_UnmapGPUTransferBuffer(device, transfer);

    const cmd = SDL_AcquireGPUCommandBuffer(device);
    if (cmd === null) {
        console.log(`ui atlas: command buffer failed : ${stringFromCString(SDL_GetError())}`);
        SDL_ReleaseGPUTransferBuffer(device, transfer);
        return false;
    }

    const pass = SDL_BeginGPUCopyPass(cmd);
    if (pass === null) {
        console.log(`ui atlas: copy pass failed : ${stringFromCString(SDL_GetError())}`);
        SDL_SubmitGPUCommandBuffer(cmd);
        SDL_ReleaseGPUTransferBuffer(device, transfer);
        return false;
    }

    const from = alloc<SDL_GPUTextureTransferInfo>({
        transfer_buffer: transfer,
        pixels_per_row: width,
        rows_per_layer: height,
    });
    const to = alloc<SDL_GPUTextureRegion>({
        texture: texture,
        w: width,
        h: height,
        d: 1,
    });

    SDL_UploadToGPUTexture(pass, from, to, false);
    SDL_EndGPUCopyPass(pass);
    from.free();
    to.free();

    SDL_SubmitGPUCommandBuffer(cmd);
    SDL_WaitForGPUIdle(device);
    SDL_ReleaseGPUTransferBuffer(device, transfer);
    return true;
}
