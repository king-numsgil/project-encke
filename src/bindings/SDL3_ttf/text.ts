// `TTF_Text` — a string that remembers its own layout.
//
// The difference from `render.ts` is what is kept between calls. A `TTF_Text`
// holds the string, the shaping result and the glyphs, so appending a character
// re-lays out from the edit onward instead of re-shaping the whole thing, and
// drawing it costs no rasterisation at all. That is what makes it the right
// shape for anything that changes per frame — a counter, a log, an editable
// field — and overkill for a label drawn once.
//
// A text object needs a **text engine**, which is what decides where the pixels
// end up. Two are bound here:
//
//   * **The surface engine** — blits into an `SDL_Surface`, on the CPU.
//   * **The GPU engine** — keeps the glyphs in an `SDL_GPUTexture` atlas and
//     hands back vertex and index arrays through {@link TTF_GetGPUTextDrawData}.
//     Nothing is drawn for you: the geometry goes through a pipeline of your
//     own, which is exactly why it fits this project.
//
// The renderer engine is absent on purpose — see the note at the top of
// `version.ts`.
//
// **`TTF_CreateText` accepts a null engine.** The text then measures and lays
// out but cannot be drawn, which is the cheap way to ask layout questions about
// a string that is never going on screen.
//
// **Layout is lazy.** Every setter here marks the text dirty and returns; the
// work happens on the next draw or the next query. {@link TTF_UpdateText} forces
// it early, for when the cost belongs somewhere other than the frame that
// happened to ask.

import type { SDL_FPoint, SDL_GPUDevice, SDL_GPUTexture, SDL_PropertiesID, SDL_Rect, SDL_Surface } from "../SDL3";
import type { TTF_Direction, TTF_Font, TTF_ImageType } from "./font.ts";

/** An opaque handle to a text engine. Destroyed by the call matching the one that made it. */
export declare class TTF_TextEngine {
    private _opaque: never;
}

/**
 * The private half of a `TTF_Text`.
 *
 * Its layout is public in `SDL_textengine.h`, for engine implementations. These
 * bindings do not implement one, so it stays opaque here.
 */
export declare class TTF_TextData {
    private _opaque: never;
}

/**
 * A laid-out string.
 *
 * `text` is the library's own copy of the UTF-8 string, rewritten whenever the
 * text is edited and freed with the object — read it, do not keep it. Nothing
 * in this struct should be written to; the setters below exist because they
 * also invalidate the layout, which assigning to a field would not.
 */
export interface TTF_Text {
    /** The UTF-8 string this object represents. */
    text: CString | null;
    /** Lines after wrapping. 0 when the string is empty. */
    num_lines: i32;
    /** Application reference count, used when freeing. */
    refcount: i32;
    /** Private. */
    internal: Pointer<TTF_TextData> | null;
}

/** Which way round the GPU engine emits its triangles. */
export enum TTF_GPUTextEngineWinding {
    INVALID = -1,
    CLOCKWISE,
    COUNTER_CLOCKWISE,
}

export declare namespace TTF_GPUTextEngineWinding {
    type Underlying = i32;
}

/**
 * One draw's worth of glyph geometry, and the next link in the chain.
 *
 * The list breaks wherever the atlas texture or the image type changes, so each
 * node is a batch that can be drawn with one binding. `xy` and `uv` are
 * `num_vertices` long, `indices` is `num_indices` long, and all of it belongs to
 * the engine — valid until the text is next updated or destroyed.
 *
 * **Y is up, in both position and texture coordinates**, matching SDL_gpu's own
 * convention rather than the top-left origin the rest of this library uses.
 */
export interface TTF_GPUAtlasDrawSequence {
    /** The atlas holding these glyphs. */
    atlas_texture: Pointer<SDL_GPUTexture> | null;
    /** `num_vertices` positions. */
    xy: Pointer<SDL_FPoint> | null;
    /** `num_vertices` normalised texture coordinates. */
    uv: Pointer<SDL_FPoint> | null;
    num_vertices: i32;
    /** `num_indices` indices into `xy` and `uv`. */
    indices: Pointer<i32> | null;
    num_indices: i32;
    /** What the atlas pixels mean for this batch. */
    image_type: TTF_ImageType;
    /** The next batch. Null on the last one, which is how the walk terminates. */
    next: Pointer<TTF_GPUAtlasDrawSequence> | null;
}

/** Where a substring sits in the text, and what boundaries it touches. */
export enum TTF_SubStringFlags {
    /** The low byte holds a {@link TTF_Direction} — mask it out before comparing the rest. */
    DIRECTION_MASK = 0x000000ff,
    /** Contains the start of the text. */
    TEXT_START = 0x00000100,
    /** Contains the start of line `line_index`. */
    LINE_START = 0x00000200,
    /** Contains the end of line `line_index`. */
    LINE_END = 0x00000400,
    /** Contains the end of the text. */
    TEXT_END = 0x00000800,
}

export declare namespace TTF_SubStringFlags {
    type Underlying = u32;
}

/**
 * A run of glyphs within a text object.
 *
 * A cluster, not a character: one substring can cover several codepoints that
 * shaped into one glyph, or one codepoint that shaped into several. `offset`
 * and `length` are byte positions in the UTF-8 string; `rect` is relative to the
 * text's top left, in pixels.
 */
export interface TTF_SubString {
    flags: TTF_SubStringFlags;
    /** Byte offset from the start of the string. */
    offset: i32;
    /** Byte length from `offset`. */
    length: i32;
    /** Which line this sits on. */
    line_index: i32;
    /** The engine's internal cluster index, for stepping without searching. */
    cluster_index: i32;
    /** The box this occupies, relative to the top left of the text. */
    rect: SDL_Rect;
}

// ---------------------------------------------------------------------------
// The surface engine.
// ---------------------------------------------------------------------------

export declare function TTF_CreateSurfaceTextEngine(): Pointer<TTF_TextEngine> | null;

/**
 * Blit a text object onto a surface at `x`, `y` — top-left origin, Y down.
 *
 * The text must have been created with a surface engine; an engine of the wrong
 * kind is a failure, not a silent no-op.
 */
export declare function TTF_DrawSurfaceText(
    text: Pointer<TTF_Text>,
    x: i32,
    y: i32,
    surface: Pointer<SDL_Surface>,
): boolean;

/** Every text made by this engine has to be destroyed first. */
export declare function TTF_DestroySurfaceTextEngine(engine: Pointer<TTF_TextEngine>): void;

// ---------------------------------------------------------------------------
// The GPU engine.
// ---------------------------------------------------------------------------

export declare function TTF_CreateGPUTextEngine(device: Pointer<SDL_GPUDevice>): Pointer<TTF_TextEngine> | null;

/**
 * The GPU engine with the atlas size chosen rather than defaulted. See
 * `TTF_PROP_GPU_TEXT_ENGINE_*` in `props.ts`.
 */
export declare function TTF_CreateGPUTextEngineWithProperties(
    props: SDL_PropertiesID,
): Pointer<TTF_TextEngine> | null;

/**
 * The geometry for drawing a text object, as a linked list of batches.
 *
 * Null means either an empty string or a failure — `SDL_GetError` separates the
 * two. The arrays are the engine's and live until the text changes, so they are
 * to be uploaded or consumed now, not held.
 *
 * If the glyphs look blocky, the sampler is doing nearest filtering; the atlas
 * wants linear.
 */
export declare function TTF_GetGPUTextDrawData(text: Pointer<TTF_Text>): Pointer<TTF_GPUAtlasDrawSequence> | null;

/**
 * Which winding the emitted triangles use, so it can match the pipeline's
 * cull mode rather than the pipeline having to match it.
 */
export declare function TTF_SetGPUTextEngineWinding(
    engine: Pointer<TTF_TextEngine>,
    winding: TTF_GPUTextEngineWinding,
): void;

export declare function TTF_GetGPUTextEngineWinding(engine: Pointer<TTF_TextEngine>): TTF_GPUTextEngineWinding;

export declare function TTF_DestroyGPUTextEngine(engine: Pointer<TTF_TextEngine>): void;

// ---------------------------------------------------------------------------
// Text objects.
// ---------------------------------------------------------------------------

/**
 * Create a text object. `engine` may be null — see the note at the top of this
 * file. `length` is a byte count, 0 for NUL-terminated.
 */
export declare function TTF_CreateText(
    engine: Pointer<TTF_TextEngine> | null,
    font: Pointer<TTF_Font>,
    text: CString,
    length: usize,
): Pointer<TTF_Text> | null;

export declare function TTF_DestroyText(text: Pointer<TTF_Text>): void;

/** The text's own property group, for hanging application data on it. */
export declare function TTF_GetTextProperties(text: Pointer<TTF_Text>): SDL_PropertiesID;

export declare function TTF_SetTextEngine(text: Pointer<TTF_Text>, engine: Pointer<TTF_TextEngine>): boolean;

export declare function TTF_GetTextEngine(text: Pointer<TTF_Text>): Pointer<TTF_TextEngine> | null;

/**
 * Change the font.
 *
 * While a text has a font, changes to that font regenerate the text
 * automatically. Setting it to null cuts that link: the text keeps rendering as
 * it is and stops tracking the font.
 */
export declare function TTF_SetTextFont(text: Pointer<TTF_Text>, font: Pointer<TTF_Font> | null): boolean;

export declare function TTF_GetTextFont(text: Pointer<TTF_Text>): Pointer<TTF_Font> | null;

/** Per-text override of the font's direction. */
export declare function TTF_SetTextDirection(text: Pointer<TTF_Text>, direction: TTF_Direction): boolean;

/** Falls back to the font's direction when the text has none of its own. */
export declare function TTF_GetTextDirection(text: Pointer<TTF_Text>): TTF_Direction;

/** Per-text override of the font's script. False without HarfBuzz. */
export declare function TTF_SetTextScript(text: Pointer<TTF_Text>, script: u32): boolean;

/** Falls back to the font's script, then to 0. */
export declare function TTF_GetTextScript(text: Pointer<TTF_Text>): u32;

// ---------------------------------------------------------------------------
// Colour. Kept on the text rather than passed at draw time, so recolouring
// costs nothing — the glyphs are already in the atlas.
// ---------------------------------------------------------------------------

/** White until set. */
export declare function TTF_SetTextColor(text: Pointer<TTF_Text>, r: u8, g: u8, b: u8, a: u8): boolean;

/** The same colour in floats, which is how the text stores it either way. */
export declare function TTF_SetTextColorFloat(text: Pointer<TTF_Text>, r: f32, g: f32, b: f32, a: f32): boolean;

export declare function TTF_GetTextColor(
    text: Pointer<TTF_Text>,
    r: Pointer<u8> | null,
    g: Pointer<u8> | null,
    b: Pointer<u8> | null,
    a: Pointer<u8> | null,
): boolean;

export declare function TTF_GetTextColorFloat(
    text: Pointer<TTF_Text>,
    r: Pointer<f32> | null,
    g: Pointer<f32> | null,
    b: Pointer<f32> | null,
    a: Pointer<f32> | null,
): boolean;

// ---------------------------------------------------------------------------
// Position and wrapping.
// ---------------------------------------------------------------------------

/**
 * The offset of the text's top left corner, in pixels.
 *
 * Not the same as the `x`, `y` handed to `TTF_DrawSurfaceText` — this is the
 * text's own place within a layout, which is how several text objects share one
 * wrapping column.
 */
export declare function TTF_SetTextPosition(text: Pointer<TTF_Text>, x: i32, y: i32): boolean;

export declare function TTF_GetTextPosition(
    text: Pointer<TTF_Text>,
    x: Pointer<i32> | null,
    y: Pointer<i32> | null,
): boolean;

/** `wrap_width` of 0 wraps on newlines only. */
export declare function TTF_SetTextWrapWidth(text: Pointer<TTF_Text>, wrap_width: i32): boolean;

export declare function TTF_GetTextWrapWidth(text: Pointer<TTF_Text>, wrap_width: Pointer<i32> | null): boolean;

/**
 * Whether the space a line wraps at still takes up room.
 *
 * False by default, and false is what looks right centred or right-aligned.
 * True is what an editor wants, so that a cursor can sit on that space.
 */
export declare function TTF_SetTextWrapWhitespaceVisible(text: Pointer<TTF_Text>, visible: boolean): boolean;

export declare function TTF_TextWrapWhitespaceVisible(text: Pointer<TTF_Text>): boolean;

// ---------------------------------------------------------------------------
// Editing.
//
// `offset` is in bytes, and a negative one counts back from the end. **None of
// these validate UTF-8** — splitting a multi-byte sequence produces a string
// that shapes into replacement characters rather than an error, so offsets want
// to come from a `TTF_SubString` or from `TTF_MeasureString`.
// ---------------------------------------------------------------------------

/** Replace the whole string. `string` may be null, which empties it. */
export declare function TTF_SetTextString(
    text: Pointer<TTF_Text>,
    string: CString | null,
    length: usize,
): boolean;

export declare function TTF_InsertTextString(
    text: Pointer<TTF_Text>,
    offset: i32,
    string: CString,
    length: usize,
): boolean;

export declare function TTF_AppendTextString(text: Pointer<TTF_Text>, string: CString, length: usize): boolean;

/** `length` of -1 deletes the rest of the string. */
export declare function TTF_DeleteTextString(text: Pointer<TTF_Text>, offset: i32, length: i32): boolean;

// ---------------------------------------------------------------------------
// Measurement and layout.
// ---------------------------------------------------------------------------

/** The laid-out size in pixels. Changes with the font, its size and its style. */
export declare function TTF_GetTextSize(
    text: Pointer<TTF_Text>,
    w: Pointer<i32> | null,
    h: Pointer<i32> | null,
): boolean;

/** Force the pending layout now rather than at the next draw. */
export declare function TTF_UpdateText(text: Pointer<TTF_Text>): boolean;

// ---------------------------------------------------------------------------
// Substrings — hit testing, caret placement and selection highlighting.
//
// The out-of-range answers are deliberate rather than errors: an offset before
// the string gives a zero-length substring at the start with `TEXT_START` set,
// and one past the end gives its mirror image at the end. That is what makes a
// caret walk terminate without a special case.
// ---------------------------------------------------------------------------

/** The cluster containing a byte offset. */
export declare function TTF_GetTextSubString(
    text: Pointer<TTF_Text>,
    offset: i32,
    substring: Pointer<TTF_SubString>,
): boolean;

/** The whole of line `line`, zero-based, in `[0, text.num_lines)`. */
export declare function TTF_GetTextSubStringForLine(
    text: Pointer<TTF_Text>,
    line: i32,
    substring: Pointer<TTF_SubString>,
): boolean;

/**
 * Every cluster overlapping a byte range. `length` of -1 runs to the end.
 *
 * The result is a NULL-terminated array of pointers in **one allocation**:
 * release it with a single `SDL_free`, and do not free the entries.
 */
export declare function TTF_GetTextSubStringsForRange(
    text: Pointer<TTF_Text>,
    offset: i32,
    length: i32,
    count: Pointer<i32> | null,
): Pointer<Pointer<TTF_SubString>> | null;

/**
 * The cluster nearest a point, relative to the text's top left.
 *
 * The point may be outside the text entirely — this is the call behind clicking
 * to place a caret, and a click below the last line should land at its end.
 */
export declare function TTF_GetTextSubStringForPoint(
    text: Pointer<TTF_Text>,
    x: i32,
    y: i32,
    substring: Pointer<TTF_SubString>,
): boolean;

export declare function TTF_GetPreviousTextSubString(
    text: Pointer<TTF_Text>,
    substring: Pointer<TTF_SubString>,
    previous: Pointer<TTF_SubString>,
): boolean;

export declare function TTF_GetNextTextSubString(
    text: Pointer<TTF_Text>,
    substring: Pointer<TTF_SubString>,
    next: Pointer<TTF_SubString>,
): boolean;
