// Cascaded shadow maps for the sun, and single maps for up to four spotlights.
//
// Both live in atlases rather than texture arrays, and that is the whole reason
// the rect arithmetic below exists. An array forces every layer to one size; the
// cascades are deliberately *not* one size — the near two are 2048 and the far
// two 1024, because a far cascade covers an enormous area at a resolution nobody
// can resolve anyway, and rasterising it at a quarter the cost is free quality.
//
//     CSM atlas, 6144 x 2048       spot atlas, 2048 x 2048
//     +--------+--------+----+----+   +------+------+
//     |   C0   |   C1   | C2 | C3 |   |  S0  |  S1  |
//     |  2048  |  2048  |1024|1024|   +------+------+
//     +--------+--------+----+----+   |  S2  |  S3  |
//                                     +------+------+
//
// The cost of an atlas is that filtering can walk out of one tile and into its
// neighbour, which reads as a bar of wrong shadow along a tile edge. Every tap
// is clamped to the tile's interior for that reason.

/** How many cascades the sun is split into. */
const CASCADE_COUNT : u32 = 4u;

/** How many spotlights may cast at once. */
const SPOT_SHADOW_COUNT : u32 = 4u;

struct Shadows {
    /** World -> light clip, per cascade. */
    cascade_view_proj : array<mat4x4<f32>, 4>,
    /** World -> light clip, per shadow-casting spotlight. */
    spot_view_proj : array<mat4x4<f32>, 4>,

    /** `xy`: the tile's UV offset in the atlas. `zw`: its UV scale. */
    cascade_rect : array<vec4<f32>, 4>,
    spot_rect : array<vec4<f32>, 4>,

    /** View-space distance at which each cascade ends. */
    cascade_split : vec4<f32>,
    /** World units covered by one shadow texel, per cascade. Drives the normal offset. */
    cascade_texel_ws : vec4<f32>,

    /**
     * Clip depth per world unit along the light, per cascade.
     *
     * The reciprocal of each cascade's orthographic depth range. It exists so a
     * bias can be stated once, in metres, and mean the same distance in all four
     * cascades — their depth ranges differ by more than an order of magnitude.
     */
    cascade_depth_scale : vec4<f32>,

    /** `xy`: one CSM atlas texel in UV. `zw`: one spot atlas texel in UV. */
    atlas_texel : vec4<f32>,

    /** `x`: sun depth bias in **world units**. `y`: normal bias in texels. `z`: PCF radius in texels. `w`: cascade blend fraction. */
    params : vec4<f32>,

    /** `x`: spot depth bias in clip depth. `y`: spot normal bias in world units. `zw`: unused. */
    spot_params : vec4<f32>,
}

/**
 * How much of the normal offset a surface needs, from `0` to `1`.
 *
 * The sine of the angle between the surface and the light. A surface facing the
 * light square-on gets nothing: its depth barely varies across a shadow texel,
 * so it cannot self-shadow, and offsetting it only moves its shadow away from
 * whatever is standing on it. A surface nearly edge-on gets the lot.
 *
 * `light_dir` points from the surface **towards** the light.
 */
fn obliquity(normal : vec3<f32>, light_dir : vec3<f32>) -> f32 {
    let n_dot_l = saturate(dot(normal, light_dir));
    return sqrt(max(1.0 - n_dot_l * n_dot_l, 0.0));
}

/** The first cascade whose far distance covers `view_z`. */
fn cascade_for(view_z: f32, splits: vec4<f32>) -> u32 {
    var cascade : u32 = CASCADE_COUNT - 1u;
    for (var i : u32 = 0u; i < CASCADE_COUNT; i = i + 1u) {
        if view_z < splits[i] {
            cascade = i;
            break;
        }
    }
    return cascade;
}

/**
 * A 3x3 percentage-closer filter over one atlas tile.
 *
 * `textureSampleCompareLevel` rather than `textureSampleCompare`: the level-less
 * form needs uniform control flow, and every caller here has already branched on
 * a cascade index that varies across the quad. The explicit LOD costs nothing —
 * a shadow map has one level.
 */
fn pcf_tile(
    atlas: texture_depth_2d,
    atlas_sampler: sampler_comparison,
    rect: vec4<f32>,
    tile_uv: vec2<f32>,
    reference: f32,
    texel: vec2<f32>,
    radius: f32,
) -> f32 {
    // Half a texel in from each edge, so a tap can never land in the neighbour.
    let inset = texel * 0.5 / max(rect.zw, vec2<f32>(1e-6));
    let clamped = clamp(tile_uv, inset, vec2<f32>(1.0) - inset);

    var sum = 0.0;
    for (var y = -1; y <= 1; y = y + 1) {
        for (var x = -1; x <= 1; x = x + 1) {
            let offset = vec2<f32>(f32(x), f32(y)) * texel * radius;
            let uv = rect.xy + clamped * rect.zw + offset;
            sum = sum + textureSampleCompareLevel(atlas, atlas_sampler, uv, reference);
        }
    }
    return sum / 9.0;
}

/**
 * Project into one cascade and filter. 1.0 is fully lit.
 *
 * Outside the cascade's depth range the answer is "lit" rather than "shadowed":
 * a fragment behind the light's far plane has nothing recorded in front of it,
 * and guessing shadow there puts a black band across the far cascade.
 */
fn sample_cascade(
    atlas: texture_depth_2d,
    atlas_sampler: sampler_comparison,
    shadows: Shadows,
    cascade: u32,
    world_pos: vec3<f32>,
) -> f32 {
    let clip = shadows.cascade_view_proj[cascade] * vec4<f32>(world_pos, 1.0);
    let ndc = clip.xyz / clip.w;

    if ndc.z <= 0.0 || ndc.z >= 1.0 {
        return 1.0;
    }

    let tile_uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    if any(tile_uv < vec2<f32>(0.0)) || any(tile_uv > vec2<f32>(1.0)) {
        return 1.0;
    }

    // The bias is stated in world units and converted here, so it is the same
    // physical distance in every cascade rather than the same clip-depth number.
    let reference = ndc.z - shadows.params.x * shadows.cascade_depth_scale[cascade];
    return pcf_tile(
        atlas,
        atlas_sampler,
        shadows.cascade_rect[cascade],
        tile_uv,
        reference,
        shadows.atlas_texel.xy,
        shadows.params.z,
    );
}

/**
 * The sun's shadow term at a world position.
 *
 * `light_dir` points from the surface **towards** the sun, and it is what makes
 * the normal offset behave: scaled by {@link obliquity}, a floor lit from above
 * is offset by nothing at all, so the contact shadow of whatever stands on it
 * begins exactly where the object does. Offsetting unconditionally — which this
 * did at first — lifts every contact shadow by a texel's worth of world space,
 * which in the far cascades is most of a metre.
 */
fn sun_shadow(
    atlas: texture_depth_2d,
    atlas_sampler: sampler_comparison,
    shadows: Shadows,
    world_pos: vec3<f32>,
    normal: vec3<f32>,
    light_dir: vec3<f32>,
    view_z: f32,
) -> f32 {
    let cascade = cascade_for(view_z, shadows.cascade_split);
    let slope = obliquity(normal, light_dir);
    let offset = normal * (shadows.cascade_texel_ws[cascade] * shadows.params.y * slope);
    let lit = sample_cascade(atlas, atlas_sampler, shadows, cascade, world_pos + offset);

    // Cross-fade into the next cascade over the last slice of this one, so the
    // resolution change is a gradient rather than a visible line across the floor.
    let blend = shadows.params.w;
    if blend <= 0.0 || cascade + 1u >= CASCADE_COUNT {
        return lit;
    }

    let split = shadows.cascade_split[cascade];
    let band = split * blend;
    let t = saturate((view_z - (split - band)) / max(band, 1e-4));
    if t <= 0.0 {
        return lit;
    }

    let next_offset = normal * (shadows.cascade_texel_ws[cascade + 1u] * shadows.params.y * slope);
    let next = sample_cascade(atlas, atlas_sampler, shadows, cascade + 1u, world_pos + next_offset);
    return mix(lit, next, t);
}

/**
 * A shadow-casting spotlight's term. `slot` is the light's assigned tile.
 *
 * `light_dir` points from the surface towards the light, the same convention the
 * sun's uses, and serves the same purpose: no offset on surfaces the light meets
 * square-on, so the pool of light under a lamp keeps its contact shadows.
 */
fn spot_shadow(
    atlas: texture_depth_2d,
    atlas_sampler: sampler_comparison,
    shadows: Shadows,
    slot: u32,
    world_pos: vec3<f32>,
    normal: vec3<f32>,
    light_dir: vec3<f32>,
) -> f32 {
    let offset = normal * (shadows.spot_params.y * obliquity(normal, light_dir));
    let clip = shadows.spot_view_proj[slot] * vec4<f32>(world_pos + offset, 1.0);
    if clip.w <= 0.0 {
        return 1.0;
    }

    let ndc = clip.xyz / clip.w;
    if ndc.z <= 0.0 || ndc.z >= 1.0 {
        return 1.0;
    }

    let tile_uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    if any(tile_uv < vec2<f32>(0.0)) || any(tile_uv > vec2<f32>(1.0)) {
        return 1.0;
    }

    return pcf_tile(
        atlas,
        atlas_sampler,
        shadows.spot_rect[slot],
        tile_uv,
        ndc.z - shadows.spot_params.x,
        shadows.atlas_texel.zw,
        shadows.params.z,
    );
}
