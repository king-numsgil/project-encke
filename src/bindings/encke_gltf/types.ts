// The structures `tools/gltf` publishes.
//
// Translated from `tools/gltf/src/scene.rs`, field for field and under the same
// names, the way every other binding in this folder mirrors the header it came
// from. The two must agree exactly — this is a private ABI between two halves
// of one program, so there is no header to generate from and no compiler that
// checks the pair. What there is instead is `encke_gltf_abi_version`, bumped on
// the Rust side whenever anything here changes shape and asserted at startup:
// the failure mode of a stale DLL beside a fresh executable is a garbage vertex
// stream rather than an error, and a garbage vertex stream reads as a renderer
// bug.
//
// Everything reachable from an {@link EnckeGltfScene} is owned by the loader
// and dies at `encke_gltf_free`. The arrays are never null even where their
// count is zero, so the count is what decides whether to read.

/**
 * One triangle mesh, already in this renderer's vertex layout.
 *
 * {@link vertices} is `12 * vertex_count` floats — `position.xyz`,
 * `normal.xyz`, `uv`, `tangent.xyzw` — which is exactly what
 * `geometry/meshdata.ts` describes and what every pipeline declares. The loader
 * bakes it on the Rust side precisely so that nothing here has to interleave,
 * triangulate, or invent a tangent: the two pointers go straight into
 * `GpuMesh.uploadRaw`.
 */
export interface EnckeGltfMesh {
    vertices: Pointer<f32>;
    vertex_count: u32;
    indices: Pointer<u32>;
    index_count: u32;
    /**
     * Index into {@link EnckeGltfScene.materials}. Never out of range — a
     * primitive with no material of its own gets glTF's default, which the
     * loader appends to that array rather than signalling with a sentinel.
     */
    material: u32;
    /** The glTF mesh's name and the primitive's ordinal, for GPU labels. */
    name: CString;
}

/**
 * One drawn instance: which mesh, and where.
 *
 * The node hierarchy is already composed, so {@link transform} is world space.
 * Column-major, `c0` through `c3` — the same order `fmat4` stores them in — so
 * the sixteen floats load into one without a transpose.
 */
export interface EnckeGltfNode {
    mesh: u32;
    transform: FixedArray<f32, 16>;
}

/**
 * A metallic-roughness material, and the images it multiplies.
 *
 * The image fields are indices into {@link EnckeGltfScene.images}, or `-1` for
 * a channel this material does not map. They are **image** indices rather than
 * glTF texture indices: this renderer has one sampler configuration and no use
 * for the sampler half of a glTF `texture`, and collapsing them on the loader's
 * side means each image is decoded once however many textures cite it.
 */
export interface EnckeGltfMaterial {
    /** Linear. `w` is glTF's alpha, which this renderer does not use. */
    base_color: FixedArray<f32, 4>;
    metallic: f32;
    roughness: f32;
    emissive: FixedArray<f32, 3>;
    /** `occlusionTexture.strength`, which is `Material.aoStrength` here. */
    occlusion_strength: f32;
    /** `normalTexture.scale`. Reported; this renderer does not apply it. */
    normal_scale: f32;

    /** sRGB, multiplying {@link base_color}. */
    base_color_image: i32;
    /** Linear. `g` is roughness and `b` is metallic — glTF's packing, and the shader's. */
    metallic_roughness_image: i32;
    /** Linear, tangent space. */
    normal_image: i32;
    /** Linear, `r` is occlusion. Frequently the same image as the one above. */
    occlusion_image: i32;
    /** sRGB, multiplying {@link emissive}. */
    emissive_image: i32;

    /**
     * Non-zero when the material asked not to be back-face culled.
     *
     * This renderer culls everything and has no two-sided path — every mesh is
     * required to have real thickness, which is the same rule stated from the
     * other end. It is reported so that a model which looks wrong has an
     * explanation in the log rather than a mystery.
     */
    double_sided: u8;
    name: CString;
}

/**
 * One image, still encoded.
 *
 * PNG or JPEG bytes exactly as the file carried them, wherever they came from —
 * a GLB chunk, a data URI, or a file beside the document. **The loader decodes
 * nothing**, so SDL3_image stays the one library in this program that knows a
 * pixel format and `assets/texture.ts` keeps being the one place that decides
 * mip levels and colour space.
 */
export interface EnckeGltfImage {
    bytes: Pointer<u8>;
    length: usize;
    /**
     * Non-zero when some material samples this image as colour, so it wants an
     * `_SRGB` texture format.
     *
     * A *usage* property, not a property of the file: nothing in a PNG says
     * whether its numbers are light or data, and the same bytes cited as a base
     * colour map and as a normal map would want different answers. The loader
     * works it out from the slots that referenced it.
     */
    srgb: u8;
    /** The declared media type, or `""`. Informational — SDL3_image sniffs. */
    mime: CString;
}

/** What `encke_gltf_load` hands back. */
export interface EnckeGltfScene {
    meshes: Pointer<EnckeGltfMesh>;
    mesh_count: u32;
    nodes: Pointer<EnckeGltfNode>;
    node_count: u32;
    materials: Pointer<EnckeGltfMaterial>;
    material_count: u32;
    images: Pointer<EnckeGltfImage>;
    image_count: u32;
}
