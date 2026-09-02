// Research: what a relationship store should be made of.
//
// Three candidates for "child -> parent", measured on the same 100,000 links
// with the same lookup order:
//
//   1. `HashMap<u64, u64>` — one probe per lookup.
//   2. A **paged sparse set** — entity index into a page table, then a direct
//      array index. No hashing, no key compare.
//   3. A plain column read, which is what the archetype version does today and
//      is the floor nothing beats.
//
// And for "parent -> children", two:
//
//   4. A map to a per-parent list, which is what `relation.ts` does now.
//   5. An intrusive sibling chain threaded through the dense arrays.

import { HashMap } from "std/collection";
import type { Bench } from "../bench.ts";

/** No slot. Not a valid index; the store never holds this many links. */
function none(): u32 {
    return 0xffffffff;
}

/** 4096 entries a page, the size EnTT settled on. A page is 16 KB of `u32`. */
function pageShift(): usize {
    return 12;
}

function pageMask(): usize {
    return 4095;
}

function pageEntries(): usize {
    return 4096;
}

/**
 * Entity index to slot, in pages allocated only where something lives.
 *
 * The whole point against a hash map: a lookup is a shift, a bounds check and
 * two array reads, with no hash to compute and no key to compare.
 */
class SparseIndex {
    /** Page to its 4096 entries. An empty array means the page is not there. */
    private pages: u32[][];

    /** How many pages hold anything, for the memory number. */
    live: usize;

    constructor() {
        this.pages = [];
        this.live = 0;
    }

    get(index: u32): u32 {
        const page = cast<usize>(index) >> pageShift();
        if (page >= this.pages.length || this.pages[page].length === 0) {
            return none();
        }
        return this.pages[page][cast<usize>(index) & pageMask()];
    }

    set(index: u32, slot: u32): void {
        const page = cast<usize>(index) >> pageShift();

        while (this.pages.length <= page) {
            const absent: u32[] = [];
            this.pages.push(absent);
        }

        if (this.pages[page].length === 0) {
            this.pages[page].reserve(pageEntries());
            for (let i: usize = 0; i < pageEntries(); i++) {
                this.pages[page].push(none());
            }
            this.live += 1;
        }

        this.pages[page][cast<usize>(index) & pageMask()] = slot;
    }

    /** Bytes the pages occupy. */
    bytes(): usize {
        return this.live * pageEntries() * 4;
    }
}

/** An entity handle from an index, generation 3, so the numbers are not all zero. */
function handleOf(index: u32): u64 {
    return (cast<u64>(3) << 32) | cast<u64>(index);
}

function indexOfHandle(id: u64): u32 {
    return cast<u32>(id & cast<u64>(0xffffffff));
}

export function benchRelationStore(b: Reference<Bench>): void {
    const links: usize = 100000;

    // A deterministic scatter, so every candidate walks the same order and none
    // of them gets a sequential-access advantage the real thing would not have.
    const order: u32[] = [];
    order.reserve(links);
    let state: u32 = 0x9e3779b9;
    for (let i: usize = 0; i < links; i++) {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        order.push(cast<u32>(cast<usize>(state) % links));
    }

    // -- 1. the hash map ------------------------------------------------------

    const map = new HashMap<u64, u64>();
    map.reserve(links);
    for (let i: usize = 0; i < links; i++) {
        map.set(handleOf(cast<u32>(i)), handleOf(cast<u32>(i + 1000000)));
    }

    let sink: u64 = 0;
    b.run("relstore/HashMap<u64,u64> lookup", 20, links, (count) => {
        for (let i: usize = 0; i < count; i++) {
            sink += map.getOr(handleOf(order[i]), 0);
        }
    });

    // -- 2. the paged sparse set ------------------------------------------------

    const sparse = new SparseIndex();
    const dense: u64[] = [];
    const targets: u64[] = [];
    dense.reserve(links);
    targets.reserve(links);

    for (let i: usize = 0; i < links; i++) {
        sparse.set(cast<u32>(i), cast<u32>(dense.length));
        dense.push(handleOf(cast<u32>(i)));
        targets.push(handleOf(cast<u32>(i + 1000000)));
    }

    b.run("relstore/paged sparse set lookup", 20, links, (count) => {
        for (let i: usize = 0; i < count; i++) {
            const slot = sparse.get(order[i]);
            if (slot !== none()) {
                sink += targets[cast<usize>(slot)];
            }
        }
    });

    // -- 3. the floor: a straight array read ------------------------------------

    b.run("relstore/direct array read", 20, links, (count) => {
        for (let i: usize = 0; i < count; i++) {
            sink += targets[cast<usize>(order[i])];
        }
    });

    if (sink === 1) {
        console.log("unreachable");
    }

    console.log(`    sparse pages: ${sparse.live}, ${sparse.bytes()} bytes for ${links} links`);
    console.log(`    dense + targets: ${links * 16} bytes`);

    // -- 4 and 5. the reverse direction -------------------------------------------
    //
    // 10,000 parents with 10 children each, which is a scene graph's shape.
    // Asking one parent for its children, over and over.

    const parents: usize = 10000;
    const perParent: usize = 10;

    // A map to a per-parent list, which is what `relation.ts` holds today.
    const slotOf = new HashMap<u64, u32>();
    const lists: u64[][] = [];
    for (let p: usize = 0; p < parents; p++) {
        const fresh: u64[] = [];
        lists.push(fresh);
        slotOf.set(handleOf(cast<u32>(p)), cast<u32>(p));
        for (let c: usize = 0; c < perParent; c++) {
            lists[p].push(handleOf(cast<u32>(p * perParent + c)));
        }
    }

    let seen: usize = 0;
    b.run("relstore/map to a list, one parent of 10", 20, 20000, (count) => {
        for (let i: usize = 0; i < count; i++) {
            const at = slotOf.indexOf(handleOf(cast<u32>(i % parents)));
            if (at >= 0) {
                const slot = cast<usize>(slotOf.valueAt(cast<usize>(at)));
                for (let c: usize = 0; c < lists[slot].length; c++) {
                    seen += cast<usize>(indexOfHandle(lists[slot][c]));
                }
            }
        }
    });

    // An intrusive chain: the parent's sparse entry names its first child, and
    // each child names the next. No per-parent allocation at all.
    const firstChild = new SparseIndex();
    const nextSibling: u32[] = [];
    const childHandle: u64[] = [];
    nextSibling.reserve(parents * perParent);
    childHandle.reserve(parents * perParent);

    for (let p: usize = 0; p < parents; p++) {
        for (let c: usize = 0; c < perParent; c++) {
            const slot = cast<u32>(childHandle.length);
            childHandle.push(handleOf(cast<u32>(p * perParent + c)));
            // Push onto the front, which is what makes attaching O(1).
            nextSibling.push(firstChild.get(cast<u32>(p)));
            firstChild.set(cast<u32>(p), slot);
        }
    }

    b.run("relstore/intrusive chain, one parent of 10", 20, 20000, (count) => {
        for (let i: usize = 0; i < count; i++) {
            let slot = firstChild.get(cast<u32>(i % parents));
            while (slot !== none()) {
                seen += cast<usize>(indexOfHandle(childHandle[cast<usize>(slot)]));
                slot = nextSibling[cast<usize>(slot)];
            }
        }
    });

    if (seen === 1) {
        console.log("unreachable");
    }

    console.log(
        `    reverse: chain costs ${firstChild.bytes()} bytes of pages + ` +
        `${parents * perParent * 4} bytes of links, no per-parent allocation`,
    );
}
