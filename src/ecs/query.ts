// Finding the entities that match a set of terms, and walking their columns.
//
// A query is a list of terms — `has(Position)`, `not(Frozen)`, `maybe(Health)` —
// resolved against archetypes rather than against entities. That is the whole
// economy of the archetype layout: every entity in a table has exactly the same
// ids, so a table either matches or it does not, and matching one table admits
// ten thousand entities at the cost of one signature walk.
//
// ## Matching is incremental, and it has to be
//
// Tables are only ever **appended** — nothing here destroys one, and two entities
// with the same ids always land in the same table however they got there. So a
// query remembers how many tables it has already considered and each rematch
// looks only at the new ones. Two things fall out, both of which the tests aim
// at: a query costs nothing on a world whose shape has settled, and a query
// **built before the archetypes it matches** picks them up the moment they exist.
//
// ## A sparse term is answered per entity, and cuts the table into runs
//
// A component registered with `World.sparseComponent` is deliberately not in any
// signature — see `pool.ts` — so "does this table hold it" has no answer.
// Matching ignores sparse terms and filters a row at a time instead.
//
// The body does not have to know. `each` walks the rows of a matching table,
// tests each one, and calls the body once per run of consecutive rows that pass,
// with every column base offset to the start of the run. The loop below is the
// same code whether term 1 is dense or sparse:
//
//     query.each(world, (it) => {
//         const p = it.column<Position>(0);
//         if (p === null) { return; }
//         for (let i: usize = 0; i < it.count; i++) { p[i].x += 1.0; }
//     });
//
// A query with no sparse terms gets one run per table and costs what it always
// did. So does a sparse term that every entity passes. A sparse term that only
// every third entity passes gets a body call per entity, which is what "slower
// to loop on" amounts to in practice.
//
// Reading a sparse component's data is `it.sparse<T>(term, row)`, one pool
// lookup per entity: the pool's rows are in its own insertion order, so no run
// of them lines up with a run of table rows.
//
// ## Relationships are not terms at all
//
// A relation lives outside both the archetypes and the pools, so no term reaches
// one. "Everything parented to *this* ship" is `world.related(childOf, ship,
// out)`, an index lookup costing the number of parts. Making it a query term
// would mean putting the target back in the signature, which is a table per
// ship — measured at 22 times slower to iterate at 2,000 ships, which is why
// that design is gone.

import { type Archetype } from "./archetype.ts";
import { noneId } from "./id.ts";
import { type SparsePool } from "./pool.ts";
import { noSlot } from "./sparse.ts";
import { type World } from "./world.ts";

/** What a term demands of a table. */
export enum TermKind {
    /** The table must hold a matching id. */
    With = 0,
    /** The table must hold no matching id. */
    Without = 1,
    /** No demand at all; the term is here so the body can read the column when it exists. */
    Optional = 2,
}

/** One clause of a query. An id and what to do about it. */
export interface Term {
    id: u64;
    kind: TermKind;
}

/** Require the id. */
export function has(id: u64): Term {
    return {id: id, kind: TermKind.With};
}

/** Exclude anything holding it. */
export function not(id: u64): Term {
    return {id: id, kind: TermKind.Without};
}

/**
 * Read it where it is there.
 *
 * The term still takes a slot, so `it.column<T>(2)` means the third term whether
 * or not this table has it — the alternative is a body that has to know how many
 * of the terms before it matched.
 */
export function maybe(id: u64): Term {
    return {id: id, kind: TermKind.Optional};
}

/**
 * Where a query's terms landed in one **run** of rows of one table.
 *
 * A run rather than a whole table, because a sparse term can cut a table into
 * several; see the note at the top of this file. A query with no sparse terms
 * gets one run per table, covering the whole table.
 *
 * Reused across runs rather than built per run. `bind` empties two arrays and
 * refills them, which keeps their capacity, so nothing is allocated after the
 * first table.
 */
export class Iter {
    /** How many entities are in this run. The loop bound for every column. */
    count: usize;

    private table: Pointer<Archetype> | null;

    /** The first row of the run within the table. Zero unless a sparse term cut it. */
    private start: usize;

    /** Column index per term, or -1 for a tag, a sparse id, an absent optional, or a `not`. */
    private columns: i32[];

    /** The concrete id each term resolved to, or `noneId`. */
    private ids: u64[];

    /**
     * Index into {@link pools} per term, or -1 where the term is not sparse.
     *
     * Two arrays rather than one array of nullable pointers, so a query with no
     * sparse terms holds a short run of -1 and no pointers at all.
     */
    private termPool: i32[];

    /** The pools behind the sparse terms, in the order the terms named them. */
    private pools: Pointer<SparsePool>[];

    constructor() {
        this.count = 0;
        this.table = null;
        this.start = 0;
        this.columns = [];
        this.ids = [];
        this.termPool = [];
        this.pools = [];
    }

    /**
     * The base of the column for term `term`, or null.
     *
     * Null for a term this table does not hold, for a tag, which has no data to
     * point at, and for a sparse term, whose data is not in this table at all —
     * use {@link sparse} for that. A `has` term on a dense component with a size
     * is never null, so the check costs one branch per run and nothing per
     * entity.
     *
     * The pointer is the base of **this run**, so `p[0]` is the first entity the
     * body was handed, not the first entity of the table.
     *
     * **The pointer is good until the next structural change** and no longer.
     * Adding a component to anything in the same table can reallocate this
     * column, and adding one to a row inside the run moves that row out of the
     * table.
     */
    column<T>(term: usize): Pointer<T> | null {
        const table = this.table;
        if (table === null || term >= this.columns.length) {
            return null;
        }
        const at = this.columns[term];
        if (at < 0) {
            return null;
        }
        return table.columns[cast<usize>(at)].at(this.start).reify<T>();
    }

    /** The entity at `row`, numbered from the start of this run. */
    entity(row: usize): u64 {
        const table = this.table;
        if (table === null) {
            return noneId();
        }
        return table.entities[this.start + row];
    }

    /**
     * A pointer to the sparse data for term `term` at `row`, or null.
     *
     * One pool lookup per call: two array reads and a handle comparison, around
     * 9 ns, landing wherever the entity happened to be added rather than next to
     * the last one. This is what a sparse component costs to iterate, and it
     * cannot be turned into a contiguous walk — the pool's rows are in its own
     * insertion order and nothing keeps them in step with a table's.
     *
     * Null for a term that is not sparse, for a sparse tag, and for an optional
     * sparse term this entity does not hold. Never null for a sparse `has` term,
     * since {@link Query.each} only handed the body rows that passed it.
     */
    sparse<T>(term: usize, row: usize): Pointer<T> | null {
        const pool = this.poolFor(term);
        if (pool === null || pool.isTag) {
            return null;
        }
        const at = pool.rowOf(this.entity(row));
        if (at === noSlot()) {
            return null;
        }
        return pool.at(cast<usize>(at)).reify<T>();
    }

    /**
     * Whether the entity at `row` holds sparse term `term`.
     *
     * For optional sparse terms, and for sparse tags, which have no data for
     * {@link sparse} to point at and so are only ever a yes or a no.
     */
    hasSparse(term: usize, row: usize): boolean {
        const pool = this.poolFor(term);
        return pool !== null && pool.has(this.entity(row));
    }

    /** Whether term `term` names a sparse component. */
    isSparseTerm(term: usize): boolean {
        return term < this.termPool.length && this.termPool[term] >= 0;
    }

    /**
     * The concrete id term `term` matched, or {@link noneId}.
     *
     * Always `noneId` for a sparse term: nothing about it is in the signature,
     * so there is no id there to have matched.
     */
    idAt(term: usize): u64 {
        if (term >= this.ids.length) {
            return noneId();
        }
        return this.ids[term];
    }

    /**
     * Whether this table holds term `term` at all. For optional dense terms.
     *
     * Always `false` for a sparse term. Holding one is a property of an entity
     * rather than of a table, so ask {@link hasSparse} instead.
     */
    holds(term: usize): boolean {
        return term < this.ids.length && this.ids[term] !== noneId();
    }

    /** Which table is being walked. For a body that wants to look further. */
    archetype(): Pointer<Archetype> | null {
        return this.table;
    }

    /**
     * Find each term's pool, once.
     *
     * Called by {@link Query.refresh} the first time it sees a world. An id has
     * to be registered before a term can name it, so the answer cannot change
     * later and there is no need to look again.
     */
    resolvePools(world: Reference<World>, terms: Reference<Term[]>): void {
        while (this.termPool.length !== 0) {
            this.termPool.pop();
        }
        while (this.pools.length !== 0) {
            this.pools.pop();
        }

        for (let i: usize = 0; i < terms.length; i++) {
            const slot = world.poolSlotOf(terms[i].id);
            if (slot === noSlot()) {
                this.termPool.push(-1);
                continue;
            }
            this.termPool.push(cast<i32>(this.pools.length));
            this.pools.push(world.poolAt(slot));
        }
    }

    /** Whether `handle` holds sparse term `term`. {@link Query} filters with this. */
    poolHolds(term: usize, handle: u64): boolean {
        const pool = this.poolFor(term);
        return pool !== null && pool.has(handle);
    }

    /**
     * Point at a table, resolve every term against it, and open a run over the
     * whole thing. Internal to {@link Query}.
     */
    bind(table: Pointer<Archetype>, terms: Reference<Term[]>): void {
        this.table = table;
        this.start = 0;
        this.count = table.count;

        while (this.columns.length !== 0) {
            this.columns.pop();
        }
        while (this.ids.length !== 0) {
            this.ids.pop();
        }

        for (let i: usize = 0; i < terms.length; i++) {
            const at = resolve(table, terms[i].id);
            if (at < 0) {
                this.columns.push(-1);
                this.ids.push(noneId());
                continue;
            }
            this.columns.push(table.columnOf[cast<usize>(at)]);
            this.ids.push(table.signature[cast<usize>(at)]);
        }
    }

    /** Narrow the run to `count` rows from `start`. Internal to {@link Query}. */
    window(start: usize, count: usize): void {
        this.start = start;
        this.count = count;
    }

    private poolFor(term: usize): Pointer<SparsePool> | null {
        if (term >= this.termPool.length) {
            return null;
        }
        const slot = this.termPool[term];
        if (slot < 0) {
            return null;
        }
        return this.pools[cast<usize>(slot)];
    }
}

export class Query {
    private terms: Term[];

    /** Table indices that match, in the order the tables were created. */
    private matched: u32[];

    /**
     * How many tables have been considered.
     *
     * The incremental half. Tables are append-only, so everything below this is
     * settled forever and a rematch is a walk over `[cursor, tableCount)` —
     * usually empty.
     */
    private cursor: usize;

    /**
     * The run handed to the body, owned by the query rather than made per
     * traversal.
     *
     * It holds each term's resolved pool, worked out once; rebuilding that per
     * `each` would put a sparse lookup per term in front of every traversal. The
     * catch is that **`each` is not re-entrant on the same query** — a body that
     * called `each` on the query it is already inside would rebind the run
     * underneath itself. Nesting two *different* queries is fine.
     */
    private it: Iter;

    /**
     * Which terms are sparse and demand something: the ones filtered per row.
     *
     * Empty for any query naming only dense ids, and `each` branches on that to
     * keep the usual case at one body call per table.
     */
    private filters: usize[];

    /** Whether {@link Iter.resolvePools} has run. See {@link refresh}. */
    private resolved: boolean;

    constructor(terms: Term[]) {
        this.terms = terms;
        this.matched = [];
        this.cursor = 0;
        this.it = new Iter();
        this.filters = [];
        this.resolved = false;
    }

    /** How many terms. `it.column<T>(n)` is indexed by the same numbering. */
    get termCount(): usize {
        return this.terms.length;
    }

    /** How many tables match. Grows as the world grows shapes; never shrinks. */
    get tableCount(): usize {
        return this.matched.length;
    }

    /**
     * How many terms name a sparse component and are filtered per entity.
     *
     * **Zero until the first {@link refresh}**: only the world knows which ids
     * are sparse, and a query is built without one. Refresh or traverse before
     * reading this as a diagnostic. Nothing inside this class reads it before
     * resolving.
     */
    get filterCount(): usize {
        return this.filters.length;
    }

    /**
     * Consider any tables created since the last look.
     *
     * Called by {@link each} and {@link count}, so nothing has to remember to.
     * Public because a caller measuring one of those wants to be able to take
     * the matching out of the measurement.
     */
    refresh(world: Reference<World>): void {
        if (!this.resolved) {
            this.it.resolvePools(world, this.terms);
            for (let i: usize = 0; i < this.terms.length; i++) {
                if (this.it.isSparseTerm(i) && this.terms[i].kind !== TermKind.Optional) {
                    this.filters.push(i);
                }
            }
            this.resolved = true;
        }

        while (this.cursor < world.tableCount) {
            const table = world.tableAt(this.cursor);
            if (this.admits(table)) {
                this.matched.push(cast<u32>(this.cursor));
            }
            this.cursor += 1;
        }
    }

    /**
     * How many entities match.
     *
     * A sum of table counts when nothing is filtered. With a sparse term it has
     * to walk every row of every matching table, since that term's answer is per
     * entity and there is no count to add up.
     */
    count(world: Reference<World>): usize {
        this.refresh(world);

        let total: usize = 0;
        for (let i: usize = 0; i < this.matched.length; i++) {
            const table = world.tableAt(cast<usize>(this.matched[i]));
            if (this.filters.length === 0) {
                total += table.count;
                continue;
            }
            for (let row: usize = 0; row < table.count; row++) {
                if (this.passes(table, row)) {
                    total += 1;
                }
            }
        }
        return total;
    }

    /**
     * Call `body` once per run of matching entities.
     *
     * Per run rather than per entity, on purpose: the body gets column bases and
     * a count, so its inner loop is a straight walk with no call overhead and no
     * bounds arithmetic per element. That loop is the reason for the archetype
     * layout, and an API handing out one entity at a time would throw it away at
     * the last step.
     *
     * A query naming only dense ids gets one run per table, covering the whole
     * table. A sparse `has` or `not` term cuts a table into the runs of
     * consecutive rows that pass it; see the note at the top of this file.
     *
     * **Do not add or remove components from inside `body`.** Doing so
     * invalidates every column pointer the body is holding, and moving the
     * current entity out of the table renumbers the rows underneath the loop —
     * the same rule that applies to iterating a `std::vector`. Sparse ids are no
     * safer: adding or removing one swap-moves the pool's rows, which
     * invalidates anything `it.sparse` returned and changes the answer to a
     * filter this walk has already used. Collect the entities and act on them
     * afterwards.
     */
    each(world: Reference<World>, body: LocalFn<(it: Reference<Iter>) => void>): void {
        this.refresh(world);

        for (let i: usize = 0; i < this.matched.length; i++) {
            const table = world.tableAt(cast<usize>(this.matched[i]));
            // An empty table still matches and is kept, since it will have rows
            // again, but there is nothing to hand the body.
            if (table.count === 0) {
                continue;
            }

            this.it.bind(table, this.terms);

            if (this.filters.length === 0) {
                body(this.it);
                continue;
            }

            // Every row is tested once. The loop either steps over a failing row
            // or opens a run and extends it to the next failure.
            const rows = table.count;
            let row: usize = 0;
            while (row < rows) {
                if (!this.passes(table, row)) {
                    row += 1;
                    continue;
                }
                const start = row;
                row += 1;
                while (row < rows && this.passes(table, row)) {
                    row += 1;
                }
                this.it.window(start, row - start);
                body(this.it);
            }
        }
    }

    /** Whether `table` satisfies every **dense** term. Sparse ones are per entity. */
    private admits(table: Pointer<Archetype>): boolean {
        for (let i: usize = 0; i < this.terms.length; i++) {
            const kind = this.terms[i].kind;
            if (kind === TermKind.Optional || this.it.isSparseTerm(i)) {
                continue;
            }

            const found = resolve(table, this.terms[i].id) >= 0;
            if (kind === TermKind.With && !found) {
                return false;
            }
            if (kind === TermKind.Without && found) {
                return false;
            }
        }
        return true;
    }

    /** Whether the entity at `row` of `table` satisfies every sparse term. */
    private passes(table: Pointer<Archetype>, row: usize): boolean {
        const handle = table.entities[row];
        for (let f: usize = 0; f < this.filters.length; f++) {
            const term = this.filters[f];
            const held = this.it.poolHolds(term, handle);
            if (this.terms[term].kind === TermKind.With && !held) {
                return false;
            }
            if (this.terms[term].kind === TermKind.Without && held) {
                return false;
            }
        }
        return true;
    }
}

/**
 * Where `id` sits in `table`'s signature, or -1. A binary search.
 *
 * There is nothing else to it any more. An earlier design had relationships in
 * the signature as `(ChildOf, ship)` ids, so a term could carry a wildcard and
 * this had to scan for a match; with relations out of the archetypes entirely,
 * every term that reaches here is one exact id.
 */
function resolve(table: Pointer<Archetype>, id: u64): isize {
    return table.indexOfId(id);
}
