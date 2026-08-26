// Six clip planes pulled out of a view-projection matrix, and a sphere test
// against them.
//
// One class serves the camera, the sun's cascades and the spotlights, because
// the extraction does not care what kind of projection produced the matrix. A
// clip volume is `-w <= x,y <= w` and `0 <= z <= w` whatever built it, so the
// planes are sums and differences of the matrix's rows and an orthographic
// matrix — where `w` is the constant 1 — falls out of the same arithmetic as a
// perspective one. That is the whole reason the shadow passes need no geometry
// of their own to cull with.
//
// **Deriving the planes from the matrix, rather than rebuilding them from the
// cascade's centre and radius, is what makes shadow culling safe.** The stored
// matrix already carries two things a reconstruction would have to remember:
// the caster margin, which pushes the volume 60 units back towards the sun so
// that objects behind the visible slice still cast into it, and the texel
// snapping, which slides the whole volume by up to a texel each frame. A test
// against the real matrix rejects an object only when the rasteriser would have
// clipped every one of its fragments anyway, so the atlas that comes out is the
// one that came out before.
//
// The plane order is left, right, bottom, top, near, far, and nothing outside
// this file depends on it.

import { fmat4, fvec3, fvec4 } from "std/linalg";

/** How many planes bound a clip volume. */
function planeCount(): usize {
    return 6;
}

export class Frustum {
    /**
     * `xyz` is the inward-facing unit normal, `w` the plane's offset, so the
     * signed distance to a point is `dot(xyz, point) + w` and it is positive
     * inside.
     */
    private planes: FixedArray<fvec4, 6>;

    constructor() {
        this.planes = fixedArray(6, fvec4.zero());
    }

    /**
     * Fill the planes from a world-to-clip matrix.
     *
     * Gribb-Hartmann: each plane is a row of the matrix added to or subtracted
     * from the `w` row, which is the algebraic statement of the clip test it
     * comes from. The near plane is the `z` row alone rather than `z + w`
     * because this renderer's depth runs `[0, 1]` and not `[-1, 1]` — the
     * convention `fmat4.perspective` and `fmat4.ortho` both produce. Getting
     * that one wrong culls everything in front of the camera, which at least
     * fails loudly.
     */
    build(viewProj: fmat4): void {
        // Columns to rows. `c0.w` is row 3, column 0 — the transpose is written
        // out because the extraction is stated in terms of rows and reading it
        // against the formula matters more here than brevity.
        const row0 = new fvec4(viewProj.c0.x, viewProj.c1.x, viewProj.c2.x, viewProj.c3.x);
        const row1 = new fvec4(viewProj.c0.y, viewProj.c1.y, viewProj.c2.y, viewProj.c3.y);
        const row2 = new fvec4(viewProj.c0.z, viewProj.c1.z, viewProj.c2.z, viewProj.c3.z);
        const row3 = new fvec4(viewProj.c0.w, viewProj.c1.w, viewProj.c2.w, viewProj.c3.w);

        this.setPlane(0, row3.add(row0));
        this.setPlane(1, row3.sub(row0));
        this.setPlane(2, row3.add(row1));
        this.setPlane(3, row3.sub(row1));
        this.setPlane(4, row2);
        this.setPlane(5, row3.sub(row2));
    }

    /**
     * Whether a world-space bounding sphere is anywhere inside.
     *
     * Rejects only on a sphere that is wholly outside one plane, which is the
     * cheap conservative test — a sphere outside two planes at once near a
     * corner is not rejected, and is drawn for nothing. That case is rare
     * enough not to be worth the corner arithmetic.
     */
    containsSphere(center: fvec3, radius: f32): boolean {
        const count = planeCount();
        for (let i: usize = 0; i < count; i++) {
            const plane = this.planes[i];
            const distance = plane.x * center.x + plane.y * center.y + plane.z * center.z + plane.w;
            if (distance < -radius) {
                return false;
            }
        }
        return true;
    }

    /**
     * Store one plane, scaled so its normal is unit length.
     *
     * Without the division the distance is in units of the normal's length,
     * which differs per plane and per matrix — so comparing it against a world
     * radius would be comparing two different things, and the error would grow
     * with the projection's scale rather than showing up as an obvious failure.
     */
    private setPlane(index: usize, plane: fvec4): void {
        const normal = new fvec3(plane.x, plane.y, plane.z);
        const length = normal.length();
        if (length < 1e-8) {
            // A degenerate matrix. Everything passes, which draws too much and
            // never too little.
            this.planes[index] = new fvec4(0.0, 0.0, 0.0, 1.0);
            return;
        }

        const scale = 1.0 / length;
        this.planes[index] = new fvec4(
            plane.x * scale,
            plane.y * scale,
            plane.z * scale,
            plane.w * scale,
        );
    }
}
