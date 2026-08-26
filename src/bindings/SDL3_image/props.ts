// The property-group keys SDL3_image reads and writes.
//
// Functions rather than constants, because Goblin has no top-level `const` — the
// same reason `renderer/config.ts` is shaped this way. Each returns the exact
// string SDL3_image compares against, so a typo is a property silently ignored
// rather than a compile error; that is what these exist to prevent.
//
// Three groups:
//
//   * `IMG_PROP_ANIMATION_ENCODER_CREATE_*` — passed to
//     `IMG_CreateAnimationEncoderWithProperties`. The only route to quality,
//     timebase and per-codec settings.
//   * `IMG_PROP_ANIMATION_DECODER_CREATE_*` — the decoder's equivalent.
//   * `IMG_PROP_METADATA_*` — read back from
//     `IMG_GetAnimationDecoderProperties`, and settable on an encoder to write
//     metadata into the file.
//
// **One upstream oddity, faithfully reproduced.** The two GIF decoder keys spell
// themselves `animation_encoder`, not `animation_decoder`. That is what the
// header says (`SDL_image.h`, the `IMG_PROP_ANIMATION_DECODER_CREATE_GIF_*`
// defines), so it is what these return — matching the library matters more than
// matching the name.

// ---------------------------------------------------------------------------
// Encoder creation.
// ---------------------------------------------------------------------------

export function IMG_PROP_ANIMATION_ENCODER_CREATE_FILENAME_STRING(): string {
    return "SDL_image.animation_encoder.create.filename";
}

export function IMG_PROP_ANIMATION_ENCODER_CREATE_IOSTREAM_POINTER(): string {
    return "SDL_image.animation_encoder.create.iostream";
}

export function IMG_PROP_ANIMATION_ENCODER_CREATE_IOSTREAM_AUTOCLOSE_BOOLEAN(): string {
    return "SDL_image.animation_encoder.create.iostream.autoclose";
}

export function IMG_PROP_ANIMATION_ENCODER_CREATE_TYPE_STRING(): string {
    return "SDL_image.animation_encoder.create.type";
}

export function IMG_PROP_ANIMATION_ENCODER_CREATE_QUALITY_NUMBER(): string {
    return "SDL_image.animation_encoder.create.quality";
}

/** With the denominator below, sets the unit `IMG_AddAnimationEncoderFrame` durations are in. */
export function IMG_PROP_ANIMATION_ENCODER_CREATE_TIMEBASE_NUMERATOR_NUMBER(): string {
    return "SDL_image.animation_encoder.create.timebase.numerator";
}

export function IMG_PROP_ANIMATION_ENCODER_CREATE_TIMEBASE_DENOMINATOR_NUMBER(): string {
    return "SDL_image.animation_encoder.create.timebase.denominator";
}

export function IMG_PROP_ANIMATION_ENCODER_CREATE_AVIF_MAX_THREADS_NUMBER(): string {
    return "SDL_image.animation_encoder.create.avif.max_threads";
}

export function IMG_PROP_ANIMATION_ENCODER_CREATE_AVIF_KEYFRAME_INTERVAL_NUMBER(): string {
    return "SDL_image.animation_encoder.create.avif.keyframe_interval";
}

export function IMG_PROP_ANIMATION_ENCODER_CREATE_GIF_USE_LUT_BOOLEAN(): string {
    return "SDL_image.animation_encoder.create.gif.use_lut";
}

// ---------------------------------------------------------------------------
// Decoder creation.
// ---------------------------------------------------------------------------

export function IMG_PROP_ANIMATION_DECODER_CREATE_FILENAME_STRING(): string {
    return "SDL_image.animation_decoder.create.filename";
}

export function IMG_PROP_ANIMATION_DECODER_CREATE_IOSTREAM_POINTER(): string {
    return "SDL_image.animation_decoder.create.iostream";
}

export function IMG_PROP_ANIMATION_DECODER_CREATE_IOSTREAM_AUTOCLOSE_BOOLEAN(): string {
    return "SDL_image.animation_decoder.create.iostream.autoclose";
}

export function IMG_PROP_ANIMATION_DECODER_CREATE_TYPE_STRING(): string {
    return "SDL_image.animation_decoder.create.type";
}

/** With the denominator below, sets the unit `IMG_GetAnimationDecoderFrame` reports durations in. */
export function IMG_PROP_ANIMATION_DECODER_CREATE_TIMEBASE_NUMERATOR_NUMBER(): string {
    return "SDL_image.animation_decoder.create.timebase.numerator";
}

export function IMG_PROP_ANIMATION_DECODER_CREATE_TIMEBASE_DENOMINATOR_NUMBER(): string {
    return "SDL_image.animation_decoder.create.timebase.denominator";
}

export function IMG_PROP_ANIMATION_DECODER_CREATE_AVIF_MAX_THREADS_NUMBER(): string {
    return "SDL_image.animation_decoder.create.avif.max_threads";
}

export function IMG_PROP_ANIMATION_DECODER_CREATE_AVIF_ALLOW_INCREMENTAL_BOOLEAN(): string {
    return "SDL_image.animation_decoder.create.avif.allow_incremental";
}

export function IMG_PROP_ANIMATION_DECODER_CREATE_AVIF_ALLOW_PROGRESSIVE_BOOLEAN(): string {
    return "SDL_image.animation_decoder.create.avif.allow_progressive";
}

/** Spelled `animation_encoder` upstream. See the note at the top of this file. */
export function IMG_PROP_ANIMATION_DECODER_CREATE_GIF_TRANSPARENT_COLOR_INDEX_NUMBER(): string {
    return "SDL_image.animation_encoder.create.gif.transparent_color_index";
}

/** Spelled `animation_encoder` upstream. See the note at the top of this file. */
export function IMG_PROP_ANIMATION_DECODER_CREATE_GIF_NUM_COLORS_NUMBER(): string {
    return "SDL_image.animation_encoder.create.gif.num_colors";
}

// ---------------------------------------------------------------------------
// Metadata, read from a decoder or set on an encoder.
// ---------------------------------------------------------------------------

/** Set true on an encoder to write no metadata at all. */
export function IMG_PROP_METADATA_IGNORE_PROPS_BOOLEAN(): string {
    return "SDL_image.metadata.ignore_props";
}

export function IMG_PROP_METADATA_DESCRIPTION_STRING(): string {
    return "SDL_image.metadata.description";
}

export function IMG_PROP_METADATA_COPYRIGHT_STRING(): string {
    return "SDL_image.metadata.copyright";
}

export function IMG_PROP_METADATA_TITLE_STRING(): string {
    return "SDL_image.metadata.title";
}

export function IMG_PROP_METADATA_AUTHOR_STRING(): string {
    return "SDL_image.metadata.author";
}

export function IMG_PROP_METADATA_CREATION_TIME_STRING(): string {
    return "SDL_image.metadata.creation_time";
}

export function IMG_PROP_METADATA_FRAME_COUNT_NUMBER(): string {
    return "SDL_image.metadata.frame_count";
}

export function IMG_PROP_METADATA_LOOP_COUNT_NUMBER(): string {
    return "SDL_image.metadata.loop_count";
}
