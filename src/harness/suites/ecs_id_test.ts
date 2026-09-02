// The id bit layout.
//
// Every other file in `ecs/` reads ids through these functions and none of them
// touches a bit itself, so this suite is where a shifted mask turns into a
// failure instead of into an entity that is somebody else. The cases that matter
// are the boundaries — index zero and index 2^32-1, generation zero and 65535 —
// because a mask that is one bit short works perfectly for every small number
// anyone tests by hand.

import {
    componentId,
    deleteId,
    firstUserIndex,
    generationOf,
    indexOf,
    isReserved,
    makeEntity,
    noneId,
    relationId,
    removeId,
    reservedId,
} from "../../ecs/id.ts";
import type { Tester } from "../testing.ts";

export function testEcsId(t: Reference<Tester>): void {
    // -- the boundaries -------------------------------------------------------

    const first = makeEntity(0, 0);
    t.equalU64("index 0 generation 0 is the null id", first, 0);
    t.equalUsize("index of it", cast<usize>(indexOf(first)), 0);
    t.equalUsize("generation of it", cast<usize>(generationOf(first)), 0);

    const ordinary = makeEntity(1234567, 7);
    t.equalUsize("an ordinary index", cast<usize>(indexOf(ordinary)), 1234567);
    t.equalUsize("an ordinary generation", cast<usize>(generationOf(ordinary)), 7);

    // The last index there is. A 31-bit mask would give 2147483647 here.
    const last = makeEntity(0xffffffff, 0xffff);
    t.equalUsize("the largest index survives", cast<usize>(indexOf(last)), 4294967295);
    t.equalUsize("the largest generation survives", cast<usize>(generationOf(last)), 65535);

    // A generation past 16 bits wraps rather than bleeding into the flags. The
    // caller that increments it wraps at the same width, so the two always agree
    // — and `entities.ts` retires the index before it can get here at all.
    const wrapped = makeEntity(9, 0x10000);
    t.equalUsize("a generation of 65536 wraps to 0", cast<usize>(generationOf(wrapped)), 0);
    t.equalUsize("and does not disturb the index", cast<usize>(indexOf(wrapped)), 9);

    // Index is not generation. This is the check that catches a shift of the
    // wrong size, which otherwise makes two different entities equal.
    t.ok(
        "index and generation are different fields",
        makeEntity(3, 0) !== makeEntity(0, 3),
    );

    // Every index round-trips at every generation, which is the property
    // everything above this file assumes without checking.
    let broken: usize = 0;
    for (let i: usize = 0; i < 64; i++) {
        const index = cast<u32>(1) << cast<u32>(i % 32);
        const generation = cast<u32>(i * 1031) & 0xffff;
        const handle = makeEntity(index, generation);
        if (indexOf(handle) !== index || generationOf(handle) !== generation) {
            broken += 1;
        }
    }
    t.equalUsize("every bit position round-trips", broken, 0);

    // -- the reserved entities -------------------------------------------------
    //
    // Generation zero, so each handle *is* its index and these numbers can be
    // read in a debugger. Distinctness matters more than the values: two
    // builtins sharing an index would make `Component` and `Relation` the same
    // thing, which would be a very confusing afternoon.

    t.equalU64("none is 0", noneId(), 0);
    t.equalU64("index 1 is reserved", reservedId(), 1);
    t.equalU64("Component is 3", componentId(), 3);
    t.equalU64("Relation is 4", relationId(), 4);
    t.equalU64("Remove is 6", removeId(), 6);
    t.equalU64("Delete is 7", deleteId(), 7);

    t.ok("Remove and Delete are different policies", removeId() !== deleteId());

    t.ok("the builtins are reserved", isReserved(indexOf(deleteId())));
    t.ok("the first user index is not", !isReserved(firstUserIndex()));
    t.ok("nor is anything past it", !isReserved(firstUserIndex() + 1000));

    // -- the flag bits are untouched -------------------------------------------
    //
    // Bits 48 upward are reserved for whatever wants them next — a marker for a
    // relation holding several targets, most likely. Nothing sets one today, and
    // an id built from an index and a generation must leave them clear, or the
    // day something does start reading them it will find garbage.

    const flags = last >> 48;
    t.equalU64("a full-width handle sets no flag bits", flags, 0);
    t.equalU64("and neither does an ordinary one", ordinary >> 48, 0);
}
