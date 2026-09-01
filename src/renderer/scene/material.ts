// Metallic-roughness material parameters.
//
// These are **factors**, not colours: the shader multiplies each by the matching
// channel of the material's maps, so a material with no maps at all shades from
// these numbers alone and a fully textured one uses them as tints. That is
// glTF's rule, and following it is what lets an imported material and a
// hand-written one be the same struct — see `assets/material_set.ts`.

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
