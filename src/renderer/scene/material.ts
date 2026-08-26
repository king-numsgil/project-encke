// Metallic-roughness material parameters.
//
// Constants per instance, not textures. Phase 1 has no asset loading, so there
// is nothing to sample from; when glTF arrives these become the factors a
// texture is multiplied by, which is the same struct with more work behind it.

import { fvec3 } from "std/linalg";

export class Material {
    /** Base colour, **linear**. Not an sRGB value someone read off a colour picker. */
    albedo: fvec3;

    /**
     * 0 for a dielectric, 1 for a metal, and nothing in between is physical.
     *
     * Values between the two exist for blending between materials across a
     * surface, which needs a texture. A constant of 0.5 is not "a bit metallic",
     * it is a material that does not occur.
     */
    metallic: f32;

    /** Perceptual roughness. Squared into the GGX alpha in the shader. */
    roughness: f32;

    /** How much SSAO applies. 1 for everything ordinary; 0 to opt a surface out. */
    aoStrength: f32;

    /** Emitted radiance, added after shading and unaffected by lights or AO. */
    emissive: fvec3;

    /** A mid-grey dielectric. Every field is set by the makers below. */
    constructor() {
        this.albedo = fvec3.splat(0.5);
        this.metallic = 0.0;
        this.roughness = 0.5;
        this.aoStrength = 1.0;
        this.emissive = fvec3.zero();
    }
}

/** An ordinary non-metal. */
export function makeMaterial(albedo: fvec3, roughness: f32): Material {
    const material = new Material();
    material.albedo = albedo;
    material.metallic = 0.0;
    material.roughness = roughness;
    material.aoStrength = 1.0;
    material.emissive = fvec3.zero();
    return material;
}

/** A metal. Metals have no diffuse lobe; their albedo tints the specular instead. */
export function makeMetal(albedo: fvec3, roughness: f32): Material {
    const material = makeMaterial(albedo, roughness);
    material.metallic = 1.0;
    return material;
}

/**
 * A surface that emits.
 *
 * Emissive is not a light. It brightens the surface itself and illuminates
 * nothing around it — pair it with a point light at the same place if the glow
 * is meant to fall on anything.
 */
export function makeEmissive(color: fvec3): Material {
    const material = makeMaterial(color, 1.0);
    material.emissive = color;
    material.aoStrength = 0.0;
    return material;
}
