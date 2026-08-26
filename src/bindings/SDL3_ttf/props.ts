// The property-group keys SDL_ttf reads and writes.
//
// Functions rather than constants, because Goblin has no top-level `const` —
// the same reason `SDL3_image/props.ts` is shaped this way. Each returns the
// exact string the library compares against, so a typo is a property silently
// ignored rather than a compile error; that is what these exist to prevent.
//
// Three groups:
//
//   * `TTF_PROP_FONT_CREATE_*` — passed to `TTF_OpenFontWithProperties`, and the
//     only way to reach a face index, a non-default DPI, or a font that starts
//     partway into a stream.
//   * `TTF_PROP_FONT_OUTLINE_*` — read from `TTF_GetFontProperties` and set on
//     it. `TTF_SetFontOutline` reads them **when it is called**, so they have to
//     be set first.
//   * `TTF_PROP_GPU_TEXT_ENGINE_*` — passed to
//     `TTF_CreateGPUTextEngineWithProperties`.
//
// The renderer text engine's keys are absent along with its functions — see the
// note at the top of `version.ts`.

// ---------------------------------------------------------------------------
// Opening a font.
// ---------------------------------------------------------------------------

/** Required unless the iostream or existing-font key is set. */
export function TTF_PROP_FONT_CREATE_FILENAME_STRING(): string {
    return "SDL_ttf.font.create.filename";
}

/** The stream stays open for the font's lifetime; see `TTF_OpenFontIO`. */
export function TTF_PROP_FONT_CREATE_IOSTREAM_POINTER(): string {
    return "SDL_ttf.font.create.iostream";
}

/** Where the font starts within the stream. 0 by default — for a font packed into a larger file. */
export function TTF_PROP_FONT_CREATE_IOSTREAM_OFFSET_NUMBER(): string {
    return "SDL_ttf.font.create.iostream.offset";
}

export function TTF_PROP_FONT_CREATE_IOSTREAM_AUTOCLOSE_BOOLEAN(): string {
    return "SDL_ttf.font.create.iostream.autoclose";
}

/** Point size for a scalable font, size index for a bitmap one. */
export function TTF_PROP_FONT_CREATE_SIZE_FLOAT(): string {
    return "SDL_ttf.font.create.size";
}

/** Which face, in a collection that holds more than one. `TTF_GetNumFontFaces` says how many. */
export function TTF_PROP_FONT_CREATE_FACE_NUMBER(): string {
    return "SDL_ttf.font.create.face";
}

/** Defaults to the vertical DPI if that is set, otherwise 72. */
export function TTF_PROP_FONT_CREATE_HORIZONTAL_DPI_NUMBER(): string {
    return "SDL_ttf.font.create.hdpi";
}

/** Defaults to the horizontal DPI if that is set, otherwise 72. */
export function TTF_PROP_FONT_CREATE_VERTICAL_DPI_NUMBER(): string {
    return "SDL_ttf.font.create.vdpi";
}

/**
 * An existing `TTF_Font` to share data with — `TTF_CopyFont` with the size and
 * style overridable in the same call.
 *
 * Spelled without a `_POINTER` suffix in 3.2.2, which is the name this returns.
 * Upstream has since renamed the macro to `TTF_PROP_FONT_CREATE_EXISTING_FONT_POINTER`;
 * the string it expands to is unchanged, so nothing breaks either way.
 */
export function TTF_PROP_FONT_CREATE_EXISTING_FONT(): string {
    return "SDL_ttf.font.create.existing_font";
}

// ---------------------------------------------------------------------------
// Outline stroking. The values are FreeType's own enums, which SDL_ttf passes
// through to `FT_Stroker_Set` without interpreting them.
// ---------------------------------------------------------------------------

/** `FT_Stroker_LineCap`. Round by default. */
export function TTF_PROP_FONT_OUTLINE_LINE_CAP_NUMBER(): string {
    return "SDL_ttf.font.outline.line_cap";
}

/** `FT_Stroker_LineJoin`. Round by default. */
export function TTF_PROP_FONT_OUTLINE_LINE_JOIN_NUMBER(): string {
    return "SDL_ttf.font.outline.line_join";
}

/** `FT_Fixed` — 16.16 fixed point, not pixels. 0 by default. */
export function TTF_PROP_FONT_OUTLINE_MITER_LIMIT_NUMBER(): string {
    return "SDL_ttf.font.outline.miter_limit";
}

// ---------------------------------------------------------------------------
// The GPU text engine.
// ---------------------------------------------------------------------------

export function TTF_PROP_GPU_TEXT_ENGINE_DEVICE(): string {
    return "SDL_ttf.gpu_text_engine.create.device";
}

/**
 * The atlas texture's edge length in pixels.
 *
 * Too small and the engine spills into a second atlas, which is a second draw
 * call per text that crosses the boundary; too large and it is a texture
 * allocation that never fills.
 */
export function TTF_PROP_GPU_TEXT_ENGINE_ATLAS_TEXTURE_SIZE(): string {
    return "SDL_ttf.gpu_text_engine.create.atlas_texture_size";
}
