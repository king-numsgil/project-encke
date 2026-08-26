// The overlay pass. Stage 9, after the tonemap, straight into the swapchain.
//
// It is last for the obvious reason — an overlay is on top — and it draws into
// the swapchain rather than the HDR scene target for a less obvious one: the
// tonemap would otherwise run a filmic curve over the UI, and a panel authored
// at 60% grey would arrive somewhere else entirely. Drawing after it means the
// colours in `ui/overlay.ts` are the colours on screen.
//
// **`LOAD`, not `DONT_CARE`.** Every other colour pass in this renderer covers
// its target completely and says so; this one covers a corner of it, and
// discarding the rest would leave the frame the tonemap just wrote as undefined
// memory.
//
// **Straight alpha, blended in whatever space the swapchain is.** With a `_SRGB`
// swapchain the hardware blends linearly, which is correct; with a `UNORM` one
// the tonemap has already written encoded bytes and blending happens over those,
// which is slightly wrong for a half-transparent panel and is the same
// compromise every UI that composites onto an encoded framebuffer makes.
//
// The vertex and index buffers are allocated once at the ceilings in `config.ts`
// and refilled per frame through one transfer buffer. Growing them mid-frame
// would mean a device idle, which is a stall in the middle of a frame to make
// room for a frame counter.

import {
    SDL_BeginGPURenderPass,
    SDL_BindGPUFragmentSamplers,
    SDL_BindGPUGraphicsPipeline,
    SDL_BindGPUIndexBuffer,
    SDL_BindGPUVertexBuffers,
    SDL_CreateGPUGraphicsPipeline,
    SDL_DrawGPUIndexedPrimitives,
    SDL_EndGPURenderPass,
    SDL_GetError,
    SDL_GPUBlendFactor,
    SDL_GPUBlendOp,
    type SDL_GPUBuffer,
    type SDL_GPUBufferBinding,
    SDL_GPUBufferUsageFlags,
    type SDL_GPUColorTargetDescription,
    type SDL_GPUColorTargetInfo,
    type SDL_GPUCommandBuffer,
    type SDL_GPUCopyPass,
    SDL_GPUCullMode,
    type SDL_GPUDevice,
    SDL_GPUFrontFace,
    type SDL_GPUGraphicsPipeline,
    type SDL_GPUGraphicsPipelineCreateInfo,
    SDL_GPUIndexElementSize,
    SDL_GPULoadOp,
    type SDL_GPURenderPass,
    type SDL_GPUSampler,
    type SDL_GPUShader,
    SDL_GPUStoreOp,
    type SDL_GPUTexture,
    SDL_GPUTextureFormat,
    type SDL_GPUTextureSamplerBinding,
    type SDL_GPUVertexAttribute,
    type SDL_GPUVertexBufferDescription,
    SDL_GPUVertexElementFormat,
    SDL_GPUVertexInputRate,
    SDL_PushGPUVertexUniformData,
    SDL_ReleaseGPUGraphicsPipeline,
    SDL_ReleaseGPUShader,
} from "../../bindings/SDL3";
import { uiMaxIndices, uiMaxVertices } from "../config.ts";
import type { UiUniform } from "../frame/uniforms.ts";
import { createBuffer, releaseBuffer, Staging } from "../gpu/buffer.ts";
import { uiFsMain, uiVsMain } from "../shaders.generated.ts";
import { type UiDrawList, uiVertexFloats, uiVertexStride } from "../ui/draw.ts";

/** Bytes the vertex half of the transfer buffer reserves. Indices start here. */
function vertexRegionBytes(): u32 {
    return uiMaxVertices() * uiVertexStride();
}

function indexRegionBytes(): u32 {
    return uiMaxIndices() * 4;
}

export class UiPass {
    private pipeline: Pointer<SDL_GPUGraphicsPipeline> | null;

    private vertexBuffer: Pointer<SDL_GPUBuffer> | null;
    private indexBuffer: Pointer<SDL_GPUBuffer> | null;

    /** Built once at creation, for the same reason `GpuMesh` builds its pair once. */
    private vertexBinding: Pointer<SDL_GPUBufferBinding> | null;
    private indexBinding: Pointer<SDL_GPUBufferBinding> | null;

    private staging: Staging;

    /** How many indices {@link upload} put in the buffer. Zero skips the draw. */
    private pending: u32;

    constructor() {
        this.pipeline = null;
        this.vertexBuffer = null;
        this.indexBuffer = null;
        this.vertexBinding = null;
        this.indexBinding = null;
        this.staging = new Staging();
        this.pending = 0;
    }

    create(device: Pointer<SDL_GPUDevice>, swapchainFormat: SDL_GPUTextureFormat): boolean {
        const vertex = uiVsMain(device);
        const fragment = uiFsMain(device);
        if (vertex === null || fragment === null) {
            return false;
        }

        this.pipeline = createUiPipeline(device, vertex, fragment, swapchainFormat);
        SDL_ReleaseGPUShader(device, vertex);
        SDL_ReleaseGPUShader(device, fragment);

        if (this.pipeline === null) {
            return false;
        }

        this.vertexBuffer = createBuffer(
            device,
            SDL_GPUBufferUsageFlags.VERTEX,
            vertexRegionBytes(),
            "ui.vertices",
        );
        this.indexBuffer = createBuffer(
            device,
            SDL_GPUBufferUsageFlags.INDEX,
            indexRegionBytes(),
            "ui.indices",
        );
        if (this.vertexBuffer === null || this.indexBuffer === null) {
            return false;
        }

        // One transfer buffer for both streams, the same arrangement `GpuMesh`
        // uses at load time — except that this one is remapped every frame.
        if (!this.staging.create(device, vertexRegionBytes() + indexRegionBytes(), "ui.staging")) {
            return false;
        }

        this.vertexBinding = alloc<SDL_GPUBufferBinding>({
            buffer: this.vertexBuffer,
            offset: 0,
        });
        this.indexBinding = alloc<SDL_GPUBufferBinding>({
            buffer: this.indexBuffer,
            offset: 0,
        });
        return true;
    }

    /**
     * Copy this frame's draw list into the GPU buffers, on a copy pass the caller
     * owns.
     *
     * Recorded onto the frame's own copy pass rather than one of its own, so the
     * overlay costs no extra pass and no extra submission. `cycle: true` on the
     * map is what makes that safe: it hands back fresh memory rather than waiting
     * on the copy the previous frame is still doing.
     */
    upload(pass: Pointer<SDL_GPUCopyPass>, list: Reference<UiDrawList>): void {
        this.pending = 0;
        if (list.empty()) {
            return;
        }

        const source = list.vertexFloats();
        const sourceIndices = list.indexWords();
        if (source === null || sourceIndices === null) {
            return;
        }

        if (!this.staging.map(true)) {
            return;
        }

        const floats = this.staging.floats();
        const liveFloats = cast<usize>(list.vertexCount() * uiVertexFloats());
        for (let i: usize = 0; i < liveFloats; i++) {
            floats[i] = source[i];
        }

        // The same mapping seen as words. The index region starts at a fixed
        // offset rather than just past the vertices actually written, so the copy
        // below has a constant source offset and nothing has to be recomputed
        // when the list's length changes.
        const words = this.staging.words();
        const indexBase = cast<usize>(vertexRegionBytes()) / 4;
        const liveIndices = cast<usize>(list.indexCount());
        for (let i: usize = 0; i < liveIndices; i++) {
            words[indexBase + i] = sourceIndices[i];
        }

        this.staging.unmap();

        const vertexBuffer = this.vertexBuffer;
        const indexBuffer = this.indexBuffer;
        if (vertexBuffer === null || indexBuffer === null) {
            return;
        }

        const vertexBytes = list.vertexCount() * uiVertexStride();
        const indexBytes = list.indexCount() * 4;
        this.staging.record(pass, vertexBuffer, 0, 0, vertexBytes);
        this.staging.record(pass, indexBuffer, 0, vertexRegionBytes(), indexBytes);

        this.pending = list.indexCount();
    }

    /**
     * Draw whatever {@link upload} left in the buffers.
     *
     * `params` has already been filled by `fillUi` with the render size, which is
     * what the overlay's pixel coordinates are relative to.
     */
    record(
        cmd: Pointer<SDL_GPUCommandBuffer>,
        target: Pointer<SDL_GPUTexture>,
        atlas: Pointer<SDL_GPUTexture>,
        sampler: Pointer<SDL_GPUSampler>,
        params: Pointer<UiUniform>,
        paramBytes: u32,
    ): void {
        const pipeline = this.pipeline;
        const vertexBinding = this.vertexBinding;
        const indexBinding = this.indexBinding;

        if (this.pending === 0 || pipeline === null || vertexBinding === null || indexBinding === null) {
            return;
        }

        const info = alloc<SDL_GPUColorTargetInfo>({
            texture: target,
            load_op: SDL_GPULoadOp.LOAD,
            store_op: SDL_GPUStoreOp.STORE,
        });

        const pass = SDL_BeginGPURenderPass(cmd, info, 1, null);
        info.free();

        if (pass === null) {
            console.log(`ui: pass failed : ${stringFromCString(SDL_GetError())}`);
            return;
        }

        SDL_BindGPUGraphicsPipeline(pass, pipeline);
        SDL_BindGPUVertexBuffers(pass, 0, vertexBinding, 1);
        SDL_BindGPUIndexBuffer(pass, indexBinding, SDL_GPUIndexElementSize._32BIT);

        bindAtlas(pass, atlas, sampler);

        SDL_PushGPUVertexUniformData(cmd, 0, params, paramBytes);
        SDL_DrawGPUIndexedPrimitives(pass, this.pending, 1, 0, 0, 0);
        SDL_EndGPURenderPass(pass);
    }

    release(device: Pointer<SDL_GPUDevice>): void {
        const pipeline = this.pipeline;
        if (pipeline !== null) {
            SDL_ReleaseGPUGraphicsPipeline(device, pipeline);
        }
        this.pipeline = null;

        this.staging.destroy();
        releaseBuffer(device, this.vertexBuffer);
        releaseBuffer(device, this.indexBuffer);
        this.vertexBuffer = null;
        this.indexBuffer = null;

        if (this.vertexBinding !== null) {
            this.vertexBinding.free();
        }
        if (this.indexBinding !== null) {
            this.indexBinding.free();
        }
        this.vertexBinding = null;
        this.indexBinding = null;
        this.pending = 0;
    }
}

/** The atlas and its sampler, on the fragment stage's only texture slot. */
function bindAtlas(
    pass: Pointer<SDL_GPURenderPass>,
    atlas: Pointer<SDL_GPUTexture>,
    sampler: Pointer<SDL_GPUSampler>,
): void {
    const binding = allocArray<SDL_GPUTextureSamplerBinding>(1);
    binding[0].texture = atlas;
    binding[0].sampler = sampler;
    SDL_BindGPUFragmentSamplers(pass, 0, binding, 1);
    binding.freeArray();
}

/**
 * The overlay pipeline: one blended colour target, no depth, no culling.
 *
 * Not in `gpu/pipeline.ts` with the other three, because it is the only one in
 * this renderer that blends and the only one whose vertices are not the shared
 * mesh layout — putting it there would mean a fourth shape and a second vertex
 * layout in a file whose point is that there are three of each.
 */
function createUiPipeline(
    device: Pointer<SDL_GPUDevice>,
    vertex: Pointer<SDL_GPUShader>,
    fragment: Pointer<SDL_GPUShader>,
    colorFormat: SDL_GPUTextureFormat,
): Pointer<SDL_GPUGraphicsPipeline> | null {
    const attributes = allocArray<SDL_GPUVertexAttribute>(3);

    attributes[0].location = 0;
    attributes[0].buffer_slot = 0;
    attributes[0].format = SDL_GPUVertexElementFormat.FLOAT2;
    attributes[0].offset = 0;

    attributes[1].location = 1;
    attributes[1].buffer_slot = 0;
    attributes[1].format = SDL_GPUVertexElementFormat.FLOAT2;
    attributes[1].offset = 8;

    // Four floats rather than a packed `UBYTE4_NORM`. It costs twelve bytes a
    // vertex on a buffer that never exceeds half a megabyte, and it keeps the
    // whole vertex one type — so the draw list writes floats and nothing has to
    // reason about byte order inside a word.
    attributes[2].location = 2;
    attributes[2].buffer_slot = 0;
    attributes[2].format = SDL_GPUVertexElementFormat.FLOAT4;
    attributes[2].offset = 16;

    const buffers = allocArray<SDL_GPUVertexBufferDescription>(1);
    buffers[0].slot = 0;
    buffers[0].pitch = uiVertexStride();
    buffers[0].input_rate = SDL_GPUVertexInputRate.VERTEX;
    buffers[0].instance_step_rate = 0;

    const colorTarget = alloc<SDL_GPUColorTargetDescription>({
        format: colorFormat,
        blend_state: {
            enable_blend: true,
            // Straight alpha: `src.rgb * src.a + dst.rgb * (1 - src.a)`.
            src_color_blendfactor: SDL_GPUBlendFactor.SRC_ALPHA,
            dst_color_blendfactor: SDL_GPUBlendFactor.ONE_MINUS_SRC_ALPHA,
            color_blend_op: SDL_GPUBlendOp.ADD,
            // The destination's alpha accumulates rather than being replaced, so
            // that stacking two half-transparent things leaves the target opaque
            // where either covered it. It matters for the capture target, whose
            // alpha is written to a PNG.
            src_alpha_blendfactor: SDL_GPUBlendFactor.ONE,
            dst_alpha_blendfactor: SDL_GPUBlendFactor.ONE_MINUS_SRC_ALPHA,
            alpha_blend_op: SDL_GPUBlendOp.ADD,
        },
    });

    const info = alloc<SDL_GPUGraphicsPipelineCreateInfo>({
        vertex_shader: vertex,
        fragment_shader: fragment,
        vertex_input_state: {
            vertex_buffer_descriptions: buffers,
            num_vertex_buffers: 1,
            vertex_attributes: attributes,
            num_vertex_attributes: 3,
        },
        rasterizer_state: {
            cull_mode: SDL_GPUCullMode.NONE,
            front_face: SDL_GPUFrontFace.COUNTER_CLOCKWISE,
        },
        target_info: {
            num_color_targets: 1,
            color_target_descriptions: colorTarget,
        },
    });

    const pipeline = SDL_CreateGPUGraphicsPipeline(device, info);
    info.free();
    colorTarget.free();
    attributes.freeArray();
    buffers.freeArray();

    if (pipeline === null) {
        console.log(`pipeline: 'ui' failed : ${stringFromCString(SDL_GetError())}`);
    }
    return pipeline;
}
