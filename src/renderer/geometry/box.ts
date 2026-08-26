// A box, as six independent quads.
//
// 24 vertices rather than 8, because a cube's corners have three different
// normals each and a shared vertex can only carry one. Sharing them would give
// smooth-shaded corners — a cube that looks like a badly inflated ball.
//
// A box is also how this renderer spells a floor or a wall. There is no plane
// primitive on purpose: every surface has to have real thickness, so a floor is
// a very flat box and never a quad.

import { fsqrt } from "std/math";
import { MeshData } from "./meshdata.ts";

/**
 * A box centred on the origin, `size` across on each axis.
 *
 * Wound counter-clockwise seen from outside, which is what the pipelines here
 * treat as front-facing.
 */
export function makeBox(sizeX: f32, sizeY: f32, sizeZ: f32): MeshData {
    const mesh = new MeshData();

    const x = sizeX * 0.5;
    const y = sizeY * 0.5;
    const z = sizeZ * 0.5;

    addFace(mesh, -x, -y, z, x, -y, z, x, y, z, -x, y, z, 0.0, 0.0, 1.0);
    addFace(mesh, x, -y, -z, -x, -y, -z, -x, y, -z, x, y, -z, 0.0, 0.0, -1.0);
    addFace(mesh, x, -y, z, x, -y, -z, x, y, -z, x, y, z, 1.0, 0.0, 0.0);
    addFace(mesh, -x, -y, -z, -x, -y, z, -x, y, z, -x, y, -z, -1.0, 0.0, 0.0);
    addFace(mesh, -x, y, z, x, y, z, x, y, -z, -x, y, -z, 0.0, 1.0, 0.0);
    addFace(mesh, -x, -y, -z, x, -y, -z, x, -y, z, -x, -y, z, 0.0, -1.0, 0.0);

    return mesh;
}

/** A cube. */
export function makeCube(size: f32): MeshData {
    return makeBox(size, size, size);
}

/**
 * Four corners in winding order, one normal, one quad.
 *
 * The UVs are fixed by the corner order — `a` is `(0, 1)`, `b` is `(1, 1)`,
 * `c` is `(1, 0)`, `d` is `(0, 0)` — so the tangent basis follows from the
 * corners rather than being passed in. `u` grows from `a` towards `b` and `v`
 * grows from `d` towards `a`, which makes the tangent `b - a` and the bitangent
 * `a - d`, both already axis-aligned on a box and so needing no normalisation
 * beyond a divide by their length.
 */
function addFace(
    mesh: Reference<MeshData>,
    ax: f32,
    ay: f32,
    az: f32,
    bx: f32,
    by: f32,
    bz: f32,
    cx: f32,
    cy: f32,
    cz: f32,
    dx: f32,
    dy: f32,
    dz: f32,
    nx: f32,
    ny: f32,
    nz: f32,
): void {
    const tangent = normalized(bx - ax, by - ay, bz - az);
    const bitangent = normalized(ax - dx, ay - dy, az - dz);

    // `w` is the sign that makes `w * cross(normal, tangent)` reproduce the
    // bitangent. Derived rather than assumed: it comes out -1 for every face of
    // a box under the UV layout above, but writing that constant down would be a
    // trap for the first face laid out differently.
    const cross = crossProduct(nx, ny, nz, tangent[0], tangent[1], tangent[2]);
    const handedness: f32 =
        cross[0] * bitangent[0] + cross[1] * bitangent[1] + cross[2] * bitangent[2] < 0.0 ? -1.0 : 1.0;

    const a = mesh.addVertex(ax, ay, az, nx, ny, nz, 0.0, 1.0, tangent[0], tangent[1], tangent[2], handedness);
    const b = mesh.addVertex(bx, by, bz, nx, ny, nz, 1.0, 1.0, tangent[0], tangent[1], tangent[2], handedness);
    const c = mesh.addVertex(cx, cy, cz, nx, ny, nz, 1.0, 0.0, tangent[0], tangent[1], tangent[2], handedness);
    const d = mesh.addVertex(dx, dy, dz, nx, ny, nz, 0.0, 0.0, tangent[0], tangent[1], tangent[2], handedness);
    mesh.addQuad(a, b, c, d);
}

/** A unit-length copy of a vector, or the x-axis if it had no length. */
function normalized(x: f32, y: f32, z: f32): FixedArray<f32, 3> {
    const out: FixedArray<f32, 3> = fixedArray(3, 0.0);
    const length = fsqrt(x * x + y * y + z * z);

    if (length < 1e-8) {
        out[0] = 1.0;
        return out;
    }

    out[0] = x / length;
    out[1] = y / length;
    out[2] = z / length;
    return out;
}

function crossProduct(ax: f32, ay: f32, az: f32, bx: f32, by: f32, bz: f32): FixedArray<f32, 3> {
    const out: FixedArray<f32, 3> = fixedArray(3, 0.0);
    out[0] = ay * bz - az * by;
    out[1] = az * bx - ax * bz;
    out[2] = ax * by - ay * bx;
    return out;
}
