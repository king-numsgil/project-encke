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
//     SDL slot 0,1,2  textures     shadow_atlas, spot_atlas, occlusion
//                     + samplers   shadow_sampler, spot_sampler, occlusion_sampler
//     SDL slot 0,1,2  storage      lights, light_count, light_index
//     SDL slot 0,1,2  uniforms     frame, shadows, material
//
// Reordering the `@binding` numbers within a kind silently rebinds the shader.

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
    /** `x`: metallic. `y`: roughness. `z`: how much SSAO applies. `w`: unused. */
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
}

// -- vertex stage (set 1 uniforms) -------------------------------------------

@group(1) @binding(0) var<uniform> frame : Frame;
@group(1) @binding(1) var<uniform> object : Object;

@vertex
fn vs_main(
    @location(0) position : vec3<f32>,
    @location(1) normal : vec3<f32>,
    @location(2) uv : vec2<f32>,
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
    return out;
}

// -- fragment stage (set 2 resources, set 3 uniforms) ------------------------

@group(2) @binding(0) var shadow_atlas : texture_depth_2d;
@group(2) @binding(1) var spot_atlas : texture_depth_2d;
@group(2) @binding(2) var occlusion : texture_2d<f32>;

@group(2) @binding(3) var shadow_sampler : sampler_comparison;
@group(2) @binding(4) var spot_sampler : sampler_comparison;
@group(2) @binding(5) var occlusion_sampler : sampler;

@group(2) @binding(6) var<storage, read> lights : array<Light>;
@group(2) @binding(7) var<storage, read> light_count : array<u32>;
@group(2) @binding(8) var<storage, read> light_index : array<u32>;

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

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
    let normal = normalize(in.normal);
    let view_dir = normalize(frame_fs.camera_pos.xyz - in.world_pos);

    // View space is right-handed, so a point in front of the camera has a
    // negative z and the distance the cluster grid is indexed by is its negation.
    let view_z = -in.view_pos.z;

    let surface = make_surface(
        material.albedo.rgb,
        material.params.x,
        material.params.y,
        normal,
        view_dir,
    );

    // -- the sun, the one global shadow emitter --
    let sun_dir = normalize(frame_fs.sun_direction.xyz);
    let sun_visibility = sun_shadow(
        shadow_atlas,
        shadow_sampler,
        shadows,
        in.world_pos,
        normal,
        sun_dir,
        view_z,
    );
    var color = shade_light(surface, sun_dir) * frame_fs.sun_color.rgb * sun_visibility;

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
    let ao_uv = in.position.xy * frame_fs.screen.zw;
    let raw_ao = textureSample(occlusion, occlusion_sampler, ao_uv).r;
    let ao = mix(1.0, raw_ao, material.params.z);

    let ambient = frame_fs.sun_color.a * surface.diffuse * ao;
    color = color + ambient + material.emissive.rgb;

    return vec4<f32>(color, 1.0);
}
