// The four compute dispatches that decide which lights touch which froxels.
//
// Order, and why:
//
//   1. **build** — view-space AABB per cluster. Only when the projection or the
//      render size changes, because that is all the bounds depend on. Clustering
//      in view space rather than world space is what makes that true; in world
//      space these would be rebuilt every time the camera turned.
//   2. **clear** — zero the active flags.
//   3. **mark** — one thread per pixel of the depth buffer, flagging the cluster
//      each visible fragment fell into. This is where the depth pre-pass pays
//      for itself.
//   4. **cull** — one workgroup per cluster, skipping the ones nothing marked,
//      then sphere-versus-AABB against every light and a sort of what survived.
//
// Each is its own compute pass, because a pass declares its read-write bindings
// up front and no two of these write the same set.

import {
    SDL_BeginGPUComputePass,
    SDL_BindGPUComputePipeline,
    SDL_BindGPUComputeSamplers,
    SDL_BindGPUComputeStorageBuffers,
    SDL_DispatchGPUCompute,
    SDL_EndGPUComputePass,
    SDL_GetError,
    type SDL_GPUBuffer,
    type SDL_GPUCommandBuffer,
    type SDL_GPUComputePipeline,
    type SDL_GPUDevice,
    type SDL_GPUSampler,
    type SDL_GPUStorageBufferReadWriteBinding,
    type SDL_GPUTexture,
    type SDL_GPUTextureSamplerBinding,
    SDL_PushGPUComputeUniformData,
    SDL_ReleaseGPUComputePipeline,
} from "../../graphics/sdl/index.ts";
import {
    clusterCount,
    clusterLinearWorkgroup,
    clusterMarkWorkgroup,
} from "../config.ts";
import type { ClusterBuffers } from "../cluster/buffers.ts";
import type { FrameUniform } from "../frame/uniforms.ts";
import {
    clusterBuildCsMain,
    clusterClearCsMain,
    clusterCullCsMain,
    clusterMarkCsMain,
} from "../shaders.generated.ts";

/** `ceil(value / divisor)`, for turning a thread count into a workgroup count. */
function groups(value: u32, divisor: u32): u32 {
    return (value + divisor - 1) / divisor;
}

export class ClusterPasses {
    private build: Pointer<SDL_GPUComputePipeline> | null;
    private clear: Pointer<SDL_GPUComputePipeline> | null;
    private mark: Pointer<SDL_GPUComputePipeline> | null;
    private cull: Pointer<SDL_GPUComputePipeline> | null;

    /** False when the bounds need rebuilding — at startup and after every resize. */
    private boundsValid: boolean;

    constructor() {
        this.build = null;
        this.clear = null;
        this.mark = null;
        this.cull = null;
        this.boundsValid = false;
    }

    create(device: Pointer<SDL_GPUDevice>): boolean {
        this.build = clusterBuildCsMain(device);
        this.clear = clusterClearCsMain(device);
        this.mark = clusterMarkCsMain(device);
        this.cull = clusterCullCsMain(device);
        this.boundsValid = false;

        return this.build !== null && this.clear !== null && this.mark !== null && this.cull !== null;
    }

    /** Call after anything that changes the frustum or the render size. */
    invalidate(): void {
        this.boundsValid = false;
    }

    /**
     * Record every cluster dispatch for this frame.
     *
     * `frame` must already hold this frame's values — it is pushed to each
     * pipeline that reads it, and a stale projection here would put lights in
     * the wrong froxels rather than fail.
     */
    record(
        cmd: Pointer<SDL_GPUCommandBuffer>,
        buffers: Reference<ClusterBuffers>,
        frame: Pointer<FrameUniform>,
        frameBytes: u32,
        depth: Pointer<SDL_GPUTexture>,
        depthSampler: Pointer<SDL_GPUSampler>,
        width: u32,
        height: u32,
    ): void {
        const bounds = buffers.bounds;
        const active = buffers.active;
        const lightCount = buffers.lightCount;
        const lightIndex = buffers.lightIndex;
        const lights = buffers.lights;

        if (bounds === null || active === null || lightCount === null || lightIndex === null || lights === null) {
            return;
        }

        if (!this.boundsValid) {
            this.recordBuild(cmd, bounds, frame, frameBytes);
            this.boundsValid = true;
        }

        this.recordClear(cmd, active);
        this.recordMark(cmd, active, depth, depthSampler, frame, frameBytes, width, height);
        this.recordCull(cmd, bounds, lights, active, lightCount, lightIndex, frame, frameBytes);
    }

    private recordBuild(
        cmd: Pointer<SDL_GPUCommandBuffer>,
        bounds: Pointer<SDL_GPUBuffer>,
        frame: Pointer<FrameUniform>,
        frameBytes: u32,
    ): void {
        const pipeline = this.build;
        if (pipeline === null) {
            return;
        }

        const writes = allocArray<SDL_GPUStorageBufferReadWriteBinding>(1);
        writes[0].buffer = bounds;
        writes[0].cycle = false;

        const pass = SDL_BeginGPUComputePass(cmd, null, 0, writes, 1);
        writes.freeArray();

        if (pass === null) {
            console.log(`clusters: build pass failed : ${stringFromCString(SDL_GetError())}`);
            return;
        }

        SDL_PushGPUComputeUniformData(cmd, 0, frame, frameBytes);
        SDL_BindGPUComputePipeline(pass, pipeline);
        SDL_DispatchGPUCompute(pass, groups(clusterCount(), clusterLinearWorkgroup()), 1, 1);
        SDL_EndGPUComputePass(pass);
    }

    private recordClear(cmd: Pointer<SDL_GPUCommandBuffer>, active: Pointer<SDL_GPUBuffer>): void {
        const pipeline = this.clear;
        if (pipeline === null) {
            return;
        }

        const writes = allocArray<SDL_GPUStorageBufferReadWriteBinding>(1);
        writes[0].buffer = active;
        writes[0].cycle = false;

        const pass = SDL_BeginGPUComputePass(cmd, null, 0, writes, 1);
        writes.freeArray();

        if (pass === null) {
            console.log(`clusters: clear pass failed : ${stringFromCString(SDL_GetError())}`);
            return;
        }

        SDL_BindGPUComputePipeline(pass, pipeline);
        SDL_DispatchGPUCompute(pass, groups(clusterCount(), clusterLinearWorkgroup()), 1, 1);
        SDL_EndGPUComputePass(pass);
    }

    private recordMark(
        cmd: Pointer<SDL_GPUCommandBuffer>,
        active: Pointer<SDL_GPUBuffer>,
        depth: Pointer<SDL_GPUTexture>,
        depthSampler: Pointer<SDL_GPUSampler>,
        frame: Pointer<FrameUniform>,
        frameBytes: u32,
        width: u32,
        height: u32,
    ): void {
        const pipeline = this.mark;
        if (pipeline === null) {
            return;
        }

        const writes = allocArray<SDL_GPUStorageBufferReadWriteBinding>(1);
        writes[0].buffer = active;
        writes[0].cycle = false;

        const pass = SDL_BeginGPUComputePass(cmd, null, 0, writes, 1);
        writes.freeArray();

        if (pass === null) {
            console.log(`clusters: mark pass failed : ${stringFromCString(SDL_GetError())}`);
            return;
        }

        // The shader only calls `textureLoad`, but SDL reserves a *combined*
        // texture-sampler slot per texture, so a sampler still has to arrive.
        const textures = allocArray<SDL_GPUTextureSamplerBinding>(1);
        textures[0].texture = depth;
        textures[0].sampler = depthSampler;
        SDL_BindGPUComputeSamplers(pass, 0, textures, 1);
        textures.freeArray();

        SDL_PushGPUComputeUniformData(cmd, 0, frame, frameBytes);
        SDL_BindGPUComputePipeline(pass, pipeline);

        const tile = clusterMarkWorkgroup();
        SDL_DispatchGPUCompute(pass, groups(width, tile), groups(height, tile), 1);
        SDL_EndGPUComputePass(pass);
    }

    private recordCull(
        cmd: Pointer<SDL_GPUCommandBuffer>,
        bounds: Pointer<SDL_GPUBuffer>,
        lights: Pointer<SDL_GPUBuffer>,
        active: Pointer<SDL_GPUBuffer>,
        lightCount: Pointer<SDL_GPUBuffer>,
        lightIndex: Pointer<SDL_GPUBuffer>,
        frame: Pointer<FrameUniform>,
        frameBytes: u32,
    ): void {
        const pipeline = this.cull;
        if (pipeline === null) {
            return;
        }

        const writes = allocArray<SDL_GPUStorageBufferReadWriteBinding>(2);
        writes[0].buffer = lightCount;
        writes[0].cycle = false;
        writes[1].buffer = lightIndex;
        writes[1].cycle = false;

        const pass = SDL_BeginGPUComputePass(cmd, null, 0, writes, 2);
        writes.freeArray();

        if (pass === null) {
            console.log(`clusters: cull pass failed : ${stringFromCString(SDL_GetError())}`);
            return;
        }

        // Slot order is the shader's `@binding` order within the read-only
        // storage kind: bounds, lights, cluster_active.
        const reads = allocArray<Pointer<SDL_GPUBuffer>>(3);
        reads[0] = bounds;
        reads[1] = lights;
        reads[2] = active;
        SDL_BindGPUComputeStorageBuffers(pass, 0, reads, 3);
        reads.freeArray();

        SDL_PushGPUComputeUniformData(cmd, 0, frame, frameBytes);
        SDL_BindGPUComputePipeline(pass, pipeline);

        // One workgroup per cluster. The workgroup returns immediately for a
        // cluster nothing marked, which is the whole point of the marking pass.
        SDL_DispatchGPUCompute(pass, clusterCount(), 1, 1);
        SDL_EndGPUComputePass(pass);
    }

    release(device: Pointer<SDL_GPUDevice>): void {
        releasePipeline(device, this.build);
        releasePipeline(device, this.clear);
        releasePipeline(device, this.mark);
        releasePipeline(device, this.cull);
        this.build = null;
        this.clear = null;
        this.mark = null;
        this.cull = null;
    }
}

function releasePipeline(
    device: Pointer<SDL_GPUDevice>,
    pipeline: Pointer<SDL_GPUComputePipeline> | null,
): void {
    if (pipeline !== null) {
        SDL_ReleaseGPUComputePipeline(device, pipeline);
    }
}
