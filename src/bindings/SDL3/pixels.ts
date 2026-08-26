// Translated from SDL_pixels.h
//
// The enum values are the ones the header spells out, not the
// SDL_DEFINE_PIXELFORMAT / SDL_DEFINE_COLORSPACE macro expansions: SDL writes
// both, and the literal is what a C compiler ends up with.
//
// The macro accessors (SDL_PIXELTYPE, SDL_BITSPERPIXEL, SDL_ISPIXELFORMAT_ALPHA
// and friends) have no symbol to link against, so they are ordinary Goblin
// functions at the bottom of this file.

export enum SDL_PixelType {
    UNKNOWN,
    INDEX1,
    INDEX4,
    INDEX8,
    PACKED8,
    PACKED16,
    PACKED32,
    ARRAYU8,
    ARRAYU16,
    ARRAYU32,
    ARRAYF16,
    ARRAYF32,
    /** Appended at the end for compatibility with sdl2-compat. */
    INDEX2,
}

export declare namespace SDL_PixelType {
    type Underlying = i32;
}

/** Bitmap pixel order, high bit -> low bit. */
export enum SDL_BitmapOrder {
    NONE,
    _4321,
    _1234,
}

export declare namespace SDL_BitmapOrder {
    type Underlying = i32;
}

/** Packed component order, high bit -> low bit. */
export enum SDL_PackedOrder {
    NONE,
    XRGB,
    RGBX,
    ARGB,
    RGBA,
    XBGR,
    BGRX,
    ABGR,
    BGRA,
}

export declare namespace SDL_PackedOrder {
    type Underlying = i32;
}

/** Array component order, low byte -> high byte. */
export enum SDL_ArrayOrder {
    NONE,
    RGB,
    RGBA,
    ARGB,
    BGR,
    BGRA,
    ABGR,
}

export declare namespace SDL_ArrayOrder {
    type Underlying = i32;
}

/** Packed component layout. */
export enum SDL_PackedLayout {
    NONE,
    _332,
    _4444,
    _1555,
    _5551,
    _565,
    _8888,
    _2101010,
    _1010102,
}

export declare namespace SDL_PackedLayout {
    type Underlying = i32;
}

export enum SDL_PixelFormat {
    UNKNOWN = 0,
    INDEX1LSB = 0x11100100,
    INDEX1MSB = 0x11200100,
    INDEX2LSB = 0x1c100200,
    INDEX2MSB = 0x1c200200,
    INDEX4LSB = 0x12100400,
    INDEX4MSB = 0x12200400,
    INDEX8 = 0x13000801,
    RGB332 = 0x14110801,
    XRGB4444 = 0x15120c02,
    XBGR4444 = 0x15520c02,
    XRGB1555 = 0x15130f02,
    XBGR1555 = 0x15530f02,
    ARGB4444 = 0x15321002,
    RGBA4444 = 0x15421002,
    ABGR4444 = 0x15721002,
    BGRA4444 = 0x15821002,
    ARGB1555 = 0x15331002,
    RGBA5551 = 0x15441002,
    ABGR1555 = 0x15731002,
    BGRA5551 = 0x15841002,
    RGB565 = 0x15151002,
    BGR565 = 0x15551002,
    RGB24 = 0x17101803,
    BGR24 = 0x17401803,
    XRGB8888 = 0x16161804,
    RGBX8888 = 0x16261804,
    XBGR8888 = 0x16561804,
    BGRX8888 = 0x16661804,
    ARGB8888 = 0x16362004,
    RGBA8888 = 0x16462004,
    ABGR8888 = 0x16762004,
    BGRA8888 = 0x16862004,
    XRGB2101010 = 0x16172004,
    XBGR2101010 = 0x16572004,
    ARGB2101010 = 0x16372004,
    ABGR2101010 = 0x16772004,
    RGB48 = 0x18103006,
    BGR48 = 0x18403006,
    RGBA64 = 0x18204008,
    ARGB64 = 0x18304008,
    BGRA64 = 0x18504008,
    ABGR64 = 0x18604008,
    RGB48_FLOAT = 0x1a103006,
    BGR48_FLOAT = 0x1a403006,
    RGBA64_FLOAT = 0x1a204008,
    ARGB64_FLOAT = 0x1a304008,
    BGRA64_FLOAT = 0x1a504008,
    ABGR64_FLOAT = 0x1a604008,
    RGB96_FLOAT = 0x1b10600c,
    BGR96_FLOAT = 0x1b40600c,
    RGBA128_FLOAT = 0x1b208010,
    ARGB128_FLOAT = 0x1b308010,
    BGRA128_FLOAT = 0x1b508010,
    ABGR128_FLOAT = 0x1b608010,

    // FourCC formats.
    /** Planar mode: Y + V + U (3 planes) */
    YV12 = 0x32315659,
    /** Planar mode: Y + U + V (3 planes) */
    IYUV = 0x56555949,
    /** Packed mode: Y0+U0+Y1+V0 (1 plane) */
    YUY2 = 0x32595559,
    /** Packed mode: U0+Y0+V0+Y1 (1 plane) */
    UYVY = 0x59565955,
    /** Packed mode: Y0+V0+Y1+U0 (1 plane) */
    YVYU = 0x55595659,
    /** Planar mode: Y + U/V interleaved (2 planes) */
    NV12 = 0x3231564e,
    /** Planar mode: Y + V/U interleaved (2 planes) */
    NV21 = 0x3132564e,
    /** Planar mode: Y + U/V interleaved (2 planes) */
    P010 = 0x30313050,
    /** Android video texture format */
    EXTERNAL_OES = 0x2053454f,
    /** Motion JPEG */
    MJPG = 0x47504a4d,

    // Aliases for RGBA byte arrays of colour data, for the current platform.
    //
    // The header picks between two sets with `#if SDL_BYTEORDER ==
    // SDL_BIG_ENDIAN`. These are the `#else` half — little-endian, which is
    // every target this compiler produces today.
    RGBA32 = ABGR8888,
    ARGB32 = BGRA8888,
    BGRA32 = ARGB8888,
    ABGR32 = RGBA8888,
    RGBX32 = XBGR8888,
    XRGB32 = BGRX8888,
    BGRX32 = XRGB8888,
    XBGR32 = RGBX8888,
}

export declare namespace SDL_PixelFormat {
    type Underlying = u32;
}

export enum SDL_ColorType {
    UNKNOWN = 0,
    RGB = 1,
    YCBCR = 2,
}

export declare namespace SDL_ColorType {
    type Underlying = i32;
}

export enum SDL_ColorRange {
    UNKNOWN = 0,
    /** Narrow range, e.g. 16-235 for 8-bit RGB and luma, and 16-240 for 8-bit chroma */
    LIMITED = 1,
    /** Full range, e.g. 0-255 for 8-bit RGB and luma, and 1-255 for 8-bit chroma */
    FULL = 2,
}

export declare namespace SDL_ColorRange {
    type Underlying = i32;
}

export enum SDL_ColorPrimaries {
    UNKNOWN = 0,
    /** ITU-R BT.709-6 */
    BT709 = 1,
    UNSPECIFIED = 2,
    /** ITU-R BT.470-6 System M */
    BT470M = 4,
    /** ITU-R BT.470-6 System B, G / ITU-R BT.601-7 625 */
    BT470BG = 5,
    /** ITU-R BT.601-7 525, SMPTE 170M */
    BT601 = 6,
    /** SMPTE 240M, functionally the same as BT601 */
    SMPTE240 = 7,
    GENERIC_FILM = 8,
    /** ITU-R BT.2020-2 / ITU-R BT.2100-0 */
    BT2020 = 9,
    /** SMPTE ST 428-1 */
    XYZ = 10,
    /** SMPTE RP 431-2 */
    SMPTE431 = 11,
    /** SMPTE EG 432-1 / DCI P3 */
    SMPTE432 = 12,
    /** EBU Tech. 3213-E */
    EBU3213 = 22,
    CUSTOM = 31,
}

export declare namespace SDL_ColorPrimaries {
    type Underlying = i32;
}

export enum SDL_TransferCharacteristics {
    UNKNOWN = 0,
    /** Rec. ITU-R BT.709-6 / ITU-R BT1361 */
    BT709 = 1,
    UNSPECIFIED = 2,
    /** ITU-R BT.470-6 System M / ITU-R BT1700 625 PAL & SECAM */
    GAMMA22 = 4,
    /** ITU-R BT.470-6 System B, G */
    GAMMA28 = 5,
    /** SMPTE ST 170M / ITU-R BT.601-7 525 or 625 */
    BT601 = 6,
    /** SMPTE ST 240M */
    SMPTE240 = 7,
    LINEAR = 8,
    LOG100 = 9,
    LOG100_SQRT10 = 10,
    /** IEC 61966-2-4 */
    IEC61966 = 11,
    /** ITU-R BT1361 Extended Colour Gamut */
    BT1361 = 12,
    /** IEC 61966-2-1 (sRGB or sYCC) */
    SRGB = 13,
    /** ITU-R BT2020 for 10-bit system */
    BT2020_10BIT = 14,
    /** ITU-R BT2020 for 12-bit system */
    BT2020_12BIT = 15,
    /** SMPTE ST 2084 for 10-, 12-, 14- and 16-bit systems */
    PQ = 16,
    /** SMPTE ST 428-1 */
    SMPTE428 = 17,
    /** ARIB STD-B67, known as "hybrid log-gamma" (HLG) */
    HLG = 18,
    CUSTOM = 31,
}

export declare namespace SDL_TransferCharacteristics {
    type Underlying = i32;
}

export enum SDL_MatrixCoefficients {
    IDENTITY = 0,
    /** ITU-R BT.709-6 */
    BT709 = 1,
    UNSPECIFIED = 2,
    /** US FCC Title 47 */
    FCC = 4,
    /** ITU-R BT.470-6 System B, G / ITU-R BT.601-7 625, functionally the same as BT601 */
    BT470BG = 5,
    /** ITU-R BT.601-7 525 */
    BT601 = 6,
    /** SMPTE 240M */
    SMPTE240 = 7,
    YCGCO = 8,
    /** ITU-R BT.2020-2 non-constant luminance */
    BT2020_NCL = 9,
    /** ITU-R BT.2020-2 constant luminance */
    BT2020_CL = 10,
    /** SMPTE ST 2085 */
    SMPTE2085 = 11,
    CHROMA_DERIVED_NCL = 12,
    CHROMA_DERIVED_CL = 13,
    /** ITU-R BT.2100-0 ICTCP */
    ICTCP = 14,
    CUSTOM = 31,
}

export declare namespace SDL_MatrixCoefficients {
    type Underlying = i32;
}

export enum SDL_ChromaLocation {
    /** RGB, no chroma sampling */
    NONE = 0,
    /** In MPEG-2, MPEG-4 and AVC, Cb and Cr are taken on the mid-line of the left column of chroma samples */
    LEFT = 1,
    /** In JPEG/JFIF, H.261 and MPEG-1, Cb and Cr are taken at the centre of a 2x2 square */
    CENTER = 2,
    /** In HEVC for BT.2020 and BT.2100 content, Cb and Cr are sampled at the top-left of the 2x2 square */
    TOPLEFT = 3,
}

export declare namespace SDL_ChromaLocation {
    type Underlying = i32;
}

export enum SDL_Colorspace {
    UNKNOWN = 0,
    /** Equivalent to DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709 */
    SRGB = 0x120005a0,
    /** Equivalent to DXGI_COLOR_SPACE_RGB_FULL_G10_NONE_P709 */
    SRGB_LINEAR = 0x12000500,
    /** Equivalent to DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020 */
    HDR10 = 0x12002600,
    /** Equivalent to DXGI_COLOR_SPACE_YCBCR_FULL_G22_NONE_P709_X601 */
    JPEG = 0x220004c6,
    /** Equivalent to DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P601 */
    BT601_LIMITED = 0x211018c6,
    /** Equivalent to DXGI_COLOR_SPACE_YCBCR_FULL_G22_LEFT_P601 */
    BT601_FULL = 0x221018c6,
    /** Equivalent to DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709 */
    BT709_LIMITED = 0x21100421,
    /** Equivalent to DXGI_COLOR_SPACE_YCBCR_FULL_G22_LEFT_P709 */
    BT709_FULL = 0x22100421,
    /** Equivalent to DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P2020 */
    BT2020_LIMITED = 0x21102609,
    /** Equivalent to DXGI_COLOR_SPACE_YCBCR_FULL_G22_LEFT_P2020 */
    BT2020_FULL = 0x22102609,
    /** The default colorspace for RGB surfaces if no colorspace is specified */
    RGB_DEFAULT = SRGB,
    /** The default colorspace for YUV surfaces if no colorspace is specified */
    YUV_DEFAULT = BT601_LIMITED,
}

export declare namespace SDL_Colorspace {
    type Underlying = u32;
}

/**
 * A colour, one byte per channel.
 *
 * The bytes can be reinterpreted as an integer-packed colour in
 * `SDL_PixelFormat.RGBA32`.
 */
export interface SDL_Color {
    r: u8;
    g: u8;
    b: u8;
    a: u8;
}

/** A colour, one `f32` per channel — `SDL_PixelFormat.RGBA128_FLOAT`. */
export interface SDL_FColor {
    r: f32;
    g: f32;
    b: f32;
    a: f32;
}

/** A set of indexed colours representing a palette. */
export interface SDL_Palette {
    /** Number of elements in `colors`. */
    ncolors: i32;
    /** An array of colours, `ncolors` long. */
    colors: Pointer<SDL_Color> | null;
    /** Internal use only, do not touch. */
    version: u32;
    /** Internal use only, do not touch. */
    refcount: i32;
}

/** Details about the format of a pixel. */
export interface SDL_PixelFormatDetails {
    format: SDL_PixelFormat;
    bits_per_pixel: u8;
    bytes_per_pixel: u8;
    padding: FixedArray<u8, 2>;
    Rmask: u32;
    Gmask: u32;
    Bmask: u32;
    Amask: u32;
    Rbits: u8;
    Gbits: u8;
    Bbits: u8;
    Abits: u8;
    Rshift: u8;
    Gshift: u8;
    Bshift: u8;
    Ashift: u8;
}

/** A fully opaque 8-bit alpha value. `SDL_ALPHA_TRANSPARENT` is 0. */
export enum SDL_Alpha {
    TRANSPARENT = 0,
    OPAQUE = 255,
}

export declare namespace SDL_Alpha {
    type Underlying = u8;
}

export declare function SDL_GetPixelFormatName(format: SDL_PixelFormat): CString;

export declare function SDL_GetMasksForPixelFormat(
    format: SDL_PixelFormat,
    bpp: Pointer<i32>,
    Rmask: Pointer<u32>,
    Gmask: Pointer<u32>,
    Bmask: Pointer<u32>,
    Amask: Pointer<u32>,
): boolean;

export declare function SDL_GetPixelFormatForMasks(bpp: i32, Rmask: u32, Gmask: u32, Bmask: u32, Amask: u32): SDL_PixelFormat;

export declare function SDL_GetPixelFormatDetails(format: SDL_PixelFormat): Pointer<SDL_PixelFormatDetails> | null;

export declare function SDL_CreatePalette(ncolors: i32): Pointer<SDL_Palette> | null;

export declare function SDL_SetPaletteColors(palette: Pointer<SDL_Palette>, colors: Pointer<SDL_Color>, firstcolor: i32, ncolors: i32): boolean;

export declare function SDL_DestroyPalette(palette: Pointer<SDL_Palette>): void;

export declare function SDL_MapRGB(format: Pointer<SDL_PixelFormatDetails>, palette: Pointer<SDL_Palette> | null, r: u8, g: u8, b: u8): u32;

export declare function SDL_MapRGBA(format: Pointer<SDL_PixelFormatDetails>, palette: Pointer<SDL_Palette> | null, r: u8, g: u8, b: u8, a: u8): u32;

export declare function SDL_GetRGB(
    pixelvalue: u32,
    format: Pointer<SDL_PixelFormatDetails>,
    palette: Pointer<SDL_Palette> | null,
    r: Pointer<u8>,
    g: Pointer<u8>,
    b: Pointer<u8>,
): void;

export declare function SDL_GetRGBA(
    pixelvalue: u32,
    format: Pointer<SDL_PixelFormatDetails>,
    palette: Pointer<SDL_Palette> | null,
    r: Pointer<u8>,
    g: Pointer<u8>,
    b: Pointer<u8>,
    a: Pointer<u8>,
): void;

// ---------------------------------------------------------------------------
// The `#define` accessors. Macros in C, so there is no symbol to link against
// and these are ordinary Goblin functions.
// ---------------------------------------------------------------------------

/** Define a custom FourCC pixel format, e.g. `SDL_DEFINE_PIXELFOURCC(89, 86, 49, 50)` for YV12. */
export function SDL_DEFINE_PIXELFOURCC(A: u32, B: u32, C: u32, D: u32): u32 {
    return A | (B << 8) | (C << 16) | (D << 24);
}

/** Define a custom non-FourCC pixel format. */
export function SDL_DEFINE_PIXELFORMAT(type_: u32, order: u32, layout: u32, bits: u32, bytes: u32): u32 {
    return (1 << 28) | (type_ << 24) | (order << 20) | (layout << 16) | (bits << 8) | bytes;
}

export function SDL_PIXELFLAG(format: SDL_PixelFormat): u32 {
    return (cast<u32>(format) >> 28) & 0x0f;
}

export function SDL_PIXELTYPE(format: SDL_PixelFormat): u32 {
    return (cast<u32>(format) >> 24) & 0x0f;
}

export function SDL_PIXELORDER(format: SDL_PixelFormat): u32 {
    return (cast<u32>(format) >> 20) & 0x0f;
}

export function SDL_PIXELLAYOUT(format: SDL_PixelFormat): u32 {
    return (cast<u32>(format) >> 16) & 0x0f;
}

/** Zero for a FourCC format, where measuring per pixel rarely makes sense. */
export function SDL_BITSPERPIXEL(format: SDL_PixelFormat): u32 {
    return SDL_ISPIXELFORMAT_FOURCC(format) ? 0 : ((cast<u32>(format) >> 8) & 0xff);
}

export function SDL_BYTESPERPIXEL(format: SDL_PixelFormat): u32 {
    if (SDL_ISPIXELFORMAT_FOURCC(format)) {
        const f = cast<u32>(format);
        if (f === cast<u32>(SDL_PixelFormat.YUY2)
            || f === cast<u32>(SDL_PixelFormat.UYVY)
            || f === cast<u32>(SDL_PixelFormat.YVYU)
            || f === cast<u32>(SDL_PixelFormat.P010)) {
            return 2;
        }
        return 1;
    }
    return cast<u32>(format) & 0xff;
}

export function SDL_ISPIXELFORMAT_INDEXED(format: SDL_PixelFormat): boolean {
    if (SDL_ISPIXELFORMAT_FOURCC(format)) {
        return false;
    }
    const t = SDL_PIXELTYPE(format);
    return t === cast<u32>(SDL_PixelType.INDEX1)
        || t === cast<u32>(SDL_PixelType.INDEX2)
        || t === cast<u32>(SDL_PixelType.INDEX4)
        || t === cast<u32>(SDL_PixelType.INDEX8);
}

export function SDL_ISPIXELFORMAT_PACKED(format: SDL_PixelFormat): boolean {
    if (SDL_ISPIXELFORMAT_FOURCC(format)) {
        return false;
    }
    const t = SDL_PIXELTYPE(format);
    return t === cast<u32>(SDL_PixelType.PACKED8)
        || t === cast<u32>(SDL_PixelType.PACKED16)
        || t === cast<u32>(SDL_PixelType.PACKED32);
}

export function SDL_ISPIXELFORMAT_ARRAY(format: SDL_PixelFormat): boolean {
    if (SDL_ISPIXELFORMAT_FOURCC(format)) {
        return false;
    }
    const t = SDL_PIXELTYPE(format);
    return t === cast<u32>(SDL_PixelType.ARRAYU8)
        || t === cast<u32>(SDL_PixelType.ARRAYU16)
        || t === cast<u32>(SDL_PixelType.ARRAYU32)
        || t === cast<u32>(SDL_PixelType.ARRAYF16)
        || t === cast<u32>(SDL_PixelType.ARRAYF32);
}

export function SDL_ISPIXELFORMAT_10BIT(format: SDL_PixelFormat): boolean {
    return !SDL_ISPIXELFORMAT_FOURCC(format)
        && SDL_PIXELTYPE(format) === cast<u32>(SDL_PixelType.PACKED32)
        && SDL_PIXELLAYOUT(format) === cast<u32>(SDL_PackedLayout._2101010);
}

export function SDL_ISPIXELFORMAT_FLOAT(format: SDL_PixelFormat): boolean {
    if (SDL_ISPIXELFORMAT_FOURCC(format)) {
        return false;
    }
    const t = SDL_PIXELTYPE(format);
    return t === cast<u32>(SDL_PixelType.ARRAYF16) || t === cast<u32>(SDL_PixelType.ARRAYF32);
}

export function SDL_ISPIXELFORMAT_ALPHA(format: SDL_PixelFormat): boolean {
    if (SDL_ISPIXELFORMAT_PACKED(format)) {
        const o = SDL_PIXELORDER(format);
        return o === cast<u32>(SDL_PackedOrder.ARGB)
            || o === cast<u32>(SDL_PackedOrder.RGBA)
            || o === cast<u32>(SDL_PackedOrder.ABGR)
            || o === cast<u32>(SDL_PackedOrder.BGRA);
    }
    if (SDL_ISPIXELFORMAT_ARRAY(format)) {
        const o = SDL_PIXELORDER(format);
        return o === cast<u32>(SDL_ArrayOrder.ARGB)
            || o === cast<u32>(SDL_ArrayOrder.RGBA)
            || o === cast<u32>(SDL_ArrayOrder.ABGR)
            || o === cast<u32>(SDL_ArrayOrder.BGRA);
    }
    return false;
}

/** A FourCC format is one whose top nibble is not the 1 that SDL_DEFINE_PIXELFORMAT puts there. */
export function SDL_ISPIXELFORMAT_FOURCC(format: SDL_PixelFormat): boolean {
    const f = cast<u32>(format);
    return f !== 0 && SDL_PIXELFLAG(format) !== 1;
}

/** Build an SDL_Colorspace out of its parts. */
export function SDL_DEFINE_COLORSPACE(
    type_: u32,
    range: u32,
    primaries: u32,
    transfer: u32,
    matrix: u32,
    chroma: u32,
): u32 {
    return (type_ << 28) | (range << 24) | (chroma << 20) | (primaries << 10) | (transfer << 5) | matrix;
}

export function SDL_COLORSPACETYPE(cspace: SDL_Colorspace): u32 {
    return (cast<u32>(cspace) >> 28) & 0x0f;
}

export function SDL_COLORSPACERANGE(cspace: SDL_Colorspace): u32 {
    return (cast<u32>(cspace) >> 24) & 0x0f;
}

export function SDL_COLORSPACECHROMA(cspace: SDL_Colorspace): u32 {
    return (cast<u32>(cspace) >> 20) & 0x0f;
}

export function SDL_COLORSPACEPRIMARIES(cspace: SDL_Colorspace): u32 {
    return (cast<u32>(cspace) >> 10) & 0x1f;
}

export function SDL_COLORSPACETRANSFER(cspace: SDL_Colorspace): u32 {
    return (cast<u32>(cspace) >> 5) & 0x1f;
}

export function SDL_COLORSPACEMATRIX(cspace: SDL_Colorspace): u32 {
    return cast<u32>(cspace) & 0x1f;
}

export function SDL_ISCOLORSPACE_MATRIX_BT601(cspace: SDL_Colorspace): boolean {
    const m = SDL_COLORSPACEMATRIX(cspace);
    return m === cast<u32>(SDL_MatrixCoefficients.BT601) || m === cast<u32>(SDL_MatrixCoefficients.BT470BG);
}

export function SDL_ISCOLORSPACE_MATRIX_BT709(cspace: SDL_Colorspace): boolean {
    return SDL_COLORSPACEMATRIX(cspace) === cast<u32>(SDL_MatrixCoefficients.BT709);
}

export function SDL_ISCOLORSPACE_MATRIX_BT2020_NCL(cspace: SDL_Colorspace): boolean {
    return SDL_COLORSPACEMATRIX(cspace) === cast<u32>(SDL_MatrixCoefficients.BT2020_NCL);
}

export function SDL_ISCOLORSPACE_LIMITED_RANGE(cspace: SDL_Colorspace): boolean {
    return SDL_COLORSPACERANGE(cspace) !== cast<u32>(SDL_ColorRange.FULL);
}

export function SDL_ISCOLORSPACE_FULL_RANGE(cspace: SDL_Colorspace): boolean {
    return SDL_COLORSPACERANGE(cspace) === cast<u32>(SDL_ColorRange.FULL);
}
