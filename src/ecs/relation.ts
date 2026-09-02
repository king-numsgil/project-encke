// Finding every table that names an entity as a relationship target.
//
// This index exists for one operation: deleting an entity. A pair packs two
// entity references into 64 bits, which leaves no room for either one's
// generation — see the layout note in `id.ts` — so `(ChildOf, ship)` records the
// ship *by index*, and when the ship dies there is nothing in the pair to notice.
// A stale handle can be detected; a stale pair cannot.
//
// So it has to be found and dealt with, and finding it by scanning every table
// would make a delete cost the size of the world. This is the map that makes it
// cost the size of the answer.
//
// ## Only targets, and only tables
//
// There is no relation index and no exact-id index here, because nothing needs
// one: query matching walks the table list incrementally and caches, which is
// cheaper than a lookup for the access pattern queries actually have. Adding
// indexes without a consumer is how a data structure ends up with three ways to
// answer a question and two of them wrong.
//
// The unit is a **table**, not an entity. Every entity in a table holds the same
// ids, so "which tables hold a pair to this target" is the whole answer and the
// entities fall out of walking them — the same economy the archetype layout buys
// everywhere else.

import { HashMap } from "std/collection";

export class TargetIndex {
    /** Target entity index to its slot in {@link lists}. */
    private slotOf: HashMap<u32, u32>;

    /**
     * Table indices, one list per target.
     *
     * A `u32[][]` addressed through the map rather than a `HashMap<u32, u32[]>`,
     * because reading a value out of a map **copies** it — there is no way to
     * borrow out of a container yet — so appending to a list held as a map value
     * would allocate and copy the whole list on every registration. Indexing an
     * array gives a place rather than a copy, so `lists[slot].push(…)` appends
     * where it should.
     */
    private lists: u32[][];

    constructor() {
        this.slotOf = new HashMap<u32, u32>();
        this.lists = [];
    }

    /** How many targets have ever been registered. */
    get size(): usize {
        return this.lists.length;
    }

    /**
     * Record that `table` holds a pair whose target is `target`.
     *
     * Called once per pair id per table, when the table is built. A table's
     * signature never changes, so nothing ever has to be removed from a list —
     * which is why these are plain arrays with no holes to manage.
     */
    add(target: u32, table: u32): void {
        const at = this.slotOf.indexOf(target);
        if (at >= 0) {
            const slot = cast<usize>(this.slotOf.valueAt(cast<usize>(at)));
            // The same table can register a target twice — an entity holding
            // both `(ChildOf, x)` and `(Orbits, x)` is one table with two pairs
            // to one target — and a duplicate would make the cleanup walk it
            // twice. Cheap to check: these lists are short.
            for (let i: usize = 0; i < this.lists[slot].length; i++) {
                if (this.lists[slot][i] === table) {
                    return;
                }
            }
            this.lists[slot].push(table);
            return;
        }

        const slot = this.lists.length;
        const fresh: u32[] = [];
        this.lists.push(fresh);
        this.lists[slot].push(table);
        this.slotOf.set(target, cast<u32>(slot));
    }

    /**
     * Append every table holding a pair to `target` onto `out`.
     *
     * A copy into the caller's array rather than a borrow, and that is the point
     * rather than a limitation: the caller is about to delete entities, which
     * moves rows between tables and would renumber whatever it was walking. A
     * snapshot is what it needs, and taking it here is one place rather than at
     * every call site.
     */
    collectTables(target: u32, out: Reference<u32[]>): void {
        const at = this.slotOf.indexOf(target);
        if (at < 0) {
            return;
        }

        const slot = cast<usize>(this.slotOf.valueAt(cast<usize>(at)));
        out.reserve(out.length + this.lists[slot].length);
        for (let i: usize = 0; i < this.lists[slot].length; i++) {
            out.push(this.lists[slot][i]);
        }
    }

    /** How many tables name `target`. For diagnostics and for tests. */
    tableCountFor(target: u32): usize {
        const at = this.slotOf.indexOf(target);
        if (at < 0) {
            return 0;
        }
        return this.lists[cast<usize>(this.slotOf.valueAt(cast<usize>(at)))].length;
    }
}
