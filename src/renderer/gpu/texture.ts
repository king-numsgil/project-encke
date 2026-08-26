// Render targets.
//
// Three shapes are needed and each has a usage flag combination that is easy to
// get subtly wrong — a texture created without `SAMPLER` cannot be read back by
// a later pass, and the error arrives as a validation message about a descriptor
// rather than as anything naming the texture.

import {
    SDL_CreateGPUTexture,
    SDL_GetError,
    type SDL_GPUDevice,
    type SDL_GPUTexture,
    type SDL_GPUTextureCreateInfo,
    SDL_GPUTextureFormat,
    SDL_GPUTextureUsageFlags,
    SDL_ReleaseGPUTexture,
    SDL_SetGPUTextureName,
} from "../../bindings/SDL3";

/**
 * A colour target that a later pass will sample.
 *
 * Both flags, always. Every colour target in this renderer is read by something
 * downstream — the HDR scene by the tonemap, the occlusion buffer by the blur
 * and then by the forward pass — so there is no case here for a write-only one.
 */
export function createColorTarget(
    device: Pointer<SDL_GPUDevice>,
    format: SDL_GPUTextureFormat,
    width: u32,
    height: u32,
    name: string,
): Pointer<SDL_GPUTexture> | null {
    return create(
        device,
        format,
        SDL_GPUTextureUsageFlags.COLOR_TARGET | SDL_GPUTextureUsageFlags.SAMPLER,
        width,
        height,
        name,
    );
}

/**
 * A depth target that a later pass will sample.
 *
 * `SAMPLER` matters here more than anywhere: the cluster marking pass reads the
 * depth buffer, SSAO reads it, and the shadow atlases are read by the forward
 * pass. A depth buffer nothing samples would be the exception in this renderer.
 */
export function createDepthTarget(
    device: Pointer<SDL_GPUDevice>,
    format: SDL_GPUTextureFormat,
    width: u32,
    height: u32,
    name: string,
): Pointer<SDL_GPUTexture> | null {
    return create(
        device,
        format,
        SDL_GPUTextureUsageFlags.DEPTH_STENCIL_TARGET | SDL_GPUTextureUsageFlags.SAMPLER,
        width,
        height,
        name,
    );
}

function create(
    device: Pointer<SDL_GPUDevice>,
    format: SDL_GPUTextureFormat,
    usage: SDL_GPUTextureUsageFlags,
    width: u32,
    height: u32,
    name: string,
): Pointer<SDL_GPUTexture> | null {
    const info = alloc<SDL_GPUTextureCreateInfo>({
        format: format,
        usage: usage,
        width: width,
        height: height,
        layer_count_or_depth: 1,
        num_levels: 1,
    });
    const texture = SDL_CreateGPUTexture(device, info);
    info.free();

    if (texture === null) {
        console.log(`texture: '${name}' ${width}x${height} failed : ${stringFromCString(SDL_GetError())}`);
        return null;
    }

    SDL_SetGPUTextureName(device, texture, cstring(name));
    return texture;
}

/** Release a texture, tolerating null. */
export function releaseTexture(device: Pointer<SDL_GPUDevice>, texture: Pointer<SDL_GPUTexture> | null): void {
    if (texture !== null) {
        SDL_ReleaseGPUTexture(device, texture);
    }
}
