// The opaque depth pre-pass.
//
// Two jobs, and the second is the one that makes it mandatory:
//
//   1. It removes overdraw from the forward pass, which then runs its light loop
//      exactly once per pixel because the pipeline tests depth `EQUAL`.
//   2. It gives the cluster marking pass a depth buffer to read, so light
//      culling runs against the scene's real depth complexity rather than the
//      whole froxel volume.
//
// The vertex transform here and the one in `forward.wgsl` must produce bit-identical
// clip positions, or fragments fail the `EQUAL` test and disappear. Both spell it
// `view_proj * (model * position)` — the same matrices in the same order — and
// that is a constraint on the shaders rather than a coincidence between them.

import {
    SDL_BeginGPURenderPass,
    SDL_BindGPUGraphicsPipeline,
    SDL_EndGPURenderPass,
    SDL_GetError,
    type SDL_GPUCommandBuffer,
    SDL_GPUCullMode,
    type SDL_GPUDepthStencilTargetInfo,
    type SDL_GPUDevice,
    type SDL_GPUGraphicsPipeline,
    SDL_GPULoadOp,
    SDL_GPUStoreOp,
    type SDL_GPUTexture,
    SDL_GPUTextureFormat,
    SDL_PushGPUVertexUniformData,
    SDL_ReleaseGPUGraphicsPipeline,
    SDL_ReleaseGPUShader,
} from "../../graphics/sdl/index.ts";
import { fillObject, type FrameUniform, type ObjectUniform } from "../frame/uniforms.ts";
import { createDepthOnlyPipeline } from "../gpu/pipeline.ts";
import type { Scene } from "../scene/scene.ts";
import { depthPrepassFsMain, depthPrepassVsMain } from "../shaders.generated.ts";

export class DepthPrepass {
    private pipeline: Pointer<SDL_GPUGraphicsPipeline> | null;

    constructor() {
        this.pipeline = null;
    }

    create(device: Pointer<SDL_GPUDevice>, depthFormat: SDL_GPUTextureFormat): boolean {
        const vertex = depthPrepassVsMain(device);
        const fragment = depthPrepassFsMain(device);
        if (vertex === null || fragment === null) {
            return false;
        }

        this.pipeline = createDepthOnlyPipeline(
            device,
            vertex,
            fragment,
            depthFormat,
            SDL_GPUCullMode.BACK,
            // No bias. This buffer is compared against with `EQUAL` by the
            // forward pass, so any offset here would make every fragment fail.
            0.0,
            0.0,
            "depth-prepass",
        );

        // The shaders are baked into the pipeline now.
        SDL_ReleaseGPUShader(device, vertex);
        SDL_ReleaseGPUShader(device, fragment);
        return this.pipeline !== null;
    }

    record(
        cmd: Pointer<SDL_GPUCommandBuffer>,
        depth: Pointer<SDL_GPUTexture>,
        scene: Reference<Scene>,
        frame: Pointer<FrameUniform>,
        frameBytes: u32,
        object: Pointer<ObjectUniform>,
        objectBytes: u32,
    ): void {
        const pipeline = this.pipeline;
        if (pipeline === null) {
            return;
        }

        const target = alloc<SDL_GPUDepthStencilTargetInfo>({
            texture: depth,
            clear_depth: 1.0,
            load_op: SDL_GPULoadOp.CLEAR,
            // STORE, not DONT_CARE: three later passes read this buffer, and it
            // is also what the forward pass tests against.
            store_op: SDL_GPUStoreOp.STORE,
            stencil_load_op: SDL_GPULoadOp.DONT_CARE,
            stencil_store_op: SDL_GPUStoreOp.DONT_CARE,
            cycle: true,
        });

        const pass = SDL_BeginGPURenderPass(cmd, null, 0, target);
        target.free();

        if (pass === null) {
            console.log(`depth: pass failed : ${stringFromCString(SDL_GetError())}`);
            return;
        }

        SDL_BindGPUGraphicsPipeline(pass, pipeline);

        // Uniforms are pushed to the *command buffer* and apply to every draw
        // recorded after them, so the frame block is pushed once and only the
        // per-object block moves inside the loop.
        SDL_PushGPUVertexUniformData(cmd, 0, frame, frameBytes);

        for (let i: usize = 0; i < scene.instances.length; i++) {
            fillObject(object, scene.instances[i].transform);
            SDL_PushGPUVertexUniformData(cmd, 1, object, objectBytes);
            scene.meshes[scene.instances[i].mesh].draw(pass);
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
