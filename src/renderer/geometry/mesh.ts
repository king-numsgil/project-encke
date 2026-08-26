// A mesh on the GPU: one vertex buffer, one index buffer, and the draw.
//
// Indices are 32-bit throughout. 16-bit would halve the index buffer and is the
// usual advice, but it caps a mesh at 65536 vertices and this renderer has no
// mesh loader yet — so the cap would exist to save a few kilobytes of procedural
// geometry. Revisit when glTF arrives and meshes stop being boxes.

import {
    SDL_BindGPUIndexBuffer,
    SDL_BindGPUVertexBuffers,
    SDL_DrawGPUIndexedPrimitives,
    type SDL_GPUBuffer,
    type SDL_GPUBufferBinding,
    SDL_GPUBufferUsageFlags,
    type SDL_GPUDevice,
    SDL_GPUIndexElementSize,
    type SDL_GPURenderPass,
} from "../../bindings/SDL3";
import { createBuffer, releaseBuffer, Staging } from "../gpu/buffer.ts";
import { type MeshData, vertexStride } from "./meshdata.ts";

export class GpuMesh {
    private vertices: Pointer<SDL_GPUBuffer> | null;
    private indices: Pointer<SDL_GPUBuffer> | null;

    /**
     * The two binding structs {@link draw} hands to SDL, built once at upload.
     *
     * Both are `{ buffer, offset }` over a handle fixed at upload and an offset
     * that is always zero, so there is nothing per-frame in either of them.
     * Building them inside `draw` instead cost a malloc and a free *per draw
     * call* — and a mesh is drawn once per cascade, once per spot tile, once in
     * the pre-pass and once in the forward pass, so the scene's draw count is
     * ten times its instance count and every one of them paid twice.
     *
     * Same reasoning as the renderer's uniform scratch: a block that is refilled
     * rather than reallocated, because there is never a second live value of it.
     */
    private vertexBinding: Pointer<SDL_GPUBufferBinding> | null;
    private indexBinding: Pointer<SDL_GPUBufferBinding> | null;

    /** Indices to draw. Zero until {@link upload} has succeeded. */
    indexCount: u32;

    constructor() {
        this.vertices = null;
        this.indices = null;
        this.vertexBinding = null;
        this.indexBinding = null;
        this.indexCount = 0;
    }

    /**
     * Build the buffers and fill them, blocking until they have landed.
     *
     * One staging buffer big enough for both streams, written in one mapping and
     * copied out in two — the vertices from offset 0 and the indices from just
     * past them. Two transfer buffers would work as well and allocate twice.
     */
    upload(device: Pointer<SDL_GPUDevice>, mesh: Reference<MeshData>, name: string): boolean {
        const vertexBytes = cast<u32>(mesh.vertices.length) * 4;
        const indexBytes = cast<u32>(mesh.indices.length) * 4;

        if (vertexBytes === 0 || indexBytes === 0) {
            console.log(`mesh: '${name}' is empty`);
            return false;
        }

        const vertexBuffer = createBuffer(
            device,
            SDL_GPUBufferUsageFlags.VERTEX,
            vertexBytes,
            `${name}.vertices`,
        );
        const indexBuffer = createBuffer(
            device,
            SDL_GPUBufferUsageFlags.INDEX,
            indexBytes,
            `${name}.indices`,
        );
        if (vertexBuffer === null || indexBuffer === null) {
            releaseBuffer(device, vertexBuffer);
            releaseBuffer(device, indexBuffer);
            return false;
        }

        const staging = new Staging();
        if (!staging.create(device, vertexBytes + indexBytes, `${name}.staging`)) {
            releaseBuffer(device, vertexBuffer);
            releaseBuffer(device, indexBuffer);
            return false;
        }

        if (!staging.map(false)) {
            staging.destroy();
            releaseBuffer(device, vertexBuffer);
            releaseBuffer(device, indexBuffer);
            return false;
        }

        const floats = staging.floats();
        for (let i: usize = 0; i < mesh.vertices.length; i++) {
            floats[i] = mesh.vertices[i];
        }

        // The same block seen as words, past the vertices. Both views alias one
        // mapping, which is the point — one upload, two streams.
        const words = staging.words();
        const indexBase = mesh.vertices.length;
        for (let i: usize = 0; i < mesh.indices.length; i++) {
            words[indexBase + i] = mesh.indices[i];
        }

        staging.unmap();

        const ok =
            staging.flushOnce(vertexBuffer, 0, vertexBytes) &&
            staging.flushOnce(indexBuffer, vertexBytes, indexBytes);
        staging.destroy();

        if (!ok) {
            releaseBuffer(device, vertexBuffer);
            releaseBuffer(device, indexBuffer);
            return false;
        }

        this.vertices = vertexBuffer;
        this.indices = indexBuffer;
        // Allocated last, so none of the failure paths above has one to release.
        this.vertexBinding = alloc<SDL_GPUBufferBinding>({
            buffer: vertexBuffer,
            offset: 0,
        });
        this.indexBinding = alloc<SDL_GPUBufferBinding>({
            buffer: indexBuffer,
            offset: 0,
        });
        this.indexCount = cast<u32>(mesh.indices.length);
        return true;
    }

    /** Bind and draw one instance. The pipeline is the caller's. */
    draw(pass: Pointer<SDL_GPURenderPass>): void {
        const vertexBinding = this.vertexBinding;
        const indexBinding = this.indexBinding;
        if (vertexBinding === null || indexBinding === null) {
            return;
        }

        SDL_BindGPUVertexBuffers(pass, 0, vertexBinding, 1);
        SDL_BindGPUIndexBuffer(pass, indexBinding, SDL_GPUIndexElementSize._32BIT);
        SDL_DrawGPUIndexedPrimitives(pass, this.indexCount, 1, 0, 0, 0);
    }

    release(device: Pointer<SDL_GPUDevice>): void {
        releaseBuffer(device, this.vertices);
        releaseBuffer(device, this.indices);
        if (this.vertexBinding !== null) {
            this.vertexBinding.free();
        }
        if (this.indexBinding !== null) {
            this.indexBinding.free();
        }
        this.vertices = null;
        this.indices = null;
        this.vertexBinding = null;
        this.indexBinding = null;
        this.indexCount = 0;
    }
}

/** The vertex layout every pipeline in this renderer declares. */
export function meshVertexPitch(): u32 {
    return vertexStride();
}
