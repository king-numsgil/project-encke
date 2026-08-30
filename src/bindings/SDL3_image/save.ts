// Writing a surface out.
//
// Fewer formats encode than decode, which is the usual shape for an image
// library: AVIF, BMP, CUR, GIF, ICO, JPG, PNG, TGA and WebP, against the twenty
// or so `load.ts` reads.
//
// **Quality is not one scale.** JPEG and AVIF take an `i32` from 0 to 100. WebP
// takes an `f32`, and its range is not the same idea: 0 to 100 selects lossy
// quality, while any value below 0 asks for *lossless*. Passing `85` to the
// WebP encoder because it worked for JPEG produces a lossy file; passing `-1`
// is how you get the lossless one.
//
// Every `_IO` form takes `closeio`, with the same meaning as in `load.ts`: true
// hands the stream over to be closed whether the write succeeded or not.
//
// All of these return `false` on failure with the reason in `SDL_GetError`.

import type { SDL_IOStream, SDL_Surface } from "../SDL3";

/**
 * Save by path, choosing the encoder from the file extension.
 *
 * An unrecognised or absent extension is a failure rather than a default —
 * there is no sensible format to guess.
 */
export declare function IMG_Save(surface: Pointer<SDL_Surface>, file: CString): boolean;

/**
 * Save to a stream, naming the format.
 *
 * `type` is a format name such as `"PNG"`, case-insensitive. Unlike the load
 * side's hint this one is not advisory: a stream has no name to infer from, so
 * this is the only thing selecting the encoder.
 */
export declare function IMG_SaveTyped_IO(
    surface: Pointer<SDL_Surface>,
    dst: Pointer<SDL_IOStream>,
    closeio: boolean,
    type: CString,
): boolean;

// -- lossless, no parameters ------------------------------------------------

export declare function IMG_SaveBMP(surface: Pointer<SDL_Surface>, file: CString): boolean;

export declare function IMG_SaveBMP_IO(
    surface: Pointer<SDL_Surface>,
    dst: Pointer<SDL_IOStream>,
    closeio: boolean,
): boolean;

export declare function IMG_SaveCUR(surface: Pointer<SDL_Surface>, file: CString): boolean;

export declare function IMG_SaveCUR_IO(
    surface: Pointer<SDL_Surface>,
    dst: Pointer<SDL_IOStream>,
    closeio: boolean,
): boolean;

export declare function IMG_SaveGIF(surface: Pointer<SDL_Surface>, file: CString): boolean;

export declare function IMG_SaveGIF_IO(
    surface: Pointer<SDL_Surface>,
    dst: Pointer<SDL_IOStream>,
    closeio: boolean,
): boolean;

export declare function IMG_SaveICO(surface: Pointer<SDL_Surface>, file: CString): boolean;

export declare function IMG_SaveICO_IO(
    surface: Pointer<SDL_Surface>,
    dst: Pointer<SDL_IOStream>,
    closeio: boolean,
): boolean;

export declare function IMG_SavePNG(surface: Pointer<SDL_Surface>, file: CString): boolean;

export declare function IMG_SavePNG_IO(
    surface: Pointer<SDL_Surface>,
    dst: Pointer<SDL_IOStream>,
    closeio: boolean,
): boolean;

export declare function IMG_SaveTGA(surface: Pointer<SDL_Surface>, file: CString): boolean;

export declare function IMG_SaveTGA_IO(
    surface: Pointer<SDL_Surface>,
    dst: Pointer<SDL_IOStream>,
    closeio: boolean,
): boolean;

// -- lossy, with a quality knob ---------------------------------------------

/** `quality` runs 0 to 100. */
export declare function IMG_SaveAVIF(surface: Pointer<SDL_Surface>, file: CString, quality: i32): boolean;

export declare function IMG_SaveAVIF_IO(
    surface: Pointer<SDL_Surface>,
    dst: Pointer<SDL_IOStream>,
    closeio: boolean,
    quality: i32,
): boolean;

/** `quality` runs 0 to 100. */
export declare function IMG_SaveJPG(surface: Pointer<SDL_Surface>, file: CString, quality: i32): boolean;

export declare function IMG_SaveJPG_IO(
    surface: Pointer<SDL_Surface>,
    dst: Pointer<SDL_IOStream>,
    closeio: boolean,
    quality: i32,
): boolean;

/**
 * `quality` runs 0 to 100 for lossy, and **below 0 asks for lossless** — see the
 * note at the top of this file. An `f32`, unlike the two above.
 */
export declare function IMG_SaveWEBP(surface: Pointer<SDL_Surface>, file: CString, quality: f32): boolean;

export declare function IMG_SaveWEBP_IO(
    surface: Pointer<SDL_Surface>,
    dst: Pointer<SDL_IOStream>,
    closeio: boolean,
    quality: f32,
): boolean;
