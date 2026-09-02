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
// ## What a wildcard term resolves to
//
// `has(pair(ChildOf, wildcard))` matches a table holding any `(ChildOf, x)`, and
// the iterator resolves the term to the **first** such id in signature order.
// An entity holding two pairs of one relation is therefore visited once, for the
// lower-sorted target, and `Iter.idAt` is how the body learns which. That is a
// real limitation rather than a subtlety: flecs returns a table once per matching
// id and this returns it once. It is the right first cut — `ChildOf` is exclusive,
// so the common case has exactly one match — and the place to change it is here,
// by yielding per resolved id instead of per table.

import { type Archetype } from "./archetype.ts";
import { hasWildcard, matches, noneId } from "./id.ts";
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

/** One clause of a query. An id, possibly with wildcards, and what to do about it. */
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
 * Where a query's terms landed in one table.
 *
 * Reused across tables rather than built per table: `bind` empties two arrays
 * and refills them, which keeps their capacity and allocates nothing after the
 * first table. A query over fifty tables that built one of these each time would
 * allocate a hundred times per traversal.
 */
export class Iter {
    /** How many entities are in this table. The loop bound for every column. */
    count: usize;

    private table: Pointer<Archetype> | null;

    /** Column index per term, or -1 for a tag, an absent optional, or a `not`. */
    private columns: i32[];

    /** The concrete id each term resolved to, or `noneId`. */
    private ids: u64[];

    constructor() {
        this.count = 0;
        this.table = null;
        this.columns = [];
        this.ids = [];
    }

    /**
     * The base of the column for term `term`, or null.
     *
     * Null for a term this table does not hold, and for a tag — which has no
     * data to point at. A `has` term on a component with a size is never null,
     * so the check costs one branch per table and nothing per entity:
     *
     *     query.each(world, (it) => {
     *         const p = it.column<Position>(0);
     *         if (p === null) { return; }
     *         for (let i: usize = 0; i < it.count; i++) { p[i].x += 1.0; }
     *     });
     *
     * **The pointer is good until the next structural change** and no longer.
     * Adding a component to anything inside the body can reallocate this column
     * or move the row out of the table entirely.
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
        return table.columns[cast<usize>(at)].base().reify<T>();
    }

    /** The entity at `row`. */
    entity(row: usize): u64 {
        const table = this.table;
        if (table === null) {
            return noneId();
        }
        return table.entities[row];
    }

    /**
     * The concrete id term `term` matched.
     *
     * The answer to "which target" after a `(ChildOf, *)` term, which is
     * otherwise unrecoverable — the body knows the entity has *a* parent and has
     * no way to ask which one.
     */
    idAt(term: usize): u64 {
        if (term >= this.ids.length) {
            return noneId();
        }
        return this.ids[term];
    }

    /** Whether this table holds term `term` at all. For optional terms. */
    holds(term: usize): boolean {
        return term < this.ids.length && this.ids[term] !== noneId();
    }

    /** Which table is being walked. For a body that wants to look further. */
    archetype(): Pointer<Archetype> | null {
        return this.table;
    }

    /** Point at a table and resolve every term against it. Internal to {@link Query}. */
    bind(table: Pointer<Archetype>, terms: Reference<Term[]>): void {
        this.table = table;
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

    constructor(terms: Term[]) {
        this.terms = terms;
        this.matched = [];
        this.cursor = 0;
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
     * Consider any tables created since the last look.
     *
     * Called by {@link each} and {@link count}, so nothing has to remember to.
     * Public because a caller measuring one of those wants to be able to take
     * the matching out of the measurement.
     */
    refresh(world: Reference<World>): void {
        while (this.cursor < world.tableCount) {
            const table = world.tableAt(this.cursor);
            if (this.admits(table)) {
                this.matched.push(cast<u32>(this.cursor));
            }
            this.cursor += 1;
        }
    }

    /** How many entities match. */
    count(world: Reference<World>): usize {
        this.refresh(world);

        let total: usize = 0;
        for (let i: usize = 0; i < this.matched.length; i++) {
            total += world.tableAt(cast<usize>(this.matched[i])).count;
        }
        return total;
    }

    /**
     * Call `body` once per matching table that has anything in it.
     *
     * Per table rather than per entity, deliberately: the body gets column bases
     * and a count, so its inner loop is a straight walk with no call overhead
     * and no bounds arithmetic per element. That loop is the entire reason for
     * the archetype layout, and an API that handed out one entity at a time
     * would have thrown it away at the last step.
     *
     * **Do not add or remove components from inside `body`.** Every column
     * pointer it is holding is invalidated by one, and moving the current
     * entity out of the table renumbers the rows underneath the loop — the same
     * bargain iterating a `std::vector` strikes. Collect the entities and act on
     * them afterwards.
     */
    each(world: Reference<World>, body: LocalFn<(it: Reference<Iter>) => void>): void {
        this.refresh(world);

        const it = new Iter();
        for (let i: usize = 0; i < this.matched.length; i++) {
            const table = world.tableAt(cast<usize>(this.matched[i]));
            // An empty table still matches and is still kept — it will have rows
            // again — but there is nothing to hand the body.
            if (table.count === 0) {
                continue;
            }
            it.bind(table, this.terms);
            body(it);
        }
    }

    /** Whether `table` satisfies every term. */
    private admits(table: Pointer<Archetype>): boolean {
        for (let i: usize = 0; i < this.terms.length; i++) {
            const kind = this.terms[i].kind;
            if (kind === TermKind.Optional) {
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
}

/**
 * Where `pattern` matches in `table`'s signature, or -1.
 *
 * An exact id is a binary search. A pattern with a wildcard in it is a scan,
 * because the ids it matches are not contiguous in general — though every pair
 * *is* in one run at the end of the signature, since a pair sets bit 63, so a
 * wildcard pair term could start from there. Signatures are a dozen ids; that is
 * an optimisation for the day a profile asks for it.
 */
function resolve(table: Pointer<Archetype>, pattern: u64): isize {
    if (!hasWildcard(pattern)) {
        return table.indexOfId(pattern);
    }

    for (let i: usize = 0; i < table.signature.length; i++) {
        if (matches(pattern, table.signature[i])) {
            return cast<isize>(i);
        }
    }
    return -1;
}
