// Every texture a frame draws into.
//
// Split by lifetime, which is the only division that matters here: the
// screen-sized targets are rebuilt whenever the window changes, and the shadow
// atlases never are — their size is a quality setting, not a function of the
// window.
//
// The scene target is `R16G16B16A16_FLOAT` and not an 8-bit format. Physical
// falloff produces radiance far outside `[0, 1]`, and clamping it at the shading
// stage would destroy exactly the highlights the tonemap exists to roll off.

import { type SDL_GPUDevice, type SDL_GPUTexture, SDL_GPUTextureFormat } from "../../bindings/SDL3";
import { cascadeAtlasHeight, cascadeAtlasWidth, spotAtlasSize } from "../config.ts";
import { createColorTarget, createDepthTarget, releaseTexture } from "../gpu/texture.ts";

/** Half of `value`, never zero. */
function half(value: u32): u32 {
    const result = value / 2;
    return result < 1 ? 1 : result;
}

export class Targets {
    /** Linear HDR radiance, before the tonemap. */
    scene: Pointer<SDL_GPUTexture> | null;

    /** Written by the pre-pass, then read by cluster marking, SSAO, and tested against by the forward pass. */
    depth: Pointer<SDL_GPUTexture> | null;

    /** Raw occlusion, half resolution. */
    occlusion: Pointer<SDL_GPUTexture> | null;

    /** Occlusion after the noise has been blurred out. What the forward pass samples. */
    occlusionBlurred: Pointer<SDL_GPUTexture> | null;

    /** The four sun cascades, side by side. */
    cascadeAtlas: Pointer<SDL_GPUTexture> | null;

    /** Four spotlight maps, in quadrants. */
    spotAtlas: Pointer<SDL_GPUTexture> | null;

    width: u32;
    height: u32;
    occlusionWidth: u32;
    occlusionHeight: u32;

    constructor() {
        this.scene = null;
        this.depth = null;
        this.occlusion = null;
        this.occlusionBlurred = null;
        this.cascadeAtlas = null;
        this.spotAtlas = null;
        this.width = 0;
        this.height = 0;
        this.occlusionWidth = 0;
        this.occlusionHeight = 0;
    }

    /** The atlases, which outlive any resize. */
    createPersistent(device: Pointer<SDL_GPUDevice>): boolean {
        this.cascadeAtlas = createDepthTarget(
            device,
            SDL_GPUTextureFormat.D32_FLOAT,
            cascadeAtlasWidth(),
            cascadeAtlasHeight(),
            "shadow.cascades",
        );
        this.spotAtlas = createDepthTarget(
            device,
            SDL_GPUTextureFormat.D32_FLOAT,
            spotAtlasSize(),
            spotAtlasSize(),
            "shadow.spots",
        );

        return this.cascadeAtlas !== null && this.spotAtlas !== null;
    }

    /** The screen-sized targets. Safe to call again; the old ones are released first. */
    resize(device: Pointer<SDL_GPUDevice>, width: u32, height: u32): boolean {
        this.releaseSized(device);

        this.width = width;
        this.height = height;
        this.occlusionWidth = half(width);
        this.occlusionHeight = half(height);

        this.scene = createColorTarget(
            device,
            SDL_GPUTextureFormat.R16G16B16A16_FLOAT,
            width,
            height,
            "scene.hdr",
        );
        this.depth = createDepthTarget(device, SDL_GPUTextureFormat.D32_FLOAT, width, height, "scene.depth");

        // `R8_UNORM`: occlusion is one channel in `[0, 1]` and 256 levels of it
        // are more than a term multiplied into ambient light can show.
        this.occlusion = createColorTarget(
            device,
            SDL_GPUTextureFormat.R8_UNORM,
            this.occlusionWidth,
            this.occlusionHeight,
            "ssao.raw",
        );
        this.occlusionBlurred = createColorTarget(
            device,
            SDL_GPUTextureFormat.R8_UNORM,
            this.occlusionWidth,
            this.occlusionHeight,
            "ssao.blurred",
        );

        return (
            this.scene !== null &&
            this.depth !== null &&
            this.occlusion !== null &&
            this.occlusionBlurred !== null
        );
    }

    release(device: Pointer<SDL_GPUDevice>): void {
        this.releaseSized(device);
        releaseTexture(device, this.cascadeAtlas);
        releaseTexture(device, this.spotAtlas);
        this.cascadeAtlas = null;
        this.spotAtlas = null;
    }

    private releaseSized(device: Pointer<SDL_GPUDevice>): void {
        releaseTexture(device, this.scene);
        releaseTexture(device, this.depth);
        releaseTexture(device, this.occlusion);
        releaseTexture(device, this.occlusionBlurred);
        this.scene = null;
        this.depth = null;
        this.occlusion = null;
        this.occlusionBlurred = null;
    }
}
