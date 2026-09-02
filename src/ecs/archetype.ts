// A table: every entity that holds exactly the same set of ids.
//
// This is the archetype in "archetype ECS", and the reason for it is one loop.
// An entity's components are spread across the columns of its table at the same
// row, so a query that wants `Position` and `Velocity` finds the tables holding
// both and walks two contiguous arrays — no per-entity lookup, no branch, no
// pointer chasing. The price is paid when an entity's *shape* changes: adding a
// component moves it to a different table, which copies its whole row.
//
// That trade is the right way round for a simulation, where shape changes are
// rare and iteration happens every frame for every entity.
//
// ## The signature is sorted, and that is load-bearing
//
// Two entities with the same ids in a different order are the same archetype, so
// the signature has to have a canonical form, and ascending is it. Two things
// fall out and both get used:
//
//   * membership is a binary search rather than a scan;
//   * **every pair sorts after every plain id**, because a pair sets bit 63 and
//     the comparison is unsigned. So "does this table hold any relationship"
//     is a look at one end of the array, and the pairs are one contiguous run
//     that `relation.ts` can walk without touching the components.

import { HashMap } from "std/collection";
import { Column } from "./column.ts";
import { type ComponentInfo, isTag } from "./component.ts";
import { noneId } from "./id.ts";

/** No archetype. Also the `hashNext` of the last table in a chain. */
export function noTable(): i32 {
    return -1;
}

export class Archetype {
    /** Its own index in the world's table array. */
    id: u32;

    /** The ids every entity here holds, ascending. Never changed after building. */
    signature: u64[];

    /** One column per signature entry that carries data, in signature order. */
    columns: Column[];

    /**
     * Signature index to column index, or -1 where the id is a tag.
     *
     * Parallel to {@link signature} rather than to {@link columns}, because the
     * question is always "I have an id, where is its data" and going the other
     * way is not asked.
     */
    columnOf: i32[];

    /** Row to entity handle. The inverse of the entity index's row field. */
    entities: u64[];

    /**
     * Where adding one id lands, cached.
     *
     * The archetype *graph*. Without it every add would hash a signature and
     * search; with it the second entity to take the same route follows a
     * pointer. This is the hot path in any world that spawns things.
     */
    addEdge: HashMap<u64, u32>;

    /** Where removing one id lands. */
    removeEdge: HashMap<u64, u32>;

    /**
     * The next table whose signature hashes the same, or -1.
     *
     * A chain rather than a `HashMap<u64, u32[]>`, because reading an array out
     * of a map copies it — there is no way to borrow out of a container yet —
     * and a collision list that allocates on every lookup would be worse than
     * the linear scan it replaced.
     */
    hashNext: i32;

    constructor(id: u32) {
        this.id = id;
        this.signature = [];
        this.columns = [];
        this.columnOf = [];
        this.entities = [];
        this.addEdge = new HashMap<u64, u32>();
        this.removeEdge = new HashMap<u64, u32>();
        this.hashNext = noTable();
    }

    /** How many entities are in this table. */
    get count(): usize {
        return this.entities.length;
    }

    /**
     * Append one id to the signature, with the column it needs.
     *
     * Called once per id at construction, in ascending order, by the world —
     * which is the only thing that knows how to turn an id into a
     * {@link ComponentInfo}. A tag adds a `-1` and no column.
     *
     * By value rather than by reference, because the column keeps a copy either
     * way and a `Reference<ComponentInfo>` does not convert to one implicitly.
     * It is five machine words.
     */
    push(id: u64, info: ComponentInfo): void {
        this.signature.push(id);
        if (isTag(info)) {
            this.columnOf.push(-1);
            return;
        }
        this.columnOf.push(cast<i32>(this.columns.length));
        this.columns.push(new Column(info));
    }

    /**
     * Where `id` sits in the signature, or -1.
     *
     * Binary search. A signature is rarely more than a dozen ids, so this is
     * close to a scan in practice — but it is called once per id per archetype
     * per query rematch, and the version that scanned showed up.
     */
    indexOfId(id: u64): isize {
        let low: usize = 0;
        let high = this.signature.length;
        while (low < high) {
            const middle = low + (high - low) / 2;
            const here = this.signature[middle];
            if (here === id) {
                return cast<isize>(middle);
            }
            if (here < id) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        return -1;
    }

    has(id: u64): boolean {
        return this.indexOfId(id) >= 0;
    }

    /**
     * The column holding `id`'s data, or -1.
     *
     * -1 means either "not here" or "here but a tag", and the two are
     * deliberately not distinguished: every caller either already knows the id
     * is present or has no data to read either way.
     */
    columnFor(id: u64): i32 {
        const at = this.indexOfId(id);
        if (at < 0) {
            return -1;
        }
        return this.columnOf[cast<usize>(at)];
    }

    /** Append a row for `entity`, defaulted in every column. */
    addRow(entity: u64): usize {
        const row = this.entities.length;
        this.entities.push(entity);
        for (let i: usize = 0; i < this.columns.length; i++) {
            this.columns[i].pushDefault();
        }
        return row;
    }

    /**
     * Take row `row` out, and say which entity was moved into it.
     *
     * The last row fills the hole, so this **reorders**, and the returned handle
     * is the entity whose record now says the wrong row. The caller must repoint
     * it. Returning it rather than fixing it here is the split that keeps this
     * file from needing to know what an entity index is — and the caller
     * forgetting is the classic archetype bug, which is why it comes back as a
     * value rather than being left to be looked up.
     *
     * {@link noneId} when the removed row was the last one and nothing moved.
     */
    removeRow(row: usize): u64 {
        const last = this.entities.length - 1;

        for (let i: usize = 0; i < this.columns.length; i++) {
            this.columns[i].swapRemove(row);
        }

        let moved = noneId();
        if (row !== last) {
            moved = this.entities[last];
            this.entities[row] = moved;
        }
        this.entities.pop();
        return moved;
    }

    /**
     * Copy the data at `row` of `source` into `row` of this table, for every id
     * the two signatures share.
     *
     * A merge walk over two sorted arrays, so it is linear in the larger
     * signature rather than quadratic. Ids present in only one side are exactly
     * the ones being added or removed, and are skipped — the added one keeps the
     * default `addRow` put there.
     */
    copySharedFrom(source: Pointer<Archetype>, sourceRow: usize, row: usize): void {
        let here: usize = 0;
        let there: usize = 0;

        while (here < this.signature.length && there < source.signature.length) {
            const mine = this.signature[here];
            const theirs = source.signature[there];

            if (mine < theirs) {
                here += 1;
                continue;
            }
            if (theirs < mine) {
                there += 1;
                continue;
            }

            const to = this.columnOf[here];
            const from = source.columnOf[there];
            if (to >= 0 && from >= 0) {
                this.columns[cast<usize>(to)].info.copy(
                    this.columns[cast<usize>(to)].at(row),
                    source.columns[cast<usize>(from)].at(sourceRow),
                );
            }

            here += 1;
            there += 1;
        }
    }

    /**
     * Release every column's buffer.
     *
     * There are no destructors here, so this is the only thing that gives the
     * memory back and the world calls it on every table before going away.
     */
    release(): void {
        for (let i: usize = 0; i < this.columns.length; i++) {
            this.columns[i].release();
        }
    }
}

/**
 * A 64-bit mix over a signature.
 *
 * Hand-rolled because a `u64[]` is not a hashable key — `hashOf` covers scalars,
 * strings, structs and fixed arrays, and an owning array is none of those. This
 * is FNV-1a's structure over whole 64-bit words with a final avalanche, which is
 * ample for the few thousand distinct signatures a world has and costs a
 * multiply per id.
 */
export function hashSignature(signature: Reference<u64[]>): u64 {
    // Written as two halves because a literal past 2^53 is not exactly
    // representable as a `number`, which is what tsc parses one into — the
    // constant would arrive here already rounded.
    let hash = wide(0xcbf29ce4, 0x84222325);
    for (let i: usize = 0; i < signature.length; i++) {
        hash ^= signature[i];
        hash *= cast<u64>(0x100000001b3);
    }
    // Without this the low bits barely move for signatures differing only in
    // their last id, and the map masks off the low bits to pick a slot.
    hash ^= hash >> 33;
    hash *= wide(0xff51afd7, 0xed558ccd);
    hash ^= hash >> 33;
    return hash;
}

/** One `u64` from its two halves. See {@link hashSignature}. */
function wide(high: u32, low: u32): u64 {
    return (cast<u64>(high) << 32) | cast<u64>(low);
}

/** Whether two signatures hold the same ids. Both are sorted, so this is a walk. */
export function signaturesEqual(a: Reference<u64[]>, b: Reference<u64[]>): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i: usize = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

/** `base` with `id` inserted, keeping it sorted. `base` unchanged. */
export function signatureWith(base: Reference<u64[]>, id: u64): u64[] {
    const out: u64[] = [];
    out.reserve(base.length + 1);

    let inserted = false;
    for (let i: usize = 0; i < base.length; i++) {
        if (!inserted && id < base[i]) {
            out.push(id);
            inserted = true;
        }
        out.push(base[i]);
    }
    if (!inserted) {
        out.push(id);
    }
    return out;
}

/** `base` without `id`. `base` unchanged. */
export function signatureWithout(base: Reference<u64[]>, id: u64): u64[] {
    const out: u64[] = [];
    out.reserve(base.length);
    for (let i: usize = 0; i < base.length; i++) {
        if (base[i] !== id) {
            out.push(base[i]);
        }
    }
    return out;
}
