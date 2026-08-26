// The three samplers this renderer uses, and why each is the one it is.
//
// SDL binds a texture and a sampler together, and a shader that only ever calls
// `textureLoad` still needs one on its slot — `num_samplers` counts textures,
// not sampler objects. {@link createNearestClamp} is what those slots get.

import {
    SDL_CreateGPUSampler,
    SDL_GetError,
    SDL_GPUCompareOp,
    type SDL_GPUDevice,
    SDL_GPUFilter,
    type SDL_GPUSampler,
    SDL_GPUSamplerAddressMode,
    type SDL_GPUSamplerCreateInfo,
    SDL_GPUSamplerMipmapMode,
    SDL_ReleaseGPUSampler,
} from "../../bindings/SDL3";

/**
 * Bilinear, clamped.
 *
 * This is what makes half-resolution SSAO free: the forward pass samples the
 * occlusion buffer at full-resolution UVs and the hardware's filter *is* the
 * upsample. There is no separate upsample pass because this sampler is one.
 */
export function createLinearClamp(device: Pointer<SDL_GPUDevice>): Pointer<SDL_GPUSampler> | null {
    return create(device, SDL_GPUFilter.LINEAR, false, "linear-clamp");
}

/** Point, clamped. For `textureLoad` slots and anything that must not be filtered. */
export function createNearestClamp(device: Pointer<SDL_GPUDevice>): Pointer<SDL_GPUSampler> | null {
    return create(device, SDL_GPUFilter.NEAREST, false, "nearest-clamp");
}

/**
 * A comparison sampler, for the shadow atlases.
 *
 * `LESS_OR_EQUAL` against a reference depth, so a tap returns 0 or 1 rather than
 * a depth — and because the filter runs *after* the comparison, a bilinear
 * comparison sampler gives four-tap PCF for the price of one fetch. The 3x3
 * filter in `shadow.wgsl` is built on nine of those, so it is really sampling a
 * 4x4 neighbourhood.
 */
export function createShadowCompare(device: Pointer<SDL_GPUDevice>): Pointer<SDL_GPUSampler> | null {
    return create(device, SDL_GPUFilter.LINEAR, true, "shadow-compare");
}

function create(
    device: Pointer<SDL_GPUDevice>,
    filter: SDL_GPUFilter,
    compare: boolean,
    name: string,
): Pointer<SDL_GPUSampler> | null {
    const info = alloc<SDL_GPUSamplerCreateInfo>({
        min_filter: filter,
        mag_filter: filter,
        mipmap_mode: SDL_GPUSamplerMipmapMode.NEAREST,
        // Clamped on every axis. A shadow atlas in particular must never wrap:
        // a tap that ran off the edge would sample a different cascade.
        address_mode_u: SDL_GPUSamplerAddressMode.CLAMP_TO_EDGE,
        address_mode_v: SDL_GPUSamplerAddressMode.CLAMP_TO_EDGE,
        address_mode_w: SDL_GPUSamplerAddressMode.CLAMP_TO_EDGE,
        enable_compare: compare,
        compare_op: compare ? SDL_GPUCompareOp.LESS_OR_EQUAL : SDL_GPUCompareOp.NEVER,
    });
    const sampler = SDL_CreateGPUSampler(device, info);
    info.free();

    if (sampler === null) {
        console.log(`sampler: '${name}' failed : ${stringFromCString(SDL_GetError())}`);
    }
    return sampler;
}

/** Release a sampler, tolerating null. */
export function releaseSampler(device: Pointer<SDL_GPUDevice>, sampler: Pointer<SDL_GPUSampler> | null): void {
    if (sampler !== null) {
        SDL_ReleaseGPUSampler(device, sampler);
    }
}
