// GPU buffers, and the transfer buffers that fill them.
//
// SDL has no "write these bytes into that buffer" call. Everything goes through
// a transfer buffer: map it, write, then record a copy inside a copy pass. Two
// shapes of that are wanted and they are genuinely different operations:
//
//   * {@link Staging.flushOnce} — its own command buffer, submitted and waited
//     on. For data written at load time. It stalls on purpose, so the buffer is
//     usable when the call returns.
//   * {@link Staging.record} — the copy recorded on a pass the *caller* owns,
//     which in practice is the frame's. For data that changes every frame. It
//     never waits, because mapping with `cycle` hands back fresh memory rather
//     than blocking on the copy still in flight.
//
// Writing into the mapped block is the caller's job and is done element by
// element through {@link Staging.floats} or {@link Staging.words}. There is no
// bulk copy from a `T[]`, because a Goblin array is a value and taking a raw
// pointer into one is not something the ambient surface offers.

import {
    SDL_AcquireGPUCommandBuffer,
    SDL_BeginGPUCopyPass,
    SDL_CreateGPUBuffer,
    SDL_CreateGPUTransferBuffer,
    SDL_EndGPUCopyPass,
    SDL_GetError,
    type SDL_GPUBuffer,
    type SDL_GPUBufferCreateInfo,
    type SDL_GPUBufferRegion,
    SDL_GPUBufferUsageFlags,
    type SDL_GPUCopyPass,
    type SDL_GPUDevice,
    type SDL_GPUTransferBuffer,
    type SDL_GPUTransferBufferCreateInfo,
    type SDL_GPUTransferBufferLocation,
    SDL_GPUTransferBufferUsage,
    SDL_MapGPUTransferBuffer,
    SDL_ReleaseGPUBuffer,
    SDL_ReleaseGPUTransferBuffer,
    SDL_SetGPUBufferName,
    SDL_SubmitGPUCommandBuffer,
    SDL_UnmapGPUTransferBuffer,
    SDL_UploadToGPUBuffer,
    SDL_WaitForGPUIdle,
} from "../../bindings/SDL3";

/**
 * A device-local buffer.
 *
 * `name` reaches a debugger only when the device was created in debug mode and
 * costs nothing otherwise — worth setting on everything, because a validation
 * message naming `cluster.light_index` is a different experience from one naming
 * `VkBuffer 0x2a`.
 */
export function createBuffer(
    device: Pointer<SDL_GPUDevice>,
    usage: SDL_GPUBufferUsageFlags,
    size: u32,
    name: string,
): Pointer<SDL_GPUBuffer> | null {
    const info = alloc<SDL_GPUBufferCreateInfo>({
        usage: usage,
        size: size,
    });
    const buffer = SDL_CreateGPUBuffer(device, info);
    info.free();

    if (buffer === null) {
        console.log(`buffer: '${name}' (${size} bytes) failed : ${stringFromCString(SDL_GetError())}`);
        return null;
    }

    SDL_SetGPUBufferName(device, buffer, cstring(name));
    return buffer;
}

/** Release a buffer, tolerating null so teardown paths need no check each. */
export function releaseBuffer(device: Pointer<SDL_GPUDevice>, buffer: Pointer<SDL_GPUBuffer> | null): void {
    if (buffer !== null) {
        SDL_ReleaseGPUBuffer(device, buffer);
    }
}

export class Staging {
    private device: Pointer<SDL_GPUDevice> | null;
    private buffer: Pointer<SDL_GPUTransferBuffer> | null;
    private mapped: Pointer<unknown> | null;
    private capacity: u32;

    constructor() {
        this.device = null;
        this.buffer = null;
        this.mapped = null;
        this.capacity = 0;
    }

    create(device: Pointer<SDL_GPUDevice>, size: u32, name: string): boolean {
        const info = alloc<SDL_GPUTransferBufferCreateInfo>({
            usage: SDL_GPUTransferBufferUsage.UPLOAD,
            size: size,
        });
        const buffer = SDL_CreateGPUTransferBuffer(device, info);
        info.free();

        if (buffer === null) {
            console.log(`staging: '${name}' (${size} bytes) failed : ${stringFromCString(SDL_GetError())}`);
            return false;
        }

        this.device = device;
        this.buffer = buffer;
        this.mapped = null;
        this.capacity = size;
        return true;
    }

    /** How many bytes this holds. */
    size(): u32 {
        return this.capacity;
    }

    /**
     * Map the block for writing.
     *
     * Pass `cycle` true inside a frame: it renames the transfer buffer rather
     * than waiting for a copy already in flight to finish with it. False at load
     * time, where there is nothing in flight and the rename is only waste.
     */
    map(cycle: boolean): boolean {
        const device = this.device;
        const buffer = this.buffer;
        if (device === null || buffer === null) {
            return false;
        }

        const mapped = SDL_MapGPUTransferBuffer(device, buffer, cycle);
        if (mapped === null) {
            console.log(`staging: map failed : ${stringFromCString(SDL_GetError())}`);
            return false;
        }

        this.mapped = mapped;
        return true;
    }

    /** The mapped block as floats. Valid only between {@link map} and {@link unmap}. */
    floats(): Pointer<f32> {
        const mapped = this.mapped;
        if (mapped === null) {
            // Never dereferenced: every caller has checked `map` succeeded, and
            // a null here is a crash at the write rather than silent corruption.
            return alloc<f32>();
        }
        return mapped.reify<f32>();
    }

    /** The same block as 32-bit words, for indices and light kinds. */
    words(): Pointer<u32> {
        const mapped = this.mapped;
        if (mapped === null) {
            return alloc<u32>();
        }
        return mapped.reify<u32>();
    }

    unmap(): void {
        const device = this.device;
        const buffer = this.buffer;
        if (device !== null && buffer !== null && this.mapped !== null) {
            SDL_UnmapGPUTransferBuffer(device, buffer);
        }
        this.mapped = null;
    }

    /**
     * Record the copy onto a pass the caller opened.
     *
     * `cycle: false` on the destination — it is a resource this renderer reads
     * in the same frame, so letting SDL rename it out from under the readers is
     * exactly wrong.
     */
    record(
        pass: Pointer<SDL_GPUCopyPass>,
        destination: Pointer<SDL_GPUBuffer>,
        destinationOffset: u32,
        sourceOffset: u32,
        size: u32,
    ): void {
        const buffer = this.buffer;
        if (buffer === null) {
            return;
        }

        const source = alloc<SDL_GPUTransferBufferLocation>({
            transfer_buffer: buffer,
            offset: sourceOffset,
        });
        const region = alloc<SDL_GPUBufferRegion>({
            buffer: destination,
            offset: destinationOffset,
            size: size,
        });

        SDL_UploadToGPUBuffer(pass, source, region, false);

        source.free();
        region.free();
    }

    /**
     * Copy on a command buffer of its own and wait for it.
     *
     * Load time only. `SDL_WaitForGPUIdle` rather than a fence because the queue
     * is empty here and the ceremony of a fence buys nothing.
     */
    flushOnce(destination: Pointer<SDL_GPUBuffer>, sourceOffset: u32, size: u32): boolean {
        const device = this.device;
        if (device === null) {
            return false;
        }

        const cmd = SDL_AcquireGPUCommandBuffer(device);
        if (cmd === null) {
            console.log(`staging: command buffer failed : ${stringFromCString(SDL_GetError())}`);
            return false;
        }

        const pass = SDL_BeginGPUCopyPass(cmd);
        if (pass === null) {
            console.log(`staging: copy pass failed : ${stringFromCString(SDL_GetError())}`);
            SDL_SubmitGPUCommandBuffer(cmd);
            return false;
        }

        this.record(pass, destination, 0, sourceOffset, size);
        SDL_EndGPUCopyPass(pass);
        SDL_SubmitGPUCommandBuffer(cmd);
        SDL_WaitForGPUIdle(device);
        return true;
    }

    destroy(): void {
        const device = this.device;
        const buffer = this.buffer;
        if (device !== null && buffer !== null) {
            SDL_ReleaseGPUTransferBuffer(device, buffer);
        }
        this.device = null;
        this.buffer = null;
        this.mapped = null;
        this.capacity = 0;
    }
}
