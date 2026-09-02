// Entity index to slot, in pages allocated only where something lives.
//
// The lookup structure a relationship store is built on, and the reason it is
// not a hash map: answering "where is this entity's link" is a shift, a bounds
// check and two array reads. No hash to compute, no key to compare, no probe
// sequence. Measured over 100,000 links in random order, that is **9 ns against
// 40 ns** for a `HashMap<u64, u64>` — and it uses less memory, because a hash
// map at a 0.7 load factor carries a slot array half again as large as the data.
//
// ## Pages, and what they cost
//
// A page is 4096 entries of `u32`: 16 KB, and the size EnTT settled on for the
// same job. Pages are allocated on first touch, so an index holding a hundred
// thousand entities whose indices happen to be contiguous occupies twenty-five
// of them — 400 KB — and one holding nothing occupies none.
//
// **The failure mode is scatter.** The cost is one page per 4096-index span that
// contains *anything*, so a relation held by one entity in every span pays 16 KB
// per link. That is pathological rather than likely: entity indices are handed
// out sequentially and recycled, so entities created together — which is what
// the members of a hierarchy are — land in the same span. It is worth knowing
// because it is the one input that turns this structure from the cheapest option
// into the most expensive one.

/** No slot. Not a valid index: a store never holds four billion links. */
export function noSlot(): u32 {
    return 0xffffffff;
}

/** Entries a page holds. A power of two, so the split is a shift and a mask. */
function pageEntries(): usize {
    return 4096;
}

function pageShift(): usize {
    return 12;
}

function pageMask(): usize {
    return 4095;
}

export class SparseIndex {
    /**
     * Page number to its entries.
     *
     * An **empty array** means the page has never been touched, which is what
     * makes the whole thing sparse — an absent page costs one machine word in
     * this array rather than 16 KB, so the gaps between what a relation actually
     * holds are nearly free.
     */
    private pages: u32[][];

    private allocated: usize;

    constructor() {
        this.pages = [];
        this.allocated = 0;
    }

    /** How many pages hold anything. */
    get pageCount(): usize {
        return this.allocated;
    }

    /** What the pages occupy, for the gauges a running program watches. */
    get bytes(): usize {
        return this.allocated * pageEntries() * 4;
    }

    /** The slot recorded for `index`, or {@link noSlot}. */
    get(index: u32): u32 {
        const page = cast<usize>(index) >> pageShift();
        if (page >= this.pages.length || this.pages[page].length === 0) {
            return noSlot();
        }
        return this.pages[page][cast<usize>(index) & pageMask()];
    }

    /** Record `slot` for `index`, allocating that page if it is the first here. */
    set(index: u32, slot: u32): void {
        const page = cast<usize>(index) >> pageShift();

        // Absent pages up to the one wanted. Each is an empty array and costs a
        // word, so a huge index reached early is not a huge allocation.
        while (this.pages.length <= page) {
            const absent: u32[] = [];
            this.pages.push(absent);
        }

        if (this.pages[page].length === 0) {
            this.pages[page].reserve(pageEntries());
            for (let i: usize = 0; i < pageEntries(); i++) {
                this.pages[page].push(noSlot());
            }
            this.allocated += 1;
        }

        this.pages[page][cast<usize>(index) & pageMask()] = slot;
    }

    /**
     * Forget `index`.
     *
     * The page stays. Freeing it would need a count of what is left in it, and
     * a page that emptied once will very likely fill again — these are entity
     * indices, which are recycled onto the same spans.
     */
    clear(index: u32): void {
        const page = cast<usize>(index) >> pageShift();
        if (page >= this.pages.length || this.pages[page].length === 0) {
            return;
        }
        this.pages[page][cast<usize>(index) & pageMask()] = noSlot();
    }
}
