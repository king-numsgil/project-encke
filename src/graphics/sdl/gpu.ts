// Translated from SDL_gpu.h
//
// The shape of the API, because the type signatures alone do not tell you:
//
//   1. Make an `SDL_GPUDevice` and claim a window for it.
//   2. Per frame, `SDL_AcquireGPUCommandBuffer`, then
//      `SDL_WaitAndAcquireGPUSwapchainTexture`.
//   3. Open one pass at a time on that command buffer — render, compute or
//      copy — bind what it needs, issue draws, end it.
//   4. `SDL_SubmitGPUCommandBuffer`.
//
// Two rules the compiler cannot enforce:
//
//   * **Every `Create…` has a matching `SDL_Release…`**, and the release goes to
//     the *device*, never to `.free()`. These handles are the driver's, not
//     Goblin's.
//   * **A command buffer is single-threaded and one-shot.** Acquire it, record
//     on the thread that acquired it, submit it, and never touch it again — it
//     is freed by the submit.
//
// `cycle` on a create-info or a binding is SDL's rename-under-the-hood: when a
// resource is still in use by a pending command buffer, `cycle: true` hands you
// a fresh block instead of stalling. It is how you avoid writing a
// `SDL_WaitForGPUIdle` into your inner loop.

import type { SDL_PixelFormat, SDL_FColor } from "./pixels.ts";
import type { SDL_PropertiesID } from "./properties.ts";
import type { SDL_Rect } from "./rect.ts";
import type { SDL_FlipMode } from "./surface.ts";
import type { SDL_Window } from "./video.ts";

// ---------------------------------------------------------------------------
// Handles. All opaque, all released through the device.
// ---------------------------------------------------------------------------

/** An opaque handle representing the SDL_GPU context. */
export declare class SDL_GPUDevice {
    private _opaque: never;
}

/** An opaque handle representing a buffer. */
export declare class SDL_GPUBuffer {
    private _opaque: never;
}

/** An opaque handle representing a transfer buffer — the CPU side of an upload or download. */
export declare class SDL_GPUTransferBuffer {
    private _opaque: never;
}

/** An opaque handle representing a texture. */
export declare class SDL_GPUTexture {
    private _opaque: never;
}

/** An opaque handle representing a sampler. */
export declare class SDL_GPUSampler {
    private _opaque: never;
}

/** An opaque handle representing a compiled shader object. */
export declare class SDL_GPUShader {
    private _opaque: never;
}

/** An opaque handle representing a compute pipeline. */
export declare class SDL_GPUComputePipeline {
    private _opaque: never;
}

/** An opaque handle representing a graphics pipeline. */
export declare class SDL_GPUGraphicsPipeline {
    private _opaque: never;
}

/**
 * An opaque handle representing a command buffer.
 *
 * Not thread-safe, and destroyed by the submit — see the note at the top of
 * this file.
 */
export declare class SDL_GPUCommandBuffer {
    private _opaque: never;
}

/** An opaque handle representing a render pass. Valid only until `SDL_EndGPURenderPass`. */
export declare class SDL_GPURenderPass {
    private _opaque: never;
}

/** An opaque handle representing a compute pass. Valid only until `SDL_EndGPUComputePass`. */
export declare class SDL_GPUComputePass {
    private _opaque: never;
}

/** An opaque handle representing a copy pass. Valid only until `SDL_EndGPUCopyPass`. */
export declare class SDL_GPUCopyPass {
    private _opaque: never;
}

/** An opaque handle representing a fence. Released with `SDL_ReleaseGPUFence`. */
export declare class SDL_GPUFence {
    private _opaque: never;
}

// ---------------------------------------------------------------------------
// Enums.
// ---------------------------------------------------------------------------

/** Specifies the primitive topology of a graphics pipeline. */
export enum SDL_GPUPrimitiveType {
    /** A series of separate triangles. */
    TRIANGLELIST,
    /** A series of connected triangles. */
    TRIANGLESTRIP,
    /** A series of separate lines. */
    LINELIST,
    /** A series of connected lines. */
    LINESTRIP,
    /** A series of separate points. */
    POINTLIST,
}

export declare namespace SDL_GPUPrimitiveType {
    type Underlying = i32;
}

/** How the contents of a texture are treated at the beginning of a render pass. */
export enum SDL_GPULoadOp {
    /** The previous contents of the texture will be preserved. */
    LOAD,
    /** The contents of the texture will be cleared to a colour. */
    CLEAR,
    /** The previous contents will be undefined — the fastest, when you overwrite everything. */
    DONT_CARE,
}

export declare namespace SDL_GPULoadOp {
    type Underlying = i32;
}

/** How the contents of a texture are treated at the end of a render pass. */
export enum SDL_GPUStoreOp {
    /** The contents generated during the pass will be written to memory. */
    STORE,
    /** The contents will be left undefined. */
    DONT_CARE,
    /** The multisample contents resolve to a texture; the multisample texture is left undefined. */
    RESOLVE,
    /** The multisample contents resolve to a texture, and the multisample texture is kept too. */
    RESOLVE_AND_STORE,
}

export declare namespace SDL_GPUStoreOp {
    type Underlying = i32;
}

/** The size of elements in an index buffer. */
export enum SDL_GPUIndexElementSize {
    /** The index elements are 16-bit. */
    _16BIT,
    /** The index elements are 32-bit. */
    _32BIT,
}

export declare namespace SDL_GPUIndexElementSize {
    type Underlying = i32;
}

/**
 * The pixel format of a texture.
 *
 * Not every format is supported everywhere — ask
 * `SDL_GPUTextureSupportsFormat` before relying on one.
 */
export enum SDL_GPUTextureFormat {
    INVALID,

    // Unsigned normalized float colour formats.
    A8_UNORM,
    R8_UNORM,
    R8G8_UNORM,
    R8G8B8A8_UNORM,
    R16_UNORM,
    R16G16_UNORM,
    R16G16B16A16_UNORM,
    R10G10B10A2_UNORM,
    B5G6R5_UNORM,
    B5G5R5A1_UNORM,
    B4G4R4A4_UNORM,
    B8G8R8A8_UNORM,

    // Compressed unsigned normalized float colour formats.
    BC1_RGBA_UNORM,
    BC2_RGBA_UNORM,
    BC3_RGBA_UNORM,
    BC4_R_UNORM,
    BC5_RG_UNORM,
    BC7_RGBA_UNORM,

    // Compressed signed float colour formats.
    BC6H_RGB_FLOAT,
    BC6H_RGB_UFLOAT,

    // Signed normalized float colour formats.
    R8_SNORM,
    R8G8_SNORM,
    R8G8B8A8_SNORM,
    R16_SNORM,
    R16G16_SNORM,
    R16G16B16A16_SNORM,

    // Signed float colour formats.
    R16_FLOAT,
    R16G16_FLOAT,
    R16G16B16A16_FLOAT,
    R32_FLOAT,
    R32G32_FLOAT,
    R32G32B32A32_FLOAT,

    // Unsigned float colour formats.
    R11G11B10_UFLOAT,

    // Unsigned integer colour formats.
    R8_UINT,
    R8G8_UINT,
    R8G8B8A8_UINT,
    R16_UINT,
    R16G16_UINT,
    R16G16B16A16_UINT,
    R32_UINT,
    R32G32_UINT,
    R32G32B32A32_UINT,

    // Signed integer colour formats.
    R8_INT,
    R8G8_INT,
    R8G8B8A8_INT,
    R16_INT,
    R16G16_INT,
    R16G16B16A16_INT,
    R32_INT,
    R32G32_INT,
    R32G32B32A32_INT,

    // SRGB unsigned normalized colour formats.
    R8G8B8A8_UNORM_SRGB,
    B8G8R8A8_UNORM_SRGB,

    // Compressed SRGB unsigned normalized colour formats.
    BC1_RGBA_UNORM_SRGB,
    BC2_RGBA_UNORM_SRGB,
    BC3_RGBA_UNORM_SRGB,
    BC7_RGBA_UNORM_SRGB,

    // Depth formats.
    D16_UNORM,
    D24_UNORM,
    D32_FLOAT,
    D24_UNORM_S8_UINT,
    D32_FLOAT_S8_UINT,

    // Compressed ASTC normalized float colour formats.
    ASTC_4x4_UNORM,
    ASTC_5x4_UNORM,
    ASTC_5x5_UNORM,
    ASTC_6x5_UNORM,
    ASTC_6x6_UNORM,
    ASTC_8x5_UNORM,
    ASTC_8x6_UNORM,
    ASTC_8x8_UNORM,
    ASTC_10x5_UNORM,
    ASTC_10x6_UNORM,
    ASTC_10x8_UNORM,
    ASTC_10x10_UNORM,
    ASTC_12x10_UNORM,
    ASTC_12x12_UNORM,

    // Compressed SRGB ASTC normalized float colour formats.
    ASTC_4x4_UNORM_SRGB,
    ASTC_5x4_UNORM_SRGB,
    ASTC_5x5_UNORM_SRGB,
    ASTC_6x5_UNORM_SRGB,
    ASTC_6x6_UNORM_SRGB,
    ASTC_8x5_UNORM_SRGB,
    ASTC_8x6_UNORM_SRGB,
    ASTC_8x8_UNORM_SRGB,
    ASTC_10x5_UNORM_SRGB,
    ASTC_10x6_UNORM_SRGB,
    ASTC_10x8_UNORM_SRGB,
    ASTC_10x10_UNORM_SRGB,
    ASTC_12x10_UNORM_SRGB,
    ASTC_12x12_UNORM_SRGB,

    // Compressed ASTC signed float colour formats.
    ASTC_4x4_FLOAT,
    ASTC_5x4_FLOAT,
    ASTC_5x5_FLOAT,
    ASTC_6x5_FLOAT,
    ASTC_6x6_FLOAT,
    ASTC_8x5_FLOAT,
    ASTC_8x6_FLOAT,
    ASTC_8x8_FLOAT,
    ASTC_10x5_FLOAT,
    ASTC_10x6_FLOAT,
    ASTC_10x8_FLOAT,
    ASTC_10x10_FLOAT,
    ASTC_12x10_FLOAT,
    ASTC_12x12_FLOAT,
}

export declare namespace SDL_GPUTextureFormat {
    type Underlying = i32;
}

/** How a texture is intended to be used. Declared at creation and enforced afterwards. */
export enum SDL_GPUTextureUsageFlags {
    NONE = 0x00000000,
    /** Texture supports sampling. */
    SAMPLER = 0x00000001,
    /** Texture is a colour render target. */
    COLOR_TARGET = 0x00000002,
    /** Texture is a depth-stencil target. */
    DEPTH_STENCIL_TARGET = 0x00000004,
    /** Texture supports storage reads in graphics stages. */
    GRAPHICS_STORAGE_READ = 0x00000008,
    /** Texture supports storage reads in the compute stage. */
    COMPUTE_STORAGE_READ = 0x00000010,
    /** Texture supports storage writes in the compute stage. */
    COMPUTE_STORAGE_WRITE = 0x00000020,
    /** Reads and writes in the same compute shader. NOT equivalent to READ | WRITE. */
    COMPUTE_STORAGE_SIMULTANEOUS_READ_WRITE = 0x00000040,
}

export declare namespace SDL_GPUTextureUsageFlags {
    type Underlying = u32;
}

/** The type of a texture. */
export enum SDL_GPUTextureType {
    /** The texture is a 2-dimensional image. */
    _2D,
    /** The texture is a 2-dimensional array image. */
    _2D_ARRAY,
    /** The texture is a 3-dimensional image. */
    _3D,
    /** The texture is a cube image. */
    CUBE,
    /** The texture is a cube array image. */
    CUBE_ARRAY,
}

export declare namespace SDL_GPUTextureType {
    type Underlying = i32;
}

/** The sample count of a texture. Anything above `_1` is multisampling. */
export enum SDL_GPUSampleCount {
    /** No multisampling. */
    _1,
    /** MSAA 2x */
    _2,
    /** MSAA 4x */
    _4,
    /** MSAA 8x */
    _8,
}

export declare namespace SDL_GPUSampleCount {
    type Underlying = i32;
}

/** The face of a cube map. These are laid out in the order given here. */
export enum SDL_GPUCubeMapFace {
    POSITIVEX,
    NEGATIVEX,
    POSITIVEY,
    NEGATIVEY,
    POSITIVEZ,
    NEGATIVEZ,
}

export declare namespace SDL_GPUCubeMapFace {
    type Underlying = i32;
}

/** How a buffer is intended to be used. Declared at creation and enforced afterwards. */
export enum SDL_GPUBufferUsageFlags {
    NONE = 0x00000000,
    /** Buffer is a vertex buffer. */
    VERTEX = 0x00000001,
    /** Buffer is an index buffer. */
    INDEX = 0x00000002,
    /** Buffer is an indirect buffer. */
    INDIRECT = 0x00000004,
    /** Buffer supports storage reads in graphics stages. */
    GRAPHICS_STORAGE_READ = 0x00000008,
    /** Buffer supports storage reads in the compute stage. */
    COMPUTE_STORAGE_READ = 0x00000010,
    /** Buffer supports storage writes in the compute stage. */
    COMPUTE_STORAGE_WRITE = 0x00000020,
}

export declare namespace SDL_GPUBufferUsageFlags {
    type Underlying = u32;
}

/** Which way a transfer buffer moves data. */
export enum SDL_GPUTransferBufferUsage {
    UPLOAD,
    DOWNLOAD,
}

export declare namespace SDL_GPUTransferBufferUsage {
    type Underlying = i32;
}

/** Which stage a shader program corresponds to. */
export enum SDL_GPUShaderStage {
    VERTEX,
    FRAGMENT,
}

export declare namespace SDL_GPUShaderStage {
    type Underlying = i32;
}

/**
 * The format of shader code a device accepts.
 *
 * A device accepts one or two of these and no others, which is why shipping a
 * program means shipping every variant its target platforms need. Ask
 * `SDL_GetGPUShaderFormats`.
 */
export enum SDL_GPUShaderFormat {
    INVALID = 0x00000000,
    /** Shaders for NDA'd platforms. */
    PRIVATE = 0x00000001,
    /** SPIR-V shaders for Vulkan. */
    SPIRV = 0x00000002,
    /** DXBC SM5_1 shaders for D3D12. */
    DXBC = 0x00000004,
    /** DXIL SM6_0 shaders for D3D12. */
    DXIL = 0x00000008,
    /** MSL shaders for Metal. */
    MSL = 0x00000010,
    /** Precompiled metallib shaders for Metal. */
    METALLIB = 0x00000020,
}

export declare namespace SDL_GPUShaderFormat {
    type Underlying = u32;
}

/** The format of a vertex attribute. */
export enum SDL_GPUVertexElementFormat {
    INVALID,

    // 32-bit signed integers.
    INT,
    INT2,
    INT3,
    INT4,

    // 32-bit unsigned integers.
    UINT,
    UINT2,
    UINT3,
    UINT4,

    // 32-bit floats.
    FLOAT,
    FLOAT2,
    FLOAT3,
    FLOAT4,

    // 8-bit signed integers.
    BYTE2,
    BYTE4,

    // 8-bit unsigned integers.
    UBYTE2,
    UBYTE4,

    // 8-bit signed normalized.
    BYTE2_NORM,
    BYTE4_NORM,

    // 8-bit unsigned normalized.
    UBYTE2_NORM,
    UBYTE4_NORM,

    // 16-bit signed integers.
    SHORT2,
    SHORT4,

    // 16-bit unsigned integers.
    USHORT2,
    USHORT4,

    // 16-bit signed normalized.
    SHORT2_NORM,
    SHORT4_NORM,

    // 16-bit unsigned normalized.
    USHORT2_NORM,
    USHORT4_NORM,

    // 16-bit floats.
    HALF2,
    HALF4,
}

export declare namespace SDL_GPUVertexElementFormat {
    type Underlying = i32;
}

/** Whether a vertex buffer advances per vertex or per instance. */
export enum SDL_GPUVertexInputRate {
    /** Attribute addressing is a function of the vertex index. */
    VERTEX,
    /** Attribute addressing is a function of the instance index. */
    INSTANCE,
}

export declare namespace SDL_GPUVertexInputRate {
    type Underlying = i32;
}

/** The fill mode of the graphics pipeline. */
export enum SDL_GPUFillMode {
    /** Polygons will be rendered via rasterization. */
    FILL,
    /** Polygon edges will be drawn as line segments. */
    LINE,
}

export declare namespace SDL_GPUFillMode {
    type Underlying = i32;
}

/** The facing direction in which triangles are culled. */
export enum SDL_GPUCullMode {
    /** No triangles are culled. */
    NONE,
    /** Front-facing triangles are culled. */
    FRONT,
    /** Back-facing triangles are culled. */
    BACK,
}

export declare namespace SDL_GPUCullMode {
    type Underlying = i32;
}

/** The vertex winding that will cause a triangle to be determined as front-facing. */
export enum SDL_GPUFrontFace {
    /** A triangle with counter-clockwise vertex winding will be considered front-facing. */
    COUNTER_CLOCKWISE,
    /** A triangle with clockwise vertex winding will be considered front-facing. */
    CLOCKWISE,
}

export declare namespace SDL_GPUFrontFace {
    type Underlying = i32;
}

/** A comparison operator for depth, stencil and sampler operations. */
export enum SDL_GPUCompareOp {
    INVALID,
    /** The comparison always evaluates false. */
    NEVER,
    /** The comparison evaluates reference < test. */
    LESS,
    /** The comparison evaluates reference == test. */
    EQUAL,
    /** The comparison evaluates reference <= test. */
    LESS_OR_EQUAL,
    /** The comparison evaluates reference > test. */
    GREATER,
    /** The comparison evaluates reference != test. */
    NOT_EQUAL,
    /** The comparison evaluates reference >= test. */
    GREATER_OR_EQUAL,
    /** The comparison always evaluates true. */
    ALWAYS,
}

export declare namespace SDL_GPUCompareOp {
    type Underlying = i32;
}

/** What happens to a stencil value. */
export enum SDL_GPUStencilOp {
    INVALID,
    /** Keeps the current value. */
    KEEP,
    /** Sets the value to 0. */
    ZERO,
    /** Sets the value to reference. */
    REPLACE,
    /** Increments the current value and clamps to the maximum value. */
    INCREMENT_AND_CLAMP,
    /** Decrements the current value and clamps to 0. */
    DECREMENT_AND_CLAMP,
    /** Bitwise-inverts the current value. */
    INVERT,
    /** Increments the current value and wraps back to 0. */
    INCREMENT_AND_WRAP,
    /** Decrements the current value and wraps to the maximum value. */
    DECREMENT_AND_WRAP,
}

export declare namespace SDL_GPUStencilOp {
    type Underlying = i32;
}

/** The operator to be used when pixels in a render target are blended with existing pixels. */
export enum SDL_GPUBlendOp {
    INVALID,
    /** (source * source_factor) + (destination * destination_factor) */
    ADD,
    /** (source * source_factor) - (destination * destination_factor) */
    SUBTRACT,
    /** (destination * destination_factor) - (source * source_factor) */
    REVERSE_SUBTRACT,
    /** min(source, destination) */
    MIN,
    /** max(source, destination) */
    MAX,
}

export declare namespace SDL_GPUBlendOp {
    type Underlying = i32;
}

/** A blending factor to be used when pixels in a render target are blended. */
export enum SDL_GPUBlendFactor {
    INVALID,
    /** 0 */
    ZERO,
    /** 1 */
    ONE,
    /** source colour */
    SRC_COLOR,
    /** 1 - source colour */
    ONE_MINUS_SRC_COLOR,
    /** destination colour */
    DST_COLOR,
    /** 1 - destination colour */
    ONE_MINUS_DST_COLOR,
    /** source alpha */
    SRC_ALPHA,
    /** 1 - source alpha */
    ONE_MINUS_SRC_ALPHA,
    /** destination alpha */
    DST_ALPHA,
    /** 1 - destination alpha */
    ONE_MINUS_DST_ALPHA,
    /** the constant colour set with `SDL_SetGPUBlendConstants` */
    CONSTANT_COLOR,
    /** 1 - that constant colour */
    ONE_MINUS_CONSTANT_COLOR,
    /** min(source alpha, 1 - destination alpha) */
    SRC_ALPHA_SATURATE,
}

export declare namespace SDL_GPUBlendFactor {
    type Underlying = i32;
}

/** Which colour channels a pipeline writes to. */
export enum SDL_GPUColorComponentFlags {
    NONE = 0x00,
    /** The red component. */
    R = 0x01,
    /** The green component. */
    G = 0x02,
    /** The blue component. */
    B = 0x04,
    /** The alpha component. */
    A = 0x08,
}

export declare namespace SDL_GPUColorComponentFlags {
    type Underlying = u8;
}

/** A sampler filter. */
export enum SDL_GPUFilter {
    /** Point filtering. */
    NEAREST,
    /** Linear filtering. */
    LINEAR,
}

export declare namespace SDL_GPUFilter {
    type Underlying = i32;
}

/** A sampler mipmap mode. */
export enum SDL_GPUSamplerMipmapMode {
    /** Point filtering. */
    NEAREST,
    /** Linear filtering. */
    LINEAR,
}

export declare namespace SDL_GPUSamplerMipmapMode {
    type Underlying = i32;
}

/** What happens when a coordinate falls outside [0, 1]. */
export enum SDL_GPUSamplerAddressMode {
    /** Specifies that the coordinate will wrap around. */
    REPEAT,
    /** Specifies that the coordinate will wrap around mirrored. */
    MIRRORED_REPEAT,
    /** Specifies that the coordinate will be clamped to the edge. */
    CLAMP_TO_EDGE,
}

export declare namespace SDL_GPUSamplerAddressMode {
    type Underlying = i32;
}

/**
 * How the swapchain hands frames to the display.
 *
 * `VSYNC` is the only one guaranteed to be supported. Check the others with
 * `SDL_WindowSupportsGPUPresentMode` before asking for them.
 */
export enum SDL_GPUPresentMode {
    /** Waits for vblank. No tearing; may block. */
    VSYNC,
    /** Immediate. Tearing is possible. */
    IMMEDIATE,
    /** Waits for vblank, replacing any frame already queued. No tearing, no block. */
    MAILBOX,
}

export declare namespace SDL_GPUPresentMode {
    type Underlying = i32;
}

/**
 * The colour space of a swapchain texture.
 *
 * `SDR` is the only one guaranteed to be supported. Check the others with
 * `SDL_WindowSupportsGPUSwapchainComposition`.
 */
export enum SDL_GPUSwapchainComposition {
    /** B8G8R8A8 or R8G8B8A8 non-linear SDR. */
    SDR,
    /** B8G8R8A8_SRGB or R8G8B8A8_SRGB; linear SDR, converted to non-linear on present. */
    SDR_LINEAR,
    /** R16G16B16A16_FLOAT; extended linear HDR, converted to the display's colour space. */
    HDR_EXTENDED_LINEAR,
    /** A2B10G10R10 or A2R10G10B10; PQ HDR. */
    HDR10_ST2084,
}

export declare namespace SDL_GPUSwapchainComposition {
    type Underlying = i32;
}

// ---------------------------------------------------------------------------
// Structures.
//
// Every one of these that ends in `CreateInfo` is meant to be zeroed and then
// filled in: SDL's own examples memset them, and the defaults are chosen so
// that zero means "the ordinary thing".
//
// `alloc<T>({ … })` is that in one expression — it zeroes what the initialiser
// does not name, and reaches nested structs, so only the fields that differ
// from the default need writing:
//
//     const info = alloc<SDL_GPUColorTargetInfo>({
//         texture: offscreen,
//         clear_color: { r: 0.07, g: 0.09, b: 0.13, a: 1.0 },
//         load_op: SDL_GPULoadOp.CLEAR,
//         store_op: SDL_GPUStoreOp.STORE,
//     });
//     const pass = SDL_BeginGPURenderPass(cmd, info, 1, null);
//     info.free();
// ---------------------------------------------------------------------------

/** A viewport. Depth runs from `min_depth` to `max_depth`, both usually 0 and 1. */
export interface SDL_GPUViewport {
    /** The left offset of the viewport. */
    x: f32;
    /** The top offset of the viewport. */
    y: f32;
    /** The width of the viewport. */
    w: f32;
    /** The height of the viewport. */
    h: f32;
    /** The start of the viewport's depth range. */
    min_depth: f32;
    /** The end of the viewport's depth range. */
    max_depth: f32;
}

/** A location in a transfer buffer used for transferring texture data. */
export interface SDL_GPUTextureTransferInfo {
    /** The transfer buffer used in the transfer operation. */
    transfer_buffer: Pointer<SDL_GPUTransferBuffer> | null;
    /** The starting byte of the image data in the transfer buffer. */
    offset: u32;
    /** The number of pixels from one row to the next. 0 means tightly packed. */
    pixels_per_row: u32;
    /** The number of rows from one layer or depth slice to the next. 0 means tightly packed. */
    rows_per_layer: u32;
}

/** A location in a transfer buffer. Used when transferring buffer data to or from a transfer buffer. */
export interface SDL_GPUTransferBufferLocation {
    /** The transfer buffer used in the transfer operation. */
    transfer_buffer: Pointer<SDL_GPUTransferBuffer> | null;
    /** The starting byte of the buffer data in the transfer buffer. */
    offset: u32;
}

/** A location in a texture. Used when copying data from one texture to another. */
export interface SDL_GPUTextureLocation {
    /** The texture used in the copy operation. */
    texture: Pointer<SDL_GPUTexture> | null;
    /** The mip level index of the location. */
    mip_level: u32;
    /** The layer index of the location. */
    layer: u32;
    /** The left offset of the location. */
    x: u32;
    /** The top offset of the location. */
    y: u32;
    /** The front offset of the location. */
    z: u32;
}

/** A region of a texture. Used when transferring data to or from a texture. */
export interface SDL_GPUTextureRegion {
    /** The texture used in the copy operation. */
    texture: Pointer<SDL_GPUTexture> | null;
    /** The mip level index to transfer. */
    mip_level: u32;
    /** The layer index to transfer. */
    layer: u32;
    /** The left offset of the region. */
    x: u32;
    /** The top offset of the region. */
    y: u32;
    /** The front offset of the region. */
    z: u32;
    /** The width of the region. */
    w: u32;
    /** The height of the region. */
    h: u32;
    /** The depth of the region. */
    d: u32;
}

/** A region of a texture used in a blit operation. */
export interface SDL_GPUBlitRegion {
    /** The texture. */
    texture: Pointer<SDL_GPUTexture> | null;
    /** The mip level index of the region. */
    mip_level: u32;
    /** The layer index or depth plane of the region — depends on the texture type. */
    layer_or_depth_plane: u32;
    /** The left offset of the region. */
    x: u32;
    /** The top offset of the region. */
    y: u32;
    /** The width of the region. */
    w: u32;
    /** The height of the region. */
    h: u32;
}

/** A location in a buffer. Used when copying data between buffers. */
export interface SDL_GPUBufferLocation {
    /** The buffer. */
    buffer: Pointer<SDL_GPUBuffer> | null;
    /** The starting byte within the buffer. */
    offset: u32;
}

/** A region of a buffer. Used when transferring data to or from buffers. */
export interface SDL_GPUBufferRegion {
    /** The buffer. */
    buffer: Pointer<SDL_GPUBuffer> | null;
    /** The starting byte within the buffer. */
    offset: u32;
    /** The size in bytes of the region. */
    size: u32;
}

/**
 * The arguments an indirect draw reads out of a buffer.
 *
 * The `first_instance` field is only honoured where
 * `"SDL.gpu.device.create.feature.indirect_draw_first_instance"` is available.
 */
export interface SDL_GPUIndirectDrawCommand {
    /** The number of vertices to draw. */
    num_vertices: u32;
    /** The number of instances to draw. */
    num_instances: u32;
    /** The index of the first vertex to draw. */
    first_vertex: u32;
    /** The ID of the first instance to draw. */
    first_instance: u32;
}

/** The arguments an indexed indirect draw reads out of a buffer. */
export interface SDL_GPUIndexedIndirectDrawCommand {
    /** The number of indices to draw per instance. */
    num_indices: u32;
    /** The number of instances to draw. */
    num_instances: u32;
    /** The base index within the index buffer. */
    first_index: u32;
    /** The value added to the vertex index before indexing into the vertex buffer. */
    vertex_offset: i32;
    /** The ID of the first instance to draw. */
    first_instance: u32;
}

/** The arguments an indirect dispatch reads out of a buffer. */
export interface SDL_GPUIndirectDispatchCommand {
    /** The number of local workgroups to dispatch in the X dimension. */
    groupcount_x: u32;
    /** The number of local workgroups to dispatch in the Y dimension. */
    groupcount_y: u32;
    /** The number of local workgroups to dispatch in the Z dimension. */
    groupcount_z: u32;
}

/** A sampler. */
export interface SDL_GPUSamplerCreateInfo {
    /** The minification filter to apply to lookups. */
    min_filter: SDL_GPUFilter;
    /** The magnification filter to apply to lookups. */
    mag_filter: SDL_GPUFilter;
    /** The mipmap filter to apply to lookups. */
    mipmap_mode: SDL_GPUSamplerMipmapMode;
    /** The addressing mode for U coordinates outside [0, 1). */
    address_mode_u: SDL_GPUSamplerAddressMode;
    /** The addressing mode for V coordinates outside [0, 1). */
    address_mode_v: SDL_GPUSamplerAddressMode;
    /** The addressing mode for W coordinates outside [0, 1). */
    address_mode_w: SDL_GPUSamplerAddressMode;
    /** The bias to be added to mipmap LOD calculation. */
    mip_lod_bias: f32;
    /** The anisotropy value clamp used by the sampler. Ignored unless `enable_anisotropy`. */
    max_anisotropy: f32;
    /** The comparison operator to apply to fetched data before filtering. */
    compare_op: SDL_GPUCompareOp;
    /** Clamps the minimum of the computed LOD value. */
    min_lod: f32;
    /** Clamps the maximum of the computed LOD value. */
    max_lod: f32;
    /** True to enable anisotropic filtering. */
    enable_anisotropy: boolean;
    /** True to enable comparison against a reference value during lookups. */
    enable_compare: boolean;
    padding1: u8;
    padding2: u8;
    /** A property group for extensions. Should be 0 if no extensions are needed. */
    props: SDL_PropertiesID;
}

/** A vertex buffer slot and its stride. */
export interface SDL_GPUVertexBufferDescription {
    /** The binding slot of the vertex buffer. */
    slot: u32;
    /** The byte pitch between consecutive elements of the vertex buffer. */
    pitch: u32;
    /** Whether attribute addressing is a function of the vertex or instance index. */
    input_rate: SDL_GPUVertexInputRate;
    /** Instances to draw with the same per-instance data before advancing. Must be 0 for VERTEX rate. */
    instance_step_rate: u32;
}

/** One vertex attribute, as the shader sees it. */
export interface SDL_GPUVertexAttribute {
    /** The shader input location index. */
    location: u32;
    /** The binding slot of the associated vertex buffer. */
    buffer_slot: u32;
    /** The size and type of the attribute data. */
    format: SDL_GPUVertexElementFormat;
    /** The byte offset of this attribute relative to the start of the vertex element. */
    offset: u32;
}

/** The parameters of a graphics pipeline's vertex input state. */
export interface SDL_GPUVertexInputState {
    /** A pointer to an array of vertex buffer descriptions. */
    vertex_buffer_descriptions: Pointer<SDL_GPUVertexBufferDescription> | null;
    /** The number of vertex buffer descriptions in the above array. */
    num_vertex_buffers: u32;
    /** A pointer to an array of vertex attribute descriptions. */
    vertex_attributes: Pointer<SDL_GPUVertexAttribute> | null;
    /** The number of vertex attribute descriptions in the above array. */
    num_vertex_attributes: u32;
}

/** The stencil operation state of a graphics pipeline. */
export interface SDL_GPUStencilOpState {
    /** The action performed on samples that fail the stencil test. */
    fail_op: SDL_GPUStencilOp;
    /** The action performed on samples that pass the depth and stencil tests. */
    pass_op: SDL_GPUStencilOp;
    /** The action performed on samples that pass the stencil test and fail the depth test. */
    depth_fail_op: SDL_GPUStencilOp;
    /** The comparison operator used in the stencil test. */
    compare_op: SDL_GPUCompareOp;
}

/** The blend state of a colour target. */
export interface SDL_GPUColorTargetBlendState {
    /** The value multiplied by the source RGB value. */
    src_color_blendfactor: SDL_GPUBlendFactor;
    /** The value multiplied by the destination RGB value. */
    dst_color_blendfactor: SDL_GPUBlendFactor;
    /** The blend operation for the RGB components. */
    color_blend_op: SDL_GPUBlendOp;
    /** The value multiplied by the source alpha. */
    src_alpha_blendfactor: SDL_GPUBlendFactor;
    /** The value multiplied by the destination alpha. */
    dst_alpha_blendfactor: SDL_GPUBlendFactor;
    /** The blend operation for the alpha component. */
    alpha_blend_op: SDL_GPUBlendOp;
    /** Which RGBA components are enabled for writing. All of them if `enable_color_write_mask` is false. */
    color_write_mask: SDL_GPUColorComponentFlags;
    /** Whether blending is enabled for the colour target. */
    enable_blend: boolean;
    /** Whether the colour write mask is enabled. */
    enable_color_write_mask: boolean;
    padding1: u8;
    padding2: u8;
}

/**
 * A shader.
 *
 * The resource counts are how many of each binding the shader declares, and
 * they have to be right — SDL cannot read them out of every bytecode format,
 * and getting one wrong is a driver-level crash rather than an SDL error.
 */
export interface SDL_GPUShaderCreateInfo {
    /** The size in bytes of the code pointed to. */
    code_size: usize;
    /** A pointer to shader code. */
    code: Pointer<u8> | null;
    /** A pointer to a NUL-terminated UTF-8 string specifying the entry point function name. */
    entrypoint: CString | null;
    /** The format of the shader code. */
    format: SDL_GPUShaderFormat;
    /** The stage the shader program corresponds to. */
    stage: SDL_GPUShaderStage;
    /** The number of samplers defined in the shader. */
    num_samplers: u32;
    /** The number of storage textures defined in the shader. */
    num_storage_textures: u32;
    /** The number of storage buffers defined in the shader. */
    num_storage_buffers: u32;
    /** The number of uniform buffers defined in the shader. */
    num_uniform_buffers: u32;
    /** A property group for extensions. Should be 0 if no extensions are needed. */
    props: SDL_PropertiesID;
}

/** A texture. */
export interface SDL_GPUTextureCreateInfo {
    /** The base dimensionality of the texture. */
    type: SDL_GPUTextureType;
    /** The pixel format of the texture. */
    format: SDL_GPUTextureFormat;
    /** How the texture is intended to be used by the client. */
    usage: SDL_GPUTextureUsageFlags;
    /** The width of the texture. */
    width: u32;
    /** The height of the texture. */
    height: u32;
    /** The layer count or depth of the texture — depends on the texture type. */
    layer_count_or_depth: u32;
    /** The number of mip levels in the texture. */
    num_levels: u32;
    /** The number of samples per texel. Only applies if the texture is used as a render target. */
    sample_count: SDL_GPUSampleCount;
    /**
     * A property group for extensions. Should be 0 if no extensions are needed.
     *
     * D3D12 takes clear-value hints here: `"SDL.gpu.texture.create.d3d12.clear.r"`
     * through `.a`, `.depth` and `.stencil`. A name for the debug layer goes in
     * `"SDL.gpu.texture.create.name"`.
     */
    props: SDL_PropertiesID;
}

/** A buffer. */
export interface SDL_GPUBufferCreateInfo {
    /** How the buffer is intended to be used by the client. */
    usage: SDL_GPUBufferUsageFlags;
    /** The size in bytes of the buffer. */
    size: u32;
    /** A property group for extensions. `"SDL.gpu.buffer.create.name"` names it for the debug layer. */
    props: SDL_PropertiesID;
}

/** A transfer buffer. */
export interface SDL_GPUTransferBufferCreateInfo {
    /** How the transfer buffer is intended to be used by the client. */
    usage: SDL_GPUTransferBufferUsage;
    /** The size in bytes of the transfer buffer. */
    size: u32;
    /** A property group for extensions. `"SDL.gpu.transferbuffer.create.name"` names it. */
    props: SDL_PropertiesID;
}

/** The rasterizer state of a graphics pipeline. */
export interface SDL_GPURasterizerState {
    /** Whether polygons will be filled in or drawn as lines. */
    fill_mode: SDL_GPUFillMode;
    /** The facing direction in which triangles will be culled. */
    cull_mode: SDL_GPUCullMode;
    /** The vertex winding that will cause a triangle to be determined as front-facing. */
    front_face: SDL_GPUFrontFace;
    /** A scalar factor controlling the depth value added to each fragment. */
    depth_bias_constant_factor: f32;
    /** The maximum depth bias of a fragment. */
    depth_bias_clamp: f32;
    /** A scalar factor applied to a fragment's slope in depth calculations. */
    depth_bias_slope_factor: f32;
    /** True to bias fragment depth values. */
    enable_depth_bias: boolean;
    /** True to enable depth clip, false to enable depth clamp. */
    enable_depth_clip: boolean;
    padding1: u8;
    padding2: u8;
}

/** The multisample state of a graphics pipeline. */
export interface SDL_GPUMultisampleState {
    /** The number of samples to be used in rasterization. */
    sample_count: SDL_GPUSampleCount;
    /** Determines which samples get updated in the render targets. Treated as 0xFFFFFFFF if `enable_mask` is false. */
    sample_mask: u32;
    /** Enables sample masking. */
    enable_mask: boolean;
    /** True to enable alpha-to-coverage. */
    enable_alpha_to_coverage: boolean;
    padding2: u8;
    padding3: u8;
}

/** The depth-stencil state of a graphics pipeline. */
export interface SDL_GPUDepthStencilState {
    /** The comparison operator used for depth testing. */
    compare_op: SDL_GPUCompareOp;
    /** The stencil op state for back-facing triangles. */
    back_stencil_state: SDL_GPUStencilOpState;
    /** The stencil op state for front-facing triangles. */
    front_stencil_state: SDL_GPUStencilOpState;
    /** Selects the bits of the stencil values participating in the stencil test. */
    compare_mask: u8;
    /** Selects the bits of the stencil values updated by the stencil test. */
    write_mask: u8;
    /** True enables the depth test. */
    enable_depth_test: boolean;
    /** True enables depth writes. Depth writes are always disabled when `enable_depth_test` is false. */
    enable_depth_write: boolean;
    /** True enables the stencil test. */
    enable_stencil_test: boolean;
    padding1: u8;
    padding2: u8;
    padding3: u8;
}

/** The parameters of colour targets used in a graphics pipeline. */
export interface SDL_GPUColorTargetDescription {
    /** The pixel format of the texture to be used as a colour target. */
    format: SDL_GPUTextureFormat;
    /** The blend state to be used for the colour target. */
    blend_state: SDL_GPUColorTargetBlendState;
}

/** The descriptions of render targets used in a graphics pipeline. */
export interface SDL_GPUGraphicsPipelineTargetInfo {
    /** A pointer to an array of colour target descriptions. */
    color_target_descriptions: Pointer<SDL_GPUColorTargetDescription> | null;
    /** The number of colour target descriptions in the above array. */
    num_color_targets: u32;
    /** The pixel format of the depth-stencil target. Ignored if `has_depth_stencil_target` is false. */
    depth_stencil_format: SDL_GPUTextureFormat;
    /** True specifies that the pipeline uses a depth-stencil target. */
    has_depth_stencil_target: boolean;
    padding1: u8;
    padding2: u8;
    padding3: u8;
}

/** A graphics pipeline. */
export interface SDL_GPUGraphicsPipelineCreateInfo {
    /** The vertex shader used by the graphics pipeline. */
    vertex_shader: Pointer<SDL_GPUShader> | null;
    /** The fragment shader used by the graphics pipeline. */
    fragment_shader: Pointer<SDL_GPUShader> | null;
    /** The vertex layout of the graphics pipeline. */
    vertex_input_state: SDL_GPUVertexInputState;
    /** The primitive topology of the graphics pipeline. */
    primitive_type: SDL_GPUPrimitiveType;
    /** The rasterizer state of the graphics pipeline. */
    rasterizer_state: SDL_GPURasterizerState;
    /** The multisample state of the graphics pipeline. */
    multisample_state: SDL_GPUMultisampleState;
    /** The depth-stencil state of the graphics pipeline. */
    depth_stencil_state: SDL_GPUDepthStencilState;
    /** Formats and blend modes for the render targets of the graphics pipeline. */
    target_info: SDL_GPUGraphicsPipelineTargetInfo;
    /** A property group for extensions. `"SDL.gpu.graphicspipeline.create.name"` names it. */
    props: SDL_PropertiesID;
}

/** A compute pipeline. */
export interface SDL_GPUComputePipelineCreateInfo {
    /** The size in bytes of the compute shader code pointed to. */
    code_size: usize;
    /** A pointer to compute shader code. */
    code: Pointer<u8> | null;
    /** A pointer to a NUL-terminated UTF-8 string specifying the entry point function name. */
    entrypoint: CString | null;
    /** The format of the compute shader code. */
    format: SDL_GPUShaderFormat;
    /** The number of samplers defined in the shader. */
    num_samplers: u32;
    /** The number of readonly storage textures defined in the shader. */
    num_readonly_storage_textures: u32;
    /** The number of readonly storage buffers defined in the shader. */
    num_readonly_storage_buffers: u32;
    /** The number of read-write storage textures defined in the shader. */
    num_readwrite_storage_textures: u32;
    /** The number of read-write storage buffers defined in the shader. */
    num_readwrite_storage_buffers: u32;
    /** The number of uniform buffers defined in the shader. */
    num_uniform_buffers: u32;
    /** The number of threads in the X dimension. This should match the value in the shader. */
    threadcount_x: u32;
    /** The number of threads in the Y dimension. This should match the value in the shader. */
    threadcount_y: u32;
    /** The number of threads in the Z dimension. This should match the value in the shader. */
    threadcount_z: u32;
    /** A property group for extensions. `"SDL.gpu.computepipeline.create.name"` names it. */
    props: SDL_PropertiesID;
}

/** A colour target used by a render pass. */
export interface SDL_GPUColorTargetInfo {
    /** The texture that will be used as a colour target by a render pass. */
    texture: Pointer<SDL_GPUTexture> | null;
    /** The mip level to use as a colour target. */
    mip_level: u32;
    /** The layer index or depth plane to use as a colour target. */
    layer_or_depth_plane: u32;
    /** The colour to clear the colour target to. Ignored unless `load_op` is CLEAR. */
    clear_color: SDL_FColor;
    /** What is done with the contents of the colour target at the beginning of the pass. */
    load_op: SDL_GPULoadOp;
    /** What is done with the results of the render pass. */
    store_op: SDL_GPUStoreOp;
    /** The texture that will receive the results of a multisample resolve. */
    resolve_texture: Pointer<SDL_GPUTexture> | null;
    /** The mip level of the resolve texture. */
    resolve_mip_level: u32;
    /** The layer index of the resolve texture. */
    resolve_layer: u32;
    /** True cycles the texture if it is already bound, unless `load_op` is LOAD. */
    cycle: boolean;
    /** True cycles the resolve texture if it is already bound. */
    cycle_resolve_texture: boolean;
    padding1: u8;
    padding2: u8;
}

/** A depth-stencil target used by a render pass. */
export interface SDL_GPUDepthStencilTargetInfo {
    /** The texture that will be used as the depth-stencil target by the render pass. */
    texture: Pointer<SDL_GPUTexture> | null;
    /** The value to clear the depth component to. Ignored unless `load_op` is CLEAR. */
    clear_depth: f32;
    /** What is done with the depth contents at the beginning of the pass. */
    load_op: SDL_GPULoadOp;
    /** What is done with the depth results of the render pass. */
    store_op: SDL_GPUStoreOp;
    /** What is done with the stencil contents at the beginning of the pass. */
    stencil_load_op: SDL_GPULoadOp;
    /** What is done with the stencil results of the render pass. */
    stencil_store_op: SDL_GPUStoreOp;
    /** True cycles the texture if it is already bound. */
    cycle: boolean;
    /** The value to clear the stencil component to. Ignored unless `stencil_load_op` is CLEAR. */
    clear_stencil: u8;
    /** The mip level to use as the depth-stencil target. */
    mip_level: u8;
    /** The layer index to use as the depth-stencil target. */
    layer: u8;
}

/** The parameters of a blit command. */
export interface SDL_GPUBlitInfo {
    /** The source region for the blit. */
    source: SDL_GPUBlitRegion;
    /** The destination region for the blit. */
    destination: SDL_GPUBlitRegion;
    /** What is done with the contents of the destination before the blit. */
    load_op: SDL_GPULoadOp;
    /** The colour to clear the destination region to. Ignored unless `load_op` is CLEAR. */
    clear_color: SDL_FColor;
    /** The flip mode for the source region. */
    flip_mode: SDL_FlipMode;
    /** The filter mode used when blitting. */
    filter: SDL_GPUFilter;
    /** True cycles the destination texture if it is already bound. */
    cycle: boolean;
    padding1: u8;
    padding2: u8;
    padding3: u8;
}

/** A vertex or index buffer binding. */
export interface SDL_GPUBufferBinding {
    /** The buffer to bind. Must have been created with VERTEX for `SDL_BindGPUVertexBuffers`, or INDEX for `SDL_BindGPUIndexBuffer`. */
    buffer: Pointer<SDL_GPUBuffer> | null;
    /** The starting byte of the data to bind in the buffer. */
    offset: u32;
}

/** A texture-sampler pair to be used when binding textures in a shader. */
export interface SDL_GPUTextureSamplerBinding {
    /** The texture to bind. Must have been created with the SAMPLER usage flag. */
    texture: Pointer<SDL_GPUTexture> | null;
    /** The sampler to bind. */
    sampler: Pointer<SDL_GPUSampler> | null;
}

/** A buffer binding for a compute pass that will write to it. */
export interface SDL_GPUStorageBufferReadWriteBinding {
    /** The buffer to bind. Must have been created with the COMPUTE_STORAGE_WRITE usage flag. */
    buffer: Pointer<SDL_GPUBuffer> | null;
    /** True cycles the buffer if it is already bound. */
    cycle: boolean;
    padding1: u8;
    padding2: u8;
    padding3: u8;
}

/** A texture binding for a compute pass that will write to it. */
export interface SDL_GPUStorageTextureReadWriteBinding {
    /** The texture to bind. Must have been created with the COMPUTE_STORAGE_WRITE usage flag. */
    texture: Pointer<SDL_GPUTexture> | null;
    /** The mip level index to bind. */
    mip_level: u32;
    /** The layer index to bind. */
    layer: u32;
    /** True cycles the texture if it is already bound. */
    cycle: boolean;
    padding1: u8;
    padding2: u8;
    padding3: u8;
}

/**
 * Vulkan-specific device options, handed in through
 * `"SDL.gpu.device.create.vulkan.options"` as a pointer property.
 *
 * The two `void *` fields are a `VkBaseOutStructure` chain and a
 * `VkPhysicalDeviceFeatures`; this binding has no Vulkan headers, so they stay
 * erased.
 */
export interface SDL_GPUVulkanOptions {
    /** The Vulkan API version to request. */
    vulkan_api_version: u32;
    /** A `VkBaseOutStructure` chain of feature structs. */
    feature_list: Pointer<unknown> | null;
    /** A `VkPhysicalDeviceFeatures`. */
    vulkan_10_physical_device_features: Pointer<unknown> | null;
    /** The number of device extension names. */
    device_extension_count: u32;
    /** An array of device extension names. */
    device_extension_names: Pointer<CString> | null;
    /** The number of instance extension names. */
    instance_extension_count: u32;
    /** An array of instance extension names. */
    instance_extension_names: Pointer<CString> | null;
}

// ---------------------------------------------------------------------------
// Device creation and queries.
// ---------------------------------------------------------------------------

export declare function SDL_GPUSupportsShaderFormats(format_flags: SDL_GPUShaderFormat, name: CString | null): boolean;

export declare function SDL_GPUSupportsProperties(props: SDL_PropertiesID): boolean;

/** `null` for `name` lets SDL choose the backend. */
export declare function SDL_CreateGPUDevice(format_flags: SDL_GPUShaderFormat, debug_mode: boolean, name: CString | null): Pointer<SDL_GPUDevice> | null;

/**
 * Create a device from a property group.
 *
 * The names, as `#define`d string literals in the header:
 *
 *   * `"SDL.gpu.device.create.debugmode"` — boolean
 *   * `"SDL.gpu.device.create.preferlowpower"` — boolean
 *   * `"SDL.gpu.device.create.verbose"` — boolean
 *   * `"SDL.gpu.device.create.name"` — string, the backend to force
 *   * `"SDL.gpu.device.create.feature.clip_distance"` — boolean
 *   * `"SDL.gpu.device.create.feature.depth_clamping"` — boolean
 *   * `"SDL.gpu.device.create.feature.indirect_draw_first_instance"` — boolean
 *   * `"SDL.gpu.device.create.feature.anisotropy"` — boolean
 *   * `"SDL.gpu.device.create.shaders.private"` / `.spirv` / `.dxbc` / `.dxil`
 *     / `.msl` / `.metallib` — booleans
 *   * `"SDL.gpu.device.create.d3d12.allowtier1resourcebinding"` — boolean
 *   * `"SDL.gpu.device.create.d3d12.semantic"` — string
 *   * `"SDL.gpu.device.create.d3d12.agility_sdk_version"` — number
 *   * `"SDL.gpu.device.create.d3d12.agility_sdk_path"` — string
 *   * `"SDL.gpu.device.create.vulkan.requirehardwareacceleration"` — boolean
 *   * `"SDL.gpu.device.create.vulkan.options"` — pointer to an `SDL_GPUVulkanOptions`
 *   * `"SDL.gpu.device.create.metal.allowmacfamily1"` — boolean
 */
export declare function SDL_CreateGPUDeviceWithProperties(props: SDL_PropertiesID): Pointer<SDL_GPUDevice> | null;

export declare function SDL_DestroyGPUDevice(device: Pointer<SDL_GPUDevice>): void;

export declare function SDL_GetNumGPUDrivers(): i32;

export declare function SDL_GetGPUDriver(index: i32): CString | null;

export declare function SDL_GetGPUDeviceDriver(device: Pointer<SDL_GPUDevice>): CString | null;

/** Which shader bytecode formats this device will accept. */
export declare function SDL_GetGPUShaderFormats(device: Pointer<SDL_GPUDevice>): SDL_GPUShaderFormat;

/**
 * The device's property group.
 *
 * `"SDL.gpu.device.name"`, `"SDL.gpu.device.driver_name"`,
 * `"SDL.gpu.device.driver_version"`, `"SDL.gpu.device.driver_info"` — all strings.
 */
export declare function SDL_GetGPUDeviceProperties(device: Pointer<SDL_GPUDevice>): SDL_PropertiesID;

// ---------------------------------------------------------------------------
// Resource creation. Each of these has a matching SDL_Release… below.
// ---------------------------------------------------------------------------

export declare function SDL_CreateGPUComputePipeline(
    device: Pointer<SDL_GPUDevice>,
    createinfo: Pointer<SDL_GPUComputePipelineCreateInfo>,
): Pointer<SDL_GPUComputePipeline> | null;

export declare function SDL_CreateGPUGraphicsPipeline(
    device: Pointer<SDL_GPUDevice>,
    createinfo: Pointer<SDL_GPUGraphicsPipelineCreateInfo>,
): Pointer<SDL_GPUGraphicsPipeline> | null;

export declare function SDL_CreateGPUSampler(device: Pointer<SDL_GPUDevice>, createinfo: Pointer<SDL_GPUSamplerCreateInfo>): Pointer<SDL_GPUSampler> | null;

export declare function SDL_CreateGPUShader(device: Pointer<SDL_GPUDevice>, createinfo: Pointer<SDL_GPUShaderCreateInfo>): Pointer<SDL_GPUShader> | null;

export declare function SDL_CreateGPUTexture(device: Pointer<SDL_GPUDevice>, createinfo: Pointer<SDL_GPUTextureCreateInfo>): Pointer<SDL_GPUTexture> | null;

export declare function SDL_CreateGPUBuffer(device: Pointer<SDL_GPUDevice>, createinfo: Pointer<SDL_GPUBufferCreateInfo>): Pointer<SDL_GPUBuffer> | null;

export declare function SDL_CreateGPUTransferBuffer(
    device: Pointer<SDL_GPUDevice>,
    createinfo: Pointer<SDL_GPUTransferBufferCreateInfo>,
): Pointer<SDL_GPUTransferBuffer> | null;

/** Only takes effect when the device was created in debug mode. */
export declare function SDL_SetGPUBufferName(device: Pointer<SDL_GPUDevice>, buffer: Pointer<SDL_GPUBuffer>, text: CString): void;

/** Only takes effect when the device was created in debug mode. */
export declare function SDL_SetGPUTextureName(device: Pointer<SDL_GPUDevice>, texture: Pointer<SDL_GPUTexture>, text: CString): void;

/**
 * Release is *deferred*: the resource is destroyed once no pending command
 * buffer still refers to it, so it is safe to call while frames are in flight.
 */
export declare function SDL_ReleaseGPUTexture(device: Pointer<SDL_GPUDevice>, texture: Pointer<SDL_GPUTexture>): void;

export declare function SDL_ReleaseGPUSampler(device: Pointer<SDL_GPUDevice>, sampler: Pointer<SDL_GPUSampler>): void;

export declare function SDL_ReleaseGPUBuffer(device: Pointer<SDL_GPUDevice>, buffer: Pointer<SDL_GPUBuffer>): void;

export declare function SDL_ReleaseGPUTransferBuffer(device: Pointer<SDL_GPUDevice>, transfer_buffer: Pointer<SDL_GPUTransferBuffer>): void;

export declare function SDL_ReleaseGPUComputePipeline(device: Pointer<SDL_GPUDevice>, compute_pipeline: Pointer<SDL_GPUComputePipeline>): void;

export declare function SDL_ReleaseGPUShader(device: Pointer<SDL_GPUDevice>, shader: Pointer<SDL_GPUShader>): void;

export declare function SDL_ReleaseGPUGraphicsPipeline(device: Pointer<SDL_GPUDevice>, graphics_pipeline: Pointer<SDL_GPUGraphicsPipeline>): void;

// ---------------------------------------------------------------------------
// Command buffers.
// ---------------------------------------------------------------------------

/** Record on the thread that acquired it, and only until it is submitted. */
export declare function SDL_AcquireGPUCommandBuffer(device: Pointer<SDL_GPUDevice>): Pointer<SDL_GPUCommandBuffer> | null;

/** Only takes effect when the device was created in debug mode. */
export declare function SDL_InsertGPUDebugLabel(command_buffer: Pointer<SDL_GPUCommandBuffer>, text: CString): void;

/** Only takes effect when the device was created in debug mode. */
export declare function SDL_PushGPUDebugGroup(command_buffer: Pointer<SDL_GPUCommandBuffer>, name: CString): void;

export declare function SDL_PopGPUDebugGroup(command_buffer: Pointer<SDL_GPUCommandBuffer>): void;

/**
 * Uniform data is pushed to the *command buffer*, not to a pass, and it applies
 * to every draw recorded after it until the next push to the same slot.
 */
export declare function SDL_PushGPUVertexUniformData(
    command_buffer: Pointer<SDL_GPUCommandBuffer>,
    slot_index: u32,
    data: Pointer<unknown>,
    length: u32,
): void;

export declare function SDL_PushGPUFragmentUniformData(
    command_buffer: Pointer<SDL_GPUCommandBuffer>,
    slot_index: u32,
    data: Pointer<unknown>,
    length: u32,
): void;

export declare function SDL_PushGPUComputeUniformData(
    command_buffer: Pointer<SDL_GPUCommandBuffer>,
    slot_index: u32,
    data: Pointer<unknown>,
    length: u32,
): void;

// ---------------------------------------------------------------------------
// Render passes.
// ---------------------------------------------------------------------------

/** `null` for `depth_stencil_target_info` means no depth-stencil attachment. */
export declare function SDL_BeginGPURenderPass(
    command_buffer: Pointer<SDL_GPUCommandBuffer>,
    color_target_infos: Pointer<SDL_GPUColorTargetInfo>,
    num_color_targets: u32,
    depth_stencil_target_info: Pointer<SDL_GPUDepthStencilTargetInfo> | null,
): Pointer<SDL_GPURenderPass> | null;

export declare function SDL_BindGPUGraphicsPipeline(render_pass: Pointer<SDL_GPURenderPass>, graphics_pipeline: Pointer<SDL_GPUGraphicsPipeline>): void;

export declare function SDL_SetGPUViewport(render_pass: Pointer<SDL_GPURenderPass>, viewport: Pointer<SDL_GPUViewport>): void;

export declare function SDL_SetGPUScissor(render_pass: Pointer<SDL_GPURenderPass>, scissor: Pointer<SDL_Rect>): void;

/** By value — sixteen bytes, moved indirectly by the Windows x64 ABI. */
export declare function SDL_SetGPUBlendConstants(render_pass: Pointer<SDL_GPURenderPass>, blend_constants: SDL_FColor): void;

export declare function SDL_SetGPUStencilReference(render_pass: Pointer<SDL_GPURenderPass>, reference: u8): void;

export declare function SDL_BindGPUVertexBuffers(
    render_pass: Pointer<SDL_GPURenderPass>,
    first_slot: u32,
    bindings: Pointer<SDL_GPUBufferBinding>,
    num_bindings: u32,
): void;

export declare function SDL_BindGPUIndexBuffer(
    render_pass: Pointer<SDL_GPURenderPass>,
    binding: Pointer<SDL_GPUBufferBinding>,
    index_element_size: SDL_GPUIndexElementSize,
): void;

export declare function SDL_BindGPUVertexSamplers(
    render_pass: Pointer<SDL_GPURenderPass>,
    first_slot: u32,
    texture_sampler_bindings: Pointer<SDL_GPUTextureSamplerBinding>,
    num_bindings: u32,
): void;

/** An array of texture *pointers*, so a `Pointer<Pointer<SDL_GPUTexture>>`. */
export declare function SDL_BindGPUVertexStorageTextures(
    render_pass: Pointer<SDL_GPURenderPass>,
    first_slot: u32,
    storage_textures: Pointer<Pointer<SDL_GPUTexture>>,
    num_bindings: u32,
): void;

export declare function SDL_BindGPUVertexStorageBuffers(
    render_pass: Pointer<SDL_GPURenderPass>,
    first_slot: u32,
    storage_buffers: Pointer<Pointer<SDL_GPUBuffer>>,
    num_bindings: u32,
): void;

export declare function SDL_BindGPUFragmentSamplers(
    render_pass: Pointer<SDL_GPURenderPass>,
    first_slot: u32,
    texture_sampler_bindings: Pointer<SDL_GPUTextureSamplerBinding>,
    num_bindings: u32,
): void;

export declare function SDL_BindGPUFragmentStorageTextures(
    render_pass: Pointer<SDL_GPURenderPass>,
    first_slot: u32,
    storage_textures: Pointer<Pointer<SDL_GPUTexture>>,
    num_bindings: u32,
): void;

export declare function SDL_BindGPUFragmentStorageBuffers(
    render_pass: Pointer<SDL_GPURenderPass>,
    first_slot: u32,
    storage_buffers: Pointer<Pointer<SDL_GPUBuffer>>,
    num_bindings: u32,
): void;

export declare function SDL_DrawGPUIndexedPrimitives(
    render_pass: Pointer<SDL_GPURenderPass>,
    num_indices: u32,
    num_instances: u32,
    first_index: u32,
    vertex_offset: i32,
    first_instance: u32,
): void;

export declare function SDL_DrawGPUPrimitives(
    render_pass: Pointer<SDL_GPURenderPass>,
    num_vertices: u32,
    num_instances: u32,
    first_vertex: u32,
    first_instance: u32,
): void;

/** The buffer holds `draw_count` packed `SDL_GPUIndirectDrawCommand`s from `offset`. */
export declare function SDL_DrawGPUPrimitivesIndirect(
    render_pass: Pointer<SDL_GPURenderPass>,
    buffer: Pointer<SDL_GPUBuffer>,
    offset: u32,
    draw_count: u32,
): void;

/** The buffer holds `draw_count` packed `SDL_GPUIndexedIndirectDrawCommand`s from `offset`. */
export declare function SDL_DrawGPUIndexedPrimitivesIndirect(
    render_pass: Pointer<SDL_GPURenderPass>,
    buffer: Pointer<SDL_GPUBuffer>,
    offset: u32,
    draw_count: u32,
): void;

export declare function SDL_EndGPURenderPass(render_pass: Pointer<SDL_GPURenderPass>): void;

// ---------------------------------------------------------------------------
// Compute passes.
// ---------------------------------------------------------------------------

/**
 * The read-write bindings are declared up front, at the pass, rather than
 * per-dispatch: that is what lets the driver know which resources the pass
 * writes to, and it is why they cannot be rebound in the middle of one.
 */
export declare function SDL_BeginGPUComputePass(
    command_buffer: Pointer<SDL_GPUCommandBuffer>,
    storage_texture_bindings: Pointer<SDL_GPUStorageTextureReadWriteBinding> | null,
    num_storage_texture_bindings: u32,
    storage_buffer_bindings: Pointer<SDL_GPUStorageBufferReadWriteBinding> | null,
    num_storage_buffer_bindings: u32,
): Pointer<SDL_GPUComputePass> | null;

export declare function SDL_BindGPUComputePipeline(compute_pass: Pointer<SDL_GPUComputePass>, compute_pipeline: Pointer<SDL_GPUComputePipeline>): void;

export declare function SDL_BindGPUComputeSamplers(
    compute_pass: Pointer<SDL_GPUComputePass>,
    first_slot: u32,
    texture_sampler_bindings: Pointer<SDL_GPUTextureSamplerBinding>,
    num_bindings: u32,
): void;

export declare function SDL_BindGPUComputeStorageTextures(
    compute_pass: Pointer<SDL_GPUComputePass>,
    first_slot: u32,
    storage_textures: Pointer<Pointer<SDL_GPUTexture>>,
    num_bindings: u32,
): void;

export declare function SDL_BindGPUComputeStorageBuffers(
    compute_pass: Pointer<SDL_GPUComputePass>,
    first_slot: u32,
    storage_buffers: Pointer<Pointer<SDL_GPUBuffer>>,
    num_bindings: u32,
): void;

export declare function SDL_DispatchGPUCompute(
    compute_pass: Pointer<SDL_GPUComputePass>,
    groupcount_x: u32,
    groupcount_y: u32,
    groupcount_z: u32,
): void;

/** The buffer holds one `SDL_GPUIndirectDispatchCommand` at `offset`. */
export declare function SDL_DispatchGPUComputeIndirect(compute_pass: Pointer<SDL_GPUComputePass>, buffer: Pointer<SDL_GPUBuffer>, offset: u32): void;

export declare function SDL_EndGPUComputePass(compute_pass: Pointer<SDL_GPUComputePass>): void;

// ---------------------------------------------------------------------------
// Transfer buffers and copy passes.
// ---------------------------------------------------------------------------

/**
 * Map a transfer buffer into the address space.
 *
 * The pointer is valid until `SDL_UnmapGPUTransferBuffer`, and it is *not* a
 * Goblin allocation — do not `.free()` it. `cycle: true` on an upload buffer
 * that is still in flight gets you fresh memory instead of a stall.
 */
export declare function SDL_MapGPUTransferBuffer(
    device: Pointer<SDL_GPUDevice>,
    transfer_buffer: Pointer<SDL_GPUTransferBuffer>,
    cycle: boolean,
): Pointer<unknown> | null;

export declare function SDL_UnmapGPUTransferBuffer(device: Pointer<SDL_GPUDevice>, transfer_buffer: Pointer<SDL_GPUTransferBuffer>): void;

export declare function SDL_BeginGPUCopyPass(command_buffer: Pointer<SDL_GPUCommandBuffer>): Pointer<SDL_GPUCopyPass> | null;

export declare function SDL_UploadToGPUTexture(
    copy_pass: Pointer<SDL_GPUCopyPass>,
    source: Pointer<SDL_GPUTextureTransferInfo>,
    destination: Pointer<SDL_GPUTextureRegion>,
    cycle: boolean,
): void;

export declare function SDL_UploadToGPUBuffer(
    copy_pass: Pointer<SDL_GPUCopyPass>,
    source: Pointer<SDL_GPUTransferBufferLocation>,
    destination: Pointer<SDL_GPUBufferRegion>,
    cycle: boolean,
): void;

export declare function SDL_CopyGPUTextureToTexture(
    copy_pass: Pointer<SDL_GPUCopyPass>,
    source: Pointer<SDL_GPUTextureLocation>,
    destination: Pointer<SDL_GPUTextureLocation>,
    w: u32,
    h: u32,
    d: u32,
    cycle: boolean,
): void;

export declare function SDL_CopyGPUBufferToBuffer(
    copy_pass: Pointer<SDL_GPUCopyPass>,
    source: Pointer<SDL_GPUBufferLocation>,
    destination: Pointer<SDL_GPUBufferLocation>,
    size: u32,
    cycle: boolean,
): void;

/** The data is not readable until the command buffer's fence has signalled. */
export declare function SDL_DownloadFromGPUTexture(
    copy_pass: Pointer<SDL_GPUCopyPass>,
    source: Pointer<SDL_GPUTextureRegion>,
    destination: Pointer<SDL_GPUTextureTransferInfo>,
): void;

/** The data is not readable until the command buffer's fence has signalled. */
export declare function SDL_DownloadFromGPUBuffer(
    copy_pass: Pointer<SDL_GPUCopyPass>,
    source: Pointer<SDL_GPUBufferRegion>,
    destination: Pointer<SDL_GPUTransferBufferLocation>,
): void;

export declare function SDL_EndGPUCopyPass(copy_pass: Pointer<SDL_GPUCopyPass>): void;

/** Outside any pass, on the command buffer itself. */
export declare function SDL_GenerateMipmapsForGPUTexture(command_buffer: Pointer<SDL_GPUCommandBuffer>, texture: Pointer<SDL_GPUTexture>): void;

/** Outside any pass, on the command buffer itself. */
export declare function SDL_BlitGPUTexture(command_buffer: Pointer<SDL_GPUCommandBuffer>, info: Pointer<SDL_GPUBlitInfo>): void;

// ---------------------------------------------------------------------------
// Swapchain.
// ---------------------------------------------------------------------------

export declare function SDL_WindowSupportsGPUSwapchainComposition(
    device: Pointer<SDL_GPUDevice>,
    window: Pointer<SDL_Window>,
    swapchain_composition: SDL_GPUSwapchainComposition,
): boolean;

export declare function SDL_WindowSupportsGPUPresentMode(
    device: Pointer<SDL_GPUDevice>,
    window: Pointer<SDL_Window>,
    present_mode: SDL_GPUPresentMode,
): boolean;

/** Claim the window before acquiring a swapchain texture for it. */
export declare function SDL_ClaimWindowForGPUDevice(device: Pointer<SDL_GPUDevice>, window: Pointer<SDL_Window>): boolean;

export declare function SDL_ReleaseWindowFromGPUDevice(device: Pointer<SDL_GPUDevice>, window: Pointer<SDL_Window>): void;

export declare function SDL_SetGPUSwapchainParameters(
    device: Pointer<SDL_GPUDevice>,
    window: Pointer<SDL_Window>,
    swapchain_composition: SDL_GPUSwapchainComposition,
    present_mode: SDL_GPUPresentMode,
): boolean;

/** 1 to 3. Fewer means lower latency and more stalling; the default is 2. */
export declare function SDL_SetGPUAllowedFramesInFlight(device: Pointer<SDL_GPUDevice>, allowed_frames_in_flight: u32): boolean;

/** The format your pipelines' colour targets have to match. */
export declare function SDL_GetGPUSwapchainTextureFormat(device: Pointer<SDL_GPUDevice>, window: Pointer<SDL_Window>): SDL_GPUTextureFormat;

/**
 * Take the next swapchain texture, without waiting.
 *
 * True with a **null** texture is the ordinary "no image available this
 * instant" answer, not a failure: submit the command buffer anyway and try
 * again next frame. The texture is the swapchain's — never release it.
 */
export declare function SDL_AcquireGPUSwapchainTexture(
    command_buffer: Pointer<SDL_GPUCommandBuffer>,
    window: Pointer<SDL_Window>,
    swapchain_texture: Pointer<Pointer<SDL_GPUTexture>>,
    swapchain_texture_width: Pointer<u32> | null,
    swapchain_texture_height: Pointer<u32> | null,
): boolean;

export declare function SDL_WaitForGPUSwapchain(device: Pointer<SDL_GPUDevice>, window: Pointer<SDL_Window>): boolean;

/**
 * Wait for the swapchain, then take the next texture — the one to use in an
 * ordinary frame loop, because the wait is what paces the program to the
 * display. Blocks, so do not call it from a thread that must stay responsive.
 */
export declare function SDL_WaitAndAcquireGPUSwapchainTexture(
    command_buffer: Pointer<SDL_GPUCommandBuffer>,
    window: Pointer<SDL_Window>,
    swapchain_texture: Pointer<Pointer<SDL_GPUTexture>>,
    swapchain_texture_width: Pointer<u32> | null,
    swapchain_texture_height: Pointer<u32> | null,
): boolean;

// ---------------------------------------------------------------------------
// Submission and synchronisation.
// ---------------------------------------------------------------------------

/** The command buffer is gone after this, whether it succeeded or not. */
export declare function SDL_SubmitGPUCommandBuffer(command_buffer: Pointer<SDL_GPUCommandBuffer>): boolean;

/** The fence is yours: release it with `SDL_ReleaseGPUFence`. */
export declare function SDL_SubmitGPUCommandBufferAndAcquireFence(command_buffer: Pointer<SDL_GPUCommandBuffer>): Pointer<SDL_GPUFence> | null;

/** Throw the recording away. Not allowed once a swapchain texture has been acquired on it. */
export declare function SDL_CancelGPUCommandBuffer(command_buffer: Pointer<SDL_GPUCommandBuffer>): boolean;

export declare function SDL_WaitForGPUIdle(device: Pointer<SDL_GPUDevice>): boolean;

/** An array of fence *pointers*. `wait_all` false returns as soon as any one signals. */
export declare function SDL_WaitForGPUFences(
    device: Pointer<SDL_GPUDevice>,
    wait_all: boolean,
    fences: Pointer<Pointer<SDL_GPUFence>>,
    num_fences: u32,
): boolean;

export declare function SDL_QueryGPUFence(device: Pointer<SDL_GPUDevice>, fence: Pointer<SDL_GPUFence>): boolean;

export declare function SDL_ReleaseGPUFence(device: Pointer<SDL_GPUDevice>, fence: Pointer<SDL_GPUFence>): void;

// ---------------------------------------------------------------------------
// Format queries.
// ---------------------------------------------------------------------------

/** The size of one texel block — one texel for an uncompressed format. */
export declare function SDL_GPUTextureFormatTexelBlockSize(format: SDL_GPUTextureFormat): u32;

export declare function SDL_GPUTextureSupportsFormat(
    device: Pointer<SDL_GPUDevice>,
    format: SDL_GPUTextureFormat,
    type: SDL_GPUTextureType,
    usage: SDL_GPUTextureUsageFlags,
): boolean;

export declare function SDL_GPUTextureSupportsSampleCount(
    device: Pointer<SDL_GPUDevice>,
    format: SDL_GPUTextureFormat,
    sample_count: SDL_GPUSampleCount,
): boolean;

/** The bytes one mip level of such a texture occupies. */
export declare function SDL_CalculateGPUTextureFormatSize(
    format: SDL_GPUTextureFormat,
    width: u32,
    height: u32,
    depth_or_layer_count: u32,
): u32;

export declare function SDL_GetPixelFormatFromGPUTextureFormat(format: SDL_GPUTextureFormat): SDL_PixelFormat;

export declare function SDL_GetGPUTextureFormatFromPixelFormat(format: SDL_PixelFormat): SDL_GPUTextureFormat;

// ---------------------------------------------------------------------------
// GDK (Xbox) lifecycle. No-ops elsewhere, but they are real symbols only on
// GDK builds of SDL — calling them on a desktop build will not link.
// ---------------------------------------------------------------------------

export declare function SDL_GDKSuspendGPU(device: Pointer<SDL_GPUDevice>): void;

export declare function SDL_GDKResumeGPU(device: Pointer<SDL_GPUDevice>): void;

