// A mesh on the CPU, before it becomes buffers.
//
// One interleaved vertex stream — position, normal, UV — because that is what
// the vertex pipeline reads and splitting it into three arrays would only mean
// three uploads and three attribute fetches from three cache lines.
//
// Tangents are here because normal mapping needs a basis to interpret a tangent
// space map in, and there is nowhere cheaper to compute one: a generator knows
// its own UV layout exactly, where the fragment shader would have to recover it
// from screen-space derivatives every frame.
//
// `tangent.w` is a **handedness sign**, not a fourth axis. The bitangent is
// `w * cross(normal, tangent)`, so one float stands in for three — and it has to
// be a sign rather than assumed, because a UV layout that mirrors across a seam
// flips it.

/** Floats per vertex: `position.xyz`, `normal.xyz`, `uv`, `tangent.xyzw`. */
export function vertexFloats(): u32 {
    return 12;
}

/** Bytes per vertex. The vertex buffer's pitch. */
export function vertexStride(): u32 {
    return 48;
}

export class MeshData {
    /** Interleaved, {@link vertexFloats} per vertex. */
    vertices: f32[];
    indices: u32[];

    /**
     * An array field is storage like any other, and storage is zeroed rather
     * than constructed — so it has to be given a value before anything pushes
     * to it.
     */
    constructor() {
        this.vertices = [];
        this.indices = [];
    }

    vertexCount(): u32 {
        return cast<u32>(this.vertices.length / cast<usize>(vertexFloats()));
    }

    indexCount(): u32 {
        return cast<u32>(this.indices.length);
    }

    /**
     * Append one vertex, and hand back its index for the triangle calls.
     *
     * `tx, ty, tz` is the direction of increasing `u` across the surface, and
     * `tw` is the bitangent's handedness — see the note at the top of this file.
     */
    addVertex(
        px: f32,
        py: f32,
        pz: f32,
        nx: f32,
        ny: f32,
        nz: f32,
        u: f32,
        v: f32,
        tx: f32,
        ty: f32,
        tz: f32,
        tw: f32,
    ): u32 {
        const index = this.vertexCount();
        this.vertices.push(px);
        this.vertices.push(py);
        this.vertices.push(pz);
        this.vertices.push(nx);
        this.vertices.push(ny);
        this.vertices.push(nz);
        this.vertices.push(u);
        this.vertices.push(v);
        this.vertices.push(tx);
        this.vertices.push(ty);
        this.vertices.push(tz);
        this.vertices.push(tw);
        return index;
    }

    addTriangle(a: u32, b: u32, c: u32): void {
        this.indices.push(a);
        this.indices.push(b);
        this.indices.push(c);
    }

    /** Two triangles over four corners, wound `a b c` and `a c d`. */
    addQuad(a: u32, b: u32, c: u32, d: u32): void {
        this.addTriangle(a, b, c);
        this.addTriangle(a, c, d);
    }

    /** The mesh's axis-aligned extent, as `[minX, minY, minZ, maxX, maxY, maxZ]`. */
    bounds(): FixedArray<f32, 6> {
        const box: FixedArray<f32, 6> = fixedArray(6, 0.0);
        if (this.vertices.length === 0) {
            return box;
        }

        for (let axis: usize = 0; axis < 3; axis++) {
            box[axis] = this.vertices[axis];
            box[axis + 3] = this.vertices[axis];
        }

        const stride = cast<usize>(vertexFloats());
        for (let i: usize = 0; i < this.vertices.length; i += stride) {
            for (let axis: usize = 0; axis < 3; axis++) {
                const value = this.vertices[i + axis];
                if (value < box[axis]) {
                    box[axis] = value;
                }
                if (value > box[axis + 3]) {
                    box[axis + 3] = value;
                }
            }
        }

        return box;
    }
}

/**
 * Complain about a mesh with no thickness.
 *
 * **This renderer cannot fix a zero-thickness wall and nothing downstream can.**
 * A punctual light shades a surface by its normal; a plane has one surface, so
 * whatever is behind it is lit exactly as brightly as what is in front. There is
 * no shading-stage trick that recovers the occlusion, because the geometry never
 * carried it — and the shadow pass makes it worse rather than better, since it
 * culls front faces and a plane has no inside to rasterise.
 *
 * So this is a content check, and it is a warning rather than a refusal: the
 * renderer will happily draw the thing, it will just look wrong, and the person
 * who needs to know is whoever authored it.
 */
export function warnIfPaperThin(mesh: Reference<MeshData>, name: string, minimum: f32): boolean {
    const box = mesh.bounds();
    const axes = "xyz";
    let sound = true;

    for (let axis: usize = 0; axis < 3; axis++) {
        const extent = box[axis + 3] - box[axis];
        if (extent < minimum) {
            console.log(
                `geometry: '${name}' is ${extent} thick along ${axes.substring(axis, axis + 1)} ` +
                    `(want at least ${minimum}) — light will bleed through it and the renderer cannot help`,
            );
            sound = false;
        }
    }

    return sound;
}
