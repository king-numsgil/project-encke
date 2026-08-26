// Every tunable number in one place, and every one of them mirrored in a shader.
//
// Functions rather than constants because Goblin has no top-level `let` or
// `const` — a module is declarations, and a compile-time number is spelled as a
// function that returns one. They inline to a literal.
//
// **Anything here that also appears in WGSL is written down twice**, and the
// pairs are named in each doc comment. There is no shared header between the two
// languages; keeping them in step is a manual obligation, so it is at least a
// visible one.

// ---------------------------------------------------------------------------
// The cluster grid. Mirrors `shaders/include/cluster.wgsl`.
// ---------------------------------------------------------------------------

/** Cluster tiles across the screen. */
export function clusterGridX(): u32 {
    return 16;
}

/** Cluster tiles down the screen. */
export function clusterGridY(): u32 {
    return 9;
}

/**
 * Depth slices, exponentially distributed.
 *
 * 24 is the number the near-dense split needs to keep the first slice thin
 * enough to matter without the last one swallowing half the frustum.
 */
export function clusterGridZ(): u32 {
    return 24;
}

/** `16 * 9 * 24`. Written out because it is a buffer length in several places. */
export function clusterCount(): u32 {
    return 3456;
}

/** Per-cluster light cap. Beyond this the nearest are kept — see `cluster_cull.wgsl`. */
export function maxLightsPerCluster(): u32 {
    return 96;
}

/** Per-scene light cap. The light storage buffer is exactly this long. */
export function maxLights(): u32 {
    return 384;
}

/** `@workgroup_size` of `cluster_build.wgsl` and `cluster_clear.wgsl`. */
export function clusterLinearWorkgroup(): u32 {
    return 64;
}

/** `@workgroup_size` of `cluster_mark.wgsl`, one axis of an 8x8 tile. */
export function clusterMarkWorkgroup(): u32 {
    return 8;
}

// ---------------------------------------------------------------------------
// Shadows. Mirrors `shaders/include/shadow.wgsl`.
// ---------------------------------------------------------------------------

/** Sun cascades. */
export function cascadeCount(): u32 {
    return 4;
}

/** Spotlights that may cast at once. */
export function spotShadowCount(): u32 {
    return 4;
}

/**
 * Side of the two near cascades, in texels.
 *
 * The near cascades cover a few metres and are what a player looks at, so they
 * get the resolution.
 */
export function nearCascadeSize(): u32 {
    return 2048;
}

/**
 * Side of the two far cascades, in texels.
 *
 * Half the near size, which is a quarter of the rasterisation. A far cascade
 * covers an enormous area at a density nobody can resolve; spending 2048 on it
 * buys nothing and costs real milliseconds.
 */
export function farCascadeSize(): u32 {
    return 1024;
}

/** `2048 + 2048 + 1024 + 1024`, the four cascades side by side. */
export function cascadeAtlasWidth(): u32 {
    return 6144;
}

/** The tallest cascade. The far ones occupy the top half of their columns. */
export function cascadeAtlasHeight(): u32 {
    return 2048;
}

/** Side of one spotlight's tile. */
export function spotShadowSize(): u32 {
    return 1024;
}

/** `2 x 2` spot tiles. */
export function spotAtlasSize(): u32 {
    return 2048;
}

/**
 * How far from the camera the sun's cascades reach.
 *
 * Beyond this nothing is shadowed. It is the single biggest lever on cascade
 * quality: halving it doubles the texel density of every cascade.
 */
export function shadowDistance(): f32 {
    return 150.0;
}

/**
 * Blend between the logarithmic and uniform cascade splits.
 *
 * 0 is uniform — even slabs, which wastes the near cascades on distance. 1 is
 * logarithmic — ideal in theory, but it puts the first split so close that the
 * second cascade does all the work. 0.75 is the usual practical compromise and
 * is what this uses.
 */
export function cascadeSplitLambda(): f32 {
    return 0.75;
}

/**
 * Constant depth bias for the sun's comparisons, in **world units**.
 *
 * World units, not clip depth, and the difference is the whole reason this
 * renderer had peter-panning. A cascade's orthographic projection maps its
 * entire depth range onto `[0, 1]`, and that range is far wider for a distant
 * cascade than a near one — so one clip-depth number means a few centimetres in
 * cascade 0 and better than half a metre in cascade 3. Expressed in world units
 * and divided by each cascade's own depth range, the bias is the same physical
 * distance everywhere.
 */
export function shadowWorldBias(): f32 {
    return 0.02;
}

/**
 * Normal-offset bias, in shadow texels.
 *
 * Scaled in the shader by the sine of the angle between the surface and the
 * light, so a surface facing the light square-on is offset by nothing. Those are
 * exactly the surfaces that cannot self-shadow, and they are also the floors
 * that objects stand on — offsetting them unconditionally is what lifts a
 * contact shadow away from its object.
 */
export function shadowNormalBias(): f32 {
    return 2.0;
}

/**
 * Rasteriser depth bias applied while drawing shadow casters, scaled by the
 * polygon's depth slope in light space.
 *
 * This is what makes back-face culling viable. A surface nearly edge-on to the
 * light spans many depth values across a single texel and needs a large offset;
 * one facing the light spans almost none and needs almost nothing. A constant
 * cannot serve both, and sizing it for the first is what detaches contacts.
 */
export function shadowSlopeBias(): f32 {
    return 2.75;
}

/** Rasteriser constant bias, in units of the smallest resolvable depth difference. */
export function shadowConstantBias(): f32 {
    return 1.25;
}

/**
 * Constant depth bias for spotlight comparisons, in clip depth.
 *
 * Clip depth here and world units for the sun, because a spotlight's projection
 * is perspective: its clip depth is not linear in distance, so there is no
 * single scale factor that would convert one to the other. Spot maps are short
 * range by design, which keeps the non-linearity mild enough for a constant to
 * work.
 */
export function spotDepthBias(): f32 {
    return 0.0006;
}

/** Spotlight normal-offset, in world units. Scaled by obliquity like the sun's. */
export function spotNormalBias(): f32 {
    return 0.03;
}

/** PCF tap spacing, in atlas texels. The filter is 3x3 around this. */
export function shadowPcfRadius(): f32 {
    return 1.0;
}

/** Fraction of a cascade's depth range spent fading into the next one. */
export function cascadeBlendFraction(): f32 {
    return 0.08;
}

// ---------------------------------------------------------------------------
// SSAO. Mirrors `shaders/ssao.wgsl`.
// ---------------------------------------------------------------------------

/** Occlusion radius in world units. About the width of a crate in the test scene. */
export function ssaoRadius(): f32 {
    return 0.9;
}

/**
 * Tangent-plane bias, in **world units**.
 *
 * How far a neighbouring sample has to rise above the tangent plane before it
 * counts as an occluder. It exists to stop a flat surface occluding itself
 * through reconstruction error, so it is a fraction of {@link ssaoRadius} and
 * has nothing to do with depth — see the note in `shaders/ssao.wgsl`.
 */
export function ssaoBias(): f32 {
    return 0.03;
}

/** How strongly the estimator darkens. Above about 2.5 it starts to look painted on. */
export function ssaoIntensity(): f32 {
    return 1.6;
}

/**
 * Largest tap spiral, in pixels of the half-resolution target.
 *
 * A cap rather than a preference: without it, a surface close to the camera
 * projects the world radius across most of the screen and every tap misses the
 * cache.
 */
export function ssaoMaxRadiusPixels(): f32 {
    return 48.0;
}

// ---------------------------------------------------------------------------
// Camera and exposure.
// ---------------------------------------------------------------------------

/** Vertical field of view, radians. 60 degrees. */
export function cameraFovY(): f32 {
    return 1.0471975512;
}

/**
 * Near plane.
 *
 * Also the origin of the exponential z split, so pushing it towards zero does
 * not merely cost depth precision — it stretches every cluster slice.
 */
export function cameraNear(): f32 {
    return 0.1;
}

/** Far plane, and the end of the cluster grid. */
export function cameraFar(): f32 {
    return 500.0;
}

/** Multiplier applied before the tonemap curve. */
export function exposure(): f32 {
    return 1.0;
}
