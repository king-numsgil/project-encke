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

import { fmat4, fvec3, fvec4 } from "std/linalg";
import type { SDL_GPUDevice, SDL_GPUTexture } from "../../bindings/SDL3";
import { Fallbacks, MaterialTextures } from "../assets/material_set.ts";
import { GpuMesh } from "../geometry/mesh.ts";
import { releaseTexture } from "../gpu/texture.ts";
import { Light } from "./light.ts";
import { Material } from "./material.ts";

/** One drawable: a mesh, a material, and where it is. */
export class Instance {
    mesh: usize;
    material: usize;
    transform: fmat4;

    /**
     * The mesh's bounding sphere, already in world space.
     *
     * Computed once when the instance is registered, because a transform never
     * changes after that — {@link Scene.add} is the only way one enters. Every
     * pass tests this against its own frustum, and a pass runs up to ten times
     * per frame, so recomputing it from the transform each time would be the
     * same arithmetic done ten times for an answer that cannot have moved.
     */
    boundsCenter: fvec3;
    boundsRadius: f32;

    constructor() {
        this.mesh = 0;
        this.material = 0;
        this.transform = fmat4.identity();
        this.boundsCenter = fvec3.zero();
        this.boundsRadius = 0.0;
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

    /**
     * Textures the scene itself owns, rather than any one material.
     *
     * A folder of maps belongs to the one `MaterialTextures` that loaded it, and
     * that is the ordinary case. A glTF image is not: an ORM map is routinely
     * both the metallic-roughness and the occlusion texture of one material, and
     * a base-colour map is often shared between several — so it is decoded once
     * and *borrowed* by every slot that cites it. Nothing among the borrowers
     * can be the one that frees it, which leaves the scene.
     */
    ownedTextures: Pointer<SDL_GPUTexture>[];

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
        this.ownedTextures = [];
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

    /**
     * Take ownership of a texture several materials borrow.
     *
     * See {@link ownedTextures}. Released with the scene, after every
     * `MaterialTextures` has released what it does own — which is safe in either
     * order, since a borrowed slot is never in both lists.
     */
    adoptTexture(texture: Pointer<SDL_GPUTexture>): void {
        this.ownedTextures.push(texture);
    }

    /**
     * Register a drawable.
     *
     * The mesh must already be registered: its own bounding sphere is read here
     * and carried into world space, and a mesh index that is not in
     * {@link meshes} yet would take the zero-radius sphere of an empty slot,
     * which every frustum test would then reject. That is a silently invisible
     * object rather than an error, so the ordering is worth knowing about.
     */
    add(mesh: usize, material: usize, transform: fmat4): void {
        const instance = new Instance();
        instance.mesh = mesh;
        instance.material = material;
        instance.transform = transform;

        const local = this.meshes[mesh].boundsCenter;
        const world = transform.mulVec(new fvec4(local.x, local.y, local.z, 1.0));
        instance.boundsCenter = new fvec3(world.x, world.y, world.z);

        // The largest the transform stretches any axis. Uniform scale would let
        // a single factor through, but nothing here guarantees uniform scale,
        // and a radius scaled by too little is an object that vanishes when it
        // should not — the one failure mode culling must not have.
        const x = new fvec3(transform.c0.x, transform.c0.y, transform.c0.z).length();
        const y = new fvec3(transform.c1.x, transform.c1.y, transform.c1.z).length();
        const z = new fvec3(transform.c2.x, transform.c2.y, transform.c2.z).length();
        const largest = x > y ? (x > z ? x : z) : (y > z ? y : z);
        instance.boundsRadius = this.meshes[mesh].boundsRadius * largest;

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
        for (let i: usize = 0; i < this.ownedTextures.length; i++) {
            releaseTexture(device, this.ownedTextures[i]);
        }
    }
}
