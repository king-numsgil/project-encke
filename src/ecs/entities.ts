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
//
// ## The free list is FIFO, and that is a decision
//
// A stack is the obvious structure here and is what most of this family of
// container does: push the dying index, pop the newest. It is one field instead
// of two, and the record you just wrote is still in L1 when the next `create`
// reads it.
//
// It is not what this does, and the reason is the generation. An id carries 16
// bits of it — see the layout note in `id.ts` — so an index is safe for 65,536
// recycles and no more, after which a handle that named a dead entity names a
// live one again with nothing to tell them apart. A stack spends that budget as
// fast as it is physically possible to spend it: the slot that was just freed is
// the next one out, so a spawner alternating create and destroy burns one index's
// entire generation range and never touches another.
//
// A queue spends it evenly instead. With `F` indices on the list, wrapping any
// one of them takes 65,536 **full laps** rather than 65,536 recycles, so the
// budget scales with how much churn the program actually has in flight. The cost
// is one cold record touched per create and one extra field here, which is the
// right trade when the alternative is measured in correctness.
//
// **It is still eager**, and that is worth being honest about: an index is
// eligible again the moment it reaches the head, so a program with one entity in
// flight has a one-entry queue and gets exactly the stack's behaviour. Making it
// genuinely lazy means either a floor on the queue's length or retiring an index
// when its generation is spent; neither is here yet.

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
 * Bit 0 of {@link Record.flags}: this slot holds a live entity.
 *
 * A bit rather than a `boolean` field, because the boolean was a byte that cost
 * four with the padding — and because there are fifteen more of them free here
 * for the things a record will eventually want to say about itself.
 */
function aliveFlag(): u16 {
    return 1;
}

/**
 * Where one entity is, and whether it is anywhere. **Twelve bytes, exactly.**
 *
 * A struct rather than four parallel arrays: these fields are always read
 * together — a lookup wants the generation to validate the handle and the
 * location to do anything with it — so splitting them would be three extra cache
 * misses in exchange for nothing.
 *
 * The layout is deliberate to the byte. `u32, u32, u16, u16` is twelve with no
 * padding at all; the same information as a `u32` generation and a `boolean` was
 * sixteen, a quarter of it holding nothing. At a million live entities that is
 * 12 MB against 16 MB, and the array is sized by the **high-water mark** of
 * concurrent entities and never shrinks — so it is worth the four bytes.
 */
interface Record {
    /** Which archetype holds it, or {@link noArchetype}. */
    archetype: u32;

    /** Which row of that archetype. While dead, the next free index. */
    row: u32;

    /**
     * Bumped on every destroy, wrapping at 16 bits — which is not a narrowing,
     * it is the width an id actually carries. Storing it wider only ever meant
     * masking somewhere else.
     */
    generation: u16;

    /** {@link aliveFlag}, and fifteen spare bits. */
    flags: u16;
}

export class Entities {
    private records: Record[];

    /** The next index to hand out. {@link noFreeSlot} when the queue is empty. */
    private freeHead: u32;

    /** Where a newly dead index is appended. {@link noFreeSlot} when empty. */
    private freeTail: u32;

    private living: u32;

    /**
     * Reserves the low indices for the builtins in `id.ts`.
     *
     * Index 0 is `none` and is created dead, so `isAlive(noneId())` is false
     * without a special case anywhere. Everything from 1 to `firstUserIndex()`
     * is created alive, because they are real entities that carry real
     * components — `ChildOf` holds `(OnDelete, Delete)`, for one.
     *
     * The dead index 0 is deliberately **not** put on the free list. Handing it
     * out would make `noneId()` a real entity.
     */
    constructor() {
        this.records = [];
        this.freeHead = noFreeSlot();
        this.freeTail = noFreeSlot();
        this.living = 0;

        const reserved = firstUserIndex();
        this.records.reserve(cast<usize>(reserved));
        for (let i: u32 = 0; i < reserved; i++) {
            this.records.push({
                archetype: noArchetype(),
                row: 0,
                generation: 0,
                flags: i !== 0 ? aliveFlag() : 0,
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

    /** How many indices are waiting to be reused. */
    get freeCount(): usize {
        let total: usize = 0;
        let at = this.freeHead;
        while (at !== noFreeSlot()) {
            total += 1;
            at = this.records[cast<usize>(at)].row;
        }
        return total;
    }

    /**
     * A fresh handle.
     *
     * From the **front** of the free queue when there is one, so indices stay
     * dense and the record array stays a subscript rather than a map. The
     * generation is whatever the slot already carried — it was bumped when the
     * slot died, and bumping it again here would waste half the range.
     */
    create(): u64 {
        this.living += 1;

        const reused = this.freeHead;
        if (reused !== noFreeSlot()) {
            const at = cast<usize>(reused);

            this.freeHead = this.records[at].row;
            if (this.freeHead === noFreeSlot()) {
                // The queue is now empty, so the tail has to forget its index
                // too — otherwise the next destroy would append onto a slot that
                // has since been handed out and lose the whole list.
                this.freeTail = noFreeSlot();
            }

            this.records[at].flags = aliveFlag();
            this.records[at].archetype = noArchetype();
            this.records[at].row = 0;
            return makeEntity(reused, cast<u32>(this.records[at].generation));
        }

        const index = cast<u32>(this.records.length);
        this.records.push({
            archetype: noArchetype(),
            row: 0,
            generation: 0,
            flags: aliveFlag(),
        });
        return makeEntity(index, 0);
    }

    /**
     * Retire a handle. `false` if it was not alive, which is not an error —
     * destroying something twice is the ordinary shape of cleanup code.
     *
     * The index goes on the **back** of the queue, so every other free index is
     * handed out before it comes round again. See the note at the top of this
     * file for why that is worth an extra field.
     *
     * This does **not** touch the entity's components or the pairs that name it.
     * Storage is the world's business and relationship cleanup is
     * `relation.ts`'s; this is only the index.
     */
    destroy(handle: u64): boolean {
        if (!this.isAlive(handle)) {
            return false;
        }

        const index = indexOf(handle);
        const at = cast<usize>(index);

        // Wrapped rather than checked, because there is no useful thing to do
        // about the wrap: 16 bits is what an id carries and refusing to recycle
        // the slot would be worse than reusing it. Widened first, so the addition
        // does not depend on how `u16` overflow behaves.
        const next = cast<u32>(this.records[at].generation) + 1;
        this.records[at].generation = cast<u16>(next & 0xffff);

        this.records[at].flags = 0;
        this.records[at].archetype = noArchetype();
        // The new tail, so it terminates the list rather than pointing at
        // whatever the head used to be — the one difference from a stack that is
        // easy to leave out, and it makes the queue a cycle if you do.
        this.records[at].row = noFreeSlot();

        if (this.freeTail === noFreeSlot()) {
            this.freeHead = index;
        } else {
            this.records[cast<usize>(this.freeTail)].row = index;
        }
        this.freeTail = index;

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
        const at = cast<usize>(indexOf(handle));
        if (at >= this.records.length) {
            return false;
        }
        return (this.records[at].flags & aliveFlag()) !== 0 &&
            cast<u32>(this.records[at].generation) === generationOf(handle);
    }

    /** The live handle for `index`, or {@link noneId} if nothing lives there. */
    handleAt(index: u32): u64 {
        const at = cast<usize>(index);
        if (at >= this.records.length || (this.records[at].flags & aliveFlag()) === 0) {
            return noneId();
        }
        return makeEntity(index, cast<u32>(this.records[at].generation));
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
