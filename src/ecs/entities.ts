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
// ## A spent index is retired, not recycled
//
// An id carries 16 bits of generation — see the layout note in `id.ts` — so an
// index can be handed out 65,536 times and no more. The obvious thing to do at
// 65,536 is wrap and carry on, and it is what an earlier version of this file
// did: the generation returned to zero and a handle from the very beginning read
// as alive again, naming an entity that had nothing to do with it.
//
// **So the slot is retired instead.** The destroy that would wrap it takes the
// index off the free list permanently, and `create` allocates a fresh one. The
// consequence is worth stating plainly, because it is the property everything
// above this layer gets to rely on:
//
//     No handle is ever reissued. A handle names one entity for the life of the
//     process, and once that entity is destroyed the handle is dead forever.
//
// That turns the generation from a probabilistic defence into a guarantee, and
// it is what makes it safe to keep an entity handle in a save file, a UI widget,
// a script, or an undo stack.
//
// ## The free list is a stack
//
// Push the dying index, pop the newest. One field, and the record just written
// is still in L1 when the next `create` reads it — which is most of why a
// create/destroy pair benches around 80 ns.
//
// A queue was tried, and the reason for it was to spread generation churn across
// every index in flight so that no single one burned through its 65,536 quickly.
// Retirement removes that reason entirely: the total number of retirements is
// `destroys / 65,536` whichever end of the list you take from, so the order buys
// nothing and the stack is warmer. It is the right structure *because* of the
// paragraph above, not in spite of it.
//
// ## What retirement costs, and the compaction that is not here
//
// **The record array never shrinks.** Two things grow it and neither gives
// anything back:
//
//   * the **high-water mark** of concurrent entities — peak at two million once
//     and the 24 MB is held for the life of the process, even at five thousand
//     live afterwards. This is much the larger of the two.
//   * **retirement**, at one slot per 65,536 destroys of that slot. Twelve bytes
//     per 65,536 entity lifetimes is about 0.0002 bytes a lifetime: a session
//     killing a million entities a second for seven hours retires 385,000 slots
//     and spends 4.6 MB on them. Real, and far below the high-water mark.
//
// A compaction pass would have to deal with both, and the hard part is not
// finding the dead slots — it is that **an index is the handle**. Moving a live
// entity's slot invalidates every handle anyone is holding, and those live in
// user data structures this file cannot see. Three shapes it could take:
//
//   * **Trim the tail.** Give back trailing slots that are free or retired. Safe,
//     needs no fixup, and reclaims nothing when a live entity sits at the end —
//     which after a high-water peak is exactly where one will be.
//   * **Remap with a fixup pass.** Compact properly and rewrite every stored
//     handle. Only possible if every holder is reachable, which is a promise the
//     ECS cannot make on its own.
//   * **Reset at a boundary.** At a level load or a world reset, everything is
//     destroyed anyway, so the whole index can go back to zero. This is the one
//     a game actually wants, and it is a `World.reset()` rather than a
//     compactor.
//
// None of them is written. The counters are: {@link Entities.retiredCount} and
// {@link Entities.freeCount} are what a running program watches to find out
// whether any of this matters to it yet.

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
 * four with the padding — and because there are fourteen more of them free here
 * for the things a record will eventually want to say about itself.
 */
function aliveFlag(): u16 {
    return 1;
}

/**
 * Bit 1: this slot's generations are spent and it will never be handed out again.
 *
 * Dead and not on the free list, which is all the machinery needs — the flag is
 * for the counter and for anyone reading a record in a debugger and wondering
 * why an index went quiet.
 */
function retiredFlag(): u16 {
    return 2;
}

/**
 * The last generation an index can serve.
 *
 * Not "the generation at which it wraps": the slot is used *at* this value and
 * retired by the destroy that follows, so an index serves 65,536 entities over
 * its life — generations 0 through 65,535.
 */
function lastGeneration(): u16 {
    return 0xffff;
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

    /** The top of the free stack. {@link noFreeSlot} when it is empty. */
    private freeHead: u32;

    private living: u32;

    /** How many indices have been retired. See the note at the top of this file. */
    private spent: u32;

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
        this.living = 0;
        this.spent = 0;

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

    /** How many indices are waiting to be reused. A walk, so not for a hot path. */
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
     * How many indices have been retired with their generations spent.
     *
     * The gauge for the growth the file header describes. A program that watches
     * one number to decide whether any of this matters to it watches this one;
     * it climbs by one per 65,536 destroys of a single index, and each step costs
     * twelve bytes that are never given back.
     */
    get retiredCount(): u32 {
        return this.spent;
    }

    /**
     * A fresh handle.
     *
     * Off the top of the free stack when there is one, so indices stay dense and
     * the record array stays a subscript rather than a map. The generation is
     * whatever the slot already carried — it was bumped when the slot died, and
     * bumping it again here would waste half the range.
     */
    create(): u64 {
        this.living += 1;

        const reused = this.freeHead;
        if (reused !== noFreeSlot()) {
            const at = cast<usize>(reused);
            this.freeHead = this.records[at].row;

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
     * The index goes back on the free stack **unless its generations are spent**,
     * in which case it is retired and never handed out again. That is the whole
     * of the guarantee described at the top of this file, and it is four lines.
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

        this.records[at].archetype = noArchetype();
        this.living -= 1;

        if (this.records[at].generation === lastGeneration()) {
            // Spent. The generation is left where it is rather than wrapped, so
            // a record read in a debugger says which generation it died on, and
            // so that nothing can mistake this slot for a fresh one.
            this.records[at].flags = retiredFlag();
            this.records[at].row = 0;
            this.spent += 1;
            return true;
        }

        // Widened first, so the addition does not depend on how `u16` overflow
        // behaves — though the branch above means it can never reach one.
        this.records[at].generation = cast<u16>(cast<u32>(this.records[at].generation) + 1);
        this.records[at].flags = 0;
        this.records[at].row = this.freeHead;
        this.freeHead = index;
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
