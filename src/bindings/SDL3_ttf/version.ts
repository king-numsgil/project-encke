// Translated from SDL_ttf.h — SDL3_ttf 3.2.2.
//
// SDL_ttf is a wrapper around FreeType, optionally with HarfBuzz behind it for
// shaping. Everything here turns a font and a string into pixels; layout beyond
// word wrapping, and anything resembling rich text, is the caller's problem.
//
// **This library must be initialised.** `TTF_Init` in `init.ts` comes before
// every other call — unlike SDL3_image, which has no init at all. Forgetting it
// is not a crash, it is `TTF_OpenFont` returning null with a plausible-looking
// error message.
//
// **There are three ways to get text on screen, and they are not
// interchangeable:**
//
//   * **`TTF_Render*` in `render.ts`** — a string in, an `SDL_Surface` out.
//     One shaping pass and one rasterisation per call, so this is for text that
//     changes rarely: a title, a label baked once into a texture.
//   * **`TTF_Text` with a text engine, in `text.ts`** — the string is kept, and
//     editing it re-lays out only what moved. This is what a text box wants.
//   * **The GPU text engine, also in `text.ts`** — a `TTF_Text` whose glyphs
//     live in an `SDL_GPUTexture` atlas, handed back as vertex and index arrays
//     by `TTF_GetGPUTextDrawData`. This is the one this project draws with: the
//     atlas is a texture like any other and the geometry goes through a normal
//     pipeline.
//
// **The SDL_Renderer text engine is deliberately absent.**
// `TTF_CreateRendererTextEngine`, `TTF_CreateRendererTextEngineWithProperties`,
// `TTF_DrawRendererText` and `TTF_DestroyRendererTextEngine` all belong to SDL's
// 2D renderer, which is a separate and incompatible API from SDL_gpu — the same
// reason `IMG_LoadTexture` and friends are missing from the SDL3_image
// bindings. Their `TTF_PROP_RENDERER_TEXT_ENGINE_*` keys are absent from
// `props.ts` for the same reason.
//
// **`SDL_textengine.h` is not bound either**, and that one is not about the
// renderer. It declares no functions — only the vtable, the draw-operation
// union and the private `TTF_TextData` layout needed to *implement* a text
// engine of your own. The three engines the library ships with cover what this
// project needs, and a tagged union is not a shape these bindings can express
// faithfully.

/**
 * The version of the SDL3_ttf library linked into this program.
 *
 * Encoded the way `SDL_VERSIONNUM` encodes it: `major * 1000000 + minor * 1000
 * + micro`, so 3.2.2 reads as 3002002. The header this was translated from is
 * 3.2.2; a mismatch at runtime is a mismatched DLL.
 */
export declare function TTF_Version(): i32;

/**
 * The version of FreeType underneath.
 *
 * Every parameter may be null. `TTF_Init` must have run first — before that the
 * library has not loaded FreeType and there is no version to report.
 */
export declare function TTF_GetFreeTypeVersion(
    major: Pointer<i32> | null,
    minor: Pointer<i32> | null,
    patch: Pointer<i32> | null,
): void;

/**
 * The version of HarfBuzz underneath, or 0.0.0 when the build has none.
 *
 * Worth checking rather than assuming: without HarfBuzz there is no complex
 * shaping, so `TTF_SetFontScript` and `TTF_SetFontLanguage` fail and
 * `TTF_SetFontDirection` accepts only left-to-right.
 */
export declare function TTF_GetHarfBuzzVersion(
    major: Pointer<i32> | null,
    minor: Pointer<i32> | null,
    patch: Pointer<i32> | null,
): void;
