// One-shot rendering: a string in, an `SDL_Surface` out.
//
// Every surface here is the caller's, released with `SDL_DestroySurface`, and
// every call re-shapes and re-rasterises from scratch. For text that changes
// each frame, `TTF_Text` in `text.ts` exists precisely so this does not have to
// happen sixty times a second.
//
// **Four qualities, and the difference is what comes out, not just how good it
// looks:**
//
//   * **Solid** — 8-bit palettised, two entries: index 0 is the colour key and
//     index 1 is `fg`. Aliased edges, no partial coverage, and the cheapest
//     thing here. Fine for a pixel-art UI, harsh for anything else.
//   * **Shaded** — 8-bit palettised, a ramp from `bg` to `fg`. Antialiased, but
//     against *that* background: the surface is opaque and a rectangle of `bg`
//     comes with it, so this only works where the real background is `bg`.
//   * **Blended** — 32-bit ARGB with coverage in the alpha. Antialiased and
//     composites over anything. The slowest, and the one to reach for.
//   * **LCD** — 32-bit ARGB with per-subpixel coverage, tuned for the RGB stripe
//     of an LCD. Sharper than Blended on the display it was rendered for and
//     visibly fringed anywhere else — rotated, scaled, or on a different panel
//     layout — so it is only safe for text drawn 1:1 into the final image.
//
// **`length` is a byte count and 0 means NUL-terminated**, as everywhere else in
// this library. `wrapLength` / `wrap_width` of 0 wraps on newlines only; the
// un-wrapped variants do not even do that, and render a newline as a single
// long line.
//
// `SDL_Color` is passed **by value**, four bytes in a register. That is unusual
// in these bindings — see the note in `SDL3/guid.ts` — and it is what the
// library's ABI actually is, not a convenience.

import type { SDL_Color, SDL_Surface } from "../SDL3";
import type { TTF_Font } from "./font.ts";

// ---------------------------------------------------------------------------
// Solid.
// ---------------------------------------------------------------------------

export declare function TTF_RenderText_Solid(
    font: Pointer<TTF_Font>,
    text: CString,
    length: usize,
    fg: SDL_Color,
): Pointer<SDL_Surface> | null;

export declare function TTF_RenderText_Solid_Wrapped(
    font: Pointer<TTF_Font>,
    text: CString,
    length: usize,
    fg: SDL_Color,
    wrapLength: i32,
): Pointer<SDL_Surface> | null;

/** No padding or centring horizontally; vertically the glyph sits on its baseline. */
export declare function TTF_RenderGlyph_Solid(
    font: Pointer<TTF_Font>,
    ch: u32,
    fg: SDL_Color,
): Pointer<SDL_Surface> | null;

// ---------------------------------------------------------------------------
// Shaded. The `bg` rectangle is part of the surface — see the note above.
// ---------------------------------------------------------------------------

export declare function TTF_RenderText_Shaded(
    font: Pointer<TTF_Font>,
    text: CString,
    length: usize,
    fg: SDL_Color,
    bg: SDL_Color,
): Pointer<SDL_Surface> | null;

export declare function TTF_RenderText_Shaded_Wrapped(
    font: Pointer<TTF_Font>,
    text: CString,
    length: usize,
    fg: SDL_Color,
    bg: SDL_Color,
    wrap_width: i32,
): Pointer<SDL_Surface> | null;

export declare function TTF_RenderGlyph_Shaded(
    font: Pointer<TTF_Font>,
    ch: u32,
    fg: SDL_Color,
    bg: SDL_Color,
): Pointer<SDL_Surface> | null;

// ---------------------------------------------------------------------------
// Blended. Also the only quality SDF rendering reaches — `TTF_SetFontSDF` puts
// its distances in the alpha channel these produce.
// ---------------------------------------------------------------------------

export declare function TTF_RenderText_Blended(
    font: Pointer<TTF_Font>,
    text: CString,
    length: usize,
    fg: SDL_Color,
): Pointer<SDL_Surface> | null;

export declare function TTF_RenderText_Blended_Wrapped(
    font: Pointer<TTF_Font>,
    text: CString,
    length: usize,
    fg: SDL_Color,
    wrap_width: i32,
): Pointer<SDL_Surface> | null;

export declare function TTF_RenderGlyph_Blended(
    font: Pointer<TTF_Font>,
    ch: u32,
    fg: SDL_Color,
): Pointer<SDL_Surface> | null;

// ---------------------------------------------------------------------------
// LCD. Takes a `bg` because subpixel coverage cannot be expressed as an alpha
// value — the result is already composited against that colour.
// ---------------------------------------------------------------------------

export declare function TTF_RenderText_LCD(
    font: Pointer<TTF_Font>,
    text: CString,
    length: usize,
    fg: SDL_Color,
    bg: SDL_Color,
): Pointer<SDL_Surface> | null;

export declare function TTF_RenderText_LCD_Wrapped(
    font: Pointer<TTF_Font>,
    text: CString,
    length: usize,
    fg: SDL_Color,
    bg: SDL_Color,
    wrap_width: i32,
): Pointer<SDL_Surface> | null;

export declare function TTF_RenderGlyph_LCD(
    font: Pointer<TTF_Font>,
    ch: u32,
    fg: SDL_Color,
    bg: SDL_Color,
): Pointer<SDL_Surface> | null;
