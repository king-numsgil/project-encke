// One glTF primitive, turned into the vertex stream encke's pipelines declare.
//
// The layout is `src/renderer/geometry/meshdata.ts` and nothing here may drift
// from it: twelve floats per vertex — `position.xyz`, `normal.xyz`, `uv`,
// `tangent.xyzw` — interleaved, with 32-bit indices. Baking it on this side is
// the whole reason the boundary is narrow: encke receives two pointers and two
// counts and hands them straight to `GpuMesh.upload`.
//
// Three things glTF permits that the pipeline does not, all fixed here:
//
//   * **No NORMAL.** The spec says such a primitive is flat-shaded, which means
//     face normals, which means a vertex cannot be shared between two faces —
//     so the primitive is de-indexed first. Averaging into shared vertices
//     would be smooth shading, and smooth is not what the file asked for.
//   * **No TANGENT.** Generated from the UVs, because normal mapping has no
//     basis without one and the fragment shader would otherwise have to
//     recover it from screen-space derivatives every frame.
//   * **Strips and fans.** Expanded to independent triangles, since that is the
//     only topology the renderer draws.
//
// Points and lines are skipped rather than converted. There is nothing to
// convert them *to*.

use gltf::Primitive;
use gltf::mesh::Mode;

/// Floats per vertex. Mirrors `vertexFloats()` in `meshdata.ts`.
pub const VERTEX_FLOATS: usize = 12;

/// A primitive in encke's layout, owning its two streams.
pub struct Baked {
    pub vertices: Vec<f32>,
    pub indices: Vec<u32>,
}

impl Baked {
    pub fn vertex_count(&self) -> usize {
        self.vertices.len() / VERTEX_FLOATS
    }

    /// The same geometry wound the other way, for a mirroring node transform.
    ///
    /// glTF requires the winding to be reversed under a negative-determinant
    /// global transform, and encke culls back faces — so without this a mirrored
    /// instance renders inside out. Only the index order changes, so this is a
    /// copy of the small stream and a share of the large one would be a
    /// premature saving.
    pub fn reversed(&self) -> Baked {
        let mut indices = self.indices.clone();
        for triangle in indices.as_chunks_mut::<3>().0 {
            triangle.swap(1, 2);
        }
        Baked { vertices: self.vertices.clone(), indices }
    }
}

/// Bake one primitive, or `None` if it is not made of triangles.
pub fn bake(primitive: &Primitive, buffers: &[Vec<u8>]) -> Result<Option<Baked>, String> {
    let mode = primitive.mode();
    if !matches!(mode, Mode::Triangles | Mode::TriangleStrip | Mode::TriangleFan) {
        return Ok(None);
    }

    let reader = primitive.reader(|buffer| buffers.get(buffer.index()).map(|data| &data[..]));

    let positions: Vec<[f32; 3]> = reader
        .read_positions()
        .ok_or_else(|| "a primitive has no POSITION attribute".to_string())?
        .collect();

    if positions.is_empty() {
        return Ok(None);
    }

    let normals: Option<Vec<[f32; 3]>> = reader.read_normals().map(|n| n.collect());
    let tangents: Option<Vec<[f32; 4]>> = reader.read_tangents().map(|t| t.collect());
    let uvs: Option<Vec<[f32; 2]>> = reader.read_tex_coords(0).map(|uv| uv.into_f32().collect());

    // An indexless primitive draws its vertices in order, which is exactly what
    // a counting sequence expresses — so everything below has one path.
    let source: Vec<u32> = match reader.read_indices() {
        Some(indices) => indices.into_u32().collect(),
        None => (0..positions.len() as u32).collect(),
    };

    let mut indices = triangles(&source, mode);
    if indices.is_empty() {
        return Ok(None);
    }

    // Bounds-check once, here, rather than trusting every lookup below. A file
    // whose indices run past its POSITION accessor is malformed, and finding
    // that out as a panic inside a DLL is the least useful way to find it out.
    let limit = positions.len() as u32;
    if indices.iter().any(|&index| index >= limit) {
        return Err("a primitive's indices run past its POSITION accessor".into());
    }

    let mut positions = positions;
    let mut uvs = uvs.unwrap_or_else(|| vec![[0.0, 0.0]; positions.len()]);
    let mut tangents = tangents;

    // Flat shading, which is what the spec says an absent NORMAL means. The
    // de-index has to happen before tangents are generated or read, because it
    // renumbers every vertex.
    let normals = match normals {
        Some(normals) => normals,
        None => {
            let flat = flatten(&indices, &mut positions, &mut uvs, &mut tangents);
            indices = (0..positions.len() as u32).collect();
            flat
        }
    };

    if normals.len() < positions.len() || uvs.len() < positions.len() {
        return Err("a primitive's attributes disagree on vertex count".into());
    }

    let tangents = match tangents {
        Some(tangents) if tangents.len() >= positions.len() => tangents,
        _ => generate_tangents(&positions, &normals, &uvs, &indices),
    };

    let mut vertices = Vec::with_capacity(positions.len() * VERTEX_FLOATS);
    for i in 0..positions.len() {
        vertices.extend_from_slice(&positions[i]);
        vertices.extend_from_slice(&normals[i]);
        vertices.extend_from_slice(&uvs[i]);
        vertices.extend_from_slice(&tangents[i]);
    }

    Ok(Some(Baked { vertices, indices }))
}

/// The primitive's topology as independent triangles.
///
/// A strip alternates winding on every other triangle and a fan pivots on its
/// first vertex; both are expanded here so the renderer sees one topology.
fn triangles(source: &[u32], mode: Mode) -> Vec<u32> {
    match mode {
        Mode::Triangles => {
            // A trailing partial triangle is dropped rather than refused. It is
            // a malformed file either way, and dropping it renders the rest.
            let usable = source.len() - source.len() % 3;
            source[..usable].to_vec()
        }
        Mode::TriangleStrip => {
            let mut out = Vec::new();
            for i in 2..source.len() {
                if i % 2 == 0 {
                    out.extend_from_slice(&[source[i - 2], source[i - 1], source[i]]);
                } else {
                    out.extend_from_slice(&[source[i - 1], source[i - 2], source[i]]);
                }
            }
            out
        }
        Mode::TriangleFan => {
            let mut out = Vec::new();
            for i in 2..source.len() {
                out.extend_from_slice(&[source[0], source[i - 1], source[i]]);
            }
            out
        }
        _ => Vec::new(),
    }
}

/// De-index into one vertex per corner, and hand back the face normals.
///
/// Every attribute array is rewritten in place to the new numbering, so the
/// caller's indices become a counting sequence.
fn flatten(
    indices: &[u32],
    positions: &mut Vec<[f32; 3]>,
    uvs: &mut Vec<[f32; 2]>,
    tangents: &mut Option<Vec<[f32; 4]>>,
) -> Vec<[f32; 3]> {
    let mut new_positions = Vec::with_capacity(indices.len());
    let mut new_uvs = Vec::with_capacity(indices.len());
    let mut new_tangents = tangents.as_ref().map(|_| Vec::with_capacity(indices.len()));
    let mut normals = Vec::with_capacity(indices.len());

    for triangle in indices.as_chunks::<3>().0 {
        let corners = [
            positions[triangle[0] as usize],
            positions[triangle[1] as usize],
            positions[triangle[2] as usize],
        ];
        let normal = normalize(cross(
            subtract(corners[1], corners[0]),
            subtract(corners[2], corners[0]),
        ));

        for (corner, &index) in triangle.iter().enumerate() {
            new_positions.push(corners[corner]);
            new_uvs.push(uvs.get(index as usize).copied().unwrap_or([0.0, 0.0]));
            if let (Some(out), Some(source)) = (new_tangents.as_mut(), tangents.as_ref()) {
                out.push(source.get(index as usize).copied().unwrap_or([1.0, 0.0, 0.0, 1.0]));
            }
            normals.push(normal);
        }
    }

    *positions = new_positions;
    *uvs = new_uvs;
    *tangents = new_tangents;
    normals
}

/// Per-vertex tangents from the UV parameterisation — Lengyel's method.
///
/// Each triangle contributes the direction of increasing `u` across its own
/// surface, accumulated into its three vertices and orthogonalised against the
/// shading normal at the end. `w` is the bitangent's handedness, which has to be
/// derived rather than assumed: a UV layout that mirrors across a seam flips it,
/// and a wrong sign turns a normal map inside out on exactly half a model.
fn generate_tangents(
    positions: &[[f32; 3]],
    normals: &[[f32; 3]],
    uvs: &[[f32; 2]],
    indices: &[u32],
) -> Vec<[f32; 4]> {
    let mut tangent_sum = vec![[0.0f32; 3]; positions.len()];
    let mut bitangent_sum = vec![[0.0f32; 3]; positions.len()];

    for triangle in indices.as_chunks::<3>().0 {
        let (a, b, c) = (
            triangle[0] as usize,
            triangle[1] as usize,
            triangle[2] as usize,
        );

        let edge1 = subtract(positions[b], positions[a]);
        let edge2 = subtract(positions[c], positions[a]);

        let du1 = uvs[b][0] - uvs[a][0];
        let dv1 = uvs[b][1] - uvs[a][1];
        let du2 = uvs[c][0] - uvs[a][0];
        let dv2 = uvs[c][1] - uvs[a][1];

        // A degenerate UV triangle — a seam collapsed to a point, or a
        // primitive with no UVs at all, where every corner is (0, 0) — has no
        // direction of increasing `u` to contribute. Skipped, and the fallback
        // below catches any vertex that ends up with nothing.
        let determinant = du1 * dv2 - du2 * dv1;
        if determinant.abs() < 1e-12 {
            continue;
        }
        let r = 1.0 / determinant;

        let tangent = [
            (edge1[0] * dv2 - edge2[0] * dv1) * r,
            (edge1[1] * dv2 - edge2[1] * dv1) * r,
            (edge1[2] * dv2 - edge2[2] * dv1) * r,
        ];
        let bitangent = [
            (edge2[0] * du1 - edge1[0] * du2) * r,
            (edge2[1] * du1 - edge1[1] * du2) * r,
            (edge2[2] * du1 - edge1[2] * du2) * r,
        ];

        for &corner in &[a, b, c] {
            tangent_sum[corner] = add(tangent_sum[corner], tangent);
            bitangent_sum[corner] = add(bitangent_sum[corner], bitangent);
        }
    }

    let mut out = Vec::with_capacity(positions.len());
    for i in 0..positions.len() {
        let normal = normals[i];
        // Gram-Schmidt: the accumulated tangent is only approximately in the
        // surface plane once several faces have contributed to it.
        let projected = subtract(tangent_sum[i], scale(normal, dot(normal, tangent_sum[i])));
        let tangent = if length(projected) > 1e-8 {
            normalize(projected)
        } else {
            any_perpendicular(normal)
        };

        let handedness = if dot(cross(normal, tangent), bitangent_sum[i]) < 0.0 {
            -1.0
        } else {
            1.0
        };
        out.push([tangent[0], tangent[1], tangent[2], handedness]);
    }

    out
}

/// Some unit vector at right angles to `n`, for a vertex no triangle could
/// parameterise. Arbitrary, and it has to be: there is no correct answer, only
/// a finite one, and an all-zero tangent would produce NaNs in the shader.
fn any_perpendicular(n: [f32; 3]) -> [f32; 3] {
    let axis = if n[0].abs() < 0.9 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] };
    normalize(cross(axis, n))
}

fn add(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn subtract(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn scale(a: [f32; 3], k: f32) -> [f32; 3] {
    [a[0] * k, a[1] * k, a[2] * k]
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn length(a: [f32; 3]) -> f32 {
    dot(a, a).sqrt()
}

fn normalize(a: [f32; 3]) -> [f32; 3] {
    let len = length(a);
    if len > 1e-20 { scale(a, 1.0 / len) } else { [0.0, 0.0, 1.0] }
}
