// The procedural generators.
//
// These produce the surfaces the renderer is actually tuned against, and the way
// they go wrong is quiet: a tangent that is not unit length, or not perpendicular
// to its normal, does not make a mesh disappear — it makes normal mapping subtly
// wrong on one face, which reads as "the lighting looks a bit off" and gets
// blamed on the shader. Every property checked here is one the fragment shader
// assumes without verifying.

import { makeBox, makeCube } from "../../renderer/geometry/box.ts";
import { MeshData, vertexFloats, warnIfPaperThin } from "../../renderer/geometry/meshdata.ts";
import { makeSphere } from "../../renderer/geometry/sphere.ts";
import type { Tester } from "../testing.ts";

/** Squared length of a three-vector, so no square root is needed to compare. */
function lengthSquared(x: f32, y: f32, z: f32): f32 {
    return x * x + y * y + z * z;
}

/**
 * Check the tangent basis of every vertex in a mesh.
 *
 * One call rather than a check per vertex, because 561 sphere vertices would
 * otherwise be 1683 lines of identical output on a failure. The first offending
 * vertex is named and the rest of the mesh is still walked, so the count in the
 * message says how widespread the problem is.
 */
function checkTangentBasis(t: Reference<Tester>, mesh: Reference<MeshData>, name: string): void {
    const stride = cast<usize>(vertexFloats());
    let badNormal: usize = 0;
    let badTangent: usize = 0;
    let badOrthogonal: usize = 0;
    let badHandedness: usize = 0;
    let firstBad: isize = -1;

    for (let i: usize = 0; i < mesh.vertices.length; i += stride) {
        const nx = mesh.vertices[i + 3];
        const ny = mesh.vertices[i + 4];
        const nz = mesh.vertices[i + 5];
        const tx = mesh.vertices[i + 8];
        const ty = mesh.vertices[i + 9];
        const tz = mesh.vertices[i + 10];
        const tw = mesh.vertices[i + 11];

        let sound = true;

        const normalLength = lengthSquared(nx, ny, nz);
        if (normalLength < 0.999 || normalLength > 1.001) {
            badNormal += 1;
            sound = false;
        }

        const tangentLength = lengthSquared(tx, ty, tz);
        if (tangentLength < 0.999 || tangentLength > 1.001) {
            badTangent += 1;
            sound = false;
        }

        // The shader builds the bitangent as `w * cross(n, t)`, which is only a
        // basis if the two are perpendicular to begin with.
        const dot = nx * tx + ny * ty + nz * tz;
        if (dot > 0.001 || dot < -0.001) {
            badOrthogonal += 1;
            sound = false;
        }

        // Exactly +/-1, not merely close: it is a stored sign, never computed.
        if (tw !== 1.0 && tw !== -1.0) {
            badHandedness += 1;
            sound = false;
        }

        if (!sound && firstBad < 0) {
            firstBad = cast<isize>(i / stride);
        }
    }

    t.equalUsize(`${name}: normals unit length`, badNormal, 0);
    t.equalUsize(`${name}: tangents unit length`, badTangent, 0);
    t.equalUsize(`${name}: tangent perpendicular to normal`, badOrthogonal, 0);
    t.equalUsize(`${name}: handedness is exactly +/-1`, badHandedness, 0);
    if (firstBad >= 0) {
        t.fail(`${name}: tangent basis`, `first bad vertex is ${firstBad}`);
    }
}

export function testGeometry(t: Reference<Tester>): void {
    // -- box ----------------------------------------------------------------

    const box = makeBox(2.0, 3.0, 4.0);

    // 24 and not 8: a cube corner carries three different normals and a shared
    // vertex can only hold one. Sharing them is what makes a cube look inflated.
    t.equalUsize("box: 24 vertices", cast<usize>(box.vertexCount()), 24);
    t.equalUsize("box: 36 indices", cast<usize>(box.indexCount()), 36);

    const bounds = box.bounds();
    t.equalF32("box: min x", bounds[0], -1.0);
    t.equalF32("box: min y", bounds[1], -1.5);
    t.equalF32("box: min z", bounds[2], -2.0);
    t.equalF32("box: max x", bounds[3], 1.0);
    t.equalF32("box: max y", bounds[4], 1.5);
    t.equalF32("box: max z", bounds[5], 2.0);

    checkTangentBasis(t, box, "box");

    // A box has six axis-aligned faces, so every normal component is 0 or +/-1
    // and the six of them are distinct. Anything else means a face was written
    // with the wrong normal, which shades but shades wrongly.
    const stride = cast<usize>(vertexFloats());
    let faces: u32 = 0;
    for (let i: usize = 0; i < box.vertices.length; i += stride * 4) {
        const sum = box.vertices[i + 3] + box.vertices[i + 4] + box.vertices[i + 5];
        if (sum === 1.0 || sum === -1.0) {
            faces += 1;
        }
    }
    t.equalUsize("box: six axis-aligned faces", cast<usize>(faces), 6);

    const cube = makeCube(2.0);
    const cubeBounds = cube.bounds();
    t.equalF32("cube: min x", cubeBounds[0], -1.0);
    t.equalF32("cube: max z", cubeBounds[5], 1.0);

    // -- sphere -------------------------------------------------------------

    const sphere = makeSphere(2.0, 32, 16);

    // The last column duplicates the first, because UV wraps from 1 back to 0
    // and one vertex cannot carry both — so it is (segments + 1) by (rings + 1).
    t.equalUsize("sphere: (32+1)*(16+1) vertices", cast<usize>(sphere.vertexCount()), 561);

    // Both pole rings collapse to a point, so one triangle of each quad there is
    // degenerate and is skipped: `segments * (2 * rings - 2)` triangles.
    t.equalUsize("sphere: 960 triangles", cast<usize>(sphere.indexCount()), 2880);

    checkTangentBasis(t, sphere, "sphere");

    // Every position is exactly the radius from the origin — the normal *is* the
    // unit position on a sphere, which is what the generator relies on.
    let offRadius: usize = 0;
    for (let i: usize = 0; i < sphere.vertices.length; i += stride) {
        const distance = lengthSquared(
            sphere.vertices[i],
            sphere.vertices[i + 1],
            sphere.vertices[i + 2],
        );
        if (distance < 3.99 || distance > 4.01) {
            offRadius += 1;
        }
    }
    t.equalUsize("sphere: every vertex on the radius", offRadius, 0);

    const sphereBounds = sphere.bounds();
    t.nearly("sphere: min y is -radius", sphereBounds[1], -2.0, 0.001);
    t.nearly("sphere: max y is +radius", sphereBounds[4], 2.0, 0.001);

    // Degenerate parameters are clamped rather than producing an empty mesh.
    const tiny = makeSphere(1.0, 0, 0);
    t.equalUsize("sphere: segments clamped to 3, rings to 2", cast<usize>(tiny.vertexCount()), 12);

    // -- the thickness rule --------------------------------------------------

    t.ok("paper-thin: a real box passes", warnIfPaperThin(box, "box", 0.05));

    // This one prints a line of its own, which is the whole point of the check —
    // it is a warning aimed at whoever authored the mesh, and a test that
    // silenced it would not be testing it.
    const wall = makeBox(4.0, 4.0, 0.001);
    t.ok("paper-thin: a 1mm wall is reported", !warnIfPaperThin(wall, "test wall", 0.05));

    // -- an empty mesh -------------------------------------------------------

    const empty = new MeshData();
    t.equalUsize("empty: no vertices", cast<usize>(empty.vertexCount()), 0);
    const emptyBounds = empty.bounds();
    t.equalF32("empty: bounds are zero", emptyBounds[0], 0.0);
    t.equalF32("empty: bounds are zero", emptyBounds[5], 0.0);
}
