// The maps one material binds, and where they come from.
//
// The five slots are **glTF's own texture set**, not a scheme of this
// renderer's: base colour, normal, metallic-roughness, occlusion and emissive.
// That is what a `.glb` hands over and it is now also what a folder under
// `assets/materials/` produces, so a procedurally built material and a loaded
// one take exactly the same path from here on and the forward pass cannot tell
// them apart.
//
// The folder convention is fixed and deliberately dumb: `color.jpg`,
// `normal.jpg`, `roughness.jpg`, `metallic.jpg`, `ao.jpg` and `emissive.jpg` in
// one directory, and any of them may be absent. Roughness and metalness are two
// files there and one texture in the shader, so they are packed on load — see
// `loadOrmTexture`.
//
// A missing map falls back to a 1x1 texture chosen so the surface comes out
// exactly as the numeric material parameters describe — see `Fallbacks` below —
// so there is no "has a colour map" flag anywhere in the shader and no branch in
// the fragment loop.
//
// The fallbacks are shared by every material rather than allocated per set,
// because they are constants and there may be a great many materials.

import type { SDL_GPUDevice, SDL_GPUTexture } from "../../bindings/SDL3";
import { releaseTexture } from "../gpu/texture.ts";
import { createSolidTexture, loadOrmTexture, loadTexture } from "./texture.ts";

/**
 * The 1x1 textures that stand in for maps a material does not have.
 *
 * Each is the identity for its channel: white multiplies to no change, and
 * `(128, 128, 255)` is tangent-space `(0, 0, 1)`, which is "the geometric normal,
 * unmodified" once the shader has expanded it from `[0, 1]` to `[-1, 1]`.
 *
 * White is the identity for the metallic-roughness slot too, since the shader
 * multiplies `g` into the roughness factor and `b` into the metallic one.
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

/** The five maps the forward pass binds for one material. */
export class MaterialTextures {
    color: Pointer<SDL_GPUTexture> | null;
    normal: Pointer<SDL_GPUTexture> | null;
    /** glTF's `metallicRoughnessTexture`: `g` roughness, `b` metallic. */
    orm: Pointer<SDL_GPUTexture> | null;
    /** glTF's `occlusionTexture`: `r` baked occlusion. */
    occlusion: Pointer<SDL_GPUTexture> | null;
    /** glTF's `emissiveTexture`, sRGB. Multiplies the emissive factor. */
    emissive: Pointer<SDL_GPUTexture> | null;

    /** True for the maps this set owns and must release; false for borrowed ones. */
    private ownsColor: boolean;
    private ownsNormal: boolean;
    private ownsOrm: boolean;
    private ownsOcclusion: boolean;
    private ownsEmissive: boolean;

    constructor() {
        this.color = null;
        this.normal = null;
        this.orm = null;
        this.occlusion = null;
        this.emissive = null;
        this.ownsColor = false;
        this.ownsNormal = false;
        this.ownsOrm = false;
        this.ownsOcclusion = false;
        this.ownsEmissive = false;
    }

    /** Every slot pointing at a fallback. What an untextured material uses. */
    useFallbacks(fallbacks: Reference<Fallbacks>): void {
        this.color = fallbacks.white;
        this.normal = fallbacks.flatNormal;
        this.orm = fallbacks.white;
        this.occlusion = fallbacks.white;
        this.emissive = fallbacks.white;
        this.ownsColor = false;
        this.ownsNormal = false;
        this.ownsOrm = false;
        this.ownsOcclusion = false;
        this.ownsEmissive = false;
    }

    /**
     * Point a slot at a texture somebody else owns.
     *
     * The glTF path needs this: one image can be cited by several materials —
     * an ORM map is routinely both the metallic-roughness and the occlusion
     * texture of the same material — and decoding it once per citation would
     * mean several copies of one 2K texture on the GPU. The model owns the
     * decoded images and releases them; these are borrows, so a null leaves the
     * fallback in place rather than blanking the slot.
     */
    borrowColor(texture: Pointer<SDL_GPUTexture> | null): void {
        if (texture !== null) {
            this.color = texture;
            this.ownsColor = false;
        }
    }

    borrowNormal(texture: Pointer<SDL_GPUTexture> | null): void {
        if (texture !== null) {
            this.normal = texture;
            this.ownsNormal = false;
        }
    }

    borrowOrm(texture: Pointer<SDL_GPUTexture> | null): void {
        if (texture !== null) {
            this.orm = texture;
            this.ownsOrm = false;
        }
    }

    borrowOcclusion(texture: Pointer<SDL_GPUTexture> | null): void {
        if (texture !== null) {
            this.occlusion = texture;
            this.ownsOcclusion = false;
        }
    }

    borrowEmissive(texture: Pointer<SDL_GPUTexture> | null): void {
        if (texture !== null) {
            this.emissive = texture;
            this.ownsEmissive = false;
        }
    }

    /**
     * Load whatever the folder holds, falling back for the rest.
     *
     * **Only `color.jpg` is sRGB.** The other maps carry data rather than
     * colour — a normal direction, a roughness, a metalness, an occlusion
     * factor — and sampling them through an sRGB format would apply a transfer
     * curve to numbers that are not light. It is the single easiest thing to get
     * wrong here and the symptom is a material that looks subtly, unfixably off.
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

        // One texture out of two files. A folder with neither keeps the white
        // fallback and its numeric metallic and roughness stand alone.
        const orm = loadOrmTexture(
            device,
            `${folder}/roughness.jpg`,
            `${folder}/metallic.jpg`,
            `${name}.orm`,
        );
        if (orm !== null) {
            this.orm = orm;
            this.ownsOrm = true;
        }

        const occlusion = loadTexture(device, `${folder}/ao.jpg`, false, true, `${name}.ao`);
        if (occlusion !== null) {
            this.occlusion = occlusion;
            this.ownsOcclusion = true;
        }

        // sRGB, like the colour map and unlike the other three: emission is
        // light, and it is authored by eye in the same space a colour is.
        const emissive = loadTexture(device, `${folder}/emissive.jpg`, true, true, `${name}.emissive`);
        if (emissive !== null) {
            this.emissive = emissive;
            this.ownsEmissive = true;
        }
    }

    /** Release only what this set loaded. Fallbacks and borrows belong elsewhere. */
    release(device: Pointer<SDL_GPUDevice>): void {
        if (this.ownsColor) {
            releaseTexture(device, this.color);
        }
        if (this.ownsNormal) {
            releaseTexture(device, this.normal);
        }
        if (this.ownsOrm) {
            releaseTexture(device, this.orm);
        }
        if (this.ownsOcclusion) {
            releaseTexture(device, this.occlusion);
        }
        if (this.ownsEmissive) {
            releaseTexture(device, this.emissive);
        }

        this.color = null;
        this.normal = null;
        this.orm = null;
        this.occlusion = null;
        this.emissive = null;
        this.ownsColor = false;
        this.ownsNormal = false;
        this.ownsOrm = false;
        this.ownsOcclusion = false;
        this.ownsEmissive = false;
    }
}
