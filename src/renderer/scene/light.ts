// Punctual lights, and how they reach the GPU.
//
// One type for point and spot alike, because clustering treats them identically:
// both are culled by a bounding sphere and only the cone test happens at shading
// time. Two types would mean two culling loops and two per-cluster lists for no
// gain — see the note at the top of `shaders/include/light.wgsl`.

import { fvec3, fvec4 } from "std/linalg";
import { fcos } from "std/math";

/** Matches `LIGHT_POINT` / `LIGHT_SPOT` in `shaders/include/light.wgsl`. */
export function lightKindPoint(): u32 {
    return 0;
}

export function lightKindSpot(): u32 {
    return 1;
}

/** Bytes one light occupies in the storage buffer. Four `vec4` rows. */
export function lightStride(): u32 {
    return 64;
}

/**
 * Bytes one light occupies in the culling buffer. One `vec4`.
 *
 * Mirrors `cull_lights` in `shaders/cluster_cull.wgsl`.
 */
export function cullLightStride(): u32 {
    return 16;
}

export class Light {
    position: fvec3;

    /**
     * Distance at which the light reaches exactly zero, and the radius the
     * culling sphere uses.
     *
     * Not a physical quantity — inverse-square never reaches zero — but the
     * windowed falloff in the shader is shaped to hit zero here, so the cluster
     * that stops including this light is also the cluster where it stopped
     * contributing. Getting those two out of step is what puts a visible seam
     * along a cluster boundary.
     */
    range: f32;

    /** Linear RGB with intensity already folded in. */
    color: fvec3;

    kind: u32;

    /** Unit vector the spotlight points along. Ignored for a point light. */
    direction: fvec3;

    cosOuter: f32;
    cosInner: f32;

    /**
     * Whether this light *asks* to cast a shadow.
     *
     * Author intent, not a slot. Only four spotlights can cast at once, so which
     * of the askers actually get a map is decided per frame by
     * `scene/spotslots.ts` — and a light that loses the contest this frame is
     * still the same light next frame.
     */
    castsShadow: boolean;

    /** A dark point light at the origin. Every field is set by the makers below. */
    constructor() {
        this.position = fvec3.zero();
        this.range = 1.0;
        this.color = fvec3.zero();
        this.kind = 0;
        this.direction = new fvec3(0.0, -1.0, 0.0);
        this.cosOuter = -1.0;
        this.cosInner = -1.0;
        this.castsShadow = false;
    }
}

/** A point light. */
export function makePointLight(position: fvec3, color: fvec3, range: f32): Light {
    const light = new Light();
    light.position = position;
    light.range = range;
    light.color = color;
    light.kind = lightKindPoint();
    light.direction = new fvec3(0.0, -1.0, 0.0);
    light.cosOuter = -1.0;
    light.cosInner = -1.0;
    light.castsShadow = false;
    return light;
}

/**
 * A spotlight. Angles are half-angles from the axis, in radians.
 *
 * `inner` is where falloff begins and `outer` is where it reaches zero. Passing
 * them the other way round gives a cone that is dark in the middle, which is a
 * surprisingly hard thing to spot in a screenshot.
 */
export function makeSpotLight(
    position: fvec3,
    direction: fvec3,
    color: fvec3,
    range: f32,
    inner: f32,
    outer: f32,
): Light {
    const light = new Light();
    light.position = position;
    light.range = range;
    light.color = color;
    light.kind = lightKindSpot();
    light.direction = direction.normalize();
    // Cosine is decreasing in angle, so the *outer* angle has the smaller
    // cosine. The shader divides by `cos_inner - cos_outer` and would produce a
    // negative falloff if these were swapped.
    light.cosInner = fcos(inner);
    light.cosOuter = fcos(outer);
    light.castsShadow = false;
    return light;
}

/**
 * Pack one light into the storage buffer.
 *
 * `floats` and `words` are two views of the same mapping — `kind` and the shadow
 * slot are integers sitting between floats, and writing them through the float
 * view would reinterpret the bits rather than convert them.
 *
 * `shadowSlot` is this frame's assignment, not something on the light: only four
 * spotlights can cast at once and which four is decided per frame. `-1` means
 * this one is not casting right now.
 */
export function writeLight(
    floats: Pointer<f32>,
    words: Pointer<u32>,
    index: usize,
    light: Reference<Light>,
    shadowSlot: i32,
): void {
    const base = index * 16;

    floats[base + 0] = light.position.x;
    floats[base + 1] = light.position.y;
    floats[base + 2] = light.position.z;
    floats[base + 3] = light.range;

    floats[base + 4] = light.color.x;
    floats[base + 5] = light.color.y;
    floats[base + 6] = light.color.z;
    words[base + 7] = light.kind;

    floats[base + 8] = light.direction.x;
    floats[base + 9] = light.direction.y;
    floats[base + 10] = light.direction.z;
    floats[base + 11] = light.cosOuter;

    floats[base + 12] = light.cosInner;
    // `shadow` is an `i32` in the shader and `-1` means "casts nothing", so the
    // bit pattern is what has to survive. The negative case is written out
    // rather than left to `cast`: a conversion that saturated instead of
    // reinterpreting would turn "no shadow" into "spot shadow slot 0", which
    // renders as a light mysteriously shadowed by another light's map.
    words[base + 13] = shadowSlot < 0 ? 0xffffffff : cast<u32>(shadowSlot);
    floats[base + 14] = 0.0;
    floats[base + 15] = 0.0;
}

/**
 * Pack the sixteen bytes culling actually reads: view-space position and range.
 *
 * Culling tests a bounding sphere against a froxel's view-space AABB, so those
 * two numbers are the whole of its input — the other forty-eight bytes of
 * `struct Light` are the shading pass's. Reading the wide struct in the cull
 * loop meant pulling all sixty-four across for sixteen, in the innermost loop
 * of the frame.
 *
 * **The position is in view space, transformed here.** It used to be
 * transformed in the shader, once per cluster — but the result does not depend
 * on the cluster, so every workgroup past the first was recomputing an answer
 * some other workgroup already had. There are at most 384 lights and thousands
 * of clusters, so the transform belongs on whichever side runs it once, and
 * this is the side that already walks every light every frame.
 *
 * `at` is a flat index into the float view of the staging block, not a light
 * index: the culling region sits past the shading region in one mapping.
 */
export function writeCullLight(floats: Pointer<f32>, at: usize, viewPosition: fvec4, range: f32): void {
    floats[at + 0] = viewPosition.x;
    floats[at + 1] = viewPosition.y;
    floats[at + 2] = viewPosition.z;
    floats[at + 3] = range;
}
