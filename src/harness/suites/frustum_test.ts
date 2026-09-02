// Frustum plane extraction and the sphere test.
//
// This is the suite with the strongest claim on existing. Culling failures are
// invisible: an object wrongly rejected is missing from a frame nobody was
// looking at, and an object wrongly kept costs a draw call and looks perfect.
// The same class culls the camera's view, the sun's four cascades and the
// spotlights, so one sign error here is four bugs.
//
// Everything below is arranged so the answers are exact rather than plausible.
// A 90-degree vertical field of view at aspect 1 makes both side planes lie at
// 45 degrees, so the inward normal of the right plane is `(-1, 0, -1)/sqrt(2)`
// and the signed distance to a point is arithmetic that can be done by hand.

import { fmat4, fvec3, fvec4 } from "std/linalg";
import { fpi } from "std/math";
import { Frustum } from "../../renderer/scene/frustum.ts";
import type { Tester } from "../testing.ts";

/** The camera at the origin, looking down `-Z`, 90 degrees vertical, aspect 1. */
function squareFrustum(near: f32, far: f32): Frustum {
    const view = fmat4.lookAt(fvec3.zero(), new fvec3(0.0, 0.0, -1.0), new fvec3(0.0, 1.0, 0.0));
    const projection = fmat4.perspective(fpi() * 0.5, 1.0, near, far);

    const frustum = new Frustum();
    frustum.build(projection.mul(view));
    return frustum;
}

export function testFrustum(t: Reference<Tester>): void {
    const frustum = squareFrustum(0.1, 100.0);

    // -- the easy cases -----------------------------------------------------

    t.ok(
        "a sphere down the axis is inside",
        frustum.containsSphere(new fvec3(0.0, 0.0, -10.0), 1.0),
    );
    t.ok(
        "a sphere behind the camera is rejected",
        !frustum.containsSphere(new fvec3(0.0, 0.0, 10.0), 1.0),
    );
    t.ok(
        "a sphere past the far plane is rejected",
        !frustum.containsSphere(new fvec3(0.0, 0.0, -500.0), 1.0),
    );
    t.ok(
        "a sphere in front of the near plane is rejected",
        !frustum.containsSphere(new fvec3(0.0, 0.0, -0.05), 0.001),
    );

    // -- each side plane, one at a time -------------------------------------
    //
    // At `z = -10` the frustum is 20 across and 20 tall, so `x = 10` is exactly
    // on the right plane and `x = 12` is `2/sqrt(2)` — about 1.414 — outside it.

    t.ok(
        "a sphere exactly on the right plane is kept",
        frustum.containsSphere(new fvec3(10.0, 0.0, -10.0), 0.001),
    );
    t.ok(
        "a sphere 1.414 outside the right plane, radius 1, is rejected",
        !frustum.containsSphere(new fvec3(12.0, 0.0, -10.0), 1.0),
    );
    t.ok(
        "the same sphere with radius 2 reaches back in",
        frustum.containsSphere(new fvec3(12.0, 0.0, -10.0), 2.0),
    );

    t.ok("far left is rejected", !frustum.containsSphere(new fvec3(-1000.0, 0.0, -10.0), 1.0));
    t.ok("far right is rejected", !frustum.containsSphere(new fvec3(1000.0, 0.0, -10.0), 1.0));
    t.ok("far above is rejected", !frustum.containsSphere(new fvec3(0.0, 1000.0, -10.0), 1.0));
    t.ok("far below is rejected", !frustum.containsSphere(new fvec3(0.0, -1000.0, -10.0), 1.0));

    // -- straddling ---------------------------------------------------------
    //
    // The test is conservative by design: it rejects only a sphere wholly
    // outside one plane. A sphere the camera is inside touches every plane and
    // must be kept, and a sphere hanging over the far plane must be too.

    t.ok(
        "a sphere containing the camera is kept",
        frustum.containsSphere(fvec3.zero(), 5.0),
    );
    t.ok(
        "a sphere straddling the far plane is kept",
        frustum.containsSphere(new fvec3(0.0, 0.0, -100.0), 5.0),
    );
    t.ok(
        "a sphere straddling the near plane is kept",
        frustum.containsSphere(new fvec3(0.0, 0.0, -0.05), 1.0),
    );

    // The conservative case that is deliberately *not* rejected: outside two
    // planes at once near a corner, but not wholly outside either one. It is
    // drawn for nothing, and the corner arithmetic that would catch it costs
    // more than the draw.
    t.ok(
        "a corner sphere outside two planes at once is still kept",
        frustum.containsSphere(new fvec3(10.6, 10.6, -10.0), 1.0),
    );

    // -- a wider frustum sees more --------------------------------------------
    //
    // The same point, in and out depending only on the aspect ratio, which is
    // what proves the side planes are actually derived from the matrix rather
    // than from anything hard-coded.

    const view = fmat4.lookAt(fvec3.zero(), new fvec3(0.0, 0.0, -1.0), new fvec3(0.0, 1.0, 0.0));

    const wide = new Frustum();
    wide.build(fmat4.perspective(fpi() * 0.5, 2.0, 0.1, 100.0).mul(view));
    t.ok(
        "aspect 2 admits a point aspect 1 rejects",
        wide.containsSphere(new fvec3(15.0, 0.0, -10.0), 1.0),
    );
    t.ok(
        "aspect 1 rejects it",
        !frustum.containsSphere(new fvec3(15.0, 0.0, -10.0), 1.0),
    );

    // -- an orthographic volume, which is what the shadow passes cull with ----

    const ortho = new Frustum();
    ortho.build(fmat4.ortho(-10.0, 10.0, -10.0, 10.0, 0.0, 50.0).mul(view));
    t.ok("ortho: inside the box", ortho.containsSphere(new fvec3(0.0, 0.0, -25.0), 1.0));
    t.ok("ortho: outside in x", !ortho.containsSphere(new fvec3(20.0, 0.0, -25.0), 1.0));
    t.ok("ortho: outside in y", !ortho.containsSphere(new fvec3(0.0, -20.0, -25.0), 1.0));
    t.ok("ortho: past the far plane", !ortho.containsSphere(new fvec3(0.0, 0.0, -80.0), 1.0));
    t.ok(
        "ortho: an x-extent that does not widen with depth",
        !ortho.containsSphere(new fvec3(15.0, 0.0, -45.0), 1.0),
    );

    // -- a degenerate matrix --------------------------------------------------
    //
    // Documented behaviour, and the safe direction: everything passes, which
    // draws too much and never too little.

    const degenerate = new Frustum();
    degenerate.build(fmat4.fromColumns(fvec4.zero(), fvec4.zero(), fvec4.zero(), fvec4.zero()));
    t.ok(
        "a degenerate matrix keeps everything",
        degenerate.containsSphere(new fvec3(1000.0, 1000.0, 1000.0), 0.001),
    );

    // -- a frustum that was never built --------------------------------------
    //
    // Planes of all zeroes, so every distance is zero and nothing is `< -radius`.
    // Also the safe direction, and worth pinning: a `Frustum` field that some
    // future pass forgets to build must not silently cull the scene away.
    const unbuilt = new Frustum();
    t.ok(
        "an unbuilt frustum culls nothing",
        unbuilt.containsSphere(new fvec3(0.0, 0.0, 1000.0), 0.001),
    );
}
