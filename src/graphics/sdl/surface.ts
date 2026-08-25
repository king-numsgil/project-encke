// Translated from SDL_surface.h
//
// `SDL_Surface` has a public layout, unlike `SDL_Window`, so it is an interface
// rather than an opaque class — `surface.w`, `surface.pitch` and `surface.pixels`
// are all reachable through the pointer. Everything but `pixels` is read-only
// as far as SDL is concerned, and nothing here enforces that.

import type { SDL_BlendMode } from "./blendmode.ts";
import type { SDL_IOStream } from "./iostream.ts";
import type { SDL_Colorspace, SDL_Palette, SDL_PixelFormat } from "./pixels.ts";
import type { SDL_PropertiesID } from "./properties.ts";
import type { SDL_Rect } from "./rect.ts";

/** The flags on an SDL_Surface. Read-only. */
export enum SDL_SurfaceFlags {
    NONE = 0x00000000,
    /** Surface uses preallocated pixel memory */
    PREALLOCATED = 0x00000001,
    /** Surface needs to be locked to access pixels */
    LOCK_NEEDED = 0x00000002,
    /** Surface is currently locked */
    LOCKED = 0x00000004,
    /** Surface uses pixel memory allocated with SDL_aligned_alloc() */
    SIMD_ALIGNED = 0x00000008,
}

export declare namespace SDL_SurfaceFlags {
    type Underlying = u32;
}

/** The scaling mode. */
export enum SDL_ScaleMode {
    INVALID = -1,
    /** Nearest pixel sampling */
    NEAREST,
    /** Linear filtering */
    LINEAR,
    /** Nearest pixel sampling with improved scaling for pixel art (SDL 3.4.0) */
    PIXELART,
}

export declare namespace SDL_ScaleMode {
    type Underlying = i32;
}

/** The flip mode. */
export enum SDL_FlipMode {
    /** Do not flip */
    NONE,
    /** Flip horizontally */
    HORIZONTAL,
    /** Flip vertically */
    VERTICAL,
    /** Flip horizontally and vertically — not a diagonal flip */
    HORIZONTAL_AND_VERTICAL = HORIZONTAL | VERTICAL,
}

export declare namespace SDL_FlipMode {
    type Underlying = i32;
}

/**
 * A collection of pixels used in software blitting.
 *
 * Pixels are arranged in rows, top row first, each row `pitch` bytes apart.
 * Within a row they run left to right until `w` is reached; the rest of the
 * pitch is padding with undefined contents.
 *
 * For a YUV format the planes are contiguous with no padding between them. For
 * `SDL_PixelFormat.MJPG`, `pixels` is the compressed JPEG and `pitch` is its
 * length.
 */
export interface SDL_Surface {
    /** The flags of the surface, read-only. */
    flags: SDL_SurfaceFlags;
    /** The format of the surface, read-only. */
    format: SDL_PixelFormat;
    /** The width of the surface, read-only. */
    w: i32;
    /** The height of the surface, read-only. */
    h: i32;
    /** The distance in bytes between rows of pixels, read-only. */
    pitch: i32;
    /** The pixels, writeable when non-null. */
    pixels: Pointer<unknown> | null;
    /** Application reference count, used when freeing the surface. */
    refcount: i32;
    /** Reserved for internal use. */
    reserved: Pointer<unknown> | null;
}

/** Does this surface have to be locked before its pixels can be touched? */
export function SDL_MUSTLOCK(surface: Pointer<SDL_Surface>): boolean {
    return (cast<u32>(surface.flags) & cast<u32>(SDL_SurfaceFlags.LOCK_NEEDED)) === cast<u32>(SDL_SurfaceFlags.LOCK_NEEDED);
}

// ---------------------------------------------------------------------------
// Lifetime.
// ---------------------------------------------------------------------------

/** The pixels of the new surface are zeroed. */
export declare function SDL_CreateSurface(width: i32, height: i32, format: SDL_PixelFormat): Pointer<SDL_Surface> | null;

/**
 * Wrap pixels you already own. The buffer is *not* copied and is not freed by
 * `SDL_DestroySurface` — it has to outlive the surface.
 */
export declare function SDL_CreateSurfaceFrom(
    width: i32,
    height: i32,
    format: SDL_PixelFormat,
    pixels: Pointer<unknown> | null,
    pitch: i32,
): Pointer<SDL_Surface> | null;

export declare function SDL_DestroySurface(surface: Pointer<SDL_Surface> | null): void;

/**
 * The surface's property group.
 *
 * Names: `"SDL.surface.SDR_white_point"`, `"SDL.surface.HDR_headroom"`,
 * `"SDL.surface.tonemap"`, `"SDL.surface.hotspot.x"`,
 * `"SDL.surface.hotspot.y"`.
 */
export declare function SDL_GetSurfaceProperties(surface: Pointer<SDL_Surface>): SDL_PropertiesID;

export declare function SDL_SetSurfaceColorspace(surface: Pointer<SDL_Surface>, colorspace: SDL_Colorspace): boolean;

export declare function SDL_GetSurfaceColorspace(surface: Pointer<SDL_Surface>): SDL_Colorspace;

/** The palette belongs to the surface — do not destroy it separately. */
export declare function SDL_CreateSurfacePalette(surface: Pointer<SDL_Surface>): Pointer<SDL_Palette> | null;

export declare function SDL_SetSurfacePalette(surface: Pointer<SDL_Surface>, palette: Pointer<SDL_Palette> | null): boolean;

export declare function SDL_GetSurfacePalette(surface: Pointer<SDL_Surface>): Pointer<SDL_Palette> | null;

// ---------------------------------------------------------------------------
// Alternate images — the same picture at other sizes, e.g. for a HiDPI cursor.
// ---------------------------------------------------------------------------

export declare function SDL_AddSurfaceAlternateImage(surface: Pointer<SDL_Surface>, image: Pointer<SDL_Surface>): boolean;

export declare function SDL_SurfaceHasAlternateImages(surface: Pointer<SDL_Surface>): boolean;

/** The array is SDL's allocation: release it with `SDL_free`. The surfaces in it are not. */
export declare function SDL_GetSurfaceImages(surface: Pointer<SDL_Surface>, count: Pointer<i32> | null): Pointer<Pointer<SDL_Surface>> | null;

export declare function SDL_RemoveSurfaceAlternateImages(surface: Pointer<SDL_Surface>): void;

// ---------------------------------------------------------------------------
// Locking.
// ---------------------------------------------------------------------------

export declare function SDL_LockSurface(surface: Pointer<SDL_Surface>): boolean;

export declare function SDL_UnlockSurface(surface: Pointer<SDL_Surface>): void;

// ---------------------------------------------------------------------------
// Loading and saving. `SDL_LoadSurface` sniffs the format; the BMP and PNG
// pairs are explicit about it.
// ---------------------------------------------------------------------------

export declare function SDL_LoadSurface_IO(src: Pointer<SDL_IOStream>, closeio: boolean): Pointer<SDL_Surface> | null;

export declare function SDL_LoadSurface(file: CString): Pointer<SDL_Surface> | null;

export declare function SDL_LoadBMP_IO(src: Pointer<SDL_IOStream>, closeio: boolean): Pointer<SDL_Surface> | null;

export declare function SDL_LoadBMP(file: CString): Pointer<SDL_Surface> | null;

export declare function SDL_SaveBMP_IO(surface: Pointer<SDL_Surface>, dst: Pointer<SDL_IOStream>, closeio: boolean): boolean;

export declare function SDL_SaveBMP(surface: Pointer<SDL_Surface>, file: CString): boolean;

export declare function SDL_LoadPNG_IO(src: Pointer<SDL_IOStream>, closeio: boolean): Pointer<SDL_Surface> | null;

export declare function SDL_LoadPNG(file: CString): Pointer<SDL_Surface> | null;

export declare function SDL_SavePNG_IO(surface: Pointer<SDL_Surface>, dst: Pointer<SDL_IOStream>, closeio: boolean): boolean;

export declare function SDL_SavePNG(surface: Pointer<SDL_Surface>, file: CString): boolean;

// ---------------------------------------------------------------------------
// Blit parameters.
// ---------------------------------------------------------------------------

export declare function SDL_SetSurfaceRLE(surface: Pointer<SDL_Surface>, enabled: boolean): boolean;

export declare function SDL_SurfaceHasRLE(surface: Pointer<SDL_Surface>): boolean;

/** `key` is a pixel value in the surface's own format — see `SDL_MapSurfaceRGB`. */
export declare function SDL_SetSurfaceColorKey(surface: Pointer<SDL_Surface>, enabled: boolean, key: u32): boolean;

export declare function SDL_SurfaceHasColorKey(surface: Pointer<SDL_Surface>): boolean;

export declare function SDL_GetSurfaceColorKey(surface: Pointer<SDL_Surface>, key: Pointer<u32> | null): boolean;

export declare function SDL_SetSurfaceColorMod(surface: Pointer<SDL_Surface>, r: u8, g: u8, b: u8): boolean;

export declare function SDL_GetSurfaceColorMod(surface: Pointer<SDL_Surface>, r: Pointer<u8> | null, g: Pointer<u8> | null, b: Pointer<u8> | null): boolean;

export declare function SDL_SetSurfaceAlphaMod(surface: Pointer<SDL_Surface>, alpha: u8): boolean;

export declare function SDL_GetSurfaceAlphaMod(surface: Pointer<SDL_Surface>, alpha: Pointer<u8>): boolean;

export declare function SDL_SetSurfaceBlendMode(surface: Pointer<SDL_Surface>, blendMode: SDL_BlendMode): boolean;

export declare function SDL_GetSurfaceBlendMode(surface: Pointer<SDL_Surface>, blendMode: Pointer<SDL_BlendMode>): boolean;

/** `null` for `rect` clips to the whole surface. */
export declare function SDL_SetSurfaceClipRect(surface: Pointer<SDL_Surface>, rect: Pointer<SDL_Rect> | null): boolean;

export declare function SDL_GetSurfaceClipRect(surface: Pointer<SDL_Surface>, rect: Pointer<SDL_Rect>): boolean;

// ---------------------------------------------------------------------------
// Transforms. Each of these that returns a surface returns a *new* one, which
// is yours to `SDL_DestroySurface`.
// ---------------------------------------------------------------------------

/** In place. */
export declare function SDL_FlipSurface(surface: Pointer<SDL_Surface>, flip: SDL_FlipMode): boolean;

export declare function SDL_RotateSurface(surface: Pointer<SDL_Surface>, angle: f32): Pointer<SDL_Surface> | null;

export declare function SDL_DuplicateSurface(surface: Pointer<SDL_Surface>): Pointer<SDL_Surface> | null;

export declare function SDL_ScaleSurface(surface: Pointer<SDL_Surface>, width: i32, height: i32, scaleMode: SDL_ScaleMode): Pointer<SDL_Surface> | null;

export declare function SDL_ConvertSurface(surface: Pointer<SDL_Surface>, format: SDL_PixelFormat): Pointer<SDL_Surface> | null;

export declare function SDL_ConvertSurfaceAndColorspace(
    surface: Pointer<SDL_Surface>,
    format: SDL_PixelFormat,
    palette: Pointer<SDL_Palette> | null,
    colorspace: SDL_Colorspace,
    props: SDL_PropertiesID,
): Pointer<SDL_Surface> | null;

export declare function SDL_ConvertPixels(
    width: i32,
    height: i32,
    src_format: SDL_PixelFormat,
    src: Pointer<unknown>,
    src_pitch: i32,
    dst_format: SDL_PixelFormat,
    dst: Pointer<unknown>,
    dst_pitch: i32,
): boolean;

export declare function SDL_ConvertPixelsAndColorspace(
    width: i32,
    height: i32,
    src_format: SDL_PixelFormat,
    src_colorspace: SDL_Colorspace,
    src_properties: SDL_PropertiesID,
    src: Pointer<unknown>,
    src_pitch: i32,
    dst_format: SDL_PixelFormat,
    dst_colorspace: SDL_Colorspace,
    dst_properties: SDL_PropertiesID,
    dst: Pointer<unknown>,
    dst_pitch: i32,
): boolean;

export declare function SDL_PremultiplyAlpha(
    width: i32,
    height: i32,
    src_format: SDL_PixelFormat,
    src: Pointer<unknown>,
    src_pitch: i32,
    dst_format: SDL_PixelFormat,
    dst: Pointer<unknown>,
    dst_pitch: i32,
    linear: boolean,
): boolean;

export declare function SDL_PremultiplySurfaceAlpha(surface: Pointer<SDL_Surface>, linear: boolean): boolean;

// ---------------------------------------------------------------------------
// Drawing.
// ---------------------------------------------------------------------------

/** Components are in the [0, 1] floating-point range of the surface's colorspace. */
export declare function SDL_ClearSurface(surface: Pointer<SDL_Surface>, r: f32, g: f32, b: f32, a: f32): boolean;

/** `null` for `rect` fills the whole surface. `color` is in the surface's own format. */
export declare function SDL_FillSurfaceRect(dst: Pointer<SDL_Surface>, rect: Pointer<SDL_Rect> | null, color: u32): boolean;

export declare function SDL_FillSurfaceRects(dst: Pointer<SDL_Surface>, rects: Pointer<SDL_Rect>, count: i32, color: u32): boolean;

/**
 * `null` for `srcrect` blits the whole source; `null` for `dstrect` puts it at
 * the destination's origin. `dstrect` is an in/out parameter — SDL writes the
 * clipped result back — so it may not point at read-only memory.
 */
export declare function SDL_BlitSurface(
    src: Pointer<SDL_Surface>,
    srcrect: Pointer<SDL_Rect> | null,
    dst: Pointer<SDL_Surface>,
    dstrect: Pointer<SDL_Rect> | null,
): boolean;

/** No clipping and no sanity checks: the rectangles must already be valid. */
export declare function SDL_BlitSurfaceUnchecked(
    src: Pointer<SDL_Surface>,
    srcrect: Pointer<SDL_Rect>,
    dst: Pointer<SDL_Surface>,
    dstrect: Pointer<SDL_Rect>,
): boolean;

export declare function SDL_BlitSurfaceScaled(
    src: Pointer<SDL_Surface>,
    srcrect: Pointer<SDL_Rect> | null,
    dst: Pointer<SDL_Surface>,
    dstrect: Pointer<SDL_Rect> | null,
    scaleMode: SDL_ScaleMode,
): boolean;

export declare function SDL_BlitSurfaceUncheckedScaled(
    src: Pointer<SDL_Surface>,
    srcrect: Pointer<SDL_Rect>,
    dst: Pointer<SDL_Surface>,
    dstrect: Pointer<SDL_Rect>,
    scaleMode: SDL_ScaleMode,
): boolean;

/** Like `SDL_BlitSurfaceScaled`, but ignoring the colour key, blend mode and mods. */
export declare function SDL_StretchSurface(
    src: Pointer<SDL_Surface>,
    srcrect: Pointer<SDL_Rect> | null,
    dst: Pointer<SDL_Surface>,
    dstrect: Pointer<SDL_Rect> | null,
    scaleMode: SDL_ScaleMode,
): boolean;

export declare function SDL_BlitSurfaceTiled(
    src: Pointer<SDL_Surface>,
    srcrect: Pointer<SDL_Rect> | null,
    dst: Pointer<SDL_Surface>,
    dstrect: Pointer<SDL_Rect> | null,
): boolean;

export declare function SDL_BlitSurfaceTiledWithScale(
    src: Pointer<SDL_Surface>,
    srcrect: Pointer<SDL_Rect> | null,
    scale: f32,
    scaleMode: SDL_ScaleMode,
    dst: Pointer<SDL_Surface>,
    dstrect: Pointer<SDL_Rect> | null,
): boolean;

/** A nine-patch blit: the corners stay put, the edges and centre stretch. */
export declare function SDL_BlitSurface9Grid(
    src: Pointer<SDL_Surface>,
    srcrect: Pointer<SDL_Rect> | null,
    left_width: i32,
    right_width: i32,
    top_height: i32,
    bottom_height: i32,
    scale: f32,
    scaleMode: SDL_ScaleMode,
    dst: Pointer<SDL_Surface>,
    dstrect: Pointer<SDL_Rect> | null,
): boolean;

// ---------------------------------------------------------------------------
// Pixel access. Slow — one call per pixel, with a format conversion in each.
// Lock the surface and walk `pixels` for anything that is not a one-off.
// ---------------------------------------------------------------------------

export declare function SDL_MapSurfaceRGB(surface: Pointer<SDL_Surface>, r: u8, g: u8, b: u8): u32;

export declare function SDL_MapSurfaceRGBA(surface: Pointer<SDL_Surface>, r: u8, g: u8, b: u8, a: u8): u32;

export declare function SDL_ReadSurfacePixel(
    surface: Pointer<SDL_Surface>,
    x: i32,
    y: i32,
    r: Pointer<u8> | null,
    g: Pointer<u8> | null,
    b: Pointer<u8> | null,
    a: Pointer<u8> | null,
): boolean;

export declare function SDL_ReadSurfacePixelFloat(
    surface: Pointer<SDL_Surface>,
    x: i32,
    y: i32,
    r: Pointer<f32> | null,
    g: Pointer<f32> | null,
    b: Pointer<f32> | null,
    a: Pointer<f32> | null,
): boolean;

export declare function SDL_WriteSurfacePixel(surface: Pointer<SDL_Surface>, x: i32, y: i32, r: u8, g: u8, b: u8, a: u8): boolean;

export declare function SDL_WriteSurfacePixelFloat(surface: Pointer<SDL_Surface>, x: i32, y: i32, r: f32, g: f32, b: f32, a: f32): boolean;
