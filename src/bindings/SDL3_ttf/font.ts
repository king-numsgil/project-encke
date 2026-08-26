// `TTF_Font` — opening one, asking it about itself, and changing how it draws.
//
// A `TTF_Font` is a *face at a size and style*, not a file. Two sizes of the
// same file are two fonts, and every setter here — size, style, outline,
// hinting, SDF — throws away the glyph cache and re-renders on next use. That
// makes them cheap to call once at load and expensive to call per frame.
//
// `TTF_CopyFont` exists for exactly that: it shares the file's data with the
// original but keeps its own size and style, so a second size costs a copy
// rather than a second parse of the font file.
//
// **Every setter also updates any `TTF_Text` built from the font.** Resizing a
// font re-lays out every live text object that uses it, which is convenient and
// is also why it is not free.

import type { SDL_IOStream, SDL_PropertiesID, SDL_Surface } from "../SDL3";

/** An opaque handle to a font face at a particular size and style. */
export declare class TTF_Font {
    private _opaque: never;
}

/** Style bits, OR'd together. Synthesised by the library, not selected from the file. */
export enum TTF_FontStyleFlags {
    NORMAL = 0x00,
    BOLD = 0x01,
    ITALIC = 0x02,
    UNDERLINE = 0x04,
    STRIKETHROUGH = 0x08,
}

export declare namespace TTF_FontStyleFlags {
    type Underlying = u32;
}

/**
 * How hard to push the outlines onto the pixel grid.
 *
 * `NORMAL` and `MONO` snap stems to whole pixels — crisper, and the glyph
 * shapes distort to get there. `NONE` keeps the shapes and lets them blur.
 * `LIGHT_SUBPIXEL` only snaps vertically, keeping horizontal spacing exact,
 * which is what wants to be paired with the LCD renderers in `render.ts`.
 */
export enum TTF_HintingFlags {
    INVALID = -1,
    /** Standard grid-fitting. */
    NORMAL,
    /** Subtler adjustments. */
    LIGHT,
    /** For monochrome output at small sizes. */
    MONO,
    /** No grid-fitting at all. */
    NONE,
    /** Light hinting with subpixel positioning. */
    LIGHT_SUBPIXEL,
}

export declare namespace TTF_HintingFlags {
    type Underlying = i32;
}

/**
 * The named weights on the CSS scale, which is also the scale
 * {@link TTF_GetFontWeight} reports on.
 *
 * These are landmarks, not the whole set — a variable font can sit anywhere
 * between them, which is why the query returns a plain `i32`.
 */
export enum TTF_FontWeight {
    THIN = 100,
    EXTRA_LIGHT = 200,
    LIGHT = 300,
    NORMAL = 400,
    MEDIUM = 500,
    SEMI_BOLD = 600,
    BOLD = 700,
    EXTRA_BOLD = 800,
    BLACK = 900,
    EXTRA_BLACK = 950,
}

export declare namespace TTF_FontWeight {
    type Underlying = i32;
}

/** Where wrapped lines sit within the wrap width. */
export enum TTF_HorizontalAlignment {
    INVALID = -1,
    LEFT,
    CENTER,
    RIGHT,
}

export declare namespace TTF_HorizontalAlignment {
    type Underlying = i32;
}

/**
 * The direction text flows.
 *
 * The values match HarfBuzz's `hb_direction_t`, which is why they start at 4
 * rather than 1. Anything but `LTR` needs a HarfBuzz-enabled build.
 */
export enum TTF_Direction {
    INVALID = 0,
    LTR = 4,
    RTL,
    TTB,
    BTT,
}

export declare namespace TTF_Direction {
    type Underlying = i32;
}

/**
 * What the pixels in a glyph image actually mean.
 *
 * A caller that samples every glyph the same way gets colour emoji rendered as
 * a grey blob and SDF glyphs rendered as a smear, so this is worth reading
 * rather than assuming.
 */
export enum TTF_ImageType {
    INVALID,
    /** Coverage in the alpha channel; the colour channels are white. */
    ALPHA,
    /** A real colour bitmap — an emoji, or a colour-layered glyph. */
    COLOR,
    /** Signed distances in the alpha channel. See {@link TTF_SetFontSDF}. */
    SDF,
}

export declare namespace TTF_ImageType {
    type Underlying = i32;
}

// ---------------------------------------------------------------------------
// Opening and closing.
// ---------------------------------------------------------------------------

/**
 * Open a font file at a point size.
 *
 * `ptsize` is a size in points for a scalable font and an *index* into the
 * embedded sizes for a bitmap one — a `.fon` with three sizes takes 0, 1 or 2
 * here, and anything larger picks the last. `TTF_FontIsScalable` says which
 * kind of file this is.
 */
export declare function TTF_OpenFont(file: CString, ptsize: f32): Pointer<TTF_Font> | null;

/**
 * {@link TTF_OpenFont} from a stream.
 *
 * The font reads from `src` for as long as it lives, so unlike SDL3_image's
 * loaders this does not consume the stream and finish with it. `closeio` closes
 * it when the font closes; passing `false` means keeping it open yourself until
 * then.
 */
export declare function TTF_OpenFontIO(
    src: Pointer<SDL_IOStream>,
    closeio: boolean,
    ptsize: f32,
): Pointer<TTF_Font> | null;

/**
 * A font configured by property group — the only route to a face index, a DPI
 * other than 72, or a stream offset. See `TTF_PROP_FONT_CREATE_*` in `props.ts`.
 */
export declare function TTF_OpenFontWithProperties(props: SDL_PropertiesID): Pointer<TTF_Font> | null;

/**
 * A second, independent font over the same file data.
 *
 * The copy starts at the original's size and style and diverges from there.
 * This is how to get a second size cheaply — see the note at the top of this
 * file.
 */
export declare function TTF_CopyFont(existing_font: Pointer<TTF_Font>): Pointer<TTF_Font> | null;

/**
 * Release a font.
 *
 * Null is accepted, so the result of a failed `TTF_OpenFont` can be passed
 * straight in. Every `CString` the font handed out — family name, style name —
 * dies with it.
 */
export declare function TTF_CloseFont(font: Pointer<TTF_Font> | null): void;

// ---------------------------------------------------------------------------
// Properties and change tracking.
// ---------------------------------------------------------------------------

/**
 * The font's property group — the outline stroker settings, and anywhere else
 * to hang your own data. See `TTF_PROP_FONT_OUTLINE_*` in `props.ts`.
 *
 * The group belongs to the font and dies with it.
 */
export declare function TTF_GetFontProperties(font: Pointer<TTF_Font>): SDL_PropertiesID;

/**
 * A counter bumped every time something changes that invalidates cached glyphs.
 *
 * The point of it is a glyph atlas of your own: cache the generation alongside
 * the atlas, and rebuild when the numbers stop matching. Zero means the query
 * failed.
 */
export declare function TTF_GetFontGeneration(font: Pointer<TTF_Font>): u32;

// ---------------------------------------------------------------------------
// Fallback fonts, for glyphs this face does not have.
//
// Consulted in the order added, and only for codepoints the font itself is
// missing. They should be at the same size and style as the font they back —
// nothing enforces that, and a mismatch shows up as one word in the wrong size
// rather than as an error.
// ---------------------------------------------------------------------------

export declare function TTF_AddFallbackFont(font: Pointer<TTF_Font>, fallback: Pointer<TTF_Font>): boolean;

export declare function TTF_RemoveFallbackFont(font: Pointer<TTF_Font>, fallback: Pointer<TTF_Font>): void;

export declare function TTF_ClearFallbackFonts(font: Pointer<TTF_Font>): void;

// ---------------------------------------------------------------------------
// Size and resolution.
// ---------------------------------------------------------------------------

export declare function TTF_SetFontSize(font: Pointer<TTF_Font>, ptsize: f32): boolean;

/**
 * Resize against a target resolution.
 *
 * A point is 1/72 inch, so the pixel size is `ptsize * dpi / 72` — the default
 * 72 DPI is what makes points and pixels coincide. Passing the display's real
 * DPI is how the same `ptsize` stays the same physical size across monitors.
 */
export declare function TTF_SetFontSizeDPI(font: Pointer<TTF_Font>, ptsize: f32, hdpi: i32, vdpi: i32): boolean;

/** The point size, or 0 on failure. */
export declare function TTF_GetFontSize(font: Pointer<TTF_Font>): f32;

export declare function TTF_GetFontDPI(font: Pointer<TTF_Font>, hdpi: Pointer<i32> | null, vdpi: Pointer<i32> | null): boolean;

// ---------------------------------------------------------------------------
// Appearance.
// ---------------------------------------------------------------------------

export declare function TTF_SetFontStyle(font: Pointer<TTF_Font>, style: TTF_FontStyleFlags): void;

export declare function TTF_GetFontStyle(font: Pointer<TTF_Font>): TTF_FontStyleFlags;

/**
 * Stroke the glyph outlines, in pixels. 0 turns it off.
 *
 * The stroke grows *outward*, so an outlined glyph is wider and taller than the
 * same glyph without one and the metrics change to match. The joins and caps
 * come from the `TTF_PROP_FONT_OUTLINE_*` properties, read at the moment this
 * is called rather than at render time.
 */
export declare function TTF_SetFontOutline(font: Pointer<TTF_Font>, outline: i32): boolean;

export declare function TTF_GetFontOutline(font: Pointer<TTF_Font>): i32;

export declare function TTF_SetFontHinting(font: Pointer<TTF_Font>, hinting: TTF_HintingFlags): void;

/** `TTF_HintingFlags.INVALID` if the font is not valid. */
export declare function TTF_GetFontHinting(font: Pointer<TTF_Font>): TTF_HintingFlags;

/**
 * Render glyphs as signed distance fields instead of coverage.
 *
 * The distances land in the alpha channel of the *Blended* renderers' output,
 * so this only means anything alongside `TTF_RenderText_Blended` or a text
 * engine, and the result is unreadable without a shader that thresholds it.
 * What it buys is one atlas that stays sharp at any scale or rotation.
 */
export declare function TTF_SetFontSDF(font: Pointer<TTF_Font>, enabled: boolean): boolean;

export declare function TTF_GetFontSDF(font: Pointer<TTF_Font>): boolean;

/** The stroke weight on the CSS scale — see {@link TTF_FontWeight}. */
export declare function TTF_GetFontWeight(font: Pointer<TTF_Font>): i32;

export declare function TTF_SetFontWrapAlignment(font: Pointer<TTF_Font>, align: TTF_HorizontalAlignment): void;

export declare function TTF_GetFontWrapAlignment(font: Pointer<TTF_Font>): TTF_HorizontalAlignment;

// ---------------------------------------------------------------------------
// Vertical metrics. All in pixels, all measured from the baseline unless said
// otherwise.
// ---------------------------------------------------------------------------

/** Ascent plus descent — roughly the point size. Not the distance between lines. */
export declare function TTF_GetFontHeight(font: Pointer<TTF_Font>): i32;

/** Baseline to the top. Positive. */
export declare function TTF_GetFontAscent(font: Pointer<TTF_Font>): i32;

/** Baseline to the bottom. **Negative**, so adding it moves down. */
export declare function TTF_GetFontDescent(font: Pointer<TTF_Font>): i32;

/**
 * Override the baseline-to-baseline distance the file recommends.
 *
 * This is the one to set for line spacing; `TTF_GetFontHeight` measures a glyph
 * box, not a line, and stacking lines at that pitch leaves them touching.
 */
export declare function TTF_SetFontLineSkip(font: Pointer<TTF_Font>, lineskip: i32): void;

export declare function TTF_GetFontLineSkip(font: Pointer<TTF_Font>): i32;

// ---------------------------------------------------------------------------
// Shaping.
// ---------------------------------------------------------------------------

/**
 * Kerning is on for a new font, and turning it off is almost always wrong — it
 * is what stops `AV` from sitting a visible gap apart.
 */
export declare function TTF_SetFontKerning(font: Pointer<TTF_Font>, enabled: boolean): void;

export declare function TTF_GetFontKerning(font: Pointer<TTF_Font>): boolean;

/**
 * The direction text flows.
 *
 * Without HarfBuzz only `TTF_Direction.LTR` is accepted and this returns false
 * for the rest — see {@link TTF_GetHarfBuzzVersion}.
 */
export declare function TTF_SetFontDirection(font: Pointer<TTF_Font>, direction: TTF_Direction): boolean;

/** `TTF_Direction.INVALID` until something sets it. */
export declare function TTF_GetFontDirection(font: Pointer<TTF_Font>): TTF_Direction;

/**
 * The script to shape as, an [ISO 15924](https://unicode.org/iso15924/iso15924-codes.html)
 * code packed into four bytes by {@link TTF_StringToTag}.
 *
 * False without HarfBuzz.
 */
export declare function TTF_SetFontScript(font: Pointer<TTF_Font>, script: u32): boolean;

/** 0 if no script has been set. */
export declare function TTF_GetFontScript(font: Pointer<TTF_Font>): u32;

/** The script a codepoint belongs to, so a caller can set it from the text itself. */
export declare function TTF_GetGlyphScript(ch: u32): u32;

/**
 * The language to shape as, a BCP 47 code such as `"en-GB"`. Null resets it.
 *
 * It matters because the same script renders differently by language — Turkish
 * suppresses the `fi` ligature, Serbian Cyrillic uses different italic forms.
 * False without HarfBuzz.
 */
export declare function TTF_SetFontLanguage(font: Pointer<TTF_Font>, language_bcp47: CString | null): boolean;

/** Pack a four-character tag, e.g. `"Latn"`, into the `u32` the script calls take. */
export declare function TTF_StringToTag(string: CString): u32;

/**
 * Unpack a tag into `string`.
 *
 * `size` is the buffer's size and wants to be at least 4 — the four characters
 * are written with **no NUL terminator** unless there is room for a fifth byte.
 */
export declare function TTF_TagToString(tag: u32, string: Pointer<u8>, size: usize): void;

// ---------------------------------------------------------------------------
// Naming.
// ---------------------------------------------------------------------------

/**
 * The family name from the font file, e.g. `"Inter"`.
 *
 * Points into the font's own storage: do not free it, and do not keep it past
 * {@link TTF_CloseFont}. Null when the file carries no name.
 */
export declare function TTF_GetFontFamilyName(font: Pointer<TTF_Font>): CString | null;

/** The style name, e.g. `"Regular"`. Same lifetime rules as the family name. */
export declare function TTF_GetFontStyleName(font: Pointer<TTF_Font>): CString | null;

/** How many faces the file holds — a `.ttc` collection has several, a `.ttf` one. */
export declare function TTF_GetNumFontFaces(font: Pointer<TTF_Font>): i32;

/** Is every glyph the same width? True for JetBrains Mono, false for Inter. */
export declare function TTF_FontIsFixedWidth(font: Pointer<TTF_Font>): boolean;

/** Outline font (any size) rather than bitmap font (the sizes in the file). */
export declare function TTF_FontIsScalable(font: Pointer<TTF_Font>): boolean;

// ---------------------------------------------------------------------------
// Individual glyphs.
// ---------------------------------------------------------------------------

/** Does the font — or one of its fallbacks — draw this codepoint? */
export declare function TTF_FontHasGlyph(font: Pointer<TTF_Font>, ch: u32): boolean;

/**
 * Rasterise one glyph on its own.
 *
 * The surface is the caller's, to be released with `SDL_DestroySurface`.
 * `image_type` is worth reading rather than dropping: see {@link TTF_ImageType}.
 */
export declare function TTF_GetGlyphImage(
    font: Pointer<TTF_Font>,
    ch: u32,
    image_type: Pointer<TTF_ImageType> | null,
): Pointer<SDL_Surface> | null;

/**
 * {@link TTF_GetGlyphImage} by glyph index rather than codepoint.
 *
 * This is the form a text engine needs — a `TTF_CopyOperation` names a glyph
 * index and the font it came from, because shaping has already turned
 * codepoints into glyphs by then and the mapping is not one to one.
 */
export declare function TTF_GetGlyphImageForIndex(
    font: Pointer<TTF_Font>,
    glyph_index: u32,
    image_type: Pointer<TTF_ImageType> | null,
): Pointer<SDL_Surface> | null;

/**
 * One glyph's box and advance, in pixels.
 *
 * `minx`/`miny` may be negative — a `j` reaches left of its origin and below the
 * baseline. `advance` is where the *next* glyph starts, which is not the same as
 * `maxx`. Every out-parameter may be null.
 */
export declare function TTF_GetGlyphMetrics(
    font: Pointer<TTF_Font>,
    ch: u32,
    minx: Pointer<i32> | null,
    maxx: Pointer<i32> | null,
    miny: Pointer<i32> | null,
    maxy: Pointer<i32> | null,
    advance: Pointer<i32> | null,
): boolean;

/** The pixel adjustment between two codepoints in sequence. Usually negative. */
export declare function TTF_GetGlyphKerning(
    font: Pointer<TTF_Font>,
    previous_ch: u32,
    ch: u32,
    kerning: Pointer<i32> | null,
): boolean;

// ---------------------------------------------------------------------------
// Measuring a string without drawing it.
//
// `length` is a byte count, and **0 means NUL-terminated** — not "empty". These
// shape the text to answer, so they are not free, but they do not rasterise.
// ---------------------------------------------------------------------------

export declare function TTF_GetStringSize(
    font: Pointer<TTF_Font>,
    text: CString,
    length: usize,
    w: Pointer<i32> | null,
    h: Pointer<i32> | null,
): boolean;

/** `wrap_width` of 0 wraps only on newlines. */
export declare function TTF_GetStringSizeWrapped(
    font: Pointer<TTF_Font>,
    text: CString,
    length: usize,
    wrap_width: i32,
    w: Pointer<i32> | null,
    h: Pointer<i32> | null,
): boolean;

/**
 * How much of a string fits in `max_width` pixels.
 *
 * `measured_length` comes back in **bytes**, cut at a UTF-8 boundary, which is
 * what makes this the call to build an ellipsis or a text cursor on. 0 for
 * `max_width` means unbounded.
 */
export declare function TTF_MeasureString(
    font: Pointer<TTF_Font>,
    text: CString,
    length: usize,
    max_width: i32,
    measured_width: Pointer<i32> | null,
    measured_length: Pointer<usize> | null,
): boolean;
