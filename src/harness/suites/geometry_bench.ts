// Mesh generation.
//
// This is startup cost, not frame cost, and it is worth a number anyway: the
// test scene builds its boxes and spheres before the first frame, and both
// generators are `push` loops into a `MeshData` whose arrays grow by doubling.
// If a change to `MeshData` ever makes that quadratic, this is where it shows.

import { makeBox } from "../../renderer/geometry/box.ts";
import { makeSphere } from "../../renderer/geometry/sphere.ts";
import type { Bench } from "../bench.ts";

export function benchGeometry(b: Reference<Bench>): void {
    // 24 vertices and 36 indices, which is the small-allocation case: nine
    // `push` growths per mesh, all of them inside mimalloc's small size classes.
    b.run("geometry/makeBox", 20, 20000, (count) => {
        let sum: usize = 0;
        for (let i: usize = 0; i < count; i++) {
            sum += makeBox(1.0, 1.0, 1.0).vertices.length;
        }
        // Read the total so nothing above it is dead code. The compiler has no
        // reason to keep a mesh nobody looks at.
        if (sum === 0) {
            console.log("geometry/makeBox: built nothing");
        }
    });

    // 561 vertices and 2880 indices — the same loop past the point where the
    // buffer stops fitting in a size class and starts being reallocated.
    b.run("geometry/makeSphere 32x16", 20, 400, (count) => {
        let sum: usize = 0;
        for (let i: usize = 0; i < count; i++) {
            sum += makeSphere(1.0, 32, 16).vertices.length;
        }
        if (sum === 0) {
            console.log("geometry/makeSphere: built nothing");
        }
    });
}
