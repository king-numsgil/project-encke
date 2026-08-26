// A UV sphere.
//
// Not an icosphere. An icosphere has more even triangles and is the better
// primitive in general — but this exists to be a smooth curved surface for a
// specular lobe to slide across, and a UV sphere's poles are a shading artefact
// nobody will be looking at. The generator is a third of the length.
//
// The seam is real: the last column of vertices duplicates the first, because
// UV wraps from 1 back to 0 and one vertex cannot hold both.

import { fcos, fsin, fpi } from "std/math";
import { MeshData } from "./meshdata.ts";

/**
 * A sphere centred on the origin.
 *
 * `segments` is the count around the equator, `rings` the count from pole to
 * pole. 32 by 16 is the usual default and is what the test scene uses.
 */
export function makeSphere(radius: f32, segments: u32, rings: u32): MeshData {
    const mesh = new MeshData();

    const across = segments < 3 ? 3 : segments;
    const down = rings < 2 ? 2 : rings;

    for (let ring: u32 = 0; ring <= down; ring++) {
        const v = cast<f32>(ring) / cast<f32>(down);
        const polar = v * fpi();
        const sinPolar = fsin(polar);
        const cosPolar = fcos(polar);

        for (let segment: u32 = 0; segment <= across; segment++) {
            const u = cast<f32>(segment) / cast<f32>(across);
            const azimuth = u * fpi() * 2.0;

            // The normal *is* the unit position on a sphere, which is the one
            // place that shortcut is exactly right rather than nearly right.
            const nx = fsin(azimuth) * sinPolar;
            const ny = cosPolar;
            const nz = fcos(azimuth) * sinPolar;

            // The tangent is the derivative of position with respect to `u`,
            // with the constant factors dropped since it is normalised anyway:
            // differentiating `(sin a * sin p, cos p, cos a * sin p)` by the
            // azimuth leaves `(cos a, 0, -sin a)`. It stays unit length at every
            // latitude because the `sin p` falls out of both surviving terms.
            //
            // Handedness is -1 everywhere, and that is derived rather than
            // guessed: `cross(normal, tangent)` works out to
            // `(-cos p * sin a, sin p, -cos p * cos a)`, whose dot with the
            // v-derivative is exactly `-(cos^2 p + sin^2 p)`, or -1.
            mesh.addVertex(
                nx * radius,
                ny * radius,
                nz * radius,
                nx,
                ny,
                nz,
                u,
                v,
                fcos(azimuth),
                0.0,
                -fsin(azimuth),
                -1.0,
            );
        }
    }

    const columns = across + 1;
    for (let ring: u32 = 0; ring < down; ring++) {
        for (let segment: u32 = 0; segment < across; segment++) {
            const topLeft = ring * columns + segment;
            const topRight = topLeft + 1;
            const bottomLeft = topLeft + columns;
            const bottomRight = bottomLeft + 1;

            // The pole rings collapse to a point, so one of the two triangles
            // there is degenerate. Skipping them keeps the index buffer honest.
            if (ring !== 0) {
                mesh.addTriangle(topLeft, bottomLeft, topRight);
            }
            if (ring !== down - 1) {
                mesh.addTriangle(topRight, bottomLeft, bottomRight);
            }
        }
    }

    return mesh;
}
