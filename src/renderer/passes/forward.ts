// The clustered forward pass — where everything else is spent.
//
// **Binding order is the whole risk in this file.** SDL takes resource counts on
// trust and binds by slot, and a slot is a *rank within a kind*, decided by the
// shader's `@binding` numbers. The arrays below have to match `forward.wgsl`
// exactly, and nothing checks that they do:
//
//     samplers  0 shadow atlas   1 spot atlas   2 occlusion
//     storage   0 lights         1 light_count  2 light_index
//     uniforms  0 frame          1 shadows      2 material   (fragment)
//     uniforms  0 frame          1 object                    (vertex)
//
// Get one wrong and there is no error anywhere — the shader reads whatever is at
// that slot, and a shadow atlas sampled as an occlusion buffer just looks like
// a bad ambient term.
//
// Depth is tested `EQUAL` against the pre-pass and never written. Every fragment
// that reaches the light loop is therefore the nearest surface at that pixel,
// and the loop runs exactly once per pixel regardless of how much geometry
// overlapped it.

import {
    SDL_BeginGPURenderPass,
    SDL_BindGPUFragmentSamplers,
    SDL_BindGPUFragmentStorageBuffers,
    SDL_BindGPUGraphicsPipeline,
    SDL_EndGPURenderPass,
    SDL_GetError,
    type SDL_GPUBuffer,
    type SDL_GPUColorTargetInfo,
    type SDL_GPUCommandBuffer,
    type SDL_GPUDepthStencilTargetInfo,
    type SDL_GPUDevice,
    type SDL_GPUGraphicsPipeline,
    SDL_GPULoadOp,
    type SDL_GPUSampler,
    SDL_GPUStoreOp,
    type SDL_GPUTexture,
    SDL_GPUTextureFormat,
    type SDL_GPUTextureSamplerBinding,
    SDL_PushGPUFragmentUniformData,
    SDL_PushGPUVertexUniformData,
    SDL_ReleaseGPUGraphicsPipeline,
    SDL_ReleaseGPUShader,
} from "../../bindings/SDL3";
import type { ClusterBuffers } from "../cluster/buffers.ts";
import {
    fillObject,
    type FrameUniform,
    type MaterialUniform,
    type ObjectUniform,
    type ShadowUniform,
} from "../frame/uniforms.ts";
import { createForwardPipeline } from "../gpu/pipeline.ts";
import { fillMaterial } from "../scene/materialpack.ts";
import type { Scene } from "../scene/scene.ts";
import { forwardFsMain, forwardVsMain } from "../shaders.generated.ts";

/** Everything the forward pass reads that is not the scene itself. */
export class ForwardInputs {
    cascadeAtlas: Pointer<SDL_GPUTexture> | null;
    spotAtlas: Pointer<SDL_GPUTexture> | null;
    occlusion: Pointer<SDL_GPUTexture> | null;

    shadowSampler: Pointer<SDL_GPUSampler> | null;
    occlusionSampler: Pointer<SDL_GPUSampler> | null;

    constructor() {
        this.cascadeAtlas = null;
        this.spotAtlas = null;
        this.occlusion = null;
        this.shadowSampler = null;
        this.occlusionSampler = null;
    }
}

export class ForwardPass {
    private pipeline: Pointer<SDL_GPUGraphicsPipeline> | null;

    constructor() {
        this.pipeline = null;
    }

    create(
        device: Pointer<SDL_GPUDevice>,
        colorFormat: SDL_GPUTextureFormat,
        depthFormat: SDL_GPUTextureFormat,
    ): boolean {
        const vertex = forwardVsMain(device);
        const fragment = forwardFsMain(device);
        if (vertex === null || fragment === null) {
            return false;
        }

        this.pipeline = createForwardPipeline(device, vertex, fragment, colorFormat, depthFormat, "forward");

        SDL_ReleaseGPUShader(device, vertex);
        SDL_ReleaseGPUShader(device, fragment);
        return this.pipeline !== null;
    }

    record(
        cmd: Pointer<SDL_GPUCommandBuffer>,
        scene: Pointer<SDL_GPUTexture>,
        depth: Pointer<SDL_GPUTexture>,
        world: Reference<Scene>,
        clusters: Reference<ClusterBuffers>,
        inputs: Reference<ForwardInputs>,
        frame: Pointer<FrameUniform>,
        frameBytes: u32,
        shadows: Pointer<ShadowUniform>,
        shadowBytes: u32,
        object: Pointer<ObjectUniform>,
        objectBytes: u32,
        material: Pointer<MaterialUniform>,
        materialBytes: u32,
    ): void {
        const pipeline = this.pipeline;
        const lights = clusters.lights;
        const lightCount = clusters.lightCount;
        const lightIndex = clusters.lightIndex;
        const cascadeAtlas = inputs.cascadeAtlas;
        const spotAtlas = inputs.spotAtlas;
        const occlusion = inputs.occlusion;
        const shadowSampler = inputs.shadowSampler;
        const occlusionSampler = inputs.occlusionSampler;

        if (
            pipeline === null ||
            lights === null ||
            lightCount === null ||
            lightIndex === null ||
            cascadeAtlas === null ||
            spotAtlas === null ||
            occlusion === null ||
            shadowSampler === null ||
            occlusionSampler === null
        ) {
            return;
        }

        const color = alloc<SDL_GPUColorTargetInfo>({
            texture: scene,
            clear_color: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            load_op: SDL_GPULoadOp.CLEAR,
            store_op: SDL_GPUStoreOp.STORE,
            cycle: true,
        });

        // LOAD and no write. The pre-pass owns this buffer's contents and the
        // `EQUAL` test depends on them surviving intact — `cycle` here would
        // hand back a fresh depth buffer and every fragment would fail.
        const depthTarget = alloc<SDL_GPUDepthStencilTargetInfo>({
            texture: depth,
            load_op: SDL_GPULoadOp.LOAD,
            store_op: SDL_GPUStoreOp.STORE,
            stencil_load_op: SDL_GPULoadOp.DONT_CARE,
            stencil_store_op: SDL_GPUStoreOp.DONT_CARE,
            cycle: false,
        });

        const pass = SDL_BeginGPURenderPass(cmd, color, 1, depthTarget);
        color.free();
        depthTarget.free();

        if (pass === null) {
            console.log(`forward: pass failed : ${stringFromCString(SDL_GetError())}`);
            return;
        }

        SDL_BindGPUGraphicsPipeline(pass, pipeline);

        const textures = allocArray<SDL_GPUTextureSamplerBinding>(3);
        textures[0].texture = cascadeAtlas;
        textures[0].sampler = shadowSampler;
        textures[1].texture = spotAtlas;
        textures[1].sampler = shadowSampler;
        // Linear, and that is what makes half-resolution SSAO free: this sampler
        // *is* the upsample back to full resolution.
        textures[2].texture = occlusion;
        textures[2].sampler = occlusionSampler;
        SDL_BindGPUFragmentSamplers(pass, 0, textures, 3);
        textures.freeArray();

        const buffers = allocArray<Pointer<SDL_GPUBuffer>>(3);
        buffers[0] = lights;
        buffers[1] = lightCount;
        buffers[2] = lightIndex;
        SDL_BindGPUFragmentStorageBuffers(pass, 0, buffers, 3);
        buffers.freeArray();

        // Pushed once: these apply to every draw recorded after them.
        SDL_PushGPUVertexUniformData(cmd, 0, frame, frameBytes);
        SDL_PushGPUFragmentUniformData(cmd, 0, frame, frameBytes);
        SDL_PushGPUFragmentUniformData(cmd, 1, shadows, shadowBytes);

        for (let i: usize = 0; i < world.instances.length; i++) {
            fillObject(object, world.instances[i].transform);
            SDL_PushGPUVertexUniformData(cmd, 1, object, objectBytes);

            fillMaterial(material, world.materials[world.instances[i].material]);
            SDL_PushGPUFragmentUniformData(cmd, 2, material, materialBytes);

            world.meshes[world.instances[i].mesh].draw(pass);
        }

        SDL_EndGPURenderPass(pass);
    }

    release(device: Pointer<SDL_GPUDevice>): void {
        const pipeline = this.pipeline;
        if (pipeline !== null) {
            SDL_ReleaseGPUGraphicsPipeline(device, pipeline);
        }
        this.pipeline = null;
    }
}
