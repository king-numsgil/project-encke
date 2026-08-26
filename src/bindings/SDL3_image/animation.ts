// Animated images: GIF, APNG, WebP, AVIF and ANI.
//
// Two ways in, and they suit different jobs:
//
//   * **`IMG_Animation`** — the whole thing decoded at once, every frame in
//     memory. Simple, and the right shape for a short UI animation or a sprite
//     strip. A long clip at any size is a great deal of memory.
//   * **`IMG_AnimationDecoder`** — one frame at a time, pulled. Bounded memory
//     regardless of length, and the only option for anything long.
//
// `IMG_AnimationEncoder` is the writing counterpart of the decoder, and there is
// no whole-animation equivalent for writing beyond `IMG_SaveAnimation`.
//
// **Frame timing is not one unit.** `IMG_Animation.delays` is milliseconds,
// while the encoder and decoder work in a *timebase* the caller sets through
// properties — `IMG_AddAnimationEncoderFrame` takes a duration in those units,
// not in milliseconds. Defaulting the timebase gives milliseconds, which is why
// the two so often agree and why they will stop agreeing the moment somebody
// sets one.

import type { SDL_Cursor, SDL_IOStream, SDL_PropertiesID, SDL_Surface } from "../SDL3";

/**
 * A fully decoded animation.
 *
 * `frames` and `delays` are C arrays of `count` entries — `SDL_Surface *` and
 * `int` respectively. Released with {@link IMG_FreeAnimation} and by nothing
 * else; the surfaces belong to the animation, so freeing one individually is a
 * double free waiting for the animation to be freed too.
 */
export interface IMG_Animation {
    /** Width of every frame. */
    w: i32;
    /** Height of every frame. */
    h: i32;
    /** How many entries `frames` and `delays` hold. */
    count: i32;
    /** `count` surfaces. */
    frames: Pointer<Pointer<SDL_Surface>> | null;
    /** `count` delays, in **milliseconds**. */
    delays: Pointer<i32> | null;
}

/** An opaque handle representing an animation encoder. Closed with `IMG_CloseAnimationEncoder`. */
export declare class IMG_AnimationEncoder {
    private _opaque: never;
}

/** An opaque handle representing an animation decoder. Closed with `IMG_CloseAnimationDecoder`. */
export declare class IMG_AnimationDecoder {
    private _opaque: never;
}

/** Where a decoder has got to. */
export enum IMG_AnimationDecoderStatus {
    /** The decoder is not usable. */
    INVALID = -1,
    /** Ready to decode the next frame. */
    OK = 0,
    /** A frame failed to decode; `SDL_GetError` says why. */
    FAILED = 1,
    /** No frames remain. */
    COMPLETE = 2,
}

export declare namespace IMG_AnimationDecoderStatus {
    type Underlying = i32;
}

// ---------------------------------------------------------------------------
// Whole-animation loading.
// ---------------------------------------------------------------------------

export declare function IMG_LoadAnimation(file: CString): Pointer<IMG_Animation> | null;

export declare function IMG_LoadAnimation_IO(
    src: Pointer<SDL_IOStream>,
    closeio: boolean,
): Pointer<IMG_Animation> | null;

/** `type` is a format name such as `"GIF"`, as in `IMG_LoadTyped_IO`. */
export declare function IMG_LoadAnimationTyped_IO(
    src: Pointer<SDL_IOStream>,
    closeio: boolean,
    type: CString | null,
): Pointer<IMG_Animation> | null;

export declare function IMG_LoadANIAnimation_IO(src: Pointer<SDL_IOStream>): Pointer<IMG_Animation> | null;
export declare function IMG_LoadAPNGAnimation_IO(src: Pointer<SDL_IOStream>): Pointer<IMG_Animation> | null;
export declare function IMG_LoadAVIFAnimation_IO(src: Pointer<SDL_IOStream>): Pointer<IMG_Animation> | null;
export declare function IMG_LoadGIFAnimation_IO(src: Pointer<SDL_IOStream>): Pointer<IMG_Animation> | null;
export declare function IMG_LoadWEBPAnimation_IO(src: Pointer<SDL_IOStream>): Pointer<IMG_Animation> | null;

/**
 * An animated cursor from an animation, with the hotspot in frame pixels.
 *
 * The cursor takes its own copy, so the animation may be freed afterwards.
 */
export declare function IMG_CreateAnimatedCursor(
    anim: Pointer<IMG_Animation>,
    hot_x: i32,
    hot_y: i32,
): Pointer<SDL_Cursor> | null;

/** Release an animation and every surface in it. */
export declare function IMG_FreeAnimation(anim: Pointer<IMG_Animation>): void;

// ---------------------------------------------------------------------------
// Whole-animation saving.
// ---------------------------------------------------------------------------

export declare function IMG_SaveAnimation(anim: Pointer<IMG_Animation>, file: CString): boolean;

export declare function IMG_SaveAnimationTyped_IO(
    anim: Pointer<IMG_Animation>,
    dst: Pointer<SDL_IOStream>,
    closeio: boolean,
    type: CString,
): boolean;

export declare function IMG_SaveANIAnimation_IO(
    anim: Pointer<IMG_Animation>,
    dst: Pointer<SDL_IOStream>,
    closeio: boolean,
): boolean;

export declare function IMG_SaveAPNGAnimation_IO(
    anim: Pointer<IMG_Animation>,
    dst: Pointer<SDL_IOStream>,
    closeio: boolean,
): boolean;

/** `quality` runs 0 to 100. */
export declare function IMG_SaveAVIFAnimation_IO(
    anim: Pointer<IMG_Animation>,
    dst: Pointer<SDL_IOStream>,
    closeio: boolean,
    quality: i32,
): boolean;

export declare function IMG_SaveGIFAnimation_IO(
    anim: Pointer<IMG_Animation>,
    dst: Pointer<SDL_IOStream>,
    closeio: boolean,
): boolean;

/** `quality` runs 0 to 100. An `i32` here, unlike still WebP's `f32`. */
export declare function IMG_SaveWEBPAnimation_IO(
    anim: Pointer<IMG_Animation>,
    dst: Pointer<SDL_IOStream>,
    closeio: boolean,
    quality: i32,
): boolean;

// ---------------------------------------------------------------------------
// Streaming encoder.
//
// Frames are pushed in with `IMG_AddAnimationEncoderFrame` and the file is only
// complete once `IMG_CloseAnimationEncoder` has run — an encoder that is dropped
// without closing leaks the handle *and* leaves a truncated file.
// ---------------------------------------------------------------------------

export declare function IMG_CreateAnimationEncoder(file: CString): Pointer<IMG_AnimationEncoder> | null;

export declare function IMG_CreateAnimationEncoder_IO(
    dst: Pointer<SDL_IOStream>,
    closeio: boolean,
    type: CString,
): Pointer<IMG_AnimationEncoder> | null;

/**
 * An encoder configured by property group — the only form that reaches quality,
 * timebase and the per-codec settings. See `IMG_PROP_ANIMATION_ENCODER_*` in
 * `props.ts`.
 */
export declare function IMG_CreateAnimationEncoderWithProperties(
    props: SDL_PropertiesID,
): Pointer<IMG_AnimationEncoder> | null;

/**
 * Append a frame.
 *
 * `duration` is in the encoder's **timebase units**, not milliseconds — see the
 * note at the top of this file. The surface is copied, so it may be reused or
 * freed as soon as this returns.
 */
export declare function IMG_AddAnimationEncoderFrame(
    encoder: Pointer<IMG_AnimationEncoder>,
    surface: Pointer<SDL_Surface>,
    duration: u64,
): boolean;

/** Finish the file and release the encoder. Required; see the note above. */
export declare function IMG_CloseAnimationEncoder(encoder: Pointer<IMG_AnimationEncoder>): boolean;

// ---------------------------------------------------------------------------
// Streaming decoder.
// ---------------------------------------------------------------------------

export declare function IMG_CreateAnimationDecoder(file: CString): Pointer<IMG_AnimationDecoder> | null;

export declare function IMG_CreateAnimationDecoder_IO(
    src: Pointer<SDL_IOStream>,
    closeio: boolean,
    type: CString | null,
): Pointer<IMG_AnimationDecoder> | null;

/** See `IMG_PROP_ANIMATION_DECODER_*` in `props.ts`. */
export declare function IMG_CreateAnimationDecoderWithProperties(
    props: SDL_PropertiesID,
): Pointer<IMG_AnimationDecoder> | null;

/**
 * The decoder's metadata property group — title, author, frame count and the
 * rest. See `IMG_PROP_METADATA_*` in `props.ts`.
 *
 * The group belongs to the decoder and dies with it.
 */
export declare function IMG_GetAnimationDecoderProperties(
    decoder: Pointer<IMG_AnimationDecoder>,
): SDL_PropertiesID;

/**
 * Pull the next frame.
 *
 * `frame` receives a surface the **caller then owns** and must destroy with
 * `SDL_DestroySurface`; unlike `IMG_Animation`, the decoder does not keep it.
 * `duration` receives the frame's length in the decoder's timebase units.
 *
 * A `false` return is not necessarily an error — it is also how the end of the
 * animation arrives. {@link IMG_GetAnimationDecoderStatus} distinguishes
 * `COMPLETE` from `FAILED`.
 */
export declare function IMG_GetAnimationDecoderFrame(
    decoder: Pointer<IMG_AnimationDecoder>,
    frame: Pointer<Pointer<SDL_Surface>>,
    duration: Pointer<u64>,
): boolean;

export declare function IMG_GetAnimationDecoderStatus(
    decoder: Pointer<IMG_AnimationDecoder>,
): IMG_AnimationDecoderStatus;

/** Seek back to the first frame, for looping without reopening. */
export declare function IMG_ResetAnimationDecoder(decoder: Pointer<IMG_AnimationDecoder>): boolean;

export declare function IMG_CloseAnimationDecoder(decoder: Pointer<IMG_AnimationDecoder>): boolean;
