// Loading a still image, and asking what one is.
//
// Three layers, and it is worth knowing which to reach for:
//
//   * **`IMG_Load`** — a path. The format is detected from the file's contents,
//     falling back to the extension. This is the one to use.
//   * **`IMG_Load_IO` / `IMG_LoadTyped_IO`** — an already-open stream, for data
//     that is not a file on disk. `IMG_LoadTyped_IO` takes a type hint like
//     `"PNG"` for a stream whose contents cannot be sniffed.
//   * **`IMG_LoadPNG_IO` and the rest** — one decoder, named. These skip
//     detection, and they are also the only way to be *certain* a hostile file
//     is decoded as the format you expected.
//
// Every `_IO` entry point takes `closeio`. Passing `true` hands the stream to
// SDL3_image, which closes it whether the load succeeded or not — convenient
// for a stream created solely to be decoded, and a double close if the caller
// also closes it.
//
// The `IMG_isXXX` predicates all **rewind the stream to where they found it**,
// so a caller can try several in sequence without seeking between them.

import type { SDL_GPUCopyPass, SDL_GPUDevice, SDL_GPUTexture, SDL_IOStream, SDL_Surface } from "../SDL3";

// ---------------------------------------------------------------------------
// Detection and generic loading.
// ---------------------------------------------------------------------------

/**
 * Load an image by path.
 *
 * The format comes from the file's contents where they identify it and from the
 * extension where they do not, so an extensionless file still loads and a `.png`
 * that is really a JPEG loads as a JPEG.
 */
export declare function IMG_Load(file: CString): Pointer<SDL_Surface> | null;

/** Load from a stream, detecting the format. `closeio` closes `src` either way. */
export declare function IMG_Load_IO(src: Pointer<SDL_IOStream>, closeio: boolean): Pointer<SDL_Surface> | null;

/**
 * Load from a stream, with a type hint.
 *
 * `type` is a format name such as `"PNG"`, `"JPG"` or `"BMP"`, case-insensitive.
 * It is a *hint*: detection still runs first, and the hint is what decides when
 * detection cannot. `null` makes this identical to {@link IMG_Load_IO}.
 */
export declare function IMG_LoadTyped_IO(
    src: Pointer<SDL_IOStream>,
    closeio: boolean,
    type: CString | null,
): Pointer<SDL_Surface> | null;

/** The clipboard's image, if it holds one. Null when it does not. */
export declare function IMG_GetClipboardImage(): Pointer<SDL_Surface> | null;

// ---------------------------------------------------------------------------
// Straight to the GPU.
//
// These decode and upload in one call, recording the upload onto a copy pass the
// caller already opened — so a batch of textures costs one copy pass rather than
// one per image, and none of them stall.
//
// `width` and `height` are out-parameters and may be null. They are the only way
// to learn the texture's size: the returned handle is opaque and SDL_gpu has no
// call that asks a texture how big it is.
// ---------------------------------------------------------------------------

/**
 * Decode a file and upload it as a GPU texture.
 *
 * The upload is recorded on `copy_pass`, so it has not happened when this
 * returns — the texture is not readable until the command buffer holding that
 * pass has been submitted and completed.
 */
export declare function IMG_LoadGPUTexture(
    device: Pointer<SDL_GPUDevice>,
    copy_pass: Pointer<SDL_GPUCopyPass>,
    file: CString,
    width: Pointer<i32> | null,
    height: Pointer<i32> | null,
): Pointer<SDL_GPUTexture> | null;

/** {@link IMG_LoadGPUTexture} from a stream. */
export declare function IMG_LoadGPUTexture_IO(
    device: Pointer<SDL_GPUDevice>,
    copy_pass: Pointer<SDL_GPUCopyPass>,
    src: Pointer<SDL_IOStream>,
    closeio: boolean,
    width: Pointer<i32> | null,
    height: Pointer<i32> | null,
): Pointer<SDL_GPUTexture> | null;

/** {@link IMG_LoadGPUTexture_IO} with a format hint, as {@link IMG_LoadTyped_IO} takes one. */
export declare function IMG_LoadGPUTextureTyped_IO(
    device: Pointer<SDL_GPUDevice>,
    copy_pass: Pointer<SDL_GPUCopyPass>,
    src: Pointer<SDL_IOStream>,
    closeio: boolean,
    type: CString | null,
    width: Pointer<i32> | null,
    height: Pointer<i32> | null,
): Pointer<SDL_GPUTexture> | null;

// ---------------------------------------------------------------------------
// Format detection.
//
// Each reads a few bytes and seeks back, so the stream is left exactly as it was
// found and these compose in sequence. A `true` answer means the header matched,
// not that the file will decode — a truncated PNG still passes `IMG_isPNG`.
// ---------------------------------------------------------------------------

export declare function IMG_isANI(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isAVIF(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isBMP(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isCUR(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isGIF(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isICO(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isJPG(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isJXL(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isLBM(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isPCX(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isPNG(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isPNM(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isQOI(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isSVG(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isTIF(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isWEBP(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isXCF(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isXPM(src: Pointer<SDL_IOStream>): boolean;

export declare function IMG_isXV(src: Pointer<SDL_IOStream>): boolean;

// ---------------------------------------------------------------------------
// One decoder, named.
//
// There is no `IMG_isTGA`: Targa has no magic number at the start of the file,
// so it cannot be sniffed, which is why `IMG_LoadTGA_IO` exists without a
// matching predicate. It is also why a `.tga` needs either its extension or an
// explicit type hint.
// ---------------------------------------------------------------------------

export declare function IMG_LoadAVIF_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

export declare function IMG_LoadBMP_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

export declare function IMG_LoadCUR_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

export declare function IMG_LoadGIF_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

export declare function IMG_LoadICO_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

export declare function IMG_LoadJPG_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

export declare function IMG_LoadJXL_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

export declare function IMG_LoadLBM_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

export declare function IMG_LoadPCX_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

export declare function IMG_LoadPNG_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

export declare function IMG_LoadPNM_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

export declare function IMG_LoadQOI_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

export declare function IMG_LoadTGA_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

export declare function IMG_LoadTIF_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

export declare function IMG_LoadWEBP_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

export declare function IMG_LoadXCF_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

export declare function IMG_LoadXPM_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

export declare function IMG_LoadXV_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

/**
 * SVG at its own natural size.
 *
 * Vector art has no pixel size of its own, so this rasterises at whatever the
 * document declares. {@link IMG_LoadSizedSVG_IO} is the one to use when the
 * result has to fit something.
 */
export declare function IMG_LoadSVG_IO(src: Pointer<SDL_IOStream>): Pointer<SDL_Surface> | null;

/**
 * SVG rasterised to a size.
 *
 * Passing zero for one dimension scales it from the other, preserving aspect
 * ratio. Zero for both is {@link IMG_LoadSVG_IO}.
 */
export declare function IMG_LoadSizedSVG_IO(
    src: Pointer<SDL_IOStream>,
    width: i32,
    height: i32,
): Pointer<SDL_Surface> | null;

/**
 * An XPM image from an array of strings, the form XPM files take when a C
 * compiler has already read them.
 *
 * `Pointer<CString>` is C's `char **`: an array of NUL-terminated lines,
 * terminated by nothing — the XPM header line says how many follow.
 */
export declare function IMG_ReadXPMFromArray(xpm: Pointer<CString>): Pointer<SDL_Surface> | null;

/** {@link IMG_ReadXPMFromArray}, forced to 32-bit RGB rather than a palette. */
export declare function IMG_ReadXPMFromArrayToRGB888(xpm: Pointer<CString>): Pointer<SDL_Surface> | null;
