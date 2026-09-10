// The boundary between the ECS and the renderer.
//
// The ECS is the source of truth: entities own their transforms, their parent
// links and which mesh and material they draw with. The renderer wants none of
// that shape. It wants a flat list it can sort, so that draws sharing a material
// end up adjacent and the forward pass can stop rebinding five textures per
// instance.
//
// So there are two structures and this file copies one into the other, once a
// frame, in two phases:
//
//   1. {@link SceneSync.propagate} turns every entity's local transform into a
//      world transform, composing down each parent chain.
//   2. {@link SceneSync.extract} walks the drawables, sorts them by material and
//      then by mesh, and rebuilds `Scene.instances` from scratch.
//
// **Rebuilt from scratch, every frame.** No dirty flags, no change ticks. The
// walk is over archetype columns, which this ECS does at about 1.7 ns an entity,
// so a scene of a hundred thousand drawables costs a fraction of a millisecond
// against a 16 ms budget. Change tracking is an optimisation that should have to
// beat a measurement first, and it is not free here: the ECS hands out raw
// pointers with no write barrier, so detecting a mutation would mean changing
// how components are accessed at all.
//
// **The copy goes one way.** Nothing the renderer works out — culling results,
// sort order, which instance ended up where — is written back. A cycle between
// the two would put a frame of lag somewhere nobody can see it.
//
// ## Transforms are matrices, not position-and-rotation
//
// {@link LocalTransform} holds an `fmat4`. The obvious alternative is a
// position, a rotation and a scale, which is nicer to author and cheaper to
// store, but it cannot represent everything this renderer already has: glTF
// nodes arrive as arbitrary matrices, and the test scene composes translation,
// rotation about an arbitrary axis, and scale by hand. Decomposing those back to
// a TRS triple is lossy in general.
//
// A TRS component is still the right thing for gameplay to author with. It would
// be a second component that *writes* this one, not a replacement for it.

import { fmat4 } from "std/linalg";
import { deleteId, noneId } from "../../ecs/id.ts";
import { has, Query } from "../../ecs/query.ts";
import { World } from "../../ecs/world.ts";
import { Scene } from "./scene.ts";

/**
 * How far up a parent chain {@link SceneSync.propagate} will walk.
 *
 * Nothing forbids a cycle in the relation store — `world.relate` will happily
 * make two entities each other's parent — and a cycle would otherwise be a walk
 * that does not end. At the cap the chain is cut and the topmost entity is
 * treated as a root, so a cycle produces a wrong transform rather than a hang.
 * Sixty-four is far past any hierarchy a scene has.
 */
function maxDepth(): usize {
    return 64;
}

/** Where an entity is, relative to its parent if it has one. */
export interface LocalTransform {
    matrix: fmat4;
}

/**
 * Where an entity is in the world, derived once a frame by
 * {@link SceneSync.propagate}.
 *
 * `stamp` is the frame this was last computed for. Comparing it against the
 * current frame is what stops a parent shared by twenty children being composed
 * twenty times, and it needs no clearing pass — a stale stamp is simply not the
 * current one. A boolean would have to be reset for every entity every frame.
 */
export interface WorldTransform {
    matrix: fmat4;
    stamp: u32;
}

/** What an entity draws with. Indices into `Scene.meshes` and `Scene.materials`. */
export interface Renderable {
    mesh: u32;
    material: u32;
}

export class SceneSync {
    /** Registered component and relation ids, for callers that build entities. */
    localTransform: u64;
    worldTransform: u64;
    renderable: u64;
    childOf: u64;

    /** The frame counter {@link WorldTransform.stamp} is compared against. */
    private stamp: u32;

    /** Everything with a transform, whether or not it draws. */
    private transformed: Query;

    /** Everything that draws. */
    private drawn: Query;

    /**
     * Scratch, all of it reused across frames.
     *
     * Every one of these is emptied with `pop` rather than reassigned, which
     * keeps the capacity and makes a settled scene allocate nothing per frame.
     */
    private pending: u64[];
    private chain: u64[];
    private meshKey: u32[];
    private materialKey: u32[];
    private matrices: fmat4[];
    private order: u32[];
    private shuffled: u32[];
    private counts: u32[];

    constructor(world: Reference<World>) {
        this.localTransform = world.component<LocalTransform>("LocalTransform");
        this.worldTransform = world.component<WorldTransform>("WorldTransform");
        this.renderable = world.component<Renderable>("Renderable");

        this.childOf = world.relation("ChildOf");
        // A parent takes its children with it. The alternative leaves an orphan
        // sitting at its last world position, which reads as a bug.
        world.setOnDelete(this.childOf, deleteId());

        this.transformed = new Query([has(this.localTransform), has(this.worldTransform)]);
        this.drawn = new Query([has(this.renderable), has(this.worldTransform)]);

        this.stamp = 0;
        this.pending = [];
        this.chain = [];
        this.meshKey = [];
        this.materialKey = [];
        this.matrices = [];
        this.order = [];
        this.shuffled = [];
        this.counts = [];
    }

    // -- building entities ----------------------------------------------------

    /**
     * A drawable at `matrix`, with no parent.
     *
     * The mesh and material must already be registered with the scene — their
     * indices are what `Scene.add` reads bounds from, and an index that is not
     * there yet takes an empty slot's zero-radius sphere, which every frustum
     * test rejects.
     */
    spawn(world: Reference<World>, mesh: usize, material: usize, matrix: fmat4): u64 {
        const entity = this.spawnPivot(world, matrix);
        world.set<Renderable>(entity, this.renderable, {
            mesh: cast<u32>(mesh),
            material: cast<u32>(material),
        });
        return entity;
    }

    /**
     * A transform with nothing to draw.
     *
     * What a pure parent is: a turret mount, a vehicle's origin, anything whose
     * job is to be a frame of reference for its children.
     */
    spawnPivot(world: Reference<World>, matrix: fmat4): u64 {
        const entity = world.create();
        world.set<LocalTransform>(entity, this.localTransform, {matrix: matrix});
        // Zero rather than identity, and a stamp of zero so the first propagate
        // sees it as stale. Nothing reads this before then.
        world.set<WorldTransform>(entity, this.worldTransform, {
            matrix: fmat4.identity(),
            stamp: 0,
        });
        return entity;
    }

    /** Make `child`'s transform relative to `parent`'s. Replaces any previous parent. */
    attach(world: Reference<World>, child: u64, parent: u64): boolean {
        return world.relate(child, this.childOf, parent);
    }

    /** Give `child` its own frame of reference back. */
    detach(world: Reference<World>, child: u64): boolean {
        return world.unrelate(child, this.childOf);
    }

    /** Where `entity` ended up after the last {@link propagate}. Identity if it has none. */
    worldMatrix(world: Reference<World>, entity: u64): fmat4 {
        const slot = world.get<WorldTransform>(entity, this.worldTransform);
        if (slot === null) {
            return fmat4.identity();
        }
        return slot[0].matrix;
    }

    // -- phase one: transforms -------------------------------------------------

    /**
     * Compose every entity's world transform from its local one and its parents.
     *
     * Entities are visited in whatever order the tables hold them, so a child is
     * routinely reached before its parent. {@link resolve} handles that by
     * walking *up* to the first ancestor that is already done and composing back
     * down, which means each entity is composed exactly once however the order
     * falls out.
     */
    propagate(world: Reference<World>): void {
        this.stamp += 1;

        // Collected first and resolved afterwards. Resolving reaches other
        // entities through `world.get`, and doing that inside `each` would be
        // reading and writing table rows while iterating them — legal here,
        // since nothing structural changes, but the two-step is cheaper to be
        // sure about and costs one array walk.
        while (this.pending.length !== 0) {
            this.pending.pop();
        }
        this.transformed.each(world, (it) => {
            for (let i: usize = 0; i < it.count; i++) {
                this.pending.push(it.entity(i));
            }
        });

        for (let i: usize = 0; i < this.pending.length; i++) {
            this.resolve(world, this.pending[i]);
        }
    }

    /**
     * Give `entity` and every unresolved ancestor a world transform.
     *
     * Two passes over one chain. Upwards until something is already stamped for
     * this frame, has no transform, or is a root; then downwards, composing
     * `parent * local` at each step. An ancestor that was already resolved stops
     * the walk immediately, so a parent with twenty children is composed once.
     */
    private resolve(world: Reference<World>, entity: u64): void {
        while (this.chain.length !== 0) {
            this.chain.pop();
        }

        let current = entity;
        while (this.chain.length < maxDepth()) {
            const slot = world.get<WorldTransform>(current, this.worldTransform);
            if (slot === null || slot[0].stamp === this.stamp) {
                break;
            }
            this.chain.push(current);

            const parent = world.targetOf(current, this.childOf);
            if (parent === noneId() || !world.isAlive(parent)) {
                break;
            }
            current = parent;
        }

        for (let i = this.chain.length; i > 0; i--) {
            const here = this.chain[i - 1];
            const local = world.get<LocalTransform>(here, this.localTransform);
            const slot = world.get<WorldTransform>(here, this.worldTransform);
            if (local === null || slot === null) {
                continue;
            }

            slot[0].matrix = this.composed(world, here, local[0].matrix);
            slot[0].stamp = this.stamp;
        }
    }

    /**
     * `parent * local`, or `local` where there is no usable parent.
     *
     * A parent counts as usable only once it carries this frame's stamp. That is
     * false for a dead parent, a parent with no transform, and the entity the
     * depth cap cut a chain at — all three fall back to the local transform,
     * which puts the entity somewhere wrong rather than somewhere undefined.
     */
    private composed(world: Reference<World>, entity: u64, local: fmat4): fmat4 {
        const parent = world.targetOf(entity, this.childOf);
        if (parent === noneId() || !world.isAlive(parent)) {
            return local;
        }

        const above = world.get<WorldTransform>(parent, this.worldTransform);
        if (above === null || above[0].stamp !== this.stamp) {
            return local;
        }
        return above[0].matrix.mul(local);
    }

    // -- phase two: the draw list ------------------------------------------------

    /**
     * Rebuild `scene.instances` from the world, sorted.
     *
     * Every instance is re-added through `Scene.add`, so the world-space bounds
     * are computed by the same code that computed them before the ECS existed.
     * That is deliberate: it makes "the scene is what it used to be" a property
     * of one function rather than of two that have to be kept in agreement.
     */
    extract(world: Reference<World>, scene: Reference<Scene>): void {
        while (this.meshKey.length !== 0) {
            this.meshKey.pop();
            this.materialKey.pop();
            this.matrices.pop();
        }

        this.drawn.each(world, (it) => {
            const what = it.column<Renderable>(0);
            const where = it.column<WorldTransform>(1);
            if (what === null || where === null) {
                return;
            }
            for (let i: usize = 0; i < it.count; i++) {
                this.meshKey.push(what[i].mesh);
                this.materialKey.push(what[i].material);
                this.matrices.push(where[i].matrix);
            }
        });

        this.sort(scene.meshes.length, scene.materials.length);

        while (scene.instances.length !== 0) {
            scene.instances.pop();
        }
        for (let i: usize = 0; i < this.order.length; i++) {
            const at = cast<usize>(this.order[i]);
            scene.add(
                cast<usize>(this.meshKey[at]),
                cast<usize>(this.materialKey[at]),
                this.matrices[at],
            );
        }
    }

    /** Both phases, in order. What a frame calls. */
    run(world: Reference<World>, scene: Reference<Scene>): void {
        this.propagate(world);
        this.extract(world, scene);
    }

    /**
     * Order the collected drawables by material, then by mesh.
     *
     * Two stable counting sorts, least significant key first: by mesh, then by
     * material. Both keys are indices into arrays the scene already has, so the
     * bucket counts are known and neither pass compares anything — this is
     * linear in the drawables plus the number of meshes and materials, where a
     * comparison sort would be `n log n` with a branch in the middle of it.
     *
     * Material is the outer key because it is the expensive rebind: five
     * textures and a uniform block per change, against a vertex and index buffer
     * for a mesh.
     */
    private sort(meshes: usize, materials: usize): void {
        const total = this.meshKey.length;

        while (this.order.length !== 0) {
            this.order.pop();
            this.shuffled.pop();
        }
        for (let i: usize = 0; i < total; i++) {
            this.order.push(cast<u32>(i));
            this.shuffled.push(0);
        }

        this.stablePass(this.meshKey, meshes);
        this.stablePass(this.materialKey, materials);
    }

    /**
     * One counting sort of {@link order} by `keys`, stable.
     *
     * Stability is what makes the two passes compose: the second sort leaves
     * entries with equal materials in the order the first left them, which is by
     * mesh.
     */
    private stablePass(keys: Reference<u32[]>, buckets: usize): void {
        const total = this.order.length;
        if (total === 0 || buckets === 0) {
            return;
        }

        while (this.counts.length !== 0) {
            this.counts.pop();
        }
        for (let i: usize = 0; i <= buckets; i++) {
            this.counts.push(0);
        }

        // A key past the last bucket would write outside the counts, so it is
        // folded into the final bucket. That is a mesh or material index the
        // scene does not have, which `Scene.add` would reject anyway.
        for (let i: usize = 0; i < total; i++) {
            const key = this.bucketOf(keys, cast<usize>(this.order[i]), buckets);
            this.counts[key] += 1;
        }

        let running: u32 = 0;
        for (let i: usize = 0; i < buckets; i++) {
            const here = this.counts[i];
            this.counts[i] = running;
            running += here;
        }

        for (let i: usize = 0; i < total; i++) {
            const slot = cast<usize>(this.order[i]);
            const key = this.bucketOf(keys, slot, buckets);
            this.shuffled[cast<usize>(this.counts[key])] = this.order[i];
            this.counts[key] += 1;
        }

        for (let i: usize = 0; i < total; i++) {
            this.order[i] = this.shuffled[i];
        }
    }

    /** `keys[at]`, clamped into range. See the note in {@link stablePass}. */
    private bucketOf(keys: Reference<u32[]>, at: usize, buckets: usize): usize {
        const key = cast<usize>(keys[at]);
        return key < buckets ? key : buckets - 1;
    }
}
