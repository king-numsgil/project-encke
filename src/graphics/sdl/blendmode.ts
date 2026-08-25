// Translated from SDL_blendmode.h
//
// `SDL_BlendMode` is a `Uint32` in C, not an enum, because a custom mode built
// by SDL_ComposeCustomBlendMode() is a packed field rather than one of the
// named values. It is an enum here anyway: the underlying type is the same
// `u32`, and a custom mode reaches it through `cast<SDL_BlendMode>(…)`.

export enum SDL_BlendMode {
    /** No blending: dstRGBA = srcRGBA */
    NONE = 0x00000000,
    /** Alpha blending: dstRGB = (srcRGB * srcA) + (dstRGB * (1-srcA)), dstA = srcA + (dstA * (1-srcA)) */
    BLEND = 0x00000001,
    /** Pre-multiplied alpha blending: dstRGBA = srcRGBA + (dstRGBA * (1-srcA)) */
    BLEND_PREMULTIPLIED = 0x00000010,
    /** Additive blending: dstRGB = (srcRGB * srcA) + dstRGB, dstA = dstA */
    ADD = 0x00000002,
    /** Pre-multiplied additive blending: dstRGB = srcRGB + dstRGB, dstA = dstA */
    ADD_PREMULTIPLIED = 0x00000020,
    /** Colour modulate: dstRGB = srcRGB * dstRGB, dstA = dstA */
    MOD = 0x00000004,
    /** Colour multiply: dstRGB = (srcRGB * dstRGB) + (dstRGB * (1-srcA)), dstA = dstA */
    MUL = 0x00000008,
    INVALID = 0x7fffffff,
}

export declare namespace SDL_BlendMode {
    type Underlying = u32;
}

/** The blend operation used when combining source and destination pixel components. */
export enum SDL_BlendOperation {
    /** dst + src: supported by all renderers */
    ADD = 0x1,
    /** src - dst: supported by D3D, OpenGL, OpenGLES and Vulkan */
    SUBTRACT = 0x2,
    /** dst - src: supported by D3D, OpenGL, OpenGLES and Vulkan */
    REV_SUBTRACT = 0x3,
    /** min(dst, src): supported by D3D, OpenGL, OpenGLES and Vulkan */
    MINIMUM = 0x4,
    /** max(dst, src): supported by D3D, OpenGL, OpenGLES and Vulkan */
    MAXIMUM = 0x5,
}

export declare namespace SDL_BlendOperation {
    type Underlying = i32;
}

/** The normalized factor used to multiply pixel components. */
export enum SDL_BlendFactor {
    /** 0, 0, 0, 0 */
    ZERO = 0x1,
    /** 1, 1, 1, 1 */
    ONE = 0x2,
    /** srcR, srcG, srcB, srcA */
    SRC_COLOR = 0x3,
    /** 1-srcR, 1-srcG, 1-srcB, 1-srcA */
    ONE_MINUS_SRC_COLOR = 0x4,
    /** srcA, srcA, srcA, srcA */
    SRC_ALPHA = 0x5,
    /** 1-srcA, 1-srcA, 1-srcA, 1-srcA */
    ONE_MINUS_SRC_ALPHA = 0x6,
    /** dstR, dstG, dstB, dstA */
    DST_COLOR = 0x7,
    /** 1-dstR, 1-dstG, 1-dstB, 1-dstA */
    ONE_MINUS_DST_COLOR = 0x8,
    /** dstA, dstA, dstA, dstA */
    DST_ALPHA = 0x9,
    /** 1-dstA, 1-dstA, 1-dstA, 1-dstA */
    ONE_MINUS_DST_ALPHA = 0xa,
}

export declare namespace SDL_BlendFactor {
    type Underlying = i32;
}

/**
 * Compose a custom blend mode.
 *
 * The result is not one of the named `SDL_BlendMode` members; it is a packed
 * field that only the renderer that accepted it understands.
 */
export declare function SDL_ComposeCustomBlendMode(
    srcColorFactor: SDL_BlendFactor,
    dstColorFactor: SDL_BlendFactor,
    colorOperation: SDL_BlendOperation,
    srcAlphaFactor: SDL_BlendFactor,
    dstAlphaFactor: SDL_BlendFactor,
    alphaOperation: SDL_BlendOperation,
): SDL_BlendMode;
