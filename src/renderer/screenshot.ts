// Reading a rendered frame back as a PNG.
//
// **Not from the swapchain.** A swapchain texture belongs to the presentation
// engine and is not a thing to download from; the renderer draws its tonemapped
// output into an ordinary colour target instead, and that target is what this
// reads. The extra target exists only when `--screenshot` was asked for, so the
// shipping path never pays for it — which matters, because a full-screen copy
// every frame is exactly the kind of thing that quietly ruins a benchmark.
//
// The texture must be an 8-bit-per-channel format. The HDR scene buffer is
// `R16G16B16A16_FLOAT` and there is no `SDL_Surface` conversion for it, which is
// the other reason this reads the post-tonemap target rather than the scene.

import {
    SDL_AcquireGPUCommandBuffer,
    SDL_BeginGPUCopyPass,
    SDL_CreateGPUTransferBuffer,
    SDL_CreateSurfaceFrom,
    SDL_DestroySurface,
    SDL_DownloadFromGPUTexture,
    SDL_EndGPUCopyPass,
    SDL_GetError,
    SDL_GetPixelFormatFromGPUTextureFormat,
    type SDL_GPUDevice,
    type SDL_GPUTexture,
    SDL_GPUTextureFormat,
    type SDL_GPUTextureRegion,
    type SDL_GPUTextureTransferInfo,
    type SDL_GPUTransferBufferCreateInfo,
    SDL_GPUTransferBufferUsage,
    SDL_MapGPUTransferBuffer,
    SDL_ReleaseGPUTransferBuffer,
    SDL_SavePNG,
    SDL_SubmitGPUCommandBuffer,
    SDL_UnmapGPUTransferBuffer,
    SDL_WaitForGPUIdle,
} from "../bindings/SDL3";

/**
 * Download `texture` and write it out.
 *
 * Blocking, via `SDL_WaitForGPUIdle`: nothing may read the transfer buffer until
 * the copy has actually run, and a screenshot is a one-shot where the ceremony
 * of a fence buys nothing. A frame loop would use a fence; this is not one.
 */
export function saveTexturePng(
    device: Pointer<SDL_GPUDevice>,
    texture: Pointer<SDL_GPUTexture>,
    format: SDL_GPUTextureFormat,
    width: u32,
    height: u32,
    path: string,
): boolean {
    const bufferInfo = alloc<SDL_GPUTransferBufferCreateInfo>({
        usage: SDL_GPUTransferBufferUsage.DOWNLOAD,
        size: width * height * 4,
    });
    const transfer = SDL_CreateGPUTransferBuffer(device, bufferInfo);
    bufferInfo.free();

    if (transfer === null) {
        console.log(`screenshot: transfer buffer failed : ${stringFromCString(SDL_GetError())}`);
        return false;
    }

    const cmd = SDL_AcquireGPUCommandBuffer(device);
    if (cmd === null) {
        console.log(`screenshot: command buffer failed : ${stringFromCString(SDL_GetError())}`);
        SDL_ReleaseGPUTransferBuffer(device, transfer);
        return false;
    }

    const source = alloc<SDL_GPUTextureRegion>({
        texture: texture,
        w: width,
        h: height,
        d: 1,
    });
    const destination = alloc<SDL_GPUTextureTransferInfo>({
        transfer_buffer: transfer,
        // Zero would mean "tightly packed", which is the same thing here.
        // Written out because the pitch below is built from it.
        pixels_per_row: width,
        rows_per_layer: height,
    });

    const pass = SDL_BeginGPUCopyPass(cmd);
    if (pass === null) {
        console.log(`screenshot: copy pass failed : ${stringFromCString(SDL_GetError())}`);
        source.free();
        destination.free();
        SDL_SubmitGPUCommandBuffer(cmd);
        SDL_ReleaseGPUTransferBuffer(device, transfer);
        return false;
    }

    SDL_DownloadFromGPUTexture(pass, source, destination);
    SDL_EndGPUCopyPass(pass);
    source.free();
    destination.free();

    SDL_SubmitGPUCommandBuffer(cmd);
    SDL_WaitForGPUIdle(device);

    const pixels = SDL_MapGPUTransferBuffer(device, transfer, false);
    if (pixels === null) {
        console.log(`screenshot: map failed : ${stringFromCString(SDL_GetError())}`);
        SDL_ReleaseGPUTransferBuffer(device, transfer);
        return false;
    }

    // SDL knows the translation between its GPU and surface format spellings, so
    // there is no guessing at whether R8G8B8A8 is ABGR8888 on this endianness.
    const surface = SDL_CreateSurfaceFrom(
        cast<i32>(width),
        cast<i32>(height),
        SDL_GetPixelFormatFromGPUTextureFormat(format),
        pixels,
        cast<i32>(width * 4),
    );

    let saved = false;
    if (surface === null) {
        console.log(`screenshot: surface failed : ${stringFromCString(SDL_GetError())}`);
    } else {
        saved = SDL_SavePNG(surface, cstring(path));
        if (!saved) {
            console.log(`screenshot: saving ${path} failed : ${stringFromCString(SDL_GetError())}`);
        }
        SDL_DestroySurface(surface);
    }

    SDL_UnmapGPUTransferBuffer(device, transfer);
    SDL_ReleaseGPUTransferBuffer(device, transfer);
    return saved;
}
