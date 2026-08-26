// A box, as six independent quads.
//
// 24 vertices rather than 8, because a cube's corners have three different
// normals each and a shared vertex can only carry one. Sharing them would give
// smooth-shaded corners — a cube that looks like a badly inflated ball.
//
// A box is also how this renderer spells a floor or a wall. There is no plane
// primitive on purpose: every surface has to have real thickness, so a floor is
// a very flat box and never a quad.

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

/** Four corners in winding order, one normal, one quad. */
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
    const a = mesh.addVertex(ax, ay, az, nx, ny, nz, 0.0, 1.0);
    const b = mesh.addVertex(bx, by, bz, nx, ny, nz, 1.0, 1.0);
    const c = mesh.addVertex(cx, cy, cz, nx, ny, nz, 1.0, 0.0);
    const d = mesh.addVertex(dx, dy, dz, nx, ny, nz, 0.0, 0.0);
    mesh.addQuad(a, b, c, d);
}
