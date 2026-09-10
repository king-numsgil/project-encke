// What the ECS costs.
//
// Every number here is the price of a different design decision, and together
// they say whether the layout is doing its job:
//
//   * **create/destroy** — the entity index and the root table's row churn.
//   * **add/remove** — an archetype move, which is what the layout *costs*: the
//     whole row is copied to a different table.
//   * **iteration**, two components and six — what the layout *buys*: a
//     contiguous walk with no per-entity lookup. If the two-component figure is
//     not far under a nanosecond an entity, the columns are not doing their job.
//   * **random access** — `world.get` in an order nothing can prefetch. One miss
//     for the entity record and one per component.
//   * **sparse** — the same add/remove and the same walk, with the component in
//     a pool instead of a column. The two together are the argument for
//     `sparseComponent`: far cheaper to change, far dearer to walk.
//   * **relationships** — `targetOf`, `related` and a settled `view`, none of
//     which a query can see.
//
// The wide walk and the random access came out of the chunking experiment; see
// the note above the wide one.
//
// The worlds are built outside the timed region wherever the operation does not
// need building; where it does — create and destroy are the same measurement
// from either end — the build is part of what is being measured and is said so.

import { has, Query } from "../../ecs/query.ts";
import { World } from "../../ecs/world.ts";
import type { Bench } from "../bench.ts";

interface Position {
    x: f32;
    y: f32;
    z: f32;
}

interface Velocity {
    dx: f32;
    dy: f32;
    dz: f32;
}

interface Health {
    points: i32;
}

// -- the wide archetype ------------------------------------------------------
//
// Eight components, 76 bytes an entity, six of them read by the system below —
// so the walk is six streams rather than the two the benchmark above measures.
//
// It exists because of the chunking experiment. Cutting a table's rows into
// 16 KiB blocks holding every column at once was built, measured and thrown
// away, and this was one of the two cases that decided it. The two-component
// walk is the best case for one buffer per column and could not show any
// difference; this is where a chunked layout should have won, and it lost by
// 51%. The README has the numbers under "Why the rows are not chunked". Beat
// these two before trying chunks again.

interface Accel {
    ax: f32;
    ay: f32;
    az: f32;
}

interface Colour {
    r: f32;
    g: f32;
    b: f32;
    a: f32;
}

interface Life {
    age: f32;
    span: f32;
}

interface Size {
    scale: f32;
}

interface Spin {
    angle: f32;
}

interface Layer {
    index: u32;
}

export function benchEcs(b: Reference<Bench>): void {
    // -- create and destroy ---------------------------------------------------
    //
    // A pair per iteration, so the entity index recycles one index over and over
    // and the root table stays one row deep. That is the churn a spawner does.

    b.run("ecs/create+destroy", 20, 20000, (count) => {
        const world = new World();
        for (let i: usize = 0; i < count; i++) {
            world.destroy(world.create());
        }
        world.release();
    });

    // -- the archetype move ------------------------------------------------------
    //
    // Add and remove one component from an entity that already holds two, so
    // every iteration copies a real row between two real tables. This is the
    // operation an archetype ECS is slowest at and the one worth watching.

    const moving = new World();
    const movePosition = moving.component<Position>("Position");
    const moveVelocity = moving.component<Velocity>("Velocity");
    const moveFrozen = moving.tag("Frozen");

    const subject = moving.create();
    moving.set<Position>(subject, movePosition, {x: 1.0, y: 2.0, z: 3.0});
    moving.set<Velocity>(subject, moveVelocity, {dx: 0.1, dy: 0.2, dz: 0.3});

    b.run("ecs/add+remove a tag", 20, 20000, (count) => {
        for (let i: usize = 0; i < count; i++) {
            moving.add(subject, moveFrozen);
            moving.remove(subject, moveFrozen);
        }
    });

    moving.release();

    // -- iteration -----------------------------------------------------------------
    //
    // A million entities of three components, walked as a query would walk them
    // every frame. The batch is one full pass, so the reported number is
    // nanoseconds per **entity**.

    const big = new World();
    const position = big.component<Position>("Position");
    const velocity = big.component<Velocity>("Velocity");
    const health = big.component<Health>("Health");

    const total: usize = 1000000;
    for (let i: usize = 0; i < total; i++) {
        const e = big.create();
        big.set<Position>(e, position, {x: cast<f32>(i), y: 0.0, z: 0.0});
        big.set<Velocity>(e, velocity, {dx: 1.0, dy: 0.0, dz: 0.0});
        big.set<Health>(e, health, {points: 100});
    }

    const walk = new Query([has(position), has(velocity)]);
    // Matched before the timing, so the first batch is not paying for the match
    // that every later one inherits.
    walk.refresh(big);

    // `count` is unused here because the query drives the loop — it is the
    // divisor that turns the batch into a per-entity number, so it has to equal
    // the entity count and not merely resemble it.
    b.run("ecs/iterate 1M x 2 components", 20, total, (count) => {
        walk.each(big, (it) => {
            const p = it.column<Position>(0);
            const v = it.column<Velocity>(1);
            if (p === null || v === null) {
                return;
            }
            for (let i: usize = 0; i < it.count; i++) {
                p[i].x += v[i].dx;
            }
        });
    });

    console.log(`    over ${walk.count(big)} entities in ${walk.tableCount} table(s)`);

    // -- random access ---------------------------------------------------------
    //
    // One entity's components by handle, in an order no prefetcher can follow:
    // `world.get` three times over a shuffled list. That is three cache misses
    // in three arrays twelve megabytes apart, plus one for the entity record
    // that says where to look. The last of those turns out to dominate, which is
    // why grouping an entity's components into one block made no difference
    // here; see the wide benchmark's note.
    //
    // The shuffle is a walk over a stride coprime with the length, not a
    // shuffled array, so producing the order costs nothing and the loop is not
    // measuring an indirection through a permutation table.

    const scattered: u64[] = [];
    scattered.reserve(100000);
    let seen: usize = 0;
    walk.each(big, (it) => {
        for (let i: usize = 0; i < it.count; i++) {
            // Every tenth entity, so the sample is spread across the whole
            // million rather than over the first tenth of it.
            if (seen % 10 === 0) {
                scattered.push(it.entity(i));
            }
            seen += 1;
        }
    });

    // -- what a sparse component costs, and what it saves ------------------------
    //
    // Three numbers, each with a counterpart above. A sparse id lives in a pool
    // outside the archetypes, so putting one on and taking it off moves no rows:
    // compare with `ecs/add+remove a tag`, which is two archetype moves.
    // Iteration is where it costs, and the two walks below show both halves of
    // that — one where the sparse term only filters, one where its data is read.

    const marked = big.sparseTag("Marked");
    for (let i: usize = 0; i < scattered.length; i++) {
        big.add(scattered[i], marked);
    }

    const heat = big.sparseComponent<Health>("Heat");
    const every: u64[] = [];
    every.reserve(total);
    walk.each(big, (it) => {
        for (let i: usize = 0; i < it.count; i++) {
            every.push(it.entity(i));
        }
    });
    for (let i: usize = 0; i < every.length; i++) {
        big.set<Health>(every[i], heat, {points: cast<i32>(i)});
    }

    const flip = every[0];
    b.run("ecs/add+remove a sparse tag", 20, 20000, (count) => {
        for (let i: usize = 0; i < count; i++) {
            big.add(flip, marked);
            big.remove(flip, marked);
        }
    });

    // All million rows are tested and a tenth pass, in runs of one, which is the
    // worst shape the filter can take: a body call per entity. The divisor is
    // the million tested rather than the hundred thousand kept, since testing is
    // what the number measures.
    const filtered = new Query([has(position), has(velocity), has(marked)]);
    filtered.refresh(big);

    b.run("ecs/iterate 1M, sparse tag keeping 100k", 20, total, (count) => {
        filtered.each(big, (it) => {
            const p = it.column<Position>(0);
            if (p === null) {
                return;
            }
            for (let i: usize = 0; i < it.count; i++) {
                p[i].y += 1.0;
            }
        });
    });

    console.log(`    kept ${filtered.count(big)} of ${total}, in ${filtered.tableCount} table(s)`);

    // Held by every entity, so nothing is filtered out and all the cost is the
    // pool lookup per entity. Read against `ecs/iterate 1M x 2 components`: the
    // same walk, with one of the two components sparse.
    const hot = new Query([has(position), has(heat)]);
    hot.refresh(big);

    b.run("ecs/iterate 1M, reading a sparse component", 20, total, (count) => {
        hot.each(big, (it) => {
            const p = it.column<Position>(0);
            if (p === null) {
                return;
            }
            for (let i: usize = 0; i < it.count; i++) {
                const h = it.sparse<Health>(1, i);
                if (h !== null) {
                    p[i].z += cast<f32>(h[0].points);
                }
            }
        });
    });

    console.log(`    the pool: ${big.sparseBytes(heat)} bytes for ${big.sparseCount(heat)} rows`);

    b.run("ecs/get 3 components by handle, scattered", 20, scattered.length, (count) => {
        let sum: f32 = 0.0;
        for (let i: usize = 0; i < count; i++) {
            // A stride that is coprime with the length, so the walk visits every
            // element in an order the hardware cannot follow.
            const handle = scattered[(i * 48271) % scattered.length];
            const p = big.get<Position>(handle, position);
            const v = big.get<Velocity>(handle, velocity);
            const h = big.get<Health>(handle, health);
            if (p !== null && v !== null && h !== null) {
                sum += p[0].x + v[0].dx + cast<f32>(h[0].points);
            }
        }
        if (sum === 1.0) {
            console.log("unreachable");
        }
    });

    big.release();

    // -- a wide archetype ---------------------------------------------------------
    //
    // Eight components, six of them read. The two-component walk above is the
    // best case for one buffer per column: two long streams and nothing else.
    // This is the case that is not.

    const wide = new World();
    const widePosition = wide.component<Position>("Position");
    const wideVelocity = wide.component<Velocity>("Velocity");
    const wideAccel = wide.component<Accel>("Accel");
    const wideColour = wide.component<Colour>("Colour");
    const wideLife = wide.component<Life>("Life");
    const wideSize = wide.component<Size>("Size");
    const wideSpin = wide.component<Spin>("Spin");
    const wideLayer = wide.component<Layer>("Layer");

    const particles: usize = 400000;
    for (let i: usize = 0; i < particles; i++) {
        const e = wide.create();
        wide.set<Position>(e, widePosition, {x: cast<f32>(i), y: 0.0, z: 0.0});
        wide.set<Velocity>(e, wideVelocity, {dx: 1.0, dy: 0.0, dz: 0.0});
        wide.set<Accel>(e, wideAccel, {ax: 0.0, ay: -9.8, az: 0.0});
        wide.set<Colour>(e, wideColour, {r: 1.0, g: 1.0, b: 1.0, a: 1.0});
        wide.set<Life>(e, wideLife, {age: 0.0, span: 10.0});
        wide.set<Size>(e, wideSize, {scale: 1.0});
        wide.set<Spin>(e, wideSpin, {angle: 0.0});
        wide.set<Layer>(e, wideLayer, {index: cast<u32>(i & 3)});
    }

    const step = new Query([
        has(widePosition),
        has(wideVelocity),
        has(wideAccel),
        has(wideLife),
        has(wideSize),
        has(wideSpin),
    ]);
    step.refresh(wide);

    b.run("ecs/iterate 400k, 6 of 8 components", 20, particles, (count) => {
        step.each(wide, (it) => {
            const p = it.column<Position>(0);
            const v = it.column<Velocity>(1);
            const a = it.column<Accel>(2);
            const l = it.column<Life>(3);
            const s = it.column<Size>(4);
            const r = it.column<Spin>(5);
            if (p === null || v === null || a === null || l === null || s === null || r === null) {
                return;
            }
            for (let i: usize = 0; i < it.count; i++) {
                v[i].dy += a[i].ay;
                p[i].x += v[i].dx;
                p[i].y += v[i].dy;
                l[i].age += 1.0;
                s[i].scale = 1.0 - l[i].age / l[i].span;
                r[i].angle += 0.1;
            }
        });
    });

    console.log(`    over ${step.count(wide)} entities in ${step.tableCount} table(s)`);

    wide.release();

    // -- a relationship query ------------------------------------------------------------
    //
    // Fifty thousand children over a hundred parents, so `(ChildOf, *)` matches
    // a hundred tables — one per parent, because a pair is part of the
    // signature. That table count is the cost of relationships being ids, and
    // this is the measurement that shows it.

    const tree = new World();
    const treePosition = tree.component<Position>("Position");
    const childOf = tree.relation("ChildOf");

    const parents: u64[] = [];
    for (let i: usize = 0; i < 4000; i++) {
        parents.push(tree.create());
    }
    for (let i: usize = 0; i < 50000; i++) {
        const child = tree.create();
        tree.set<Position>(child, treePosition, {x: cast<f32>(i), y: 0.0, z: 0.0});
        tree.relate(child, childOf, parents[i % 4000]);
    }

    // Four thousand parents, twelve or thirteen children each — a ship full of
    // doors and turrets. The relation is invisible here: this is an ordinary
    // component query over entities that happen to be parented, and the number
    // should be the same as if none of them were.
    const walkAll = new Query([has(treePosition)]);
    walkAll.refresh(tree);

    b.run("ecs/iterate 50k parented entities", 20, 50000, (count) => {
        walkAll.each(tree, (it) => {
            const p = it.column<Position>(0);
            if (p === null) {
                return;
            }
            for (let i: usize = 0; i < it.count; i++) {
                p[i].y += 1.0;
            }
        });
    });

    console.log(
        `    over ${walkAll.count(tree)} entities in ${walkAll.tableCount} table(s), ` +
        `across ${parents.length} parents — the relation costs the query nothing`,
    );
    console.log(`    the relation itself: ${tree.relationBytes(childOf)} bytes for 50000 links`);

    // Asking each entity for its parent, which is the sparse lookup rather than
    // a column read now. This is the price of relations leaving the archetypes.
    const sample: u64[] = [];
    sample.reserve(50000);
    walkAll.each(tree, (it) => {
        for (let i: usize = 0; i < it.count; i++) {
            sample.push(it.entity(i));
        }
    });

    b.run("ecs/targetOf, 50k lookups", 20, sample.length, (count) => {
        let sum: u64 = 0;
        for (let i: usize = 0; i < count; i++) {
            sum += tree.targetOf(sample[i], childOf);
        }
        if (sum === 1) {
            console.log("unreachable");
        }
    });

    // One parent's children: a sparse lookup for the first, then a chain walk.
    // Allocating a fresh array every call, which is the worst case and what a
    // caller writes first.
    b.run("ecs/related, one parent of 12, fresh array", 20, 2000, (count) => {
        for (let i: usize = 0; i < count; i++) {
            const children: u64[] = [];
            tree.related(childOf, parents[i % 4000], children);
        }
    });

    // The same, into a buffer that is cleared and reused — what a system doing
    // this every frame would actually write. The difference between these two is
    // the allocator, not the store.
    const reused: u64[] = [];
    reused.reserve(64);
    b.run("ecs/related, one parent of 12, reused array", 20, 2000, (count) => {
        for (let i: usize = 0; i < count; i++) {
            while (reused.length !== 0) {
                reused.pop();
            }
            tree.related(childOf, parents[i % 4000], reused);
        }
    });

    // A parent's children through a settled view, read by index rather than
    // through a callback — the cheapest form of the same question.
    const indexed = tree.view(childOf, parents[0]);
    tree.sync(indexed);
    b.run("ecs/view.at over 12", 20, 2000, (count) => {
        let sum: u64 = 0;
        for (let i: usize = 0; i < count; i++) {
            tree.sync(indexed);
            for (let c: usize = 0; c < indexed.length; c++) {
                sum += indexed.at(c);
            }
        }
        if (sum === 1) {
            console.log("unreachable");
        }
    });

    // And the operation transform propagation actually leans on: every child of
    // a parent, and each one's parent read back.
    b.run("ecs/targetOf per child of 12", 20, 2000, (count) => {
        let sum: u64 = 0;
        for (let i: usize = 0; i < count; i++) {
            while (reused.length !== 0) {
                reused.pop();
            }
            tree.related(childOf, parents[i % 4000], reused);
            for (let c: usize = 0; c < reused.length; c++) {
                sum += tree.targetOf(reused[c], childOf);
            }
        }
        if (sum === 1) {
            console.log("unreachable");
        }
    });

    // The same question through a view, which pays memory to skip the lookup and
    // the copy while nothing is changing.
    const view = tree.view(childOf, parents[0]);
    tree.sync(view);
    b.run("ecs/walk a settled view of 12", 20, 2000, (count) => {
        let seen: usize = 0;
        for (let i: usize = 0; i < count; i++) {
            tree.walk(view, (member) => {
                seen += 1;
            });
        }
        if (seen === 1) {
            console.log("unreachable");
        }
    });

    tree.release();
}
