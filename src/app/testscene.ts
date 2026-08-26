// The test scene: procedural geometry, and enough lights to make clustering earn
// its keep.
//
// Phase 1 has no asset loading, so this is what there is to look at. It is built
// to exercise the parts that are hard rather than to be pretty:
//
//   * **A floor that is a slab**, 0.4 units thick, not a plane. Every surface in
//     this renderer has to have real thickness — a zero-thickness floor lights
//     identically from below, and nothing downstream can fix it.
//   * **Pillars**, so the sun's cascades have long shadows to cast and so there
//     is depth complexity for the pre-pass to resolve.
//   * **A field of point lights** on a grid, moving, so that clusters gain and
//     lose lights every frame instead of settling into a fixed assignment.
//   * **Spheres of varying roughness**, because a specular lobe sliding across a
//     curved surface is where a wrong BRDF shows up first.

import { fvec3, fmat4 } from "std/linalg";
import { fcos, fpi, fsin } from "std/math";
import type { SDL_GPUDevice } from "../graphics/sdl/index.ts";
import { makeBox } from "../renderer/geometry/box.ts";
import { GpuMesh } from "../renderer/geometry/mesh.ts";
import { warnIfPaperThin } from "../renderer/geometry/meshdata.ts";
import { makeSphere } from "../renderer/geometry/sphere.ts";
import { makeMaterial, makeMetal } from "../renderer/scene/material.ts";
import { makePointLight, makeSpotLight } from "../renderer/scene/light.ts";
import { Scene } from "../renderer/scene/scene.ts";

/** How many point lights the moving field holds. */
function pointLightCount(): u32 {
    return 160;
}

/** Minimum thickness a mesh must have on every axis, in world units. */
function minimumThickness(): f32 {
    return 0.05;
}

export function buildTestScene(device: Pointer<SDL_GPUDevice>): Scene {
    const scene = new Scene();

    scene.sunDirection = new fvec3(-0.45, 0.8, 0.4);
    scene.sunColor = new fvec3(3.2, 3.0, 2.7);
    // High enough that SSAO has something to modulate. Ambient is the only
    // indirect term this renderer has, and occlusion multiplies *into* it — at
    // 0.05 the AO buffer can be perfectly correct and change nothing anybody can
    // see.
    scene.ambient = 0.25;

    // -- meshes --
    const floorData = makeBox(48.0, 0.4, 48.0);
    const pillarData = makeBox(1.2, 6.0, 1.2);
    const crateData = makeBox(1.6, 1.6, 1.6);
    const sphereData = makeSphere(0.9, 32, 16);

    warnIfPaperThin(floorData, "floor", minimumThickness());
    warnIfPaperThin(pillarData, "pillar", minimumThickness());
    warnIfPaperThin(crateData, "crate", minimumThickness());
    warnIfPaperThin(sphereData, "sphere", minimumThickness());

    const floorMesh = new GpuMesh();
    const pillarMesh = new GpuMesh();
    const crateMesh = new GpuMesh();
    const sphereMesh = new GpuMesh();

    // Logged and carried on with rather than returned early, and that is a rule
    // of the language rather than a style choice: returning a local is a move,
    // the move check is not flow-sensitive, and an early `return scene` would
    // mark `scene` moved-from for every line below it. A mesh whose upload
    // failed has null buffers and draws nothing, so continuing is harmless.
    if (
        !floorMesh.upload(device, floorData, "floor") ||
        !pillarMesh.upload(device, pillarData, "pillar") ||
        !crateMesh.upload(device, crateData, "crate") ||
        !sphereMesh.upload(device, sphereData, "sphere")
    ) {
        console.log("scene: mesh upload failed — the scene will be empty");
    }

    const floor = scene.addMesh(floorMesh);
    const pillar = scene.addMesh(pillarMesh);
    const crate = scene.addMesh(crateMesh);
    const sphere = scene.addMesh(sphereMesh);

    // -- materials --
    const concrete = scene.addMaterial(makeMaterial(new fvec3(0.32, 0.31, 0.30), 0.85));
    const paint = scene.addMaterial(makeMaterial(new fvec3(0.55, 0.18, 0.14), 0.55));
    const timber = scene.addMaterial(makeMaterial(new fvec3(0.38, 0.26, 0.15), 0.7));
    const steel = scene.addMaterial(makeMetal(new fvec3(0.56, 0.57, 0.58), 0.35));
    const copper = scene.addMaterial(makeMetal(new fvec3(0.95, 0.64, 0.54), 0.2));

    // -- the floor --
    scene.add(floor, concrete, fmat4.fromTranslation(new fvec3(0.0, -0.2, 0.0)));

    // -- pillars on a grid, so the sun has something to cast with --
    for (let x: i32 = -2; x <= 2; x++) {
        for (let z: i32 = -2; z <= 2; z++) {
            if (x === 0 && z === 0) {
                continue;
            }
            const position = new fvec3(cast<f32>(x) * 8.0, 3.0, cast<f32>(z) * 8.0);
            scene.add(pillar, (x + z) % 2 === 0 ? concrete : paint, fmat4.fromTranslation(position));
        }
    }

    // -- crates, rotated so the sun catches their faces differently --
    for (let i: i32 = 0; i < 24; i++) {
        const angle = cast<f32>(i) * 0.618 * fpi() * 2.0;
        const radius = 4.0 + cast<f32>(i % 6) * 2.6;
        const position = new fvec3(fcos(angle) * radius, 0.8, fsin(angle) * radius);

        const transform = fmat4.fromTranslation(position).mul(fmat4.fromRotationY(angle));
        scene.add(crate, i % 3 === 0 ? timber : paint, transform);
    }

    // -- spheres, sweeping roughness across the metals --
    for (let i: i32 = 0; i < 8; i++) {
        const t = cast<f32>(i) / 7.0;
        const material = scene.addMaterial(
            i % 2 === 0
                ? makeMetal(new fvec3(0.56, 0.57, 0.58), 0.05 + t * 0.7)
                : makeMaterial(new fvec3(0.2, 0.35, 0.5), 0.05 + t * 0.7),
        );
        const position = new fvec3(-10.5 + cast<f32>(i) * 3.0, 1.0, -12.0);
        scene.add(sphere, material, fmat4.fromTranslation(position));
    }

    scene.add(sphere, copper, fmat4.fromTranslation(new fvec3(0.0, 1.4, 0.0)));
    scene.add(sphere, steel, fmat4.fromTranslation(new fvec3(3.0, 1.4, 2.0)));

    // -- lights --
    populateLights(scene, 0.0);

    console.log(
        `scene: ${scene.instances.length} instances, ${scene.meshes.length} meshes, ${scene.lights.length} lights`,
    );
    return scene;
}

/**
 * Rebuild the light field for time `t`.
 *
 * Rebuilt rather than nudged, because the whole array is re-uploaded every frame
 * anyway and a closed-form position is one line where an integrator is a state
 * to keep. Moving lights are the point: a static field lets every cluster settle
 * into one assignment, and a culling bug that only shows on change would never
 * appear.
 */
export function populateLights(scene: Reference<Scene>, t: f32): void {
    while (scene.lights.length > 0) {
        scene.lights.pop();
    }

    const count = pointLightCount();
    // The golden angle, in radians. Annotated because a literal takes its width
    // from context and there is none here.
    const golden: f32 = 2.399963;

    for (let i: u32 = 0; i < count; i++) {
        const index = cast<f32>(i);
        const angle = index * golden + t * 0.25;
        const radius = 2.0 + (index / cast<f32>(count)) * 20.0;

        const position = new fvec3(
            fcos(angle) * radius,
            0.7 + fsin(t * 0.9 + index * 0.37) * 0.6 + (index / cast<f32>(count)) * 2.5,
            fsin(angle) * radius,
        );

        // Hue swept around the circle, kept bright enough to read against the
        // sun without washing out.
        const hue = index * 0.17 + t * 0.1;
        const color = new fvec3(
            0.5 + 0.5 * fsin(hue),
            0.5 + 0.5 * fsin(hue + 2.094),
            0.5 + 0.5 * fsin(hue + 4.188),
        ).scale(6.0);

        // Short range on purpose. A long-range light lands in most clusters and
        // the grid stops being a cull — 3.5 units keeps each one local.
        scene.addLight(makePointLight(position, color, 3.5));
    }

    // Four shadow-casting spotlights, which is exactly the concurrent cap.
    for (let i: u32 = 0; i < 4; i++) {
        const angle = cast<f32>(i) * fpi() * 0.5 + t * 0.15;
        const position = new fvec3(fcos(angle) * 13.0, 7.5, fsin(angle) * 13.0);
        const direction = new fvec3(-fcos(angle) * 0.55, -1.0, -fsin(angle) * 0.55);

        // Radiance in the hundreds, which looks absurd next to the sun's 3.2 and
        // is not. Falloff is inverse-square, so a lamp 8 metres up divides by 64
        // before anything reaches the floor; a spotlight tuned to the same
        // *number* as the sun arrives at about six per cent of its brightness.
        // Punctual intensities are not comparable to directional ones and this is
        // where that stops being an abstract point.
        const spot = makeSpotLight(
            position,
            direction,
            new fvec3(420.0, 380.0, 280.0),
            22.0,
            0.30,
            0.46,
        );
        spot.castsShadow = true;
        scene.addLight(spot);
    }
}
