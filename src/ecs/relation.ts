// Who is related to whom, looked up from the target's end.
//
// A relation's *target* lives in a column: relating a turret to a ship writes
// the ship's handle into the turret's row. That answers "what is this turret
// attached to" in one load, and it costs no archetype fragmentation at all —
// every turret in the game shares one table however many ships there are.
//
// It does not answer the other direction. "What are ship #3's parts" would be a
// scan of every entity that has a parent, and that is what this file exists to
// avoid: one map from `(relation, target)` to the entities pointing at it.
//
// ## The key is a packed pair, and it is only a key
//
// `(relation index, target index)` in one `u64`, which is exactly the shape an
// id had when relationships lived in the archetype signature. The difference is
// the whole point of the redesign: this number is a **hash key**, not an id. It
// never enters a signature, never creates a table, and never reaches a query. A
// world with 2,000 ships has 2,000 keys in one map and one table, where before
// it had 2,000 tables.
//
// ## Versions, so a view can be free
//
// Each key carries a version that changes whenever its list does. A {@link View}
// keeps its own copy of a list and the version it was copied at, so re-reading
// costs one comparison while nothing is moving, and one copy when something is.
// That is the memory-for-speed trade stated exactly: a view is a cached answer,
// and the version is how it knows the answer went stale.

import { HashMap } from "std/collection";
import { indexOf } from "./id.ts";

/**
 * `(relation, target)` in one `u64`, for the map below.
 *
 * Both halves are **indices**, without generations, which is all a lookup needs:
 * the entities are alive at the moment they are related, and the handles stored
 * in the list and in the column carry the generation that detects staleness.
 */
export function relationKey(relation: u64, target: u64): u64 {
    return (cast<u64>(indexOf(relation)) << 32) | cast<u64>(indexOf(target));
}

export class RelationIndex {
    /** `(relation, target)` to its slot in {@link lists}. */
    private slotOf: HashMap<u64, u32>;

    /**
     * The entities pointing at each target, as full handles.
     *
     * A `u64[][]` addressed through the map rather than a `HashMap<u64, u64[]>`,
     * because reading a value out of a map **copies** it — there is no way to
     * borrow out of a container yet — so appending would clone the whole list
     * every time. Indexing an array gives a place rather than a copy.
     */
    private lists: u64[][];

    /** Bumped whenever the list at the same slot changes. See {@link View}. */
    private versions: u32[];

    constructor() {
        this.slotOf = new HashMap<u64, u32>();
        this.lists = [];
        this.versions = [];
    }

    /** How many `(relation, target)` pairs have ever had a member. */
    get size(): usize {
        return this.lists.length;
    }

    /** Note that `holder` points at `target` through `relation`. */
    add(relation: u64, target: u64, holder: u64): void {
        const slot = this.slotFor(relationKey(relation, target));
        this.lists[slot].push(holder);
        this.versions[slot] += 1;
    }

    /**
     * Forget that `holder` pointed at `target`. `false` if it was not there.
     *
     * A swap-remove after a scan, so it costs the length of that one target's
     * list — thirteen, for a ship with thirteen parts. The list is **unordered**
     * as a result, which nothing depends on: a caller wanting the parts in a
     * particular order sorts them or stores an index alongside.
     */
    remove(relation: u64, target: u64, holder: u64): boolean {
        const at = this.slotOf.indexOf(relationKey(relation, target));
        if (at < 0) {
            return false;
        }

        const slot = cast<usize>(this.slotOf.valueAt(cast<usize>(at)));
        for (let i: usize = 0; i < this.lists[slot].length; i++) {
            if (this.lists[slot][i] === holder) {
                const last = this.lists[slot].length - 1;
                if (i !== last) {
                    this.lists[slot][i] = this.lists[slot][last];
                }
                this.lists[slot].pop();
                this.versions[slot] += 1;
                return true;
            }
        }
        return false;
    }

    /** How many entities point at `target` through `relation`. */
    countFor(relation: u64, target: u64): usize {
        const at = this.slotOf.indexOf(relationKey(relation, target));
        if (at < 0) {
            return 0;
        }
        return this.lists[cast<usize>(this.slotOf.valueAt(cast<usize>(at)))].length;
    }

    /**
     * Append everything pointing at `target` onto `out`.
     *
     * A copy into the caller's array rather than a borrow, and that is the point
     * rather than a limitation: what a caller does with a target's holders is
     * usually to destroy or re-relate them, and doing that while walking the
     * index would move entries under the cursor. A snapshot is what the
     * operation needs, and taking it here is one place rather than every call
     * site.
     */
    collect(relation: u64, target: u64, out: Reference<u64[]>): void {
        const at = this.slotOf.indexOf(relationKey(relation, target));
        if (at < 0) {
            return;
        }

        const slot = cast<usize>(this.slotOf.valueAt(cast<usize>(at)));
        out.reserve(out.length + this.lists[slot].length);
        for (let i: usize = 0; i < this.lists[slot].length; i++) {
            out.push(this.lists[slot][i]);
        }
    }

    /** What {@link View} compares against. Zero for a key nothing has touched. */
    versionOf(relation: u64, target: u64): u32 {
        const at = this.slotOf.indexOf(relationKey(relation, target));
        if (at < 0) {
            return 0;
        }
        return this.versions[cast<usize>(this.slotOf.valueAt(cast<usize>(at)))];
    }

    /** The slot for `key`, creating an empty list if there is none. */
    private slotFor(key: u64): usize {
        const at = this.slotOf.indexOf(key);
        if (at >= 0) {
            return cast<usize>(this.slotOf.valueAt(cast<usize>(at)));
        }

        const slot = this.lists.length;
        const fresh: u64[] = [];
        this.lists.push(fresh);
        this.versions.push(1);
        this.slotOf.set(key, cast<u32>(slot));
        return slot;
    }
}

/**
 * A cached answer to "everything related to this target", kept current.
 *
 *     const parts = world.view(childOf, ship);
 *     parts.each(world, (part) => { … });
 *
 * The trade, stated plainly: a view spends one `u64` per member to make the walk
 * a contiguous array with no lookup. While nothing is being related or
 * unrelated, `each` costs one integer comparison and then the loop; when
 * something changes, the next `each` re-copies the list once.
 *
 * **Iterating the copy rather than the index is a feature.** Relating or
 * destroying from inside the loop is the ordinary thing to want to do with a
 * ship's parts, and a walk over the live list would move entries under the
 * cursor while doing it.
 *
 * A view holds handles, not rows. Members can be destroyed while it is stale, so
 * the body should check {@link World.isAlive} if it did anything that might have
 * killed one — which is the same care a stored handle always needs.
 */
export class View {
    private relation: u64;
    private target: u64;
    private members: u64[];

    /** The version {@link members} was copied at. Zero means "never copied". */
    private version: u32;

    constructor(relation: u64, target: u64) {
        this.relation = relation;
        this.target = target;
        this.members = [];
        this.version = 0;
    }

    /** What this view is a view of. */
    get of(): u64 {
        return this.target;
    }

    get through(): u64 {
        return this.relation;
    }

    /** How many members, as of the last {@link sync}. */
    get length(): usize {
        return this.members.length;
    }

    /** Member `at`. Call {@link sync} first, or use {@link each}. */
    at(index: usize): u64 {
        return this.members[index];
    }

    /**
     * Re-copy the list if it has changed since the last look.
     *
     * Public because a caller iterating with {@link at} has to be able to say
     * when, and because a benchmark wants to take the copy out of the
     * measurement.
     */
    sync(index: Reference<RelationIndex>): void {
        const current = index.versionOf(this.relation, this.target);
        if (current === this.version) {
            return;
        }

        while (this.members.length !== 0) {
            this.members.pop();
        }
        index.collect(this.relation, this.target, this.members);
        this.version = current;
    }

    /** Sync, then call `body` with every member. */
    walk(index: Reference<RelationIndex>, body: LocalFn<(member: u64) => void>): void {
        this.sync(index);
        for (let i: usize = 0; i < this.members.length; i++) {
            body(this.members[i]);
        }
    }
}
