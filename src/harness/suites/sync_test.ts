// The ECS-to-renderer boundary: transform propagation, and the sorted draw list.
//
// Headless, so there is no device and no uploaded geometry. `Scene` does not
// need one: `addMesh` takes a `GpuMesh` whatever state it is in, and the only
// thing `Scene.add` reads back is the bounding sphere, which is a plain field.
// So the meshes here are bare `GpuMesh` values with bounds written by hand, and
// every number below is arithmetic rather than pixels.
//
// Three things get the attention:
//
//   * **Composition order.** A child's world transform is `parent * local`, in
//     that order. Reversed, it is still a valid matrix and still puts the object
//     somewhere plausible, which is why this is checked against hand-computed
//     positions rather than against the code's own idea of the answer.
//   * **Order independence.** Entities are visited in table order, so a child is
//     routinely resolved before its parent. Every case below is built in the
//     awkward order on purpose — child first, parent second — because building
//     parents first hides the bug this is looking for.
//   * **Sort stability and grouping.** The point of sorting is that the forward
//     pass can skip a rebind, which only works if every instance sharing a
//     material is contiguous. A sort that merely puts them in *roughly* the
//     right place still renders correctly and buys nothing.

import { fmat4, fvec3 } from "std/linalg";
import { World } from "../../ecs/world.ts";
import { Fallbacks } from "../../renderer/assets/material_set.ts";
import { GpuMesh } from "../../renderer/geometry/mesh.ts";
import { Material } from "../../renderer/scene/material.ts";
import { Scene } from "../../renderer/scene/scene.ts";
import { type LocalTransform, SceneSync } from "../../renderer/scene/sync.ts";
import type { Tester } from "../testing.ts";

/** A mesh with a unit bounding sphere at its origin, and no geometry. */
function unitMesh(): GpuMesh {
    const mesh = new GpuMesh();
    mesh.boundsCenter = fvec3.zero();
    mesh.boundsRadius = 1.0;
    return mesh;
}

/** The translation column of a matrix, which is where an object ended up. */
function positionOf(m: fmat4): fvec3 {
    return new fvec3(m.c3.x, m.c3.y, m.c3.z);
}

function checkPosition(t: Reference<Tester>, name: string, got: fvec3, x: f32, y: f32, z: f32): void {
    t.nearly(`${name} x`, got.x, x, 0.0001);
    t.nearly(`${name} y`, got.y, y, 0.0001);
    t.nearly(`${name} z`, got.z, z, 0.0001);
}

/** A scene with `meshes` meshes and `materials` materials, all placeholders. */
function stubScene(meshes: usize, materials: usize): Scene {
    const scene = new Scene();
    for (let i: usize = 0; i < meshes; i++) {
        scene.addMesh(unitMesh());
    }
    // `addMaterial` wants fallbacks to point the map slots at. Nothing here
    // samples a texture, so the default `Fallbacks` — every slot null — is
    // exactly as useful as a real one and needs no device to build.
    const fallbacks = new Fallbacks();
    for (let i: usize = 0; i < materials; i++) {
        scene.addMaterial(new Material(), fallbacks);
    }
    return scene;
}

export function testSceneSync(t: Reference<Tester>): void {
    // -- one entity, no parent --------------------------------------------------

    const world = new World();
    const sync = new SceneSync(world);
    const scene = stubScene(3, 3);

    const lone = sync.spawn(world, 0, 0, fmat4.fromTranslation(new fvec3(5.0, 0.0, 0.0)));
    sync.run(world, scene);

    t.equalUsize("one entity is one instance", scene.instances.length, 1);
    checkPosition(t, "an unparented entity is where its local transform says", positionOf(sync.worldMatrix(world, lone)), 5.0, 0.0, 0.0);
    checkPosition(t, "and the instance carries that transform", positionOf(scene.instances[0].transform), 5.0, 0.0, 0.0);

    // The bounds are `Scene.add`'s arithmetic, unchanged: a unit sphere at the
    // mesh origin, carried into world space by the transform.
    checkPosition(t, "bounds follow the transform", scene.instances[0].boundsCenter, 5.0, 0.0, 0.0);
    t.nearly("and keep the mesh radius", scene.instances[0].boundsRadius, 1.0, 0.0001);

    // -- a child, built before its parent ----------------------------------------
    //
    // The child is spawned first, so the table holding it comes first and the
    // propagation reaches it before the parent exists in any ordering sense. A
    // resolver that only walked downwards from roots would leave this at its
    // local transform and the check below would catch it.

    const child = sync.spawn(world, 1, 1, fmat4.fromTranslation(new fvec3(1.0, 0.0, 0.0)));
    const parent = sync.spawnPivot(world, fmat4.fromTranslation(new fvec3(10.0, 0.0, 0.0)));
    t.ok("attaching succeeds", sync.attach(world, child, parent));

    sync.run(world, scene);
    checkPosition(t, "a child is offset by its parent", positionOf(sync.worldMatrix(world, child)), 11.0, 0.0, 0.0);
    checkPosition(t, "the parent is unmoved", positionOf(sync.worldMatrix(world, parent)), 10.0, 0.0, 0.0);

    // A pivot draws nothing, so the instance count counts only the drawables.
    t.equalUsize("a pivot adds no instance", scene.instances.length, 2);

    // -- the parent moves, the child follows ---------------------------------------

    const slot = world.get<LocalTransform>(parent, sync.localTransform);
    t.ok("a pivot's transform is reachable", slot !== null);
    if (slot !== null) {
        slot[0].matrix = fmat4.fromTranslation(new fvec3(-4.0, 2.0, 0.0));
    }
    sync.run(world, scene);
    checkPosition(t, "moving a parent moves its child", positionOf(sync.worldMatrix(world, child)), -3.0, 2.0, 0.0);

    // -- rotation composes, and in the right order ----------------------------------
    //
    // The parent turns a quarter turn about Y and sits at the origin; the child
    // is one unit along +X of it. Under `parent * local` the child swings to
    // `-Z`. Under `local * parent` it would stay on `+X`, which is a perfectly
    // reasonable-looking wrong answer.

    const turner = sync.spawnPivot(world, fmat4.fromRotationY(1.5707963));
    const arm = sync.spawn(world, 2, 2, fmat4.fromTranslation(new fvec3(1.0, 0.0, 0.0)));
    sync.attach(world, arm, turner);

    sync.run(world, scene);
    checkPosition(t, "a quarter turn about Y swings +X to -Z", positionOf(sync.worldMatrix(world, arm)), 0.0, 0.0, -1.0);

    // -- three deep --------------------------------------------------------------
    //
    // Spawned leaf-first, so nothing about the build order helps.

    const leaf = sync.spawn(world, 0, 0, fmat4.fromTranslation(new fvec3(0.0, 0.0, 1.0)));
    const middle = sync.spawnPivot(world, fmat4.fromTranslation(new fvec3(0.0, 1.0, 0.0)));
    const root = sync.spawnPivot(world, fmat4.fromTranslation(new fvec3(100.0, 0.0, 0.0)));
    sync.attach(world, leaf, middle);
    sync.attach(world, middle, root);

    sync.run(world, scene);
    checkPosition(t, "a chain of three accumulates", positionOf(sync.worldMatrix(world, leaf)), 100.0, 1.0, 1.0);

    // -- detaching gives the local transform back ------------------------------------

    sync.detach(world, leaf);
    sync.run(world, scene);
    checkPosition(t, "detaching restores the local transform", positionOf(sync.worldMatrix(world, leaf)), 0.0, 0.0, 1.0);

    // -- reparenting -----------------------------------------------------------------

    sync.attach(world, leaf, turner);
    sync.run(world, scene);
    checkPosition(t, "reparenting composes against the new parent", positionOf(sync.worldMatrix(world, leaf)), 1.0, 0.0, 0.0);

    // -- a destroyed parent takes its children --------------------------------------
    //
    // `SceneSync` registers `ChildOf` with a delete policy, so this is a cascade
    // rather than an orphan left at its last position.

    const before = scene.instances.length;
    world.destroy(turner);
    t.ok("the parent is gone", !world.isAlive(turner));
    t.ok("and so is the child", !world.isAlive(arm));
    t.ok("and the grandchild reparented onto it", !world.isAlive(leaf));

    // `turner` is a pivot and drew nothing; `arm` and `leaf` were drawables.
    sync.run(world, scene);
    t.equalUsize("the draw list loses both drawables", scene.instances.length, before - 2);

    // No `scene.release`: nothing here reached a GPU, so there is nothing to
    // give back. The arrays are owning values and go with the scope.
    world.release();
}

/**
 * Sorting, on its own world.
 *
 * Separate from the propagation checks above so the expected order is something
 * that can be written down rather than derived from everything that came before.
 */
export function testSceneSort(t: Reference<Tester>): void {
    const world = new World();
    const sync = new SceneSync(world);
    const scene = stubScene(3, 4);

    // Deliberately interleaved, so insertion order is nothing like sorted order.
    const wanted: usize = 12;
    for (let i: usize = 0; i < wanted; i++) {
        const material = (i * 7) % 4;
        const mesh = (i * 5) % 3;
        sync.spawn(world, mesh, material, fmat4.fromTranslation(new fvec3(cast<f32>(i), 0.0, 0.0)));
    }

    sync.run(world, scene);
    t.equalUsize("every drawable is in the list", scene.instances.length, wanted);

    // Materials ascending, and meshes ascending inside each material. Checked as
    // a pair walk rather than against a written-out expected list, because the
    // property is what matters and a list would have to be recomputed by hand
    // every time the interleaving above changed.
    let materialFalls: usize = 0;
    let meshFalls: usize = 0;
    for (let i: usize = 1; i < scene.instances.length; i++) {
        const previous = scene.instances[i - 1];
        const here = scene.instances[i];
        if (here.material < previous.material) {
            materialFalls += 1;
        }
        if (here.material === previous.material && here.mesh < previous.mesh) {
            meshFalls += 1;
        }
    }
    t.equalUsize("materials come out ascending", materialFalls, 0);
    t.equalUsize("and meshes ascend within a material", meshFalls, 0);

    // The property the forward pass actually depends on: one contiguous run per
    // material. Counting the changes is what catches a sort that groups *most*
    // of them — four materials must mean exactly four runs.
    let runs: usize = 1;
    for (let i: usize = 1; i < scene.instances.length; i++) {
        if (scene.instances[i].material !== scene.instances[i - 1].material) {
            runs += 1;
        }
    }
    t.equalUsize("each material is one contiguous run", runs, 4);

    // -- rebuilt, not appended -------------------------------------------------------

    sync.run(world, scene);
    t.equalUsize("running twice does not duplicate anything", scene.instances.length, wanted);

    // -- an empty world ----------------------------------------------------------------

    const empty = new World();
    const emptySync = new SceneSync(empty);
    emptySync.run(empty, scene);
    t.equalUsize("a world with nothing in it empties the list", scene.instances.length, 0);
    empty.release();

    world.release();
}

/**
 * A parent cycle, which nothing forbids.
 *
 * `world.relate` will happily make two entities each other's parent, and the
 * upward walk in `SceneSync.resolve` would then never reach a root. The depth
 * cap is what makes this terminate. There is no correct answer to check — a
 * cycle has no world transform — so what is checked is that the call returns at
 * all and leaves the numbers finite.
 */
export function testSceneCycle(t: Reference<Tester>): void {
    const world = new World();
    const sync = new SceneSync(world);
    const scene = stubScene(1, 1);

    const a = sync.spawn(world, 0, 0, fmat4.fromTranslation(new fvec3(1.0, 0.0, 0.0)));
    const b = sync.spawn(world, 0, 0, fmat4.fromTranslation(new fvec3(0.0, 1.0, 0.0)));
    sync.attach(world, a, b);
    sync.attach(world, b, a);

    // The check is that this returns.
    sync.run(world, scene);
    t.equalUsize("a cycle still produces both instances", scene.instances.length, 2);

    const position = positionOf(sync.worldMatrix(world, a));
    t.ok("and a finite position", position.x === position.x && position.y === position.y);

    // An entity parented to itself is the same problem one step shorter.
    const self = sync.spawn(world, 0, 0, fmat4.identity());
    sync.attach(world, self, self);
    sync.run(world, scene);
    t.equalUsize("self-parenting terminates too", scene.instances.length, 3);

    world.release();
}
