// Deciding which spotlights cast this frame.
//
// Four maps, and a scene may want more than four. The contest is by distance to
// the camera, which is the cheapest proxy for "the one the player is looking at"
// and is stable enough not to flicker: a light has to actually overtake another
// to steal its slot, rather than winning on a tie-break that changes each frame.
//
// The assignment is computed *into* a parallel array rather than written back
// onto the lights. Rendering does not modify the scene it was handed — which
// also means the same scene can be rendered twice from different viewpoints
// without the first render poisoning the second.

import type { fvec3 } from "std/linalg";
import { spotShadowCount } from "../config.ts";
import type { ShadowUniform } from "../frame/uniforms.ts";
import { computeSpotViewProj, setSpotShadow } from "./cascades.ts";
import { type Light, lightKindSpot } from "./light.ts";

export class SpotAssignment {
    /**
     * Slot per light, parallel to the scene's light array. `-1` for a light not
     * casting this frame.
     */
    slots: i32[];

    /** How many slots were filled. Tiles past this keep the clear's depth of 1.0. */
    count: u32;

    constructor() {
        this.slots = [];
        this.count = 0;
    }
}

/**
 * Choose up to four casters and fill their half of the shadow block.
 *
 * A point light never casts here — omni shadows need a cube map and six passes,
 * and the spec puts exactly one global shadow emitter (the sun) plus four short
 * spotlights in scope.
 */
export function assignSpotShadows(
    lights: Reference<Light[]>,
    shadows: Pointer<ShadowUniform>,
    cameraPosition: fvec3,
): SpotAssignment {
    const assignment = new SpotAssignment();
    assignment.count = 0;

    const capacity = spotShadowCount();

    // Best `capacity` candidates so far, nearest first.
    const chosen: usize[] = [];
    const distances: f32[] = [];

    for (let i: usize = 0; i < lights.length; i++) {
        assignment.slots.push(-1);

        if (lights[i].kind !== lightKindSpot() || !lights[i].castsShadow) {
            continue;
        }

        const distance = lights[i].position.distance(cameraPosition);

        // Insertion into a list at most four long. A sort would be more code
        // than the thing being sorted.
        let at = chosen.length;
        while (at > 0 && distances[at - 1] > distance) {
            at -= 1;
        }
        if (at >= cast<usize>(capacity)) {
            continue;
        }

        chosen.push(0);
        distances.push(0.0);
        for (let j = chosen.length - 1; j > at; j--) {
            chosen[j] = chosen[j - 1];
            distances[j] = distances[j - 1];
        }
        chosen[at] = i;
        distances[at] = distance;

        if (chosen.length > cast<usize>(capacity)) {
            chosen.pop();
            distances.pop();
        }
    }

    for (let slot: usize = 0; slot < chosen.length; slot++) {
        const index = chosen[slot];
        const light = lights[index];

        setSpotShadow(
            shadows,
            cast<u32>(slot),
            computeSpotViewProj(light.position, light.direction, light.cosOuter, light.range),
        );
        assignment.slots[index] = cast<i32>(slot);
    }

    assignment.count = cast<u32>(chosen.length);
    return assignment;
}
