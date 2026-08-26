// What there is to draw.
//
// Flat parallel arrays with indices between them rather than a tree of objects,
// because every consumer wants a different traversal: the depth pre-pass and the
// shadow passes walk instances and want only the transform and the mesh, while
// the forward pass wants the material too. A scene graph would be a layer to
// walk through in all four.
//
// There is no visibility culling here. Phase 1 draws everything, every pass —
// frustum culling is worth having and is not what this phase is about, and
// pretending otherwise by half-implementing it would make the benchmark numbers
// lie about which work is actually being measured.

import { fmat4, fvec3 } from "std/linalg";
import type { SDL_GPUDevice } from "../../bindings/SDL3";
import { Fallbacks, MaterialTextures } from "../assets/material_set.ts";
import { GpuMesh } from "../geometry/mesh.ts";
import { Light } from "./light.ts";
import { Material } from "./material.ts";

/** One drawable: a mesh, a material, and where it is. */
export class Instance {
    mesh: usize;
    material: usize;
    transform: fmat4;

    constructor() {
        this.mesh = 0;
        this.material = 0;
        this.transform = fmat4.identity();
    }
}

export class Scene {
    meshes: GpuMesh[];
    materials: Material[];

    /**
     * The maps for each material, parallel to {@link materials}.
     *
     * A separate array rather than a field on `Material`, for the same reason
     * everything else here is parallel: `Material` is scene data that the shadow
     * and depth passes never look at, while these are GPU handles the forward
     * pass rebinds per draw. `addMaterial` keeps the two in step, so an index
     * into one is always valid in the other.
     */
    textures: MaterialTextures[];
    instances: Instance[];
    lights: Light[];

    /** Unit vector pointing *towards* the sun — the direction light arrives from. */
    sunDirection: fvec3;

    /** Sun radiance, intensity folded in. */
    sunColor: fvec3;

    /**
     * Flat ambient term.
     *
     * A single constant standing in for every bounce this renderer does not
     * compute. It is the largest single cheat in the lighting model and it is
     * deliberate: the alternative is an irradiance probe grid, which is a phase
     * of its own.
     */
    ambient: f32;

    /** Fields are storage, and storage is zeroed rather than constructed. */
    constructor() {
        this.meshes = [];
        this.materials = [];
        this.textures = [];
        this.instances = [];
        this.lights = [];
        this.sunDirection = new fvec3(0.0, 1.0, 0.0);
        this.sunColor = new fvec3(1.0, 1.0, 1.0);
        this.ambient = 0.03;
    }

    /** Register a mesh and hand back the index instances refer to it by. */
    addMesh(mesh: GpuMesh): usize {
        this.meshes.push(mesh);
        return this.meshes.length - 1;
    }

    /**
     * Register an untextured material.
     *
     * Its map slots point at the shared fallbacks, so it shades exactly as it
     * would have before textures existed and the forward pass needs no branch
     * to tell the two kinds apart.
     */
    addMaterial(material: Material, fallbacks: Reference<Fallbacks>): usize {
        const maps = new MaterialTextures();
        maps.useFallbacks(fallbacks);

        this.materials.push(material);
        this.textures.push(maps);
        return this.materials.length - 1;
    }

    /** Register a material with its own maps, already loaded. */
    addTexturedMaterial(material: Material, maps: MaterialTextures): usize {
        this.materials.push(material);
        this.textures.push(maps);
        return this.materials.length - 1;
    }

    add(mesh: usize, material: usize, transform: fmat4): void {
        const instance = new Instance();
        instance.mesh = mesh;
        instance.material = material;
        instance.transform = transform;
        this.instances.push(instance);
    }

    addLight(light: Light): void {
        this.lights.push(light);
    }

    release(device: Pointer<SDL_GPUDevice>): void {
        for (let i: usize = 0; i < this.meshes.length; i++) {
            this.meshes[i].release(device);
        }
        // Each set releases only what it loaded; the shared fallbacks are the
        // renderer's and outlive the scene.
        for (let i: usize = 0; i < this.textures.length; i++) {
            this.textures[i].release(device);
        }
    }
}
