// The five entry points of `tools/gltf`.
//
// **The order matters and nothing diagnoses getting it wrong.**
//
//     encke_gltf_set_allocator(mi_malloc_aligned, mi_realloc_aligned, mi_free);
//     const scene = encke_gltf_load(cstring(path));
//     // ... read it, upload it ...
//     encke_gltf_free(scene);
//
// `encke_gltf_set_allocator` comes first because the loader has no heap of its
// own. It is a DLL and this is an executable, so linking it the ordinary way
// would put two allocators in one process — mimalloc, which the Goblin runtime
// links into this program, and whatever `std` picked over there. Two allocators
// are not merely wasteful: the side that frees a block must be the side that
// allocated it, and a pointer does not say which side it came from. Handing the
// loader this program's own three functions makes every `Vec` it builds a
// mimalloc block, so a vertex stream read here is an address in this heap and
// a `CString` could in principle be released by either half.
//
// The three signatures are `std/alloc`'s `mi_malloc_aligned`,
// `mi_realloc_aligned` and `mi_free` **exactly**, which is why the handshake
// needs no adapter: the prelude's own function pointers go straight across.
// A function pointer is checked one level in, so dropping a `| null` from a
// return type here would make the parameter a different type from the function
// being passed and the call would be refused — which is the check working, not
// an obstacle.

import type { EnckeGltfScene } from "./types.ts";

/**
 * The ABI `types.ts` describes.
 *
 * Asserted against the loaded library before anything else is called. It is one
 * comparison at startup against a class of bug — a rebuilt executable beside a
 * stale DLL — whose symptom is otherwise a scene of garbage triangles.
 */
export declare function encke_gltf_abi_version(): u32;

/**
 * Hand the loader this program's allocator. Once, before anything else.
 *
 * Allocating before this has run aborts the process rather than guessing at a
 * heap. That is deliberately loud: the alternative is a library quietly using
 * a second allocator and a cross-heap free some minutes later, in a place with
 * nothing to do with the mistake.
 */
export declare function encke_gltf_set_allocator(
    alloc_fn: (size: usize, align: usize) => Pointer<unknown> | null,
    realloc_fn: (mem: Pointer<unknown> | null, size: usize, align: usize) => Pointer<unknown> | null,
    free_fn: (mem: Pointer<unknown> | null) => void,
): void;

/**
 * Load a `.gltf` or `.glb`. Null on failure, with the reason in
 * {@link encke_gltf_last_error}.
 *
 * Blocking, and it does the whole job: buffers resolved (including data URIs
 * and files beside the document), primitives triangulated and baked into this
 * renderer's vertex layout, missing normals and tangents generated, and the
 * node hierarchy composed into one world transform per instance.
 *
 * Relative URIs inside the document resolve against **the document's own
 * directory**, not the working directory, so a model loaded by absolute path
 * still finds the `.bin` next to it.
 *
 * The result and everything reachable from it belong to the loader and die
 * together at {@link encke_gltf_free} — so every mesh must be uploaded before
 * the scene is released.
 */
export declare function encke_gltf_load(path: CString): Pointer<EnckeGltfScene> | null;

/** Release a scene from {@link encke_gltf_load}. Null is a no-op, as in C. */
export declare function encke_gltf_free(scene: Pointer<EnckeGltfScene> | null): void;

/**
 * Why the last call failed, or `""`. Never null.
 *
 * `SDL_GetError`'s contract, on purpose — it is the one every other failure in
 * this program is already reported through. Valid until the next call into the
 * loader on this thread.
 */
export declare function encke_gltf_last_error(): CString;
