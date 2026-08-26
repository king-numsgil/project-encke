// A folder of PBR maps, loaded as a set.
//
// The convention is fixed and deliberately dumb: `color.jpg`, `normal.jpg`,
// `roughness.jpg` and `ao.jpg` in one directory, and any of them may be absent.
// A missing map falls back to a 1x1 texture chosen so the surface comes out
// exactly as the numeric material parameters describe — see `Fallbacks` below —
// so there is no "has a colour map" flag anywhere in the shader and no branch in
// the fragment loop.
//
// The fallbacks are shared by every material rather than allocated per set,
// because they are constants and there may be a great many materials.

import type { SDL_GPUDevice, SDL_GPUTexture } from "../../bindings/SDL3";
import { releaseTexture } from "../gpu/texture.ts";
import { createSolidTexture, loadTexture } from "./texture.ts";

/**
 * The 1x1 textures that stand in for maps a material does not have.
 *
 * Each is the identity for its channel: white multiplies to no change, and
 * `(128, 128, 255)` is tangent-space `(0, 0, 1)`, which is "the geometric normal,
 * unmodified" once the shader has expanded it from `[0, 1]` to `[-1, 1]`.
 */
export class Fallbacks {
    white: Pointer<SDL_GPUTexture> | null;
    flatNormal: Pointer<SDL_GPUTexture> | null;

    constructor() {
        this.white = null;
        this.flatNormal = null;
    }

    create(device: Pointer<SDL_GPUDevice>): boolean {
        this.white = createSolidTexture(device, 255, 255, 255, 255, "fallback.white");
        this.flatNormal = createSolidTexture(device, 128, 128, 255, 255, "fallback.normal");
        return this.white !== null && this.flatNormal !== null;
    }

    release(device: Pointer<SDL_GPUDevice>): void {
        releaseTexture(device, this.white);
        releaseTexture(device, this.flatNormal);
        this.white = null;
        this.flatNormal = null;
    }
}

/** The four maps the forward pass binds for one material. */
export class MaterialTextures {
    color: Pointer<SDL_GPUTexture> | null;
    normal: Pointer<SDL_GPUTexture> | null;
    roughness: Pointer<SDL_GPUTexture> | null;
    occlusion: Pointer<SDL_GPUTexture> | null;

    /** True for the maps this set owns and must release; false for borrowed fallbacks. */
    private ownsColor: boolean;
    private ownsNormal: boolean;
    private ownsRoughness: boolean;
    private ownsOcclusion: boolean;

    constructor() {
        this.color = null;
        this.normal = null;
        this.roughness = null;
        this.occlusion = null;
        this.ownsColor = false;
        this.ownsNormal = false;
        this.ownsRoughness = false;
        this.ownsOcclusion = false;
    }

    /** Every slot pointing at a fallback. What an untextured material uses. */
    useFallbacks(fallbacks: Reference<Fallbacks>): void {
        this.color = fallbacks.white;
        this.normal = fallbacks.flatNormal;
        this.roughness = fallbacks.white;
        this.occlusion = fallbacks.white;
        this.ownsColor = false;
        this.ownsNormal = false;
        this.ownsRoughness = false;
        this.ownsOcclusion = false;
    }

    /**
     * Load whatever the folder holds, falling back for the rest.
     *
     * **Only `color.jpg` is sRGB.** The other three carry data rather than
     * colour — a normal direction, a roughness, an occlusion factor — and
     * sampling them through an sRGB format would apply a transfer curve to
     * numbers that are not light. It is the single easiest thing to get wrong
     * here and the symptom is a material that looks subtly, unfixably off.
     */
    load(device: Pointer<SDL_GPUDevice>, folder: string, fallbacks: Reference<Fallbacks>, name: string): void {
        this.useFallbacks(fallbacks);

        const color = loadTexture(device, `${folder}/color.jpg`, true, true, `${name}.color`);
        if (color !== null) {
            this.color = color;
            this.ownsColor = true;
        }

        const normal = loadTexture(device, `${folder}/normal.jpg`, false, true, `${name}.normal`);
        if (normal !== null) {
            this.normal = normal;
            this.ownsNormal = true;
        }

        const roughness = loadTexture(device, `${folder}/roughness.jpg`, false, true, `${name}.roughness`);
        if (roughness !== null) {
            this.roughness = roughness;
            this.ownsRoughness = true;
        }

        const occlusion = loadTexture(device, `${folder}/ao.jpg`, false, true, `${name}.ao`);
        if (occlusion !== null) {
            this.occlusion = occlusion;
            this.ownsOcclusion = true;
        }
    }

    /** Release only what this set loaded. Fallbacks belong to {@link Fallbacks}. */
    release(device: Pointer<SDL_GPUDevice>): void {
        if (this.ownsColor) {
            releaseTexture(device, this.color);
        }
        if (this.ownsNormal) {
            releaseTexture(device, this.normal);
        }
        if (this.ownsRoughness) {
            releaseTexture(device, this.roughness);
        }
        if (this.ownsOcclusion) {
            releaseTexture(device, this.occlusion);
        }

        this.color = null;
        this.normal = null;
        this.roughness = null;
        this.occlusion = null;
        this.ownsColor = false;
        this.ownsNormal = false;
        this.ownsRoughness = false;
        this.ownsOcclusion = false;
    }
}
