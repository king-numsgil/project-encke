// Query matching and iteration.
//
// Two properties get the most attention here, because both are easy to get
// subtly right and completely wrong at the same time.
//
// The first is that a query built **before** the tables it matches finds them
// anyway. The matching is incremental — a cursor over an append-only table list
// — and a cursor that is advanced in the wrong place gives a query that works
// perfectly in every test where the world is built first and silently returns
// nothing in a program where a system is registered at startup.
//
// The second is that the column pointers a body walks are the right ones. A
// term's index into the query is not its index into the table's columns, and
// nothing catches a confusion between them except reading values back — so every
// entity here holds a value derived from its own identity, and the checks are
// that the body sees exactly the set it should.

import { childOfId, pair, wildcardId } from "../../ecs/id.ts";
import { has, maybe, not, Query } from "../../ecs/query.ts";
import { World } from "../../ecs/world.ts";
import type { Tester } from "../testing.ts";

interface Position {
    x: f32;
    y: f32;
    z: f32;
}

interface Health {
    points: i32;
}

export function testEcsQuery(t: Reference<Tester>): void {
    const world = new World();

    const position = world.component<Position>("Position");
    const health = world.component<Health>("Health");
    const frozen = world.tag("Frozen");
    const hidden = world.tag("Hidden");

    // -- a query built before anything it matches --------------------------------
    //
    // Registered first, on purpose. Every table it will ever match is created
    // after this line.

    const early = new Query([has(position)]);
    t.equalUsize("a query over an empty world matches nothing", early.count(world), 0);

    // -- the world ------------------------------------------------------------------
    //
    // Four shapes: Position alone, Position+Health, Position+Frozen, Health alone.
    // Every entity's Position.x is its index in `all`, so the body can say which
    // entities it saw.

    const all: u64[] = [];
    for (let i: usize = 0; i < 12; i++) {
        const e = world.create();
        all.push(e);

        if (i % 4 !== 3) {
            world.set<Position>(e, position, {x: cast<f32>(i), y: 0.0, z: 0.0});
        }
        if (i % 4 === 1 || i % 4 === 3) {
            world.set<Health>(e, health, {points: cast<i32>(i)});
        }
        if (i % 4 === 2) {
            world.add(e, frozen);
        }
    }

    // Nine of the twelve have Position: every one except i % 4 === 3.
    t.equalUsize("the early query found the new tables", early.count(world), 9);

    // -- one term -----------------------------------------------------------------------

    const withHealth = new Query([has(health)]);
    t.equalUsize("six have Health", withHealth.count(world), 6);

    const withFrozen = new Query([has(frozen)]);
    t.equalUsize("three are Frozen", withFrozen.count(world), 3);

    const withHidden = new Query([has(hidden)]);
    t.equalUsize("none are Hidden", withHidden.count(world), 0);

    // -- two terms --------------------------------------------------------------------------

    const both = new Query([has(position), has(health)]);
    t.equalUsize("three have both", both.count(world), 3);

    // -- exclusion ----------------------------------------------------------------------------

    const unfrozen = new Query([has(position), not(frozen)]);
    t.equalUsize("six have Position and are not Frozen", unfrozen.count(world), 6);

    const nothingAtAll = new Query([has(position), not(position)]);
    t.equalUsize("a contradiction matches nothing", nothingAtAll.count(world), 0);

    // -- what the body actually sees -----------------------------------------------------------
    //
    // The sum of every `x` the body walks. Position.x is the entity's index, so
    // a body reading the wrong column, or the wrong number of rows, gets a
    // different total — and the sum of a set is a check that does not care what
    // order the tables come in.

    let seen: usize = 0;
    let sum: f32 = 0.0;
    early.each(world, (it) => {
        const p = it.column<Position>(0);
        if (p === null) {
            return;
        }
        seen += it.count;
        for (let i: usize = 0; i < it.count; i++) {
            sum += p[i].x;
        }
    });

    // 0..11 except 3, 7 and 11, which have no Position.
    t.equalUsize("the body walked every matching entity", seen, 9);
    t.equalF32("and read each one's own value", sum, 45.0);

    // Two columns at once, which is the case the term-index-to-column-index
    // mapping exists for: Position is term 0 and Health is term 1, and in the
    // table they may sit in either order.
    let pairs: usize = 0;
    let agreed: usize = 0;
    both.each(world, (it) => {
        const p = it.column<Position>(0);
        const h = it.column<Health>(1);
        if (p === null || h === null) {
            return;
        }
        pairs += it.count;
        for (let i: usize = 0; i < it.count; i++) {
            if (cast<i32>(p[i].x) === h[i].points) {
                agreed += 1;
            }
        }
    });
    t.equalUsize("both-term query walked three", pairs, 3);
    t.equalUsize("and the two columns line up row for row", agreed, 3);

    // The entity handle for a row, which is how a body acts on what it found.
    let handlesMatched: usize = 0;
    both.each(world, (it) => {
        const p = it.column<Position>(0);
        if (p === null) {
            return;
        }
        for (let i: usize = 0; i < it.count; i++) {
            if (all[cast<usize>(p[i].x)] === it.entity(i)) {
                handlesMatched += 1;
            }
        }
    });
    t.equalUsize("and the entity at each row is the right one", handlesMatched, 3);

    // -- optional terms -----------------------------------------------------------------------
    //
    // The term takes a slot whether or not the table has it, so the numbering
    // the body uses does not shift from table to table.

    const withMaybe = new Query([has(position), maybe(health)]);
    t.equalUsize("optional does not narrow the match", withMaybe.count(world), 9);

    let withData: usize = 0;
    let withoutData: usize = 0;
    withMaybe.each(world, (it) => {
        const h = it.column<Health>(1);
        if (h === null) {
            withoutData += it.count;
            t.ok("a table without the optional says so", !it.holds(1));
            return;
        }
        withData += it.count;
    });
    t.equalUsize("three of the nine carry the optional", withData, 3);
    t.equalUsize("and six do not", withoutData, 6);

    // A tag as a term: it matches, and its column is null because there is
    // nothing to point at.
    const frozenOnes = new Query([has(position), has(frozen)]);
    let tagTables: usize = 0;
    frozenOnes.each(world, (it) => {
        tagTables += 1;
        t.ok("a tag term matched", it.holds(1));
        t.ok("but has no column", it.column<Health>(1) === null);
    });
    t.equalUsize("one table holds Position and Frozen", tagTables, 1);

    // -- no terms at all ------------------------------------------------------------------------
    //
    // Matches every table including the empty root, which is the right answer to
    // "everything" and worth pinning so nobody makes it a special case.

    const everything = new Query([]);
    t.ok("a query with no terms matches everything alive", everything.count(world) >= 12);
    t.equalUsize("and every table", everything.tableCount, world.tableCount);

    // -- relationships ----------------------------------------------------------------------------

    const ship = world.create();
    const station = world.create();

    const crew: u64[] = [];
    for (let i: usize = 0; i < 5; i++) {
        const member = world.create();
        world.add(member, pair(childOfId(), i < 3 ? ship : station));
        crew.push(member);
    }

    const ofShip = new Query([has(pair(childOfId(), ship))]);
    t.equalUsize("three are children of the ship", ofShip.count(world), 3);

    const ofStation = new Query([has(pair(childOfId(), station))]);
    t.equalUsize("two are children of the station", ofStation.count(world), 2);

    // The wildcard: everything with a parent, whoever the parent is. This is the
    // query that makes relationships worth having as ids — it is an ordinary
    // term over an ordinary signature, not a second mechanism.
    const anyParent = new Query([has(pair(childOfId(), wildcardId()))]);
    t.equalUsize("five have a parent", anyParent.count(world), 5);

    // And which parent, recovered from the resolved id.
    let toShip: usize = 0;
    let toStation: usize = 0;
    anyParent.each(world, (it) => {
        const target = it.idAt(0);
        for (let i: usize = 0; i < it.count; i++) {
            if (target === pair(childOfId(), ship)) {
                toShip += 1;
            } else if (target === pair(childOfId(), station)) {
                toStation += 1;
            }
        }
    });
    t.equalUsize("the resolved id says which parent, for the ship", toShip, 3);
    t.equalUsize("and for the station", toStation, 2);

    // The other wildcard: any relation at all to one target.
    const orbits = world.tag("Orbits");
    world.add(ship, pair(orbits, station));

    const anythingToStation = new Query([has(pair(wildcardId(), station))]);
    t.equalUsize(
        "two children plus the ship that orbits it",
        anythingToStation.count(world),
        3,
    );

    // A bare `*` matches any id at all, so every entity holding anything is in.
    const holdsAnything = new Query([has(wildcardId())]);
    t.ok("* matches everything with any id", holdsAnything.count(world) >= 17);

    // Exclusion works on pairs the same way it works on components.
    const orphans = new Query([has(position), not(pair(childOfId(), wildcardId()))]);
    t.equalUsize("the nine with Position have no parents", orphans.count(world), 9);

    // -- incremental rematching ---------------------------------------------------------------------
    //
    // A query that has already run must pick up a table created afterwards. The
    // cursor makes that cheap; getting it wrong makes it never happen.

    const before = ofShip.tableCount;
    const late = world.create();
    world.add(late, pair(childOfId(), ship));
    world.add(late, position);

    t.equalUsize("a new shape is matched on the next look", ofShip.count(world), 4);
    t.ok("through a table the query had not seen", ofShip.tableCount > before);

    // And the count follows entities leaving as well as arriving.
    world.remove(late, pair(childOfId(), ship));
    t.equalUsize("and it drops again when the id is removed", ofShip.count(world), 3);

    world.destroy(crew[0]);
    t.equalUsize("and when an entity is destroyed", ofShip.count(world), 2);

    world.release();
}
