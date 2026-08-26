// Translated from SDL_image.h — SDL3_image 3.4.4.
//
// SDL3_image is a decoder library and nothing more: everything here hands back
// an `SDL_Surface`, an `SDL_GPUTexture`, or an `IMG_Animation`, and the rest of
// what an image might need — uploading, mipmapping, format conversion — stays
// SDL3's job.
//
// **There is no initialisation call.** SDL2_image had `IMG_Init`/`IMG_Quit` and
// a flags enum saying which decoders to bring up; SDL3_image dropped both. The
// decoders initialise themselves on first use, so a program links this and
// starts loading.
//
// **The SDL_Renderer entry points are deliberately absent.** `IMG_LoadTexture`,
// `IMG_LoadTexture_IO` and `IMG_LoadTextureTyped_IO` all take an `SDL_Renderer`
// and produce an `SDL_Texture`, which belong to SDL's 2D renderer — a different
// and incompatible API from SDL_gpu, which is what this project draws with.
// Binding them would mean binding `SDL_render.h` for types nothing here can
// use. `IMG_LoadGPUTexture` and friends in `load.ts` are the SDL_gpu
// equivalents and are what this project actually wants.
//
// Which formats actually decode depends on which codec DLLs are beside the
// binary. `build.ts` copies the whole `optional/` folder from the devel package
// — PNG, TIFF, WebP and AVIF — alongside `SDL3_image.dll`. Formats with no
// codec present fail at load time with an `SDL_GetError` message rather than at
// link time.

/**
 * The version of the SDL3_image library linked into this program.
 *
 * Encoded the way `SDL_VERSIONNUM` encodes it: `major * 1000000 + minor * 1000
 * + micro`, so 3.4.4 reads as 3004004. The header this was translated from is
 * 3.4.4; a mismatch at runtime is a mismatched DLL.
 */
export declare function IMG_Version(): i32;
