// Cook-Torrance, metallic-roughness. The textbook one, deliberately.
//
// The renderer's stated philosophy is to cheat convincingly rather than solve
// the real integral, and the place that shows here is what is *absent*: no
// multi-scatter energy compensation, no Smith height-correlated visibility
// term, no split-sum IBL. Direct lighting gets the honest specular lobe because
// it is the thing a viewer reads as "lit"; everything indirect is a constant.

const PI : f32 = 3.14159265359;
const DIELECTRIC_F0 : vec3<f32> = vec3<f32>(0.04, 0.04, 0.04);

/** What the BRDF needs about a surface, gathered once per fragment. */
struct Surface {
    /** Diffuse reflectance — albedo with the metallic part removed. */
    diffuse : vec3<f32>,
    /** Normal-incidence specular reflectance. */
    f0 : vec3<f32>,
    /** Perceptual roughness squared. The GGX `alpha`. */
    alpha : f32,
    normal : vec3<f32>,
    view : vec3<f32>,
    n_dot_v : f32,
}

/**
 * Build the shading inputs from material parameters.
 *
 * Roughness is clamped away from zero: `alpha = 0` makes the GGX denominator a
 * delta function, which on a punctual light is an infinitely bright pixel
 * rather than a mirror.
 */
fn make_surface(albedo: vec3<f32>, metallic: f32, roughness: f32, normal: vec3<f32>, view: vec3<f32>) -> Surface {
    let clamped = clamp(roughness, 0.045, 1.0);

    var surface : Surface;
    surface.diffuse = albedo * (1.0 - metallic);
    surface.f0 = mix(DIELECTRIC_F0, albedo, metallic);
    surface.alpha = clamped * clamped;
    surface.normal = normal;
    surface.view = view;
    surface.n_dot_v = max(dot(normal, view), 1e-4);
    return surface;
}

/** GGX / Trowbridge-Reitz normal distribution. */
fn distribution_ggx(n_dot_h: f32, alpha: f32) -> f32 {
    let a2 = alpha * alpha;
    let d = n_dot_h * n_dot_h * (a2 - 1.0) + 1.0;
    return a2 / max(PI * d * d, 1e-7);
}

/**
 * Smith geometry term with Schlick's approximation, direct-lighting `k`.
 *
 * `k = (roughness + 1)^2 / 8` is the direct form; image-based lighting wants
 * `alpha / 2` instead. Only direct lighting exists here, so only this one does.
 */
fn geometry_smith(n_dot_v: f32, n_dot_l: f32, alpha: f32) -> f32 {
    let r = sqrt(alpha) + 1.0;
    let k = (r * r) / 8.0;
    let gv = n_dot_v / (n_dot_v * (1.0 - k) + k);
    let gl = n_dot_l / (n_dot_l * (1.0 - k) + k);
    return gv * gl;
}

/** Schlick's Fresnel. */
fn fresnel_schlick(cos_theta: f32, f0: vec3<f32>) -> vec3<f32> {
    let f = pow(saturate(1.0 - cos_theta), 5.0);
    return f0 + (vec3<f32>(1.0) - f0) * f;
}

/**
 * One light's contribution, before attenuation and shadowing.
 *
 * `light_dir` points from the surface *towards* the light. The result is
 * already multiplied by `n_dot_l`, so a caller adds
 * `brdf(...) * radiance * attenuation * shadow` and nothing else.
 */
fn shade_light(surface: Surface, light_dir: vec3<f32>) -> vec3<f32> {
    let n_dot_l = dot(surface.normal, light_dir);
    if n_dot_l <= 0.0 {
        return vec3<f32>(0.0);
    }

    let half_vector = normalize(surface.view + light_dir);
    let n_dot_h = saturate(dot(surface.normal, half_vector));
    let v_dot_h = saturate(dot(surface.view, half_vector));

    let d = distribution_ggx(n_dot_h, surface.alpha);
    let g = geometry_smith(surface.n_dot_v, n_dot_l, surface.alpha);
    let f = fresnel_schlick(v_dot_h, surface.f0);

    let specular = (d * g) * f / max(4.0 * surface.n_dot_v * n_dot_l, 1e-5);
    // Metals have no diffuse lobe; `surface.diffuse` is already zero for them,
    // so the energy split is the Fresnel complement and nothing more.
    let diffuse = (vec3<f32>(1.0) - f) * surface.diffuse / PI;

    return (diffuse + specular) * n_dot_l;
}
