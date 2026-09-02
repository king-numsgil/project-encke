// One component's storage inside one archetype: a contiguous run of rows.
//
// This is the array in "structure of arrays". Every entity in an archetype has
// the same components, so each component is one column and iterating a query is
// a straight walk down however many of them the query asked for — no indirection
// per entity, no per-entity branch, and the prefetcher gets what it wants.
//
// The bytes come from `allocArray<u8>` rather than a `u8[]`, for two reasons
// that are really one: an `allocArray` pointer is **non-null** so `at` needs no
// null path, and it is a plain address so `reify<T>()` at a row is the whole
// typed-access story. A `u8[]` would have given growth for free and taken both
// of those away.
//
// **Rows move bitwise.** Growing copies the old buffer word for word into the
// new one; `swapRemove` copies the last row over the hole. That is a relocation
// rather than a copy-and-destroy, which is right for plain data and for anything
// trivially relocatable — see the rule at the top of `component.ts`.

import { type ComponentInfo } from "./component.ts";

/**
 * Rows a fresh column makes room for.
 *
 * Small, because most archetypes hold a handful of entities: a world with one
 * player, one camera and eight thousand asteroids has three archetypes and only
 * one of them is big.
 */
function initialRows(): usize {
    return 8;
}

/**
 * Where doubling stops and fixed steps begin, in bytes.
 *
 * Doubling is the right default and is what `T[]` does on its own, but it
 * allocates the new buffer beside the old one at every step — so a column
 * approaching 400 MB transiently wants 1.2 GB of it. Past a megabyte the growth
 * becomes additive, which mimalloc can often satisfy by extending the block in
 * place and which never asks for more than a megabyte of headroom.
 */
function growthChunkBytes(): usize {
    return 1048576;
}

export class Column {
    /** The type this column holds. Copied in, so the column owns its own vtable. */
    info: ComponentInfo;

    /** How many rows are live. Always equal to its archetype's entity count. */
    count: usize;

    /** How many rows fit before the next growth. */
    capacity: usize;

    private bytes: Pointer<u8>;

    /**
     * Whether {@link bytes} is a block this column owns and must free.
     *
     * **There are no destructors in this language**, so a `Column` cannot clean
     * up when its scope ends and `release` is the only thing that ever frees the
     * buffer. That makes "is there anything to free" a question the object has to
     * answer for itself, and makes `release` leave *nothing* allocated — an
     * earlier version handed back a fresh one-byte block so the pointer stayed
     * valid, which meant one leaked allocation per column ever created, and the
     * leak checker said so.
     *
     * False after a release, and the buffer is dangling then. Nothing may read
     * it, which nothing does: `count` and `capacity` are both zero, so there is
     * no row to ask for. A `reserve` revives the column and sets this again.
     */
    private owns: boolean;

    /**
     * `info.size` must not be zero — a tag has no column, and `archetype.ts` is
     * where that decision is made rather than here, because it is the thing
     * holding the signature and can skip building one at all.
     */
    constructor(info: ComponentInfo) {
        this.info = info;
        this.count = 0;
        this.capacity = 0;
        // One byte rather than a null, so `bytes` is a real address from the
        // start and `at` needs no null path. Freed by the first `reserve`.
        this.bytes = allocArray<u8>(1);
        this.owns = true;
    }

    /** Bytes per row. */
    get stride(): usize {
        return this.info.size;
    }

    /** The address of row `row`, to be `reify<T>()`d by a caller who knows `T`. */
    at(row: usize): Pointer<unknown> {
        return this.bytes.offset(cast<isize>(row * this.info.size)).erase();
    }

    /** The address of row zero, which is what a query iterates from. */
    base(): Pointer<unknown> {
        return this.bytes.erase();
    }

    /**
     * Make room for `rows` without adding any.
     *
     * Worth calling when the count is known: it turns a run of pushes that
     * reallocates a handful of times into one that never does.
     */
    reserve(rows: usize): void {
        if (rows <= this.capacity) {
            return;
        }

        const grown = allocArray<u8>(rows * this.info.size);
        const old = this.bytes;

        // Nothing to carry over from a released column, whose buffer is gone —
        // and nothing to carry over from an empty one either, so the guard costs
        // a released column nothing it was not already paying.
        if (this.owns) {
            // Word at a time rather than byte at a time. Both buffers come from
            // the same allocator and are at least pointer-aligned, so the wide
            // loads are sound, and the tail below picks up whatever the stride
            // left over.
            const live = this.count * this.info.size;
            const words = live / 8;
            const to = grown.erase().reify<usize>();
            const from = old.erase().reify<usize>();
            for (let i: usize = 0; i < words; i++) {
                to[i] = from[i];
            }
            for (let i: usize = words * 8; i < live; i++) {
                grown[i] = old[i];
            }

            old.freeArray();
        }

        this.bytes = grown;
        this.owns = true;
        this.capacity = rows;
    }

    /**
     * Append one default row and hand back its index.
     *
     * The bytes are already zero — `allocArray` zeroes and so does every growth
     * — so `init` writes over a slot that is a valid default rather than over
     * garbage, which is what makes it safe to call at all.
     */
    pushDefault(): usize {
        if (this.count === this.capacity) {
            this.grow(this.count + 1);
        }
        const row = this.count;
        this.count = row + 1;
        this.info.init(this.at(row));
        return row;
    }

    /**
     * Take row `row` out, moving the last row into the hole.
     *
     * O(1), and it **reorders**, which is why every archetype keeps an entity
     * per row and repoints whichever entity got moved. A column cannot do that
     * repointing itself — it does not know what an entity is — so the archetype
     * that owns this one is responsible for it, and the tests aim squarely at
     * that seam.
     */
    swapRemove(row: usize): void {
        const last = this.count - 1;

        // Destroy what was there. The slot holds a default afterwards, which is
        // what makes the assignment below legal.
        this.info.drop(this.at(row));

        if (row !== last) {
            this.info.copy(this.at(row), this.at(last));
            // The duplicate at the end, emptied. Nothing reads past `count`, but
            // an owning component would otherwise be released twice — once from
            // here and once when the column is torn down.
            this.info.drop(this.at(last));
        }

        this.count = last;
    }

    /**
     * Append a copy of `row` from `source`, which must hold the same type.
     *
     * The move an archetype transition is made of. Not checked, and cannot be:
     * a `ComponentInfo` is five numbers and three addresses with no identity to
     * compare. The caller matches columns by id, which is the only thing that
     * knows.
     */
    copyRowFrom(source: Reference<Column>, row: usize): usize {
        const destination = this.pushDefault();
        this.info.copy(this.at(destination), source.at(row));
        return destination;
    }

    /** Drop every row, keeping the storage. */
    clear(): void {
        for (let i: usize = 0; i < this.count; i++) {
            this.info.drop(this.at(i));
        }
        this.count = 0;
    }

    /**
     * Destroy every row and give the buffer back.
     *
     * **This is the only thing that frees, and it must be called exactly once
     * per column**, because there are no destructors here and a column's scope
     * ending does nothing at all. An archetype releases its columns before it
     * goes away; the tests release theirs; the leak checker catches whoever
     * forgets.
     *
     * A released column is empty rather than poisoned: `reserve` and
     * `pushDefault` revive it, allocating fresh. That is what makes it safe to
     * release a column and then find that something still wanted it, which is
     * otherwise the shape of a use-after-free.
     */
    release(): void {
        this.clear();
        if (this.owns) {
            this.bytes.freeArray();
            this.owns = false;
        }
        this.capacity = 0;
    }

    /** Grow to hold at least `rows`. See {@link growthChunkBytes}. */
    private grow(rows: usize): void {
        if (rows <= this.capacity) {
            return;
        }

        let capacity = this.capacity === 0 ? initialRows() : this.capacity;
        const chunk = growthChunkBytes() / this.info.size;
        while (capacity < rows) {
            if (capacity * this.info.size < growthChunkBytes()) {
                capacity *= 2;
            } else {
                capacity += chunk === 0 ? 1 : chunk;
            }
        }

        this.reserve(capacity);
    }
}
