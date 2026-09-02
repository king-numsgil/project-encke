// One relationship kind: who points at whom, both ways, outside the archetypes.
//
// A relation is **not a component**. Its id never enters a signature, never
// creates a table, never reaches a query, and cannot be reached by `add`,
// `remove` or `set`. That is the whole reason this file exists as it does: when
// the target lived in a column it was a component, and everything that could
// touch a component could corrupt it.
//
// ## A link is a row, threaded into a chain
//
// Every link — "this turret is a child of that ship" — is one row across four
// parallel dense arrays. The rows are in no particular order and move when
// others are removed, exactly as an archetype's rows do.
//
//     holder │ turret#4  door#9   turret#7  chair#2
//     target │ ship#1     ship#1   ship#3    ship#1
//     next   │ 1          3        NONE      NONE
//     prev   │ NONE       0        NONE      1
//
// Two lookups reach a row, and neither hashes anything:
//
//   * **`slotOf`** — a paged sparse index from the *holder's* entity index to
//     its row. "What is this turret attached to" is two array reads, measured at
//     9 ns against 40 for a hash map.
//   * **`firstOf`** — the same, from the *target's* index to the first row
//     naming it, with `next` and `prev` chaining the rest. "What are this ship's
//     parts" walks the chain: 20 ns for ten, against 46 for a map to a list, and
//     with **no per-target allocation at all**.
//
// Attaching pushes onto the front of the target's chain and detaching unlinks,
// so both are O(1) and neither allocates once the arrays have room.
//
// ## Handles, whole, in the dense arrays
//
// `holder` and `target` hold **full 64-bit handles**, generations included, and
// every read compares the one it was given against the one stored. A sparse
// index is keyed by an entity *index*, so without that comparison a stale handle
// to a dead ship would find whatever entity took its index over — which is a bug
// this file has already had once, in an earlier shape, and the comparison is
// what makes it structurally impossible rather than something to remember.
//
// ## One target for now
//
// {@link relate} replaces rather than appends, so a holder has at most one row.
// The generalisation is small and deliberately left open: give the holder side
// its own `nextForHolder`/`prevForHolder` chain — eight more bytes a link — and
// the same structure is a full many-to-many graph with O(1) attach and detach.

import { indexOf } from "./id.ts";
import { noSlot, SparseIndex } from "./sparse.ts";

export class RelationStore {
    /** Holder entity index to its row. */
    private slotOf: SparseIndex;

    /** Target entity index to the first row naming it. */
    private firstOf: SparseIndex;

    /**
     * Target entity index to a counter bumped whenever its chain changes.
     *
     * What a {@link View} compares against so it can skip re-copying. Per target
     * rather than one for the store, because a store-wide counter would make
     * every view stale whenever anything anywhere moved, which is every frame in
     * a world that spawns.
     */
    private versionOf: SparseIndex;

    /** The holder's whole handle, one per row. */
    private holder: u64[];

    /** The target's whole handle, one per row. */
    private target: u64[];

    /** The next row naming the same target, or {@link noSlot}. */
    private next: u32[];

    /** The previous row naming the same target, or {@link noSlot}. */
    private prev: u32[];

    constructor() {
        this.slotOf = new SparseIndex();
        this.firstOf = new SparseIndex();
        this.versionOf = new SparseIndex();
        this.holder = [];
        this.target = [];
        this.next = [];
        this.prev = [];
    }

    /** How many links this relation holds, across every target. */
    get count(): usize {
        return this.holder.length;
    }

    /** What the three sparse indices occupy. The dense rows are 24 bytes each. */
    get sparseBytes(): usize {
        return this.slotOf.bytes + this.firstOf.bytes + this.versionOf.bytes;
    }

    /**
     * The row `handle` occupies, or {@link noSlot}.
     *
     * The handle comparison is the load-bearing line: a sparse index is keyed by
     * an entity *index*, so a stale handle finds the row of whoever took that
     * index over, and this is what refuses it.
     */
    private rowOf(handle: u64): u32 {
        const slot = this.slotOf.get(indexOf(handle));
        if (slot === noSlot()) {
            return noSlot();
        }
        if (this.holder[cast<usize>(slot)] !== handle) {
            return noSlot();
        }
        return slot;
    }

    /** What `handle` points at, or zero. */
    targetOf(handle: u64): u64 {
        const slot = this.rowOf(handle);
        if (slot === noSlot()) {
            return 0;
        }
        return this.target[cast<usize>(slot)];
    }

    /** Whether `handle` points at anything. */
    holds(handle: u64): boolean {
        return this.rowOf(handle) !== noSlot();
    }

    /**
     * Point `holder` at `target`, replacing whatever it pointed at.
     *
     * O(1): at most an unlink from one chain and a push onto the front of
     * another. Nothing allocates once the dense arrays have room.
     */
    relate(handle: u64, to: u64): void {
        const existing = this.rowOf(handle);

        if (existing !== noSlot()) {
            const at = cast<usize>(existing);
            if (this.target[at] === to) {
                return;
            }
            this.unlink(existing);
            this.target[at] = to;
            this.link(existing);
            return;
        }

        const slot = cast<u32>(this.holder.length);
        this.holder.push(handle);
        this.target.push(to);
        this.next.push(noSlot());
        this.prev.push(noSlot());

        this.slotOf.set(indexOf(handle), slot);
        this.link(slot);
    }

    /** Stop `handle` pointing at anything. `false` if it was not. */
    unrelate(handle: u64): boolean {
        const slot = this.rowOf(handle);
        if (slot === noSlot()) {
            return false;
        }

        this.unlink(slot);
        this.slotOf.clear(indexOf(handle));
        this.swapRemove(slot);
        return true;
    }

    /** The first row naming `target`, or {@link noSlot}. For the walk below. */
    firstNaming(to: u64): u32 {
        const slot = this.firstOf.get(indexOf(to));
        if (slot === noSlot()) {
            return noSlot();
        }
        // Same comparison as `rowOf`, for the other end: a stale target handle
        // must not find the chain belonging to whoever took its index.
        if (this.target[cast<usize>(slot)] !== to) {
            return noSlot();
        }
        return slot;
    }

    /** The row after `slot` in its target's chain. */
    nextNaming(slot: u32): u32 {
        return this.next[cast<usize>(slot)];
    }

    /** The holder at `slot`. */
    holderAt(slot: u32): u64 {
        return this.holder[cast<usize>(slot)];
    }

    /**
     * How many point at `to`. **O(the answer)**, because the chain has no
     * count — one is four more bytes a target and nothing needs it yet.
     */
    countNaming(to: u64): usize {
        let total: usize = 0;
        let slot = this.firstNaming(to);
        while (slot !== noSlot()) {
            total += 1;
            slot = this.next[cast<usize>(slot)];
        }
        return total;
    }

    /**
     * Append everything pointing at `to` onto `out`.
     *
     * A copy rather than a walk the caller drives, and deliberately: what a
     * caller does with a ship's parts is usually to destroy or re-relate them,
     * and doing that mid-chain would unlink the row the walk is standing on.
     */
    collect(to: u64, out: Reference<u64[]>): void {
        let slot = this.firstNaming(to);
        while (slot !== noSlot()) {
            out.push(this.holder[cast<usize>(slot)]);
            slot = this.next[cast<usize>(slot)];
        }
    }

    /** The counter a {@link View} of `to` watches. Zero when nothing is there. */
    version(to: u64): u32 {
        const version = this.versionOf.get(indexOf(to));
        return version === noSlot() ? 0 : version;
    }

    /** Note that `to`'s chain changed. */
    private touch(to: u64): void {
        const index = indexOf(to);
        const version = this.versionOf.get(index);
        // `noSlot` doubles as "never touched", and wrapping past it would make a
        // changed chain look unchanged, so it is skipped rather than stored.
        const next = version === noSlot() ? 1 : version + 1;
        this.versionOf.set(index, next === noSlot() ? 1 : next);
    }

    /** Put `slot` on the front of its target's chain. */
    private link(slot: u32): void {
        const at = cast<usize>(slot);
        const to = this.target[at];
        const index = indexOf(to);

        const head = this.firstNaming(to);
        this.next[at] = head;
        this.prev[at] = noSlot();
        if (head !== noSlot()) {
            this.prev[cast<usize>(head)] = slot;
        }

        this.firstOf.set(index, slot);
        this.touch(to);
    }

    /** Take `slot` out of its target's chain, leaving the row itself alone. */
    private unlink(slot: u32): void {
        const at = cast<usize>(slot);
        const before = this.prev[at];
        const after = this.next[at];

        if (before !== noSlot()) {
            this.next[cast<usize>(before)] = after;
        } else {
            // It was the head, so the target now starts at whatever followed.
            this.firstOf.set(indexOf(this.target[at]), after);
        }
        if (after !== noSlot()) {
            this.prev[cast<usize>(after)] = before;
        }

        this.next[at] = noSlot();
        this.prev[at] = noSlot();
        this.touch(this.target[at]);
    }

    /**
     * Move the last row into `slot` and drop the last.
     *
     * The row being removed must already be unlinked. The row that *moves* is
     * still in a chain, so three things have to be repointed at its new address
     * — its holder's sparse entry, its neighbours, and its target's head if it
     * was one. Missing any of them is a corrupt chain rather than a crash, which
     * is why the tests walk every chain end to end afterwards.
     */
    private swapRemove(slot: u32): void {
        const last = cast<u32>(this.holder.length - 1);

        if (slot !== last) {
            const to = cast<usize>(slot);
            const from = cast<usize>(last);

            this.holder[to] = this.holder[from];
            this.target[to] = this.target[from];
            this.next[to] = this.next[from];
            this.prev[to] = this.prev[from];

            this.slotOf.set(indexOf(this.holder[to]), slot);

            if (this.prev[to] !== noSlot()) {
                this.next[cast<usize>(this.prev[to])] = slot;
            } else {
                this.firstOf.set(indexOf(this.target[to]), slot);
            }
            if (this.next[to] !== noSlot()) {
                this.prev[cast<usize>(this.next[to])] = slot;
            }
        }

        this.holder.pop();
        this.target.pop();
        this.next.pop();
        this.prev.pop();
    }
}

/**
 * A cached list of everything pointing at one target, kept current.
 *
 *     const parts = world.view(childOf, ship);
 *     world.walk(parts, (part) => { … });
 *
 * Two things it buys over calling `related` each time. The copy is skipped when
 * the target's chain has not changed — one integer comparison — and iterating a
 * copy is safe while relating and destroying, where walking the live chain would
 * unlink the row the walk is standing on.
 *
 * It is an ordinary value with nothing registered behind it, so holding one
 * costs the handles it holds and dropping one costs nothing.
 */
export class View {
    private relation: u64;
    private targetOf: u64;
    private members: u64[];
    private seen: u32;

    constructor(relation: u64, target: u64) {
        this.relation = relation;
        this.targetOf = target;
        this.members = [];
        this.seen = 0;
    }

    /** What this view is of. */
    get of(): u64 {
        return this.targetOf;
    }

    /** And through what. */
    get through(): u64 {
        return this.relation;
    }

    /** How many members, as of the last {@link sync}. */
    get length(): usize {
        return this.members.length;
    }

    /** Member `index`. {@link sync} first, or use `World.walk`. */
    at(index: usize): u64 {
        return this.members[index];
    }

    /** Re-copy the chain if it has changed since the last look. */
    sync(store: Reference<RelationStore>): void {
        const current = store.version(this.targetOf);
        if (current === this.seen && this.seen !== 0) {
            return;
        }

        while (this.members.length !== 0) {
            this.members.pop();
        }
        store.collect(this.targetOf, this.members);
        this.seen = current;
    }

    /** Sync, then call `body` with every member. */
    walk(store: Reference<RelationStore>, body: LocalFn<(member: u64) => void>): void {
        this.sync(store);
        for (let i: usize = 0; i < this.members.length; i++) {
            body(this.members[i]);
        }
    }
}
