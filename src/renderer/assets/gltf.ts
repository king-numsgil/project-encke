// A glTF file, turned into meshes, materials and instances.
//
// The parsing is `tools/gltf`'s — a Rust cdylib around the `gltf` crate, which
// hands back triangle meshes already in this renderer's vertex layout, one
// world transform per instance, and every image still encoded. So there is no
// glTF here at all: no accessors, no node tree, no tangent generation. What
// this file does is the three things that must happen on this side because they
// touch this program's objects — decode the images through SDL3_image, register
// the materials, and upload the meshes.
//
// **The loader's scene must outlive every read of it**, which is why the whole
// job happens between `encke_gltf_load` and `encke_gltf_free` in one function.
// Every pointer in it — vertices, indices, image bytes, names — dies at that
// second call.
//
// What is not supported, and is silently ignored rather than refused:
//
//   * **Alpha blending and masking.** Every surface is opaque. The forward pass
//     runs depth-equal against a pre-pass, which is a scheme transparency does
//     not fit into.
//   * **Skins, morph targets and animation.** There is nothing here that moves.
//   * **A second UV set.** `TEXCOORD_1` is never read; every map samples
//     `TEXCOORD_0`.

import { mi_free, mi_malloc_aligned, mi_realloc_aligned } from "std/alloc";
import { fmat4, fvec3, fvec4 } from "std/linalg";
import {
    encke_gltf_abi_version,
    encke_gltf_free,
    encke_gltf_last_error,
    encke_gltf_load,
    encke_gltf_set_allocator,
} from "../../bindings/encke_gltf";
import type { EnckeGltfScene } from "../../bindings/encke_gltf";
import type { SDL_GPUDevice, SDL_GPUTexture } from "../../bindings/SDL3";
import { GpuMesh } from "../geometry/mesh.ts";
import { MeshData, vertexFloats } from "../geometry/meshdata.ts";
import { Material } from "../scene/material.ts";
import type { Scene } from "../scene/scene.ts";
import { Fallbacks, MaterialTextures } from "./material_set.ts";
import { loadTextureFromMemory } from "./texture.ts";

/**
 * The ABI `src/bindings/encke_gltf/types.ts` was written against.
 *
 * Checked before the first load. A stale `encke_gltf.dll` beside a fresh
 * executable does not fail — it reads the struct fields at the wrong offsets and
 * produces a scene of garbage triangles, which looks like a renderer bug and is
 * not one. One comparison is cheap insurance against an afternoon.
 */
function expectedAbi(): u32 {
    return 1;
}

/**
 * Load a model and add it to `scene` once at every transform in `placements`.
 *
 * Each placement is applied on top of the model's own world transforms, so an
 * asset authored at the origin can be put anywhere without editing it. A list
 * rather than a single matrix because **the file is read once whatever the
 * count is**: the meshes, materials and decoded textures are registered one
 * time and every placement is another entry in `Scene.instances`, which is
 * exactly the split the scene is arranged around. Fifty helmets are fifty
 * transforms and one mesh, not fifty of everything.
 *
 * glTF is Y-up, right-handed, `-Z` forward and counter-clockwise wound, which is
 * exactly what this renderer is — so there is no basis change anywhere in this
 * path, and that is worth knowing because it is the usual place a loaded model
 * goes wrong.
 *
 * Returns false and logs on failure, having added nothing.
 */
export function loadGltf(
    device: Pointer<SDL_GPUDevice>,
    scene: Reference<Scene>,
    fallbacks: Reference<Fallbacks>,
    path: string,
    placements: Reference<fmat4[]>,
): boolean {
    const abi = encke_gltf_abi_version();
    if (abi !== expectedAbi()) {
        console.log(
            `gltf: the loader reports ABI ${abi} and these bindings describe ${expectedAbi()} — ` +
            "bin/encke_gltf.dll is stale, rebuild",
        );
        return false;
    }

    // Idempotent, and cheap enough to do per load rather than keeping a flag:
    // it stores three function pointers. These four are goblin-forge's own
    // mimalloc — the same heap this program allocates from — so a `Vec` built
    // inside the loader is a block this process already owns. See
    // `bindings/encke_gltf/loader.ts` for why that matters.
    encke_gltf_set_allocator(mi_malloc_aligned, mi_realloc_aligned, mi_free);

    const loaded = encke_gltf_load(cstring(path));
    if (loaded === null) {
        console.log(`gltf: cannot load ${path} : ${stringFromCString(encke_gltf_last_error())}`);
        return false;
    }

    const label = shortName(path);
    const textures = decodeImages(device, loaded, label);
    const materials = registerMaterials(scene, fallbacks, loaded, textures, label);
    const meshes = uploadMeshes(device, scene, loaded, label);

    let instances: usize = 0;
    for (let i: usize = 0; i < cast<usize>(loaded.node_count); i++) {
        const node = loaded.nodes[i];
        const mesh = meshes[cast<usize>(node.mesh)];
        // A primitive whose upload failed is registered as `-1` rather than
        // skipped, so that this index stays parallel with the loader's.
        if (mesh < 0) {
            continue;
        }

        // Column-major on both sides, so the sixteen floats go straight in.
        const local = fmat4.fromColumns(
            new fvec4(node.transform[0], node.transform[1], node.transform[2], node.transform[3]),
            new fvec4(node.transform[4], node.transform[5], node.transform[6], node.transform[7]),
            new fvec4(node.transform[8], node.transform[9], node.transform[10], node.transform[11]),
            new fvec4(node.transform[12], node.transform[13], node.transform[14], node.transform[15]),
        );

        const which = loaded.meshes[cast<usize>(node.mesh)].material;
        for (let p: usize = 0; p < placements.length; p++) {
            scene.add(cast<usize>(mesh), materials[cast<usize>(which)], placements[p].mul(local));
            instances += 1;
        }
    }

    // Read out before the free, not after. Every one of these is a load through
    // the pointer being released on the next line, and a summary line is a
    // ridiculous thing to have a use-after-free in.
    const summary =
        `gltf: ${label} — ${instances} instances, ${loaded.mesh_count} meshes, ` +
        `${loaded.material_count} materials, ${loaded.image_count} images`;

    // Every pointer read above dies here, which is why nothing has been kept.
    // The vertex streams are in GPU buffers, the images are in GPU textures, and
    // the names have been copied into Goblin strings.
    encke_gltf_free(loaded);

    console.log(summary);
    return true;
}

/** The file's stem, for GPU object labels. */
function shortName(path: string): string {
    let start: usize = 0;
    for (let i: usize = 0; i < path.length; i++) {
        const byte = path.codePointAt(i);
        if (byte === 47 || byte === 92) {
            start = i + 1;
        }
    }
    return path.substring(start);
}

/**
 * Every image in the file, decoded once.
 *
 * Once, and not once per citation: an ORM map is routinely both the
 * metallic-roughness and the occlusion texture of the same material, and a
 * base-colour map is often shared between several. Decoding per texture
 * reference would put two or three copies of one 2K image on the GPU.
 *
 * A slot is null when the decode failed, and the material that wanted it keeps
 * its fallback — a model with one corrupt texture still renders.
 */
function decodeImages(
    device: Pointer<SDL_GPUDevice>,
    loaded: Pointer<EnckeGltfScene>,
    label: string,
): (Pointer<SDL_GPUTexture> | null)[] {
    const textures: (Pointer<SDL_GPUTexture> | null)[] = [];

    for (let i: usize = 0; i < cast<usize>(loaded.image_count); i++) {
        const image = loaded.images[i];
        // sRGB is a property of *use*, not of the file, and the loader worked it
        // out from which slots referenced this image — a base colour or emissive
        // map is light, everything else is data. Getting it backwards is the
        // classic way to end up with a roughness map that reads as a mirror.
        textures.push(
            loadTextureFromMemory(
                device,
                image.bytes,
                image.length,
                image.srgb !== 0,
                `${label}.image${i}`,
            ),
        );
    }

    return textures;
}

/**
 * Register every material, and hand back where each one landed.
 *
 * The scene may already hold materials — a model is loaded *into* a scene, not
 * as one — so the loader's indices have to be translated rather than assumed.
 */
function registerMaterials(
    scene: Reference<Scene>,
    fallbacks: Reference<Fallbacks>,
    loaded: Pointer<EnckeGltfScene>,
    textures: Reference<(Pointer<SDL_GPUTexture> | null)[]>,
    label: string,
): usize[] {
    const indices: usize[] = [];
    let twoSided: usize = 0;

    for (let i: usize = 0; i < cast<usize>(loaded.material_count); i++) {
        const source = loaded.materials[i];

        const material = new Material();
        // glTF's base colour is linear already, which is why nothing here
        // decodes it — the sRGB is in the *texture*, and the hardware undoes it.
        material.albedo = new fvec3(source.base_color[0], source.base_color[1], source.base_color[2]);
        material.metallic = source.metallic;
        material.roughness = source.roughness;
        material.aoStrength = source.occlusion_strength;
        material.emissive = new fvec3(source.emissive[0], source.emissive[1], source.emissive[2]);

        const maps = new MaterialTextures();
        maps.useFallbacks(fallbacks);
        maps.borrowColor(imageAt(textures, source.base_color_image));
        maps.borrowNormal(imageAt(textures, source.normal_image));
        maps.borrowOrm(imageAt(textures, source.metallic_roughness_image));
        maps.borrowOcclusion(imageAt(textures, source.occlusion_image));
        maps.borrowEmissive(imageAt(textures, source.emissive_image));

        if (source.double_sided !== 0) {
            twoSided += 1;
        }

        indices.push(scene.addTexturedMaterial(material, maps));
    }

    // Counted and reported once. A file can have a hundred materials and a line
    // apiece would bury everything else in the log.
    if (twoSided > 0) {
        console.log(
            `gltf: ${label} has ${twoSided} two-sided materials — this renderer culls ` +
            "back faces and will show those surfaces hollow from behind",
        );
    }

    // The textures are the scene's from here: several materials borrow each of
    // them and none owns it, so the scene is the only thing whose lifetime
    // covers the lot.
    for (let i: usize = 0; i < textures.length; i++) {
        const texture = textures[i];
        if (texture !== null) {
            scene.adoptTexture(texture);
        }
    }

    return indices;
}

/** The decoded image at a loader index, or null for `-1` and for a failed decode. */
function imageAt(
    textures: Reference<(Pointer<SDL_GPUTexture> | null)[]>,
    index: i32,
): Pointer<SDL_GPUTexture> | null {
    if (index < 0 || cast<usize>(index) >= textures.length) {
        return null;
    }
    return textures[cast<usize>(index)];
}

/**
 * Upload every mesh, and hand back where each one landed.
 *
 * `-1` for a mesh that would not upload, so that the caller's node loop can skip
 * it without the indices sliding out of step with the loader's.
 */
function uploadMeshes(
    device: Pointer<SDL_GPUDevice>,
    scene: Reference<Scene>,
    loaded: Pointer<EnckeGltfScene>,
    label: string,
): isize[] {
    const indices: isize[] = [];

    for (let i: usize = 0; i < cast<usize>(loaded.mesh_count); i++) {
        const source = loaded.meshes[i];
        const name = `${label}.${stringFromCString(source.name)}`;

        const data = new MeshData();
        data.appendRaw(
            source.vertices,
            cast<usize>(source.vertex_count) * cast<usize>(vertexFloats()),
            source.indices,
            cast<usize>(source.index_count),
        );

        const mesh = new GpuMesh();
        if (!mesh.upload(device, data, name)) {
            indices.push(-1);
            continue;
        }

        indices.push(cast<isize>(scene.addMesh(mesh)));
    }

    return indices;
}
