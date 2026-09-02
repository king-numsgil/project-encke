// What the ECS costs.
//
// Four numbers, chosen because each one is the price of a different design
// decision and together they say whether the layout is doing what it exists for:
//
//   * **create/destroy** — the entity index and the root table's row churn.
//   * **add/remove** — an archetype move, which is the cost the layout *pays*:
//     the whole row is copied to a different table.
//   * **iteration** — the cost the layout *buys*: a contiguous walk down three
//     columns with no per-entity lookup. If this is not far under a nanosecond
//     an entity, the columns are not doing their job.
//   * **(ChildOf, *)** — a wildcard query over a relationship, which is the
//     thing pairs-as-ids exists to make cheap.
//
// The worlds are built outside the timed region wherever the operation does not
// need building; where it does — create and destroy are the same measurement
// from either end — the build is part of what is being measured and is said so.

import { childOfId, pair, wildcardId } from "../../ecs/id.ts";
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

    big.release();

    // -- a relationship query ------------------------------------------------------------
    //
    // Fifty thousand children over a hundred parents, so `(ChildOf, *)` matches
    // a hundred tables — one per parent, because a pair is part of the
    // signature. That table count is the cost of relationships being ids, and
    // this is the measurement that shows it.

    const tree = new World();
    const treePosition = tree.component<Position>("Position");

    const parents: u64[] = [];
    for (let i: usize = 0; i < 100; i++) {
        parents.push(tree.create());
    }
    for (let i: usize = 0; i < 50000; i++) {
        const child = tree.create();
        tree.set<Position>(child, treePosition, {x: cast<f32>(i), y: 0.0, z: 0.0});
        tree.add(child, pair(childOfId(), parents[i % 100]));
    }

    const anyParent = new Query([has(treePosition), has(pair(childOfId(), wildcardId()))]);
    anyParent.refresh(tree);

    b.run("ecs/iterate (ChildOf, *) over 50k", 20, 50000, (count) => {
        anyParent.each(tree, (it) => {
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
        `    over ${anyParent.count(tree)} entities in ${anyParent.tableCount} tables ` +
        `— one per parent, which is what a pair being part of the signature costs`,
    );

    // The index lookup, which is the other way to ask the same question and the
    // one that does not care how many tables there are.
    b.run("ecs/childrenOf one parent", 20, 2000, (count) => {
        for (let i: usize = 0; i < count; i++) {
            const children: u64[] = [];
            tree.childrenOf(parents[i % 100], children);
        }
    });

    tree.release();
}
