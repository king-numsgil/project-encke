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
//   * **Fifty scattered helmets**, loaded from one glTF file. They are the only
//     geometry here that nobody in this repository authored, which is the point:
//     real content has UV seams, a normal map that disagrees with the geometry
//     at the silhouette, and fifteen thousand triangles where a crate has twelve.
//
// Everything placed here is **deterministic**, the scattering included. A
// benchmark whose scene differs between runs is a benchmark that cannot be
// compared with itself, so the helmets come from a seeded generator rather than
// from anything the platform provides.

import { fmat4, fvec3 } from "std/linalg";
import { fcos, fpi, fsin, fsqrt, ftau } from "std/math";
import type { SDL_GPUDevice } from "../bindings/SDL3";
import { loadGltf } from "../renderer/assets/gltf.ts";
import { Fallbacks, MaterialTextures } from "../renderer/assets/material_set.ts";
import { makeBox } from "../renderer/geometry/box.ts";
import { GpuMesh } from "../renderer/geometry/mesh.ts";
import { warnIfPaperThin } from "../renderer/geometry/meshdata.ts";
import { makeSphere } from "../renderer/geometry/sphere.ts";
import { makePointLight, makeSpotLight } from "../renderer/scene/light.ts";
import { makeMaterial, makeMetal, Material } from "../renderer/scene/material.ts";
import { Scene } from "../renderer/scene/scene.ts";

/** Minimum thickness a mesh must have on every axis, in world units. */
function minimumThickness(): f32 {
    return 0.05;
}

/** The glTF model the scene scatters, and how many of it. */
function helmetPath(): string {
    return "assets/models/DamagedHelmet.glb";
}

function helmetCount(): u32 {
    return 50;
}

/**
 * xorshift32, and the only source of randomness in this file.
 *
 * Seeded with a constant, so the scene is the same in every run on every
 * machine — see the note at the top. `next` returns `[0, 1)` from the top 24
 * bits, which is every bit an `f32` mantissa can hold; taking the low bits
 * instead is the classic way to get a generator whose last digit is periodic.
 */
class Rng {
    private state: u32;

    constructor() {
        // Any non-zero seed will do; xorshift is stuck at zero forever.
        this.state = 0x9e3779b9;
    }

    next(): f32 {
        let x = this.state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        this.state = x;
        return cast<f32>(x >> 8) / 16777216.0;
    }

    range(low: f32, high: f32): f32 {
        return low + (high - low) * this.next();
    }
}

/**
 * A prop's footprint on the floor, for keeping the scattered helmets out of it.
 *
 * A circle in `xz` rather than the instance's own bounding sphere, and that is
 * the whole reason this exists: a pillar is 1.2 wide and 6 tall, so the sphere
 * around it has a radius of 3.1, and rejecting against *that* would clear a
 * five-metre disc around every pillar and leave nowhere on the floor to stand.
 * Height is irrelevant to whether two things on a floor collide.
 */
class Footprint {
    x: f32;
    z: f32;
    radius: f32;

    constructor() {
        this.x = 0.0;
        this.z = 0.0;
        this.radius = 0.0;
    }
}

function footprint(x: f32, z: f32, radius: f32): Footprint {
    const mark = new Footprint();
    mark.x = x;
    mark.z = z;
    mark.radius = radius;
    return mark;
}

/** Whether a disc at `(x, z)` touches anything already claimed. */
function collides(claimed: Reference<Footprint[]>, x: f32, z: f32, radius: f32): boolean {
    for (let i: usize = 0; i < claimed.length; i++) {
        const dx = claimed[i].x - x;
        const dz = claimed[i].z - z;
        const reach = claimed[i].radius + radius;
        if (dx * dx + dz * dz < reach * reach) {
            return true;
        }
    }
    return false;
}

/** Load one folder of maps and register it as a material. */
function addTextured(
    scene: Reference<Scene>,
    device: Pointer<SDL_GPUDevice>,
    fallbacks: Reference<Fallbacks>,
    folder: string,
    material: Material,
): usize {
    const maps = new MaterialTextures();
    maps.load(device, folder, fallbacks, folder);
    return scene.addTexturedMaterial(material, maps);
}

export function buildTestScene(
    device: Pointer<SDL_GPUDevice>,
    fallbacks: Reference<Fallbacks>,
    pointLights: u32,
): Scene {
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

    // -- untextured materials --
    //
    // These take the shared 1x1 fallbacks, so they shade exactly as they did
    // before any of this existed. That is the whole point of the fallback
    // scheme: textured and untextured take one code path.
    const concrete = scene.addMaterial(makeMaterial(new fvec3(0.32, 0.31, 0.30), 0.85), fallbacks);
    const paint = scene.addMaterial(makeMaterial(new fvec3(0.55, 0.18, 0.14), 0.55), fallbacks);
    const steel = scene.addMaterial(makeMetal(new fvec3(0.56, 0.57, 0.58), 0.35), fallbacks);
    const copper = scene.addMaterial(makeMetal(new fvec3(0.95, 0.64, 0.54), 0.2), fallbacks);

    // -- textured materials, from assets/materials --
    //
    // The numeric parameters are multipliers on top of the maps, so albedo is
    // white and roughness is 1: the map alone decides. Metalness stays a
    // parameter because these sets carry no metalness map worth reading — the
    // plates are metal everywhere and the brick and planks are metal nowhere.
    const bricks = addTextured(
        scene,
        device,
        fallbacks,
        "assets/materials/bricks",
        makeMaterial(fvec3.one(), 1.0),
    );
    const planks = addTextured(
        scene,
        device,
        fallbacks,
        "assets/materials/planks",
        makeMaterial(fvec3.one(), 1.0),
    );
    const plates = addTextured(
        scene,
        device,
        fallbacks,
        "assets/materials/metal",
        makeMetal(fvec3.one(), 1.0),
    );

    // Every prop's footprint on the floor, filled in as it is placed and read
    // by the helmet scatter at the end. Collected here rather than recomputed
    // there so that moving a pillar cannot leave a helmet standing inside it.
    const claimed: Footprint[] = [];

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
            // Half the diagonal of a 1.2 square, so a rotated helmet clears the
            // corners and not just the faces.
            claimed.push(footprint(position.x, position.z, 0.85));
        }
    }

    // -- crates, rotated so the sun catches their faces differently --
    for (let i: i32 = 0; i < 24; i++) {
        const angle = cast<f32>(i) * 0.618 * fpi() * 2.0;
        const radius = 4.0 + cast<f32>(i % 6) * 2.6;
        const position = new fvec3(fcos(angle) * radius, 0.8, fsin(angle) * radius);

        const transform = fmat4.fromTranslation(position).mul(fmat4.fromRotationY(angle));

        // The crates are what the maps are here to show, cycling through all
        // three so a single screenshot has a dielectric with strong relief, a
        // dielectric with fine grain, and a metal.
        const material = i % 3 === 0 ? bricks : (i % 3 === 1 ? planks : plates);
        scene.add(crate, material, transform);
        claimed.push(footprint(position.x, position.z, 1.14));
    }

    // -- spheres, sweeping roughness across the metals --
    for (let i: i32 = 0; i < 8; i++) {
        const t = cast<f32>(i) / 7.0;
        const material = scene.addMaterial(
            i % 2 === 0
                ? makeMetal(new fvec3(0.56, 0.57, 0.58), 0.05 + t * 0.7)
                : makeMaterial(new fvec3(0.2, 0.35, 0.5), 0.05 + t * 0.7),
            fallbacks,
        );
        const position = new fvec3(-10.5 + cast<f32>(i) * 3.0, 1.0, -12.0);
        scene.add(sphere, material, fmat4.fromTranslation(position));
        claimed.push(footprint(position.x, position.z, 0.9));
    }

    scene.add(sphere, copper, fmat4.fromTranslation(new fvec3(0.0, 1.4, 0.0)));
    scene.add(sphere, steel, fmat4.fromTranslation(new fvec3(3.0, 1.4, 2.0)));
    claimed.push(footprint(0.0, 0.0, 0.9));
    claimed.push(footprint(3.0, 2.0, 0.9));

    // -- helmets, scattered --
    scatterHelmets(device, scene, fallbacks, claimed);

    // -- lights --
    populateLights(scene, 0.0, pointLights);

    console.log(
        `scene: ${scene.instances.length} instances, ${scene.meshes.length} meshes, ${scene.lights.length} lights`,
    );
    return scene;
}

/**
 * Drop {@link helmetCount} helmets on the floor, clear of everything else.
 *
 * **One load, many placements.** The file is read, uploaded and decoded exactly
 * once and every helmet is another `Instance` over the same mesh, material and
 * five textures — which is the split `Scene` is built around and the reason
 * fifty of a fifteen-thousand-triangle model is a reasonable thing to put in a
 * test scene at all.
 *
 * Positions come from rejection sampling against {@link claimed}: a candidate is
 * thrown away if its footprint touches a prop or a helmet already placed. That
 * can fail to find room, so the attempt count is bounded and a short scene is
 * reported rather than a hang — the failure mode of an unbounded rejection loop
 * is a program that never starts.
 *
 * Radial positions are `sqrt`-distributed. Sampling the radius uniformly would
 * pack the helmets into the middle, because a disc has more area further out.
 */
function scatterHelmets(
    device: Pointer<SDL_GPUDevice>,
    scene: Reference<Scene>,
    fallbacks: Reference<Fallbacks>,
    claimed: Reference<Footprint[]>,
): void {
    // Inside the 48-unit floor with room for a helmet at the rim.
    const reach: f32 = 22.0;
    const wanted = helmetCount();

    const rng = new Rng();
    const placements: fmat4[] = [];

    let attempts: u32 = 0;
    while (cast<u32>(placements.length) < wanted && attempts < 20000) {
        attempts += 1;

        const scale = rng.range(0.7, 1.05);
        // The model is roughly two units across, so this is its own footprint.
        const radius = scale * 1.0;

        const distance = fsqrt(rng.next()) * reach;
        const bearing = rng.next() * ftau();
        const x = fcos(bearing) * distance;
        const z = fsin(bearing) * distance;

        if (collides(claimed, x, z, radius)) {
            continue;
        }
        claimed.push(footprint(x, z, radius));

        // A full turn of yaw, and a tilt of up to about twenty degrees about a
        // random horizontal axis — enough that no two read as the same object
        // and that the normal map is exercised against the sun from every angle,
        // without any of them looking like they are floating.
        const yaw = rng.next() * ftau();
        const tiltAxis = rng.next() * ftau();
        const tilt = rng.range(0.0, 0.35);

        const transform = fmat4.fromTranslation(new fvec3(x, 0.95 * scale, z))
            .mul(fmat4.fromRotationY(yaw))
            .mul(fmat4.fromAxisAngle(new fvec3(fcos(tiltAxis), 0.0, fsin(tiltAxis)), tilt))
            .mul(fmat4.fromScale(fvec3.splat(scale)));

        placements.push(transform);
    }

    if (cast<u32>(placements.length) < wanted) {
        console.log(
            `scene: only found room for ${placements.length} of ${wanted} helmets in ${attempts} attempts`,
        );
    }

    loadGltf(device, scene, fallbacks, helmetPath(), placements);
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
export function populateLights(scene: Reference<Scene>, t: f32, count: u32): void {
    while (scene.lights.length > 0) {
        scene.lights.pop();
    }

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
