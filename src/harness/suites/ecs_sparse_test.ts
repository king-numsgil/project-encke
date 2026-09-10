// Sparse components: the pool on its own, and what a world and a query do with
// one.
//
// Three seams, each a place sparse sets are known to go wrong:
//
//   * **The swap-remove.** Taking a row out moves the last row into the hole, so
//     the moved entity's sparse slot has to be repointed. When the removed row
//     *is* the last one, the moved entity is the removed one, and repointing it
//     would bring back a slot that should be gone. Getting those two writes in
//     the wrong order is the bug, so both cases are tested.
//   * **The stale handle.** A pool is keyed by an entity index, so a dead
//     entity's handle would find whatever entity took that index over. Only the
//     whole-handle comparison refuses it.
//   * **The runs.** A sparse `has` term cuts a table into runs of consecutive
//     rows, and every column base handed to the body has to be offset to the
//     start of its run. Getting that wrong means `p[0]` is the table's first
//     entity instead of the run's, which fails silently: every number it
//     produces still looks reasonable.

import { infoOf, tagInfo } from "../../ecs/component.ts";
import { SparsePool } from "../../ecs/pool.ts";
import { has, maybe, not, Query } from "../../ecs/query.ts";
import { noSlot } from "../../ecs/sparse.ts";
import { World } from "../../ecs/world.ts";
import type { Tester } from "../testing.ts";

interface Position {
    x: f32;
    y: f32;
    z: f32;
}

interface Stunned {
    turns: i32;
}

export function testEcsSparse(t: Reference<Tester>): void {
    // -- the pool on its own ---------------------------------------------------

    const pool = new SparsePool(infoOf<Stunned>());
    t.equalUsize("a fresh pool is empty", pool.count, 0);
    t.ok("and carries data", !pool.isTag);

    // Handles that are not entities of any world. A pool never looks a handle
    // up anywhere: it splits out the index and compares the whole thing back.
    // That is what makes it testable without a world.
    const a: u64 = 100;
    const b: u64 = 200;
    const c: u64 = 300;

    t.ok("a pool starts holding nothing", !pool.has(a));
    t.equalUsize("and says so as a row", cast<usize>(pool.rowOf(a)), cast<usize>(noSlot()));

    t.equalUsize("the first add lands in row zero", cast<usize>(pool.add(a)), 0);
    t.equalUsize("the second in row one", cast<usize>(pool.add(b)), 1);
    t.equalUsize("the third in row two", cast<usize>(pool.add(c)), 2);
    t.equalUsize("three rows", pool.count, 3);

    // Idempotent, like `World.add`. Code that does not want to check first adds
    // twice as a matter of course, and that must not push a second row for the
    // same entity.
    t.equalUsize("adding again returns the row it had", cast<usize>(pool.add(b)), 1);
    t.equalUsize("without growing", pool.count, 3);

    pool.at(0).reify<Stunned>()[0].turns = 11;
    pool.at(1).reify<Stunned>()[0].turns = 22;
    pool.at(2).reify<Stunned>()[0].turns = 33;

    t.ok("every holder is found", pool.has(a) && pool.has(b) && pool.has(c));
    t.ok("and nothing else is", !pool.has(cast<u64>(400)));

    // -- the swap-remove, from the middle ---------------------------------------
    //
    // The last row fills the hole, so `c` moves from row 2 to row 0 and its
    // sparse slot has to follow. Reading `c` back through the pool rather than
    // through a remembered row number is what checks that it did.

    pool.remove(a);
    t.equalUsize("one fewer row", pool.count, 2);
    t.ok("the removed entity is gone", !pool.has(a));
    t.ok("the others are not", pool.has(b) && pool.has(c));
    t.equalUsize("the last row moved into the hole", cast<usize>(pool.rowOf(c)), 0);
    t.equalI32(
        "carrying its data",
        pool.at(cast<usize>(pool.rowOf(c))).reify<Stunned>()[0].turns,
        33,
    );
    t.equalI32(
        "and the untouched one still reads back",
        pool.at(cast<usize>(pool.rowOf(b))).reify<Stunned>()[0].turns,
        22,
    );

    t.ok("removing what is not there says so", !pool.remove(a));

    // -- the swap-remove, of the last row ---------------------------------------
    //
    // Nothing moves. The moved entity is the removed one, so repointing before
    // clearing leaves a live slot naming a row that no longer exists, and the
    // entity you just removed still reads as present.

    const last = pool.rowOf(b);
    t.equalUsize("b is the last row", cast<usize>(last), pool.count - 1);
    pool.remove(b);
    t.ok("removing the last row removes it", !pool.has(b));
    t.equalUsize("one row left", pool.count, 1);
    t.ok("and the survivor is untouched", pool.has(c));

    // -- the stale handle ------------------------------------------------------
    //
    // A second handle with the same index and a different generation. The sparse
    // index cannot tell the two apart. The whole-handle comparison can, and it
    // is all that stands between a dead entity and somebody else's data.

    const generational: u64 = (cast<u64>(1) << 32) | cast<u64>(300);
    t.ok("same index, later generation, not the same entity", !pool.has(generational));
    t.equalUsize(
        "and no row",
        cast<usize>(pool.rowOf(generational)),
        cast<usize>(noSlot()),
    );

    pool.release();

    // -- a tag pool ------------------------------------------------------------
    //
    // No data at all. This is the case where a zero stride would divide by zero,
    // if anything let it reach the column.

    const flags = new SparsePool(tagInfo());
    t.ok("a tag pool says it is one", flags.isTag);
    flags.add(a);
    flags.add(b);
    t.equalUsize("and still tracks membership", flags.count, 2);
    t.ok("both of them", flags.has(a) && flags.has(b));
    flags.remove(a);
    t.ok("and forgets one", !flags.has(a) && flags.has(b));
    flags.release();

    // -- a world with a sparse component ----------------------------------------

    const world = new World();
    const position = world.component<Position>("Position");
    const stunned = world.sparseComponent<Stunned>("Stunned");
    const selected = world.sparseTag("Selected");

    t.ok("a sparse component says it is sparse", world.isSparse(stunned));
    t.ok("so does a sparse tag", world.isSparse(selected));
    t.ok("a dense one does not", !world.isSparse(position));

    const one = world.create();
    world.set<Position>(one, position, {x: 1.0, y: 0.0, z: 0.0});

    // The property the whole feature rests on: adding a sparse id must not move
    // the entity to a different table, because no such table exists.
    const before = world.tableIndexOf(one);
    const beforeTables = world.tableCount;

    t.ok("adding a sparse component works", world.add(one, stunned));
    t.ok("the entity holds it", world.has(one, stunned));
    t.equalUsize("and did not change table", cast<usize>(world.tableIndexOf(one)), cast<usize>(before));
    t.equalUsize("nor build one", world.tableCount, beforeTables);
    t.ok("adding twice is not an error and not a second row", !world.add(one, stunned));
    t.equalUsize("one holder", world.sparseCount(stunned), 1);

    world.set<Stunned>(one, stunned, {turns: 7});
    const read = world.get<Stunned>(one, stunned);
    t.ok("its data is reachable", read !== null);
    if (read !== null) {
        t.equalI32("and is what was written", read[0].turns, 7);
    }

    // A sparse tag has membership and nothing to point at, like a dense tag.
    world.add(one, selected);
    t.ok("a sparse tag is held", world.has(one, selected));
    t.ok("and has no data", world.get<Stunned>(one, selected) === null);

    t.ok("removing gives it up", world.remove(one, stunned));
    t.ok("and it is gone", !world.has(one, stunned));
    t.ok("removing again says so", !world.remove(one, stunned));
    t.ok("its data is unreachable", world.get<Stunned>(one, stunned) === null);
    t.equalUsize("and the pool is empty", world.sparseCount(stunned), 0);
    t.equalUsize("the entity is still where it was", cast<usize>(world.tableIndexOf(one)), cast<usize>(before));

    // `set` adds, as it does for a dense component.
    world.set<Stunned>(one, stunned, {turns: 3});
    t.ok("set adds a sparse component that was not there", world.has(one, stunned));

    // -- destroy has to sweep the pools ------------------------------------------
    //
    // A dense component goes away because the row does. A sparse one has to be
    // hunted down, and a row left behind would sit there holding data for the
    // life of the process.

    const doomed = world.create();
    world.set<Stunned>(doomed, stunned, {turns: 99});
    world.add(doomed, selected);
    t.equalUsize("two holders", world.sparseCount(stunned), 2);

    world.destroy(doomed);
    t.equalUsize("destroying takes the row out", world.sparseCount(stunned), 1);
    t.equalUsize("out of every pool", world.sparseCount(selected), 1);
    t.ok("a dead entity holds nothing", !world.has(doomed, stunned));
    t.ok("and the survivor is untouched", world.has(one, stunned));

    // -- queries -----------------------------------------------------------------
    //
    // Twenty entities with a position, every third one stunned, so the runs come
    // out short and there are several of them. The table matches on the dense
    // terms alone and the sparse term cuts it up.

    const many: u64[] = [];
    for (let i: usize = 0; i < 20; i++) {
        const e = world.create();
        world.set<Position>(e, position, {x: cast<f32>(i), y: 0.0, z: 0.0});
        if (i % 3 === 0) {
            world.set<Stunned>(e, stunned, {turns: cast<i32>(i)});
        }
        many.push(e);
    }

    // `one` also has a position and is stunned, so the expected count is the
    // seven of the twenty plus it.
    const stunnedWalk = new Query([has(position), has(stunned)]);
    // Only the world knows which ids are sparse, so a query built without one
    // has resolved nothing and `filterCount` reads zero until it refreshes.
    t.equalUsize("nothing is resolved before a refresh", stunnedWalk.filterCount, 0);
    stunnedWalk.refresh(world);
    t.equalUsize("a sparse term is filtered per entity", stunnedWalk.filterCount, 1);
    t.equalUsize("and counts only the holders", stunnedWalk.count(world), 8);

    let visited: usize = 0;
    let runs: usize = 0;
    let mismatched: usize = 0;
    stunnedWalk.each(world, (it) => {
        runs += 1;
        const p = it.column<Position>(0);
        if (p === null) {
            return;
        }
        for (let i: usize = 0; i < it.count; i++) {
            visited += 1;
            // The check the runs exist for. The column base has to be the base
            // of *this* run, so the position at `i` must belong to the entity
            // at `i`. A base left at the table's row 0 would still hand back
            // perfectly plausible positions.
            const owner = it.entity(i);
            const direct = world.get<Position>(owner, position);
            if (direct === null || direct[0].x !== p[i].x) {
                mismatched += 1;
            }
            const s = it.sparse<Stunned>(1, i);
            if (s === null) {
                mismatched += 1;
            }
        }
    });
    t.equalUsize("every holder was visited", visited, 8);
    t.equalUsize("and no column base was off by a run", mismatched, 0);
    t.ok("in more than one run", runs > 1);

    // The complement. `not` on a sparse id is the same test with the answer
    // inverted, so the two queries must partition the matching entities.
    const calmWalk = new Query([has(position), not(stunned)]);
    t.equalUsize("not() over a sparse id is its complement", calmWalk.count(world), 13);

    // An optional sparse term demands nothing, so the table is not cut at all
    // and the body decides per entity.
    const eitherWalk = new Query([has(position), maybe(stunned)]);
    t.equalUsize("and matches everything the dense terms do", eitherWalk.count(world), 21);
    t.equalUsize("an optional sparse term filters nothing", eitherWalk.filterCount, 0);

    let held: usize = 0;
    let calls: usize = 0;
    eitherWalk.each(world, (it) => {
        calls += 1;
        for (let i: usize = 0; i < it.count; i++) {
            if (it.hasSparse(1, i)) {
                held += 1;
            }
        }
    });
    t.equalUsize("the body still sees which entities hold it", held, 8);
    t.equalUsize("in one run per table", calls, 1);

    // A sparse component is invisible to the archetypes, so all twenty-one of
    // these entities sit in one table no matter how many are stunned.
    t.equalUsize("and it is all one table", eitherWalk.tableCount, 1);

    // -- walking the pool directly -------------------------------------------------

    let swept: usize = 0;
    world.eachSparse(stunned, (handle) => {
        if (world.isAlive(handle)) {
            swept += 1;
        }
    });
    t.equalUsize("the pool walks its own holders", swept, 8);
    t.ok("and reports what it occupies", world.sparseBytes(stunned) > 0);

    // A component over `maxComponentBytes` aborts, so there is no check to write
    // for it here: a suite cannot assert something that takes the process down
    // with it. Verified by hand instead —
    //
    //     interface Oversized { cells: FixedArray<u8, 8192>; }
    //     world.component<Oversized>("Oversized");
    //
    //     ecs: component "Oversized" is 8192 bytes, over the 4096 byte limit. …
    //
    // after which the run stops, with no leak report, because it never returned
    // from `main`. `fatal.ts` explains why it aborts instead of returning.

    world.release();
}
