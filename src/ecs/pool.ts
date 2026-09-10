// One component's storage, outside the archetypes: EnTT's sparse set.
//
// Everywhere else in this ECS the archetype makes the same trade. Iteration is a
// contiguous walk, and changing which components an entity has copies its whole
// row to another table. That suits a `Position`. It does not suit a `Selected`,
// a `Dirty` or a `Stunned` — an id that goes on and off several times a frame,
// gets read one entity at a time, and is never what a hot loop walks.
//
// A sparse component is that id, stored the other way round:
//
//     slotOf   entity index ──► dense row        (paged, no hashing)
//     owners   dense row    ──► whole handle
//     data     dense row    ──► the component
//
// Adding is a push and one sparse write; removing is a swap-remove and two.
// Neither touches an archetype, so a sparse id never enters a signature, never
// creates a table and never moves a row. `relation.ts` keeps its links outside
// the tables for the same reason.
//
// ## The cost, and who chooses to pay it
//
// Iteration. These rows are in insertion order, which has nothing to do with the
// order a table holds its entities, so a query reading a sparse component does a
// lookup per entity where a dense one does an increment. There is no way around
// that, so the choice belongs to whoever registers the component.
//
// EnTT reaches the same place from the other side: its storage is sparse by
// default, and a `group` is the user marking a set of components as a hot path
// to be clumped together. Here the default is the archetype and
// `sparseComponent` is the exception. Either way a person decides. A heuristic
// counting accesses would be guessing at what the next frame does, and it would
// guess wrong quietly.
//
// ## Handles are stored whole, and every read compares them
//
// `slotOf` is keyed by an entity index, so a stale handle to a dead entity would
// otherwise find whichever entity took that index over. {@link SparsePool.rowOf}
// compares the whole handle, which rules the bug out instead of leaving it to be
// remembered. `relation.ts` has the same comparison for the same reason.

import { Column } from "./column.ts";
import { type ComponentInfo, isTag } from "./component.ts";
import { indexOf, noneId } from "./id.ts";
import { noSlot, SparseIndex } from "./sparse.ts";

export class SparsePool {
    /** The type this pool holds. A tag's is size zero and {@link data} is unused. */
    info: ComponentInfo;

    /** Entity index to dense row. Paged; see `sparse.ts`. */
    private slotOf: SparseIndex;

    /** The whole handle at each dense row. This is what refuses a stale one. */
    private owners: u64[];

    /**
     * The component data, one row per entry of {@link owners}.
     *
     * A `Column`: the same type-erased run of rows an archetype is made of,
     * contiguous and growable, with the per-type hooks as function pointers.
     *
     * A tag's pool builds one and never pushes to it, which costs the single
     * byte `Column`'s constructor allocates. `Column` requires a non-zero size —
     * a zero stride divides by zero when it works out how much to grow — so
     * every path that would reach it is guarded by {@link isTag}.
     */
    private data: Column;

    constructor(info: ComponentInfo) {
        this.info = info;
        this.slotOf = new SparseIndex();
        this.owners = [];
        this.data = new Column(info);
    }

    /** How many entities hold this component. */
    get count(): usize {
        return this.owners.length;
    }

    /** Whether this id carries data or is merely present. */
    get isTag(): boolean {
        return isTag(this.info);
    }

    /** Roughly what the pool occupies: the pages, the handles, and the rows. */
    get bytes(): usize {
        return this.slotOf.bytes + this.owners.length * (8 + this.info.size);
    }

    /**
     * The dense row `handle` occupies, or {@link noSlot}.
     *
     * Two array reads and a handle comparison. The comparison is what refuses a
     * stale handle; see the note at the top of this file.
     */
    rowOf(handle: u64): u32 {
        const slot = this.slotOf.get(indexOf(handle));
        if (slot === noSlot()) {
            return noSlot();
        }
        if (this.owners[cast<usize>(slot)] !== handle) {
            return noSlot();
        }
        return slot;
    }

    has(handle: u64): boolean {
        return this.rowOf(handle) !== noSlot();
    }

    /** Which entity holds dense row `row`. */
    ownerAt(row: usize): u64 {
        if (row >= this.owners.length) {
            return noneId();
        }
        return this.owners[row];
    }

    /** The data at dense row `row`, to be `reify<T>()`d by a caller who knows `T`. */
    at(row: usize): Pointer<unknown> {
        return this.data.at(row);
    }

    /**
     * Give `handle` this component, defaulted, and say which row it landed in.
     *
     * Idempotent: an entity that already holds it keeps its value and its row.
     * `World.add` behaves the same way, and `World.set` depends on it — a `set`
     * is an add followed by a write.
     */
    add(handle: u64): u32 {
        const existing = this.rowOf(handle);
        if (existing !== noSlot()) {
            return existing;
        }

        const row = cast<u32>(this.owners.length);
        this.owners.push(handle);
        if (!this.isTag) {
            this.data.pushDefault();
        }
        this.slotOf.set(indexOf(handle), row);
        return row;
    }

    /**
     * Take the component away from `handle`. `false` if it did not have it.
     *
     * A swap-remove, so the rows reorder: a pointer from {@link at} is
     * invalidated by *any* removal from this pool, not only one naming the same
     * entity. Iterating a `std::vector` costs the same thing.
     *
     * The order of the last three statements matters when the removed row is the
     * last one. `moved` is then the removed entity itself, so repointing its slot
     * before clearing it would leave a live slot naming a row that is gone.
     */
    remove(handle: u64): boolean {
        const row = this.rowOf(handle);
        if (row === noSlot()) {
            return false;
        }

        const last = this.owners.length - 1;
        const moved = this.owners[last];

        if (!this.isTag) {
            this.data.swapRemove(cast<usize>(row));
        }
        this.owners[cast<usize>(row)] = moved;
        this.owners.pop();

        if (cast<usize>(row) !== last) {
            this.slotOf.set(indexOf(moved), row);
        }
        this.slotOf.clear(indexOf(handle));
        return true;
    }

    /**
     * Call `body` with every holder and its row, in dense order.
     *
     * The one walk this layout is good at: straight down the dense arrays, with
     * no table to find and nothing to skip. It cannot join two components. For
     * that, ask for the second one by handle inside the body, or use a `Query`.
     */
    each(body: LocalFn<(handle: u64, row: usize) => void>): void {
        for (let row: usize = 0; row < this.owners.length; row++) {
            body(this.owners[row], row);
        }
    }

    /**
     * Drop every row and give the storage back.
     *
     * There are no destructors here, so this is the only thing that frees, and
     * the world calls it on every pool before going away. The sparse pages are
     * not its problem: `SparseIndex` is a value and releases its own arrays.
     */
    release(): void {
        this.data.release();
        while (this.owners.length !== 0) {
            this.owners.pop();
        }
    }
}
