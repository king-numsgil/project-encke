// HDR to the swapchain. The last pass, and the only one that touches it.
//
// The renderer never draws into a swapchain texture except here. That is partly
// discipline — a swapchain image is the presentation engine's and is not a thing
// to read back — and partly necessity: shading happens in `R16G16B16A16_FLOAT`
// because physical falloff produces radiance far outside `[0, 1]`, and there is
// no swapchain format that holds it.
//
// Whether this pass encodes sRGB depends on the format the platform gave us. A
// `_SRGB` swapchain encodes on write, and doing it here too washes the image
// out — so it is a uniform, not a compile-time choice.

import { fvec4 } from "std/linalg";
import {
    SDL_BeginGPURenderPass,
    SDL_BindGPUFragmentSamplers,
    SDL_BindGPUGraphicsPipeline,
    SDL_DrawGPUPrimitives,
    SDL_EndGPURenderPass,
    SDL_GetError,
    type SDL_GPUColorTargetInfo,
    type SDL_GPUCommandBuffer,
    type SDL_GPUDevice,
    type SDL_GPUGraphicsPipeline,
    SDL_GPULoadOp,
    type SDL_GPUSampler,
    SDL_GPUStoreOp,
    type SDL_GPUTexture,
    SDL_GPUTextureFormat,
    type SDL_GPUTextureSamplerBinding,
    SDL_PushGPUFragmentUniformData,
    SDL_ReleaseGPUGraphicsPipeline,
    SDL_ReleaseGPUShader,
} from "../../bindings/SDL3";
import { exposure } from "../config.ts";
import type { TonemapUniform } from "../frame/uniforms.ts";
import { createFullscreenPipeline } from "../gpu/pipeline.ts";
import { tonemapFsMain, tonemapVsMain } from "../shaders.generated.ts";

export class TonemapPass {
    private pipeline: Pointer<SDL_GPUGraphicsPipeline> | null;

    constructor() {
        this.pipeline = null;
    }

    create(device: Pointer<SDL_GPUDevice>, swapchainFormat: SDL_GPUTextureFormat): boolean {
        const vertex = tonemapVsMain(device);
        const fragment = tonemapFsMain(device);
        if (vertex === null || fragment === null) {
            return false;
        }

        this.pipeline = createFullscreenPipeline(device, vertex, fragment, swapchainFormat, "tonemap");

        SDL_ReleaseGPUShader(device, vertex);
        SDL_ReleaseGPUShader(device, fragment);
        return this.pipeline !== null;
    }

    /**
     * `swapchainIsSrgb` comes from the format the platform actually handed back.
     * `bypass` skips the filmic curve, for a debug view whose pixels are data.
     */
    fillParams(params: Pointer<TonemapUniform>, swapchainIsSrgb: boolean, bypass: boolean): void {
        params.settings = new fvec4(
            exposure(),
            swapchainIsSrgb ? 1.0 : 0.0,
            bypass ? 1.0 : 0.0,
            0.0,
        );
    }

    record(
        cmd: Pointer<SDL_GPUCommandBuffer>,
        swapchain: Pointer<SDL_GPUTexture>,
        scene: Pointer<SDL_GPUTexture>,
        sceneSampler: Pointer<SDL_GPUSampler>,
        params: Pointer<TonemapUniform>,
        paramBytes: u32,
    ): void {
        const pipeline = this.pipeline;
        if (pipeline === null) {
            return;
        }

        const target = alloc<SDL_GPUColorTargetInfo>({
            texture: swapchain,
            // The fullscreen triangle covers every pixel, so there is nothing to
            // preserve and nothing worth clearing.
            load_op: SDL_GPULoadOp.DONT_CARE,
            store_op: SDL_GPUStoreOp.STORE,
        });

        const pass = SDL_BeginGPURenderPass(cmd, target, 1, null);
        target.free();

        if (pass === null) {
            console.log(`tonemap: pass failed : ${stringFromCString(SDL_GetError())}`);
            return;
        }

        SDL_BindGPUGraphicsPipeline(pass, pipeline);

        const binding = allocArray<SDL_GPUTextureSamplerBinding>(1);
        binding[0].texture = scene;
        binding[0].sampler = sceneSampler;
        SDL_BindGPUFragmentSamplers(pass, 0, binding, 1);
        binding.freeArray();

        SDL_PushGPUFragmentUniformData(cmd, 0, params, paramBytes);
        SDL_DrawGPUPrimitives(pass, 3, 1, 0, 0);
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
