// The published ABI, and the walk that fills it.
//
// Everything encke needs out of a glTF file, flattened: baked triangle meshes,
// one world transform per drawn instance, metallic-roughness materials, and the
// still-encoded bytes of every image. There is no node tree here and no
// accessor — the hierarchy is walked on this side and the attributes are read
// on this side, because doing either in Goblin would mean a much wider boundary
// for no gain.
//
// **Every pointer below is owned by the `Owned` block that produced it** and
// dies with `encke_gltf_free`. Nothing here is refcounted and nothing is
// borrowed from the caller.

use std::collections::HashMap;
use std::ffi::{CString, c_char};
use std::path::Path;

use crate::bake::{self, Baked, VERTEX_FLOATS};
use crate::uri;

/// One triangle mesh, in the layout `meshdata.ts` describes.
///
/// `vertices` is `12 * vertex_count` floats — `position.xyz`, `normal.xyz`,
/// `uv`, `tangent.xyzw` — and is what `GpuMesh.upload` copies into its staging
/// buffer without touching a single field.
#[repr(C)]
pub struct EnckeGltfMesh {
    pub vertices: *const f32,
    pub vertex_count: u32,
    pub indices: *const u32,
    pub index_count: u32,
    /// Index into {@link EnckeGltfScene::materials}. Never negative — a
    /// primitive with no material of its own gets glTF's default, appended to
    /// that array by the loader.
    pub material: u32,
    /// The glTF mesh's name and the primitive's ordinal, for GPU object labels.
    /// Never null; an unnamed mesh gets `mesh0.0`.
    pub name: *const c_char,
}

/// One drawn instance: which mesh, and where.
///
/// The node hierarchy is already applied, so `transform` is world space and
/// there is nothing left to compose. Column-major, `c0..c3`, matching
/// `fmat4` — the sixteen floats go straight into `Scene.add`.
#[repr(C)]
pub struct EnckeGltfNode {
    pub mesh: u32,
    pub transform: [f32; 16],
}

/// Metallic-roughness parameters and the images they multiply.
///
/// The texture fields are indices into {@link EnckeGltfScene::images}, or `-1`
/// for a channel the material does not map. They are **image** indices rather
/// than glTF texture indices: encke has one sampler configuration and no use
/// for the sampler half of a `texture`, and collapsing them here means the
/// consumer decodes each image once no matter how many textures cite it.
#[repr(C)]
pub struct EnckeGltfMaterial {
    /// Linear. `a` is the alpha glTF carries and this renderer does not use.
    pub base_color: [f32; 4],
    pub metallic: f32,
    pub roughness: f32,
    pub emissive: [f32; 3],
    /// `occlusionTexture.strength`. Maps onto `Material.aoStrength`.
    pub occlusion_strength: f32,
    /// `normalTexture.scale`. Reported for completeness; encke does not apply it.
    pub normal_scale: f32,

    /// sRGB. Multiplies {@link base_color}.
    pub base_color_image: i32,
    /// Linear, `g` roughness and `b` metallic — glTF's packing, and the shader's.
    pub metallic_roughness_image: i32,
    /// Linear, tangent space.
    pub normal_image: i32,
    /// Linear, `r` occlusion. Often the same image as the metallic-roughness map.
    pub occlusion_image: i32,
    /// sRGB. Multiplies {@link emissive}.
    pub emissive_image: i32,

    /// `1` when the material asked not to be back-face culled. encke culls
    /// everything; this is here so a wrongly-lit model has an explanation.
    pub double_sided: u8,
    /// Never null.
    pub name: *const c_char,
}

/// One image, still encoded.
///
/// PNG or JPEG bytes exactly as the file carried them, whether they came from a
/// GLB chunk, a data URI or a file beside the document. Decoding is the host's,
/// through SDL3_image, so that one library owns every format the program reads
/// and this crate needs no image codec at all.
#[repr(C)]
pub struct EnckeGltfImage {
    pub bytes: *const u8,
    pub length: usize,
    /// `1` when some material samples this image as colour, so the host knows
    /// to give it an `_SRGB` texture format. A map read as data must not have a
    /// transfer curve applied to it, and the file itself does not say which is
    /// which — only the slot it is referenced from does.
    pub srgb: u8,
    /// The declared media type, or `""`. Informational: SDL3_image sniffs.
    pub mime: *const c_char,
}

/// What `encke_gltf_load` hands back.
#[repr(C)]
pub struct EnckeGltfScene {
    pub meshes: *const EnckeGltfMesh,
    pub mesh_count: u32,
    pub nodes: *const EnckeGltfNode,
    pub node_count: u32,
    pub materials: *const EnckeGltfMaterial,
    pub material_count: u32,
    pub images: *const EnckeGltfImage,
    pub image_count: u32,
}

/// The allocation everything above points into.
///
/// `#[repr(C)]` with `scene` first is load-bearing: the address of the block
/// **is** the address of the `EnckeGltfScene`, so `encke_gltf_free` can take the
/// pointer it published and reconstruct the `Box` from it. The alternative is a
/// side table mapping one to the other, which is a global and a lock to save a
/// layout attribute.
#[repr(C)]
pub struct Owned {
    pub scene: EnckeGltfScene,

    meshes: Vec<EnckeGltfMesh>,
    nodes: Vec<EnckeGltfNode>,
    materials: Vec<EnckeGltfMaterial>,
    images: Vec<EnckeGltfImage>,

    // The storage the four arrays above point into. Held by the box so that it
    // outlives every pointer handed across the boundary, and never touched
    // again once the pointers are taken — pushing to one of these would move
    // its buffer and dangle the lot.
    vertex_data: Vec<Vec<f32>>,
    index_data: Vec<Vec<u32>>,
    image_data: Vec<Vec<u8>>,
    strings: Vec<CString>,
}

/// One image's bytes and declared media type, before it becomes an
/// {@link EnckeGltfImage}. A named pair rather than a tuple because it travels
/// through three functions and `(Vec<u8>, CString)` says nothing at any of them.
struct RawImage {
    bytes: Vec<u8>,
    mime: CString,
}

/// A name that is always safe to publish, whatever the file said.
///
/// A glTF name may contain an interior NUL — it is JSON, not C — and a C string
/// cannot. Falling back to the generated name is better than failing the load
/// over a label nobody reads.
fn name_of(candidate: Option<&str>, fallback: String) -> CString {
    candidate
        .and_then(|text| CString::new(text).ok())
        .unwrap_or_else(|| CString::new(fallback).unwrap_or_else(|_| CString::default()))
}

/// Column-major 4x4 multiply, `parent * child`.
fn multiply(a: &[[f32; 4]; 4], b: &[[f32; 4]; 4]) -> [[f32; 4]; 4] {
    let mut out = [[0.0f32; 4]; 4];
    for column in 0..4 {
        for row in 0..4 {
            let mut sum = 0.0;
            for k in 0..4 {
                sum += a[k][row] * b[column][k];
            }
            out[column][row] = sum;
        }
    }
    out
}

/// The determinant of the upper-left 3x3 — the sign is what matters.
///
/// Negative means the transform mirrors, which reverses the triangle winding
/// glTF declared. encke culls back faces, so a mirrored instance drawn from the
/// unmirrored index buffer shows its inside.
fn determinant3(m: &[[f32; 4]; 4]) -> f32 {
    m[0][0] * (m[1][1] * m[2][2] - m[2][1] * m[1][2])
        - m[1][0] * (m[0][1] * m[2][2] - m[2][1] * m[0][2])
        + m[2][0] * (m[0][1] * m[1][2] - m[1][1] * m[0][2])
}

pub fn load(path: &Path) -> Result<Box<Owned>, String> {
    let bytes = std::fs::read(path)
        .map_err(|error| format!("cannot read '{}': {error}", path.display()))?;

    let gltf = gltf::Gltf::from_slice(&bytes)
        .map_err(|error| format!("'{}' is not valid glTF: {error}", path.display()))?;

    // Every relative URI in the document is resolved against the document's own
    // directory, not the working directory — a model loaded by absolute path
    // still finds the `.bin` beside it.
    let base = path.parent().unwrap_or_else(|| Path::new(".")).to_path_buf();

    let document = gltf.document;
    let buffers = resolve_buffers(&document, gltf.blob, &base)?;
    let (images, srgb) = resolve_images(&document, &buffers, &base)?;

    let mut builder = Builder::new(buffers);
    builder.materials(&document);
    builder.walk(&document)?;

    Ok(builder.finish(images, srgb))
}

/// Every buffer's bytes, indexed as the document indexes them.
fn resolve_buffers(
    document: &gltf::Document,
    blob: Option<Vec<u8>>,
    base: &Path,
) -> Result<Vec<Vec<u8>>, String> {
    let mut blob = blob;
    let mut out = Vec::with_capacity(document.buffers().len());

    for buffer in document.buffers() {
        let data = match buffer.source() {
            gltf::buffer::Source::Bin => blob
                .take()
                .ok_or_else(|| "the document references a GLB chunk it does not have".to_string())?,
            gltf::buffer::Source::Uri(uri) => uri::resolve(uri, base)?,
        };

        if data.len() < buffer.length() {
            return Err(format!(
                "buffer {} is {} bytes but the document declares {}",
                buffer.index(),
                data.len(),
                buffer.length()
            ));
        }
        out.push(data);
    }

    Ok(out)
}

/// Every image's encoded bytes and declared media type, plus the sRGB flags.
///
/// The flag is computed from *usage* rather than from the image, because
/// nothing in a PNG says whether its numbers are light or data. An image cited
/// as a base-colour or emissive map is colour; the same file cited as a normal
/// map is not.
fn resolve_images(
    document: &gltf::Document,
    buffers: &[Vec<u8>],
    base: &Path,
) -> Result<(Vec<RawImage>, Vec<bool>), String> {
    let mut srgb = vec![false; document.images().len()];
    let mut mark = |image: Option<usize>| {
        if let Some(slot) = image.and_then(|index| srgb.get_mut(index)) {
            *slot = true;
        }
    };

    for material in document.materials() {
        let pbr = material.pbr_metallic_roughness();
        mark(pbr.base_color_texture().map(|info| info.texture().source().index()));
        mark(material.emissive_texture().map(|info| info.texture().source().index()));
    }

    let mut out = Vec::with_capacity(document.images().len());
    for image in document.images() {
        let (bytes, mime) = match image.source() {
            gltf::image::Source::View { view, mime_type } => {
                let data = buffers.get(view.buffer().index()).ok_or_else(|| {
                    format!("image {} cites a buffer that does not exist", image.index())
                })?;
                let start = view.offset();
                let end = start + view.length();
                if end > data.len() {
                    return Err(format!(
                        "image {} cites bytes {start}..{end} of a {}-byte buffer",
                        image.index(),
                        data.len()
                    ));
                }
                (data[start..end].to_vec(), mime_type.to_string())
            }
            gltf::image::Source::Uri { uri, mime_type } => (
                uri::resolve(uri, base)?,
                mime_type.unwrap_or_default().to_string(),
            ),
        };

        out.push(RawImage { bytes, mime: name_of(Some(mime.as_str()), String::new()) });
    }

    Ok((out, srgb))
}

/// The walk's working state.
///
/// Meshes are baked on demand and keyed by `(mesh, primitive, reversed)`, so a
/// glTF mesh referenced by twenty nodes is baked once and drawn twenty times —
/// which is the whole reason encke's `Scene` separates meshes from instances.
struct Builder {
    buffers: Vec<Vec<u8>>,
    baked: Vec<(Baked, CString, u32)>,
    keys: HashMap<(usize, usize, bool), u32>,
    nodes: Vec<EnckeGltfNode>,
    materials: Vec<EnckeGltfMaterial>,
    strings: Vec<CString>,
    /// The index of glTF's default material, appended lazily.
    default_material: Option<u32>,
}

impl Builder {
    fn new(buffers: Vec<Vec<u8>>) -> Builder {
        Builder {
            buffers,
            baked: Vec::new(),
            keys: HashMap::new(),
            nodes: Vec::new(),
            materials: Vec::new(),
            strings: Vec::new(),
            default_material: None,
        }
    }

    fn materials(&mut self, document: &gltf::Document) {
        for material in document.materials() {
            let pbr = material.pbr_metallic_roughness();
            let name = name_of(
                material.name(),
                format!("material{}", material.index().unwrap_or(0)),
            );

            let entry = EnckeGltfMaterial {
                base_color: pbr.base_color_factor(),
                metallic: pbr.metallic_factor(),
                roughness: pbr.roughness_factor(),
                emissive: material.emissive_factor(),
                occlusion_strength: material
                    .occlusion_texture()
                    .map(|texture| texture.strength())
                    .unwrap_or(1.0),
                normal_scale: material
                    .normal_texture()
                    .map(|texture| texture.scale())
                    .unwrap_or(1.0),
                base_color_image: image_of(pbr.base_color_texture().map(|i| i.texture())),
                metallic_roughness_image: image_of(
                    pbr.metallic_roughness_texture().map(|i| i.texture()),
                ),
                normal_image: image_of(material.normal_texture().map(|t| t.texture())),
                occlusion_image: image_of(material.occlusion_texture().map(|t| t.texture())),
                emissive_image: image_of(material.emissive_texture().map(|i| i.texture())),
                double_sided: material.double_sided() as u8,
                name: name.as_ptr(),
            };

            self.strings.push(name);
            self.materials.push(entry);
        }
    }

    /// glTF's default material, appended the first time a primitive needs one.
    ///
    /// Appended rather than signalled with a `-1`, so the consumer never has to
    /// branch: `EnckeGltfMesh::material` always names a real entry. The values
    /// are the spec's own defaults, which are a fully rough, fully metallic
    /// white — not encke's mid-grey dielectric.
    fn default_material(&mut self) -> u32 {
        if let Some(index) = self.default_material {
            return index;
        }

        let name = name_of(None, "gltf.default".to_string());
        let index = self.materials.len() as u32;
        self.materials.push(EnckeGltfMaterial {
            base_color: [1.0, 1.0, 1.0, 1.0],
            metallic: 1.0,
            roughness: 1.0,
            emissive: [0.0, 0.0, 0.0],
            occlusion_strength: 1.0,
            normal_scale: 1.0,
            base_color_image: -1,
            metallic_roughness_image: -1,
            normal_image: -1,
            occlusion_image: -1,
            emissive_image: -1,
            double_sided: 0,
            name: name.as_ptr(),
        });
        self.strings.push(name);
        self.default_material = Some(index);
        index
    }

    /// Walk the default scene, composing transforms down the hierarchy.
    fn walk(&mut self, document: &gltf::Document) -> Result<(), String> {
        let scene = document
            .default_scene()
            .or_else(|| document.scenes().next())
            .ok_or_else(|| "the document has no scenes".to_string())?;

        let identity = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ];

        for node in scene.nodes() {
            self.visit(&node, &identity)?;
        }
        Ok(())
    }

    fn visit(&mut self, node: &gltf::Node, parent: &[[f32; 4]; 4]) -> Result<(), String> {
        let world = multiply(parent, &node.transform().matrix());

        if let Some(mesh) = node.mesh() {
            let reversed = determinant3(&world) < 0.0;
            for primitive in mesh.primitives() {
                if let Some(index) = self.mesh_index(&mesh, &primitive, reversed)? {
                    self.nodes.push(EnckeGltfNode {
                        mesh: index,
                        transform: flatten_matrix(&world),
                    });
                }
            }
        }

        for child in node.children() {
            self.visit(&child, &world)?;
        }
        Ok(())
    }

    /// The baked mesh for this primitive, baking it if this is the first ask.
    fn mesh_index(
        &mut self,
        mesh: &gltf::Mesh,
        primitive: &gltf::Primitive,
        reversed: bool,
    ) -> Result<Option<u32>, String> {
        let key = (mesh.index(), primitive.index(), reversed);
        if let Some(&index) = self.keys.get(&key) {
            return Ok(Some(index));
        }

        // A mirrored instance reuses the unmirrored bake when there is one,
        // since only the index order differs and the vertex stream is the
        // larger of the two by far.
        let baked = match self.keys.get(&(mesh.index(), primitive.index(), !reversed)) {
            Some(&existing) => Some(self.baked[existing as usize].0.reversed()),
            None => bake::bake(primitive, &self.buffers)?,
        };

        let Some(baked) = baked else { return Ok(None) };

        let material = match primitive.material().index() {
            Some(index) => index as u32,
            None => self.default_material(),
        };

        let name = name_of(mesh.name(), format!("mesh{}", mesh.index()));
        // The primitive's ordinal is appended whatever the mesh was called, so
        // two primitives of one mesh are distinguishable in a GPU capture.
        let label = name_of(
            None,
            format!(
                "{}.{}{}",
                name.to_string_lossy(),
                primitive.index(),
                if reversed { ".mirrored" } else { "" }
            ),
        );

        let index = self.baked.len() as u32;
        self.baked.push((baked, label, material));
        self.keys.insert(key, index);
        Ok(Some(index))
    }

    /// Move everything into one block and point the ABI at it.
    fn finish(self, images: Vec<RawImage>, srgb: Vec<bool>) -> Box<Owned> {
        let Builder { baked, nodes, materials, mut strings, .. } = self;

        let mut vertex_data = Vec::with_capacity(baked.len());
        let mut index_data = Vec::with_capacity(baked.len());
        let mut meshes = Vec::with_capacity(baked.len());

        for (mesh, label, material) in baked {
            let vertex_count = mesh.vertex_count() as u32;
            let index_count = mesh.indices.len() as u32;
            vertex_data.push(mesh.vertices);
            index_data.push(mesh.indices);

            meshes.push(EnckeGltfMesh {
                vertices: vertex_data[vertex_data.len() - 1].as_ptr(),
                vertex_count,
                indices: index_data[index_data.len() - 1].as_ptr(),
                index_count,
                material,
                name: label.as_ptr(),
            });
            strings.push(label);
        }

        let mut image_data = Vec::with_capacity(images.len());
        let mut image_entries = Vec::with_capacity(images.len());
        for (index, image) in images.into_iter().enumerate() {
            image_data.push(image.bytes);
            image_entries.push(EnckeGltfImage {
                bytes: image_data[image_data.len() - 1].as_ptr(),
                length: image_data[image_data.len() - 1].len(),
                srgb: srgb.get(index).copied().unwrap_or(false) as u8,
                mime: image.mime.as_ptr(),
            });
            strings.push(image.mime);
        }

        // Boxed first, then the header is filled from the boxed value. Taking
        // `meshes.as_ptr()` before the move would be taking the address of a
        // local's buffer — which survives the move, since a `Vec` moves its
        // three words and not its heap block — but the arrays themselves must
        // never be touched again either way, so this is the order that reads
        // as deliberate rather than as luck.
        let mut owned = Box::new(Owned {
            scene: EnckeGltfScene {
                meshes: std::ptr::null(),
                mesh_count: 0,
                nodes: std::ptr::null(),
                node_count: 0,
                materials: std::ptr::null(),
                material_count: 0,
                images: std::ptr::null(),
                image_count: 0,
            },
            meshes,
            nodes,
            materials,
            images: image_entries,
            vertex_data,
            index_data,
            image_data,
            strings,
        });

        owned.scene = EnckeGltfScene {
            meshes: owned.meshes.as_ptr(),
            mesh_count: owned.meshes.len() as u32,
            nodes: owned.nodes.as_ptr(),
            node_count: owned.nodes.len() as u32,
            materials: owned.materials.as_ptr(),
            material_count: owned.materials.len() as u32,
            images: owned.images.as_ptr(),
            image_count: owned.images.len() as u32,
        };
        owned
    }
}

/// The image a texture reads, or `-1`.
fn image_of(texture: Option<gltf::Texture>) -> i32 {
    texture
        .map(|texture| texture.source().index() as i32)
        .unwrap_or(-1)
}

/// `[[f32; 4]; 4]` columns, laid out the way `fmat4` reads them.
fn flatten_matrix(m: &[[f32; 4]; 4]) -> [f32; 16] {
    let mut out = [0.0f32; 16];
    for column in 0..4 {
        out[column * 4..column * 4 + 4].copy_from_slice(&m[column]);
    }
    out
}

/// Sanity check on the layout this crate and `meshdata.ts` both hard-code.
const _: () = assert!(VERTEX_FLOATS == 12);
