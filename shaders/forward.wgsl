// The clustered forward shading pass.
//
// Runs with depth test EQUAL against the pre-pass, so every fragment reaching
// the light loop is one that survives — zero overdraw through the expensive part.
//
// Binding order in the fragment stage is load-bearing and is why the `@binding`
// numbers below are contiguous and grouped. `shadercc` ranks resources within
// each kind by ascending `@binding` and hands SDL that order; a sampler shares
// the slot of the texture at its own rank. So:
//
//     SDL slot 0..2   textures     shadow_atlas, spot_atlas, occlusion
//     SDL slot 3..7   textures     color_map, normal_map, orm_map, ao_map,
//                                  emissive_map
//                     + samplers   one per texture, at matching rank
//     SDL slot 0,1,2  storage      lights, light_count, light_index
//     SDL slot 0,1,2  uniforms     frame, shadows, material
//
// Reordering the `@binding` numbers within a kind silently rebinds the shader.
//
// Slots 0-2 are bound once per pass; **3-7 are rebound per draw**, because they
// are the material's. That split is why the material maps come last.
//
// The five material maps are **glTF's own texture set**, and deliberately all
// five: `emissiveFactor` defaults to black, so a material that names an emissive
// texture is one whose factor is a multiplier rather than a colour. Honouring
// the factor and dropping the map turns every emissive model into a uniformly
// glowing white one, which is a worse answer than not supporting emission.

//!include "frame.wgsl"
//!include "cluster.wgsl"
//!include "light.wgsl"
//!include "pbr.wgsl"
//!include "shadow.wgsl"

/** `Frame.debug.x` values. Mirrored by `DebugView` in `src/app/options.ts`. */
const DEBUG_OFF : u32 = 0u;
/** Per-cluster light count as a heatmap: black is empty, red is at the cap. */
const DEBUG_CLUSTERS : u32 = 1u;
/** The occlusion buffer alone. */
const DEBUG_AO : u32 = 2u;
/** Which sun cascade each fragment samples. */
const DEBUG_CASCADES : u32 = 3u;

struct Object {
    model : mat4x4<f32>,
    /** Inverse-transpose of `model`; the upper 3x3 is the normal basis. */
    normal : mat4x4<f32>,
}

struct Material {
    /** `rgb`: base colour, linear. `a`: unused. */
    albedo : vec4<f32>,
    /**
     * `x`: metallic. `y`: roughness. `z`: how much SSAO applies. `w`: unused.
     *
     * All three are **factors**, multiplied by the maps below rather than
     * replaced by them. That is glTF's rule and it is what lets a material with
     * no maps at all take the identical code path: an absent map binds a 1x1
     * white texture, multiplies by one, and the number stands alone.
     */
    params : vec4<f32>,
    /** `rgb`: emissive radiance. `a`: unused. */
    emissive : vec4<f32>,
}

struct VertexOut {
    @builtin(position) position : vec4<f32>,
    @location(0) world_pos : vec3<f32>,
    @location(1) view_pos : vec3<f32>,
    @location(2) normal : vec3<f32>,
    @location(3) uv : vec2<f32>,
    /** `xyz` world-space tangent, `w` the bitangent's handedness. See `meshdata.ts`. */
    @location(4) tangent : vec4<f32>,
}

// -- vertex stage (set 1 uniforms) -------------------------------------------

@group(1) @binding(0) var<uniform> frame : Frame;
@group(1) @binding(1) var<uniform> object : Object;

@vertex
fn vs_main(
    @location(0) position : vec3<f32>,
    @location(1) normal : vec3<f32>,
    @location(2) uv : vec2<f32>,
    @location(3) tangent : vec4<f32>,
) -> VertexOut {
    let world = object.model * vec4<f32>(position, 1.0);

    let basis = mat3x3<f32>(object.normal[0].xyz, object.normal[1].xyz, object.normal[2].xyz);

    var out : VertexOut;
    // **`view_proj * world`, exactly as `depth_prepass.wgsl` writes it.** The
    // pipeline tests depth `EQUAL` against that pre-pass, so the two clip
    // positions have to agree bit for bit — and `proj * (view * world)` does not
    // agree with `(proj * view) * world`, because floating-point multiplication
    // is not associative. The symptom is not a subtle one: most fragments fail
    // the test and the geometry renders as horizontal stripes.
    out.position = frame.view_proj * world;
    out.world_pos = world.xyz;
    // Only a varying, so it may be computed any way that is convenient.
    out.view_pos = (frame.view * world).xyz;
    out.normal = basis * normal;
    out.uv = uv;
    // The tangent goes through the same basis as the normal, and the handedness
    // rides along untouched — it is a sign, not a direction, so a transform
    // would be meaningless. A mirroring transform flips which side the bitangent
    // falls on, but that is already encoded in `w` by whoever built the mesh.
    out.tangent = vec4<f32>(basis * tangent.xyz, tangent.w);
    return out;
}

// -- fragment stage (set 2 resources, set 3 uniforms) ------------------------

@group(2) @binding(0) var shadow_atlas : texture_depth_2d;
@group(2) @binding(1) var spot_atlas : texture_depth_2d;
@group(2) @binding(2) var occlusion : texture_2d<f32>;

// The material's own maps, rebound per draw. A material with no map for a
// channel binds a 1x1 fallback that is the identity for it, so there is no
// branch here and an untextured surface shades exactly as it did before
// textures existed — see `renderer/assets/material_set.ts`.
@group(2) @binding(3) var color_map : texture_2d<f32>;
@group(2) @binding(4) var normal_map : texture_2d<f32>;
/**
 * glTF's `metallicRoughnessTexture`: `g` is roughness, `b` is metallic.
 *
 * One texture for two channels because that is how the format packs them, and
 * because roughness and metalness vary together across a surface — a scratch
 * through paint reveals metal and changes the gloss at the same texel. `r` is
 * unused here and is where an author packs occlusion, which is why an ORM map
 * can be bound to this slot and to {@link ao_map} at once.
 */
@group(2) @binding(5) var orm_map : texture_2d<f32>;
/** glTF's `occlusionTexture`: `r` is the baked occlusion factor. */
@group(2) @binding(6) var ao_map : texture_2d<f32>;
/** glTF's `emissiveTexture`, sRGB. Multiplies the emissive factor. */
@group(2) @binding(7) var emissive_map : texture_2d<f32>;

@group(2) @binding(8) var shadow_sampler : sampler_comparison;
@group(2) @binding(9) var spot_sampler : sampler_comparison;
@group(2) @binding(10) var occlusion_sampler : sampler;
@group(2) @binding(11) var color_sampler : sampler;
@group(2) @binding(12) var normal_sampler : sampler;
@group(2) @binding(13) var orm_sampler : sampler;
@group(2) @binding(14) var ao_sampler : sampler;
@group(2) @binding(15) var emissive_sampler : sampler;

@group(2) @binding(16) var<storage, read> lights : array<Light>;
@group(2) @binding(17) var<storage, read> light_count : array<u32>;
@group(2) @binding(18) var<storage, read> light_index : array<u32>;

@group(3) @binding(0) var<uniform> frame_fs : Frame;
@group(3) @binding(1) var<uniform> shadows : Shadows;
@group(3) @binding(2) var<uniform> material : Material;

/**
 * A ramp from cold to hot over `[0, 1]`. Four stops, linearly blended.
 *
 * Deliberately not a smooth gradient: the point of the occupancy view is to read
 * *how many* lights a froxel holds, and distinct bands are easier to count than
 * a continuous hue sweep.
 */
fn heat(t : f32) -> vec3<f32> {
    let x = saturate(t);
    if x < 0.33 {
        return mix(vec3<f32>(0.0, 0.0, 0.25), vec3<f32>(0.0, 0.75, 0.6), x / 0.33);
    }
    if x < 0.66 {
        return mix(vec3<f32>(0.0, 0.75, 0.6), vec3<f32>(0.95, 0.85, 0.1), (x - 0.33) / 0.33);
    }
    return mix(vec3<f32>(0.95, 0.85, 0.1), vec3<f32>(1.0, 0.05, 0.05), (x - 0.66) / 0.34);
}

fn debug_view(
    mode : u32,
    count : u32,
    frag_xy : vec2<f32>,
    view_z : f32,
    world_pos : vec3<f32>,
    normal : vec3<f32>,
) -> vec4<f32> {
    if mode == DEBUG_CLUSTERS {
        // Empty froxels stay black rather than taking the ramp's cold end, so
        // "no lights here" and "one light here" are not the same colour.
        if count == 0u {
            return vec4<f32>(0.0, 0.0, 0.0, 1.0);
        }
        return vec4<f32>(heat(f32(count) / f32(MAX_LIGHTS_PER_CLUSTER)), 1.0);
    }

    if mode == DEBUG_AO {
        let ao = textureSample(occlusion, occlusion_sampler, frag_xy * frame_fs.screen.zw).r;
        return vec4<f32>(vec3<f32>(ao), 1.0);
    }

    if mode == DEBUG_CASCADES {
        let cascade = cascade_for(view_z, shadows.cascade_split);
        let tint = heat(f32(cascade) / f32(CASCADE_COUNT - 1u));
        let sun_dir = normalize(frame_fs.sun_direction.xyz);
        let lit = sun_shadow(shadow_atlas, shadow_sampler, shadows, world_pos, normal, sun_dir, view_z);
        return vec4<f32>(tint * mix(0.25, 1.0, lit), 1.0);
    }

    return vec4<f32>(1.0, 0.0, 1.0, 1.0);
}

/**
 * The shading normal, with the material's normal map applied.
 *
 * Gram-Schmidt on the tangent first: both it and the normal are interpolated
 * across the triangle and interpolation does not preserve the right angle
 * between them, so re-orthogonalising is what stops the basis skewing towards
 * the middle of a face.
 */
fn shading_normal(in : VertexOut) -> vec3<f32> {
    let geometric = normalize(in.normal);
    let tangent = normalize(in.tangent.xyz - geometric * dot(geometric, in.tangent.xyz));
    let bitangent = cross(geometric, tangent) * in.tangent.w;

    let sampled = textureSample(normal_map, normal_sampler, in.uv).xyz * 2.0 - vec3<f32>(1.0);
    let basis = mat3x3<f32>(tangent, bitangent, geometric);
    return normalize(basis * sampled);
}

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
    let normal = shading_normal(in);
    let view_dir = normalize(frame_fs.camera_pos.xyz - in.world_pos);

    // View space is right-handed, so a point in front of the camera has a
    // negative z and the distance the cluster grid is indexed by is its negation.
    let view_z = -in.view_pos.z;

    // Maps modulate the numeric parameters rather than replacing them, which is
    // the glTF convention and is what makes the 1x1 white fallbacks work: an
    // absent map multiplies by one and the parameter stands alone.
    //
    // The colour map is sampled through an `_SRGB` texture format, so what
    // arrives here is already linear and no conversion belongs in the shader.
    let albedo = material.albedo.rgb * textureSample(color_map, color_sampler, in.uv).rgb;

    // One sample, two channels, in glTF's own packing: `g` roughness, `b`
    // metallic. Sampling them separately would mean two textures and two
    // fetches for numbers that are authored in one image and vary together.
    let orm = textureSample(orm_map, orm_sampler, in.uv);
    let roughness = material.params.y * orm.g;
    let metallic = material.params.x * orm.b;

    let surface = make_surface(
        albedo,
        metallic,
        roughness,
        normal,
        view_dir,
    );

    // -- the sun, the one global shadow emitter --
    //
    // The shadow lookup is skipped outright on a surface the sun cannot reach.
    // It is the most expensive single thing in this shader — nine taps, or
    // eighteen inside a cascade blend band — and on a fragment facing away from
    // the sun every one of them is discarded by `shade_light`'s own `n_dot_l`
    // test a few lines later. Roughly half the visible surface in a lit scene
    // faces away from the light.
    let sun_dir = normalize(frame_fs.sun_direction.xyz);
    var color = vec3<f32>(0.0);

    if dot(normal, sun_dir) > 0.0 {
        let sun_visibility = sun_shadow(
            shadow_atlas,
            shadow_sampler,
            shadows,
            in.world_pos,
            normal,
            sun_dir,
            view_z,
        );
        color = shade_light(surface, sun_dir) * frame_fs.sun_color.rgb * sun_visibility;
    }

    // -- the cluster's punctual lights, furthest first --
    let coord = cluster_of_fragment(
        in.position.xy,
        view_z,
        frame_fs.tile.xy,
        frame_fs.cluster_z.x,
        frame_fs.cluster_z.y,
    );
    let cluster = cluster_index(coord);
    let count = light_count[cluster];
    let base = cluster * MAX_LIGHTS_PER_CLUSTER;

    let mode = frame_fs.debug.x;
    if mode != DEBUG_OFF {
        return debug_view(mode, count, in.position.xy, view_z, in.world_pos, normal);
    }

    for (var i = 0u; i < count; i = i + 1u) {
        let light = lights[light_index[base + i]];

        let delta = light.position - in.world_pos;
        let dist_sq = dot(delta, delta);
        if dist_sq > light.range * light.range {
            continue;
        }

        let to_light = delta * inverseSqrt(max(dist_sq, 1e-8));

        // Facing away from the light. `shade_light` would return zero for this
        // anyway, but only *after* the shadow lookup below has run — and that
        // lookup is a nine-tap PCF. A light's sphere covers surfaces on both
        // sides of it, so this rejects a large fraction of the loop before it
        // touches a texture.
        if dot(normal, to_light) <= 0.0 {
            continue;
        }

        var attenuation = distance_attenuation(dist_sq, light.range);
        if light.kind == LIGHT_SPOT {
            attenuation = attenuation * spot_attenuation(light, to_light);
        }
        if attenuation <= 0.0 {
            continue;
        }

        if light.shadow >= 0 {
            attenuation = attenuation * spot_shadow(
                spot_atlas,
                spot_sampler,
                shadows,
                u32(light.shadow),
                in.world_pos,
                normal,
                to_light,
            );
        }

        color = color + shade_light(surface, to_light) * light.color * attenuation;
    }

    // -- ambient, occluded --
    //
    // Two occlusion terms, multiplied. The screen-space one catches contact
    // between separate objects, which a texture cannot know about; the baked map
    // catches the surface's own crevices, which SSAO cannot resolve at this
    // scale. They answer different questions and neither subsumes the other.
    let ao_uv = in.position.xy * frame_fs.screen.zw;
    let screen_ao = textureSample(occlusion, occlusion_sampler, ao_uv).r;
    let baked_ao = textureSample(ao_map, ao_sampler, in.uv).r;
    let ao = mix(1.0, screen_ao * baked_ao, material.params.z);

    // `diffuse + f0`, not `diffuse` alone. A metal has no diffuse lobe, so an
    // ambient term built only from it leaves every metal surface lit by nothing
    // but punctual highlights — which renders as solid black between them, and
    // looks like a bug rather than like physics. Adding `f0` stands in for the
    // environment reflection there is no probe to compute: crude, but a rough
    // metal's specular response to uniform surroundings really is close to `f0`,
    // and it costs one add. Dielectrics gain 0.04 of ambient, which is invisible.
    let indirect = frame_fs.sun_color.a * (surface.diffuse + surface.f0) * ao;

    // Emission is added last and is unaffected by lights, shadows and occlusion
    // — it is radiance leaving the surface, not radiance arriving at it. The map
    // is sRGB, so what arrives here is already linear.
    let emissive = material.emissive.rgb * textureSample(emissive_map, emissive_sampler, in.uv).rgb;
    color = color + indirect + emissive;

    return vec4<f32>(color, 1.0);
}
