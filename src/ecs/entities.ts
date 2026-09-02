// Which entities exist, and where each one's data is.
//
// One dense array indexed by entity index, and a free list threaded through the
// dead slots. Both halves are the standard arrangement and both are here for the
// same reason: an entity index is a direct subscript, so answering "is this
// handle still valid" and "which row holds its components" are each one load and
// no search.
//
// **The free list lives in the dead records themselves.** A dead slot's `row`
// field is the index of the next free one, which costs nothing — the field is
// meaningless while the slot is dead — and means recycling allocates nothing.
// The list is LIFO, so an index that was just freed is the next one handed out,
// which is what makes the generation wrap in `id.ts` reachable at all and is
// therefore what the tests aim at.

import { firstUserIndex, generationOf, indexOf, makeEntity, noneId } from "./id.ts";

/** The end of the free list. Not a valid index; there are only 2^32 - 1 of those. */
function noFreeSlot(): u32 {
    return 0xffffffff;
}

/** An archetype index meaning "not in one yet". */
export function noArchetype(): u32 {
    return 0xffffffff;
}

/**
 * Where one entity is, and whether it is anywhere.
 *
 * A struct rather than four parallel arrays: these four fields are always read
 * together — a lookup wants the generation to validate the handle and the
 * location to do anything with it — so splitting them would be three extra cache
 * misses in exchange for nothing.
 */
interface Record {
    /** Which archetype holds it, or {@link noArchetype}. */
    archetype: u32;

    /** Which row of that archetype. While dead, the next free index. */
    row: u32;

    /**
     * Bumped on every destroy, wrapping at 16 bits because that is all an id
     * carries. Stored wide because a `u32` field costs nothing next to the
     * three beside it and masking on the way *in* is one place rather than
     * every comparison.
     */
    generation: u32;

    alive: boolean;
}

export class Entities {
    private records: Record[];
    private freeHead: u32;
    private living: u32;

    /**
     * Reserves the low indices for the builtins in `id.ts`.
     *
     * Index 0 is `none` and is created dead, so `isAlive(noneId())` is false
     * without a special case anywhere. Everything from 1 to `firstUserIndex()`
     * is created alive, because they are real entities that carry real
     * components — `ChildOf` holds `(OnDelete, Delete)`, for one.
     */
    constructor() {
        this.records = [];
        this.freeHead = noFreeSlot();
        this.living = 0;

        const reserved = firstUserIndex();
        this.records.reserve(cast<usize>(reserved));
        for (let i: u32 = 0; i < reserved; i++) {
            this.records.push({
                archetype: noArchetype(),
                row: 0,
                generation: 0,
                alive: i !== 0,
            });
            if (i !== 0) {
                this.living += 1;
            }
        }
    }

    /** How many indices have ever been handed out, alive or not. */
    get capacity(): usize {
        return this.records.length;
    }

    /** How many entities are alive, the reserved ones included. */
    get count(): u32 {
        return this.living;
    }

    /**
     * A fresh handle.
     *
     * From the free list when there is one, so indices stay dense and the record
     * array stays a subscript rather than a map. The generation is whatever the
     * slot already carried — it was bumped when the slot died, and bumping it
     * again here would waste half the range.
     */
    create(): u64 {
        this.living += 1;

        const reused = this.freeHead;
        if (reused !== noFreeSlot()) {
            this.freeHead = this.records[cast<usize>(reused)].row;
            this.records[cast<usize>(reused)].alive = true;
            this.records[cast<usize>(reused)].archetype = noArchetype();
            this.records[cast<usize>(reused)].row = 0;
            return makeEntity(reused, this.records[cast<usize>(reused)].generation);
        }

        const index = cast<u32>(this.records.length);
        this.records.push({archetype: noArchetype(), row: 0, generation: 0, alive: true});
        return makeEntity(index, 0);
    }

    /**
     * Retire a handle. `false` if it was not alive, which is not an error —
     * destroying something twice is the ordinary shape of cleanup code.
     *
     * This does **not** touch the entity's components or the pairs that name it.
     * Storage is the world's business and relationship cleanup is
     * `relation.ts`'s; this is only the index.
     */
    destroy(handle: u64): boolean {
        if (!this.isAlive(handle)) {
            return false;
        }

        const index = cast<usize>(indexOf(handle));
        // Wrapped here rather than checked, because there is no useful thing to
        // do about the wrap: a 16-bit generation is what an id carries and
        // refusing to recycle the slot would be worse than reusing it.
        this.records[index].generation = (this.records[index].generation + 1) & 0xffff;
        this.records[index].alive = false;
        this.records[index].archetype = noArchetype();
        this.records[index].row = this.freeHead;

        this.freeHead = indexOf(handle);
        this.living -= 1;
        return true;
    }

    /**
     * Whether `handle` still names what it named when it was handed out.
     *
     * The generation comparison is the whole point. Without it a recycled index
     * would make every stale handle silently valid, and with it one is only
     * valid again after 65,536 recycles — see the note at the top of `id.ts`.
     */
    isAlive(handle: u64): boolean {
        const index = cast<usize>(indexOf(handle));
        if (index >= this.records.length) {
            return false;
        }
        return this.records[index].alive &&
            this.records[index].generation === generationOf(handle);
    }

    /** The live handle for `index`, or {@link noneId} if nothing lives there. */
    handleAt(index: u32): u64 {
        const at = cast<usize>(index);
        if (at >= this.records.length || !this.records[at].alive) {
            return noneId();
        }
        return makeEntity(index, this.records[at].generation);
    }

    /** Which archetype holds entity `index`, or {@link noArchetype}. */
    archetypeAt(index: u32): u32 {
        return this.records[cast<usize>(index)].archetype;
    }

    /** Which row of its archetype holds entity `index`. */
    rowAt(index: u32): u32 {
        return this.records[cast<usize>(index)].row;
    }

    /**
     * Point entity `index` at a row.
     *
     * Called on every archetype move — twice, in fact: once for the entity that
     * moved and once for the entity swapped into the hole it left. Forgetting
     * the second is the classic archetype bug, and the reason this is a method
     * with a name rather than two field writes at the call site.
     */
    setLocation(index: u32, archetype: u32, row: u32): void {
        this.records[cast<usize>(index)].archetype = archetype;
        this.records[cast<usize>(index)].row = row;
    }

    /** Move entity `index` within its archetype. */
    setRow(index: u32, row: u32): void {
        this.records[cast<usize>(index)].row = row;
    }
}
