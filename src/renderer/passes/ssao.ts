// Ambient occlusion: estimate, then blur.
//
// Both at half resolution, and there is no upsample pass. The forward shader
// samples the blurred target with a *linear* sampler at full-resolution UVs, so
// the hardware's bilinear filter is the upsample — which is why the occlusion
// texture is bound with `createLinearClamp` there and nowhere else in this
// renderer cares about that sampler.
//
// The blur is a plain 4x4 box rather than anything bilateral. Its width is not
// arbitrary: the estimator rotates its tap spiral by interleaved gradient noise,
// which repeats every four pixels, so a four-wide box averages exactly one
// period and removes the pattern completely.

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
    type SDL_GPURenderPass,
    type SDL_GPUSampler,
    SDL_GPUStoreOp,
    type SDL_GPUTexture,
    SDL_GPUTextureFormat,
    type SDL_GPUTextureSamplerBinding,
    SDL_PushGPUFragmentUniformData,
    SDL_ReleaseGPUGraphicsPipeline,
    SDL_ReleaseGPUShader,
} from "../../bindings/SDL3";
import { ssaoBias, ssaoIntensity, ssaoMaxRadiusPixels, ssaoRadius } from "../config.ts";
import type { FrameUniform, SsaoUniform } from "../frame/uniforms.ts";
import { createFullscreenPipeline } from "../gpu/pipeline.ts";
import { ssaoBlurFsMain, ssaoBlurVsMain, ssaoFsMain, ssaoVsMain } from "../shaders.generated.ts";

export class SsaoPass {
    private estimate: Pointer<SDL_GPUGraphicsPipeline> | null;
    private blur: Pointer<SDL_GPUGraphicsPipeline> | null;

    constructor() {
        this.estimate = null;
        this.blur = null;
    }

    create(device: Pointer<SDL_GPUDevice>, format: SDL_GPUTextureFormat): boolean {
        const estimateVs = ssaoVsMain(device);
        const estimateFs = ssaoFsMain(device);
        const blurVs = ssaoBlurVsMain(device);
        const blurFs = ssaoBlurFsMain(device);

        if (estimateVs === null || estimateFs === null || blurVs === null || blurFs === null) {
            return false;
        }

        this.estimate = createFullscreenPipeline(device, estimateVs, estimateFs, format, "ssao");
        this.blur = createFullscreenPipeline(device, blurVs, blurFs, format, "ssao-blur");

        SDL_ReleaseGPUShader(device, estimateVs);
        SDL_ReleaseGPUShader(device, estimateFs);
        SDL_ReleaseGPUShader(device, blurVs);
        SDL_ReleaseGPUShader(device, blurFs);

        return this.estimate !== null && this.blur !== null;
    }

    /** Fill the SSAO parameter block. Its own function so the tuning is in one place. */
    fillParams(params: Pointer<SsaoUniform>, width: u32, height: u32): void {
        const w = cast<f32>(width);
        const h = cast<f32>(height);

        params.settings = new fvec4(ssaoRadius(), ssaoBias(), ssaoIntensity(), ssaoMaxRadiusPixels());
        params.extent = new fvec4(w, h, 1.0 / w, 1.0 / h);
    }

    record(
        cmd: Pointer<SDL_GPUCommandBuffer>,
        depth: Pointer<SDL_GPUTexture>,
        depthSampler: Pointer<SDL_GPUSampler>,
        raw: Pointer<SDL_GPUTexture>,
        blurred: Pointer<SDL_GPUTexture>,
        frame: Pointer<FrameUniform>,
        frameBytes: u32,
        params: Pointer<SsaoUniform>,
        paramBytes: u32,
    ): void {
        const estimate = this.estimate;
        const blur = this.blur;
        if (estimate === null || blur === null) {
            return;
        }

        // -- estimate, from depth --
        const estimatePass = beginFullscreen(cmd, raw, "ssao");
        if (estimatePass !== null) {
            SDL_BindGPUGraphicsPipeline(estimatePass, estimate);
            bindTexture(estimatePass, depth, depthSampler);
            SDL_PushGPUFragmentUniformData(cmd, 0, frame, frameBytes);
            SDL_PushGPUFragmentUniformData(cmd, 1, params, paramBytes);
            SDL_DrawGPUPrimitives(estimatePass, 3, 1, 0, 0);
            SDL_EndGPURenderPass(estimatePass);
        }

        // -- blur the noise out --
        const blurPass = beginFullscreen(cmd, blurred, "ssao-blur");
        if (blurPass !== null) {
            SDL_BindGPUGraphicsPipeline(blurPass, blur);
            // The blur only calls `textureLoad`, but SDL reserves a combined
            // texture-sampler slot per texture, so a sampler still arrives.
            bindTexture(blurPass, raw, depthSampler);
            SDL_DrawGPUPrimitives(blurPass, 3, 1, 0, 0);
            SDL_EndGPURenderPass(blurPass);
        }
    }

    release(device: Pointer<SDL_GPUDevice>): void {
        if (this.estimate !== null) {
            SDL_ReleaseGPUGraphicsPipeline(device, this.estimate);
        }
        if (this.blur !== null) {
            SDL_ReleaseGPUGraphicsPipeline(device, this.blur);
        }
        this.estimate = null;
        this.blur = null;
    }
}

/** A colour-only pass that overwrites its target completely. */
function beginFullscreen(
    cmd: Pointer<SDL_GPUCommandBuffer>,
    texture: Pointer<SDL_GPUTexture>,
    name: string,
): Pointer<SDL_GPURenderPass> | null {
    const target = alloc<SDL_GPUColorTargetInfo>({
        texture: texture,
        // DONT_CARE, not CLEAR: the fullscreen triangle covers every pixel, so
        // clearing first is a write nothing reads.
        load_op: SDL_GPULoadOp.DONT_CARE,
        store_op: SDL_GPUStoreOp.STORE,
        cycle: true,
    });

    const pass = SDL_BeginGPURenderPass(cmd, target, 1, null);
    target.free();

    if (pass === null) {
        console.log(`ssao: ${name} pass failed : ${stringFromCString(SDL_GetError())}`);
    }
    return pass;
}

function bindTexture(
    pass: Pointer<SDL_GPURenderPass>,
    texture: Pointer<SDL_GPUTexture>,
    sampler: Pointer<SDL_GPUSampler>,
): void {
    const binding = allocArray<SDL_GPUTextureSamplerBinding>(1);
    binding[0].texture = texture;
    binding[0].sampler = sampler;
    SDL_BindGPUFragmentSamplers(pass, 0, binding, 1);
    binding.freeArray();
}
