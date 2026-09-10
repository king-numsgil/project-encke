// The benchmark that decided where a relationship's target gets stored.
//
// Same 10,000 entities every time, same components, same work. The only thing
// that changes is how many parents they are spread across.
//
// When the target lived in the archetype signature — `(ChildOf, ship)` as an id,
// the way flecs does it — this measured a **22-fold** slowdown from one parent
// to two thousand, because the query paid per-table setup for five entities at a
// time. A ship full of doors and turrets is exactly that shape, so relationships
// moved out of the archetypes and into a store of their own.
//
// **This line should now be flat.** A future change that reintroduces per-target
// tables will bend the curve again, which is how the problem was found in the
// first place.

import { has, Query } from "../../ecs/query.ts";
import { World } from "../../ecs/world.ts";
import type { Bench } from "../bench.ts";

interface Position {
    x: f32;
    y: f32;
    z: f32;
}

export function benchFragmentation(b: Reference<Bench>): void {
    measure(b, 1);
    measure(b, 10);
    measure(b, 100);
    measure(b, 1000);
    measure(b, 2000);
}

function measure(b: Reference<Bench>, parents: usize): void {
    const world = new World();
    const position = world.component<Position>("Position");
    const childOf = world.relation("ChildOf");

    const total: usize = 10000;
    const perParent = total / parents;

    for (let p: usize = 0; p < parents; p++) {
        const parent = world.create();
        for (let c: usize = 0; c < perParent; c++) {
            const child = world.create();
            world.set<Position>(child, position, {x: 1.0, y: 2.0, z: 3.0});
            world.relate(child, childOf, parent);
        }
    }

    const query = new Query([has(position)]);
    query.refresh(world);

    b.run(`fragmentation/${parents} parents x ${perParent} children`, 20, total, (count) => {
        query.each(world, (it) => {
            const p = it.column<Position>(0);
            if (p === null) {
                return;
            }
            for (let i: usize = 0; i < it.count; i++) {
                p[i].x += p[i].y;
            }
        });
    });
    console.log(`    ${query.count(world)} entities across ${query.tableCount} table(s)`);

    world.release();
}
