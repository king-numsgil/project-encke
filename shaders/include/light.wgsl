// Punctual lights — point and spot — and how they fall off.
//
// One struct for both kinds, discriminated by `kind`, because clustering treats
// them identically: a spotlight is culled by its bounding sphere and only the
// cone test happens at shading time. Two arrays would mean two culling loops and
// two per-cluster lists for no gain.
//
// 64 bytes, four `vec4` rows. Mirrored by `src/renderer/scene/light.ts`.

const LIGHT_POINT : u32 = 0u;
const LIGHT_SPOT  : u32 = 1u;

struct Light {
    /** World-space position. */
    position : vec3<f32>,
    /** Distance at which the light reaches zero. The culling sphere's radius. */
    range : f32,

    /** Linear RGB radiance, intensity already folded in. */
    color : vec3<f32>,
    kind : u32,

    /** Unit vector the spotlight points along. Unused for a point light. */
    direction : vec3<f32>,
    /** Cosine of the outer cone half-angle — the edge where the cone reaches zero. */
    cos_outer : f32,

    /** Cosine of the inner cone half-angle — the edge where falloff begins. */
    cos_inner : f32,
    /** Spot shadow slot `0..3`, or `-1` for a light that casts none. */
    shadow : i32,
    pad0 : f32,
    pad1 : f32,
}

/**
 * Inverse-square falloff, windowed to reach exactly zero at `range`.
 *
 * The `+ 1e-4` keeps the singularity at the light's own position finite. The
 * window is Karis' — `saturate(1 - (d/r)^4)^2` — and it exists because a pure
 * inverse square never reaches zero, so a light would keep contributing across
 * the cluster boundary that culled it and leave a visible seam.
 */
fn distance_attenuation(dist_sq: f32, range: f32) -> f32 {
    let inv_range_sq = 1.0 / max(range * range, 1e-8);
    let factor = dist_sq * inv_range_sq;
    let smooth_factor = saturate(1.0 - factor * factor);
    return (smooth_factor * smooth_factor) / max(dist_sq, 1e-4);
}

/**
 * The cone falloff of a spotlight, 1 inside the inner cone and 0 outside the
 * outer one. `to_light` points from the surface towards the light.
 */
fn spot_attenuation(light: Light, to_light: vec3<f32>) -> f32 {
    let cos_angle = dot(light.direction, -to_light);
    let t = saturate((cos_angle - light.cos_outer) / max(light.cos_inner - light.cos_outer, 1e-4));
    return t * t;
}

/** Both falloffs together: the scalar the light's colour is multiplied by. */
fn light_attenuation(light: Light, world_pos: vec3<f32>) -> f32 {
    let delta = light.position - world_pos;
    let dist_sq = dot(delta, delta);
    var attenuation = distance_attenuation(dist_sq, light.range);

    if light.kind == LIGHT_SPOT {
        attenuation *= spot_attenuation(light, normalize(delta));
    }

    return attenuation;
}
