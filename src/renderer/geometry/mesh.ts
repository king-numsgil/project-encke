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

    /** Indices to draw. Zero until {@link upload} has succeeded. */
    indexCount: u32;

    constructor() {
        this.vertices = null;
        this.indices = null;
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
        this.indexCount = cast<u32>(mesh.indices.length);
        return true;
    }

    /** Bind and draw one instance. The pipeline is the caller's. */
    draw(pass: Pointer<SDL_GPURenderPass>): void {
        const vertices = this.vertices;
        const indices = this.indices;
        if (vertices === null || indices === null) {
            return;
        }

        const vertexBinding = alloc<SDL_GPUBufferBinding>({
            buffer: vertices,
            offset: 0,
        });
        SDL_BindGPUVertexBuffers(pass, 0, vertexBinding, 1);
        vertexBinding.free();

        const indexBinding = alloc<SDL_GPUBufferBinding>({
            buffer: indices,
            offset: 0,
        });
        SDL_BindGPUIndexBuffer(pass, indexBinding, SDL_GPUIndexElementSize._32BIT);
        indexBinding.free();

        SDL_DrawGPUIndexedPrimitives(pass, this.indexCount, 1, 0, 0, 0);
    }

    release(device: Pointer<SDL_GPUDevice>): void {
        releaseBuffer(device, this.vertices);
        releaseBuffer(device, this.indices);
        this.vertices = null;
        this.indices = null;
        this.indexCount = 0;
    }
}

/** The vertex layout every pipeline in this renderer declares. */
export function meshVertexPitch(): u32 {
    return vertexStride();
}
