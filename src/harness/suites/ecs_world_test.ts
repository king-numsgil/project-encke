// Archetypes and the operations that move entities between them.
//
// Most of this suite is aimed at one line in `World.moveEntity`. Removing a row
// fills the hole with the last row, so **some other entity's record now names
// the wrong row**, and the fix is one call that is trivially easy to leave out.
// It does not fail where it happens: the displaced entity reads somebody else's
// components later, in unrelated code, and the values look like a physics bug.
// So there are checks here that add and remove components in every order across
// a table with several rows and verify every entity still reads its own data.
//
// The rest is signature identity — the same ids in a different order must be the
// same table, or the whole scheme degenerates into one archetype per insertion
// order — and the graph edges that make the second traversal of a route cheap.

import { signatureWith, signatureWithout } from "../../ecs/archetype.ts";
import { childOfId, componentId, indexOf, pair } from "../../ecs/id.ts";
import { World } from "../../ecs/world.ts";
import type { Tester } from "../testing.ts";

interface Position {
    x: f32;
    y: f32;
    z: f32;
}

interface Velocity {
    dx: f32;
    dy: f32;
}

interface Health {
    points: i32;
}

/**
 * How many of `handles` are at a row that does not name them back.
 *
 * The invariant every structural change has to preserve, and the only one that
 * catches a missing repoint — see the long note in the swap section below for
 * why comparing component values does not.
 *
 * Dead handles are skipped rather than counted: destroying is a legitimate thing
 * to have done to one, and a caller that wants liveness checks it separately.
 */
function strayRows(world: Reference<World>, handles: Reference<u64[]>): usize {
    let stray: usize = 0;
    for (let i: usize = 0; i < handles.length; i++) {
        const handle = handles[i];
        if (!world.isAlive(handle)) {
            continue;
        }
        const table = world.tableAt(cast<usize>(world.tableIndexOf(handle)));
        const row = cast<usize>(world.rowOf(handle));
        if (row >= table.count || table.entities[row] !== handle) {
            stray += 1;
        }
    }
    return stray;
}

export function testEcsWorld(t: Reference<Tester>): void {
    // -- signature arithmetic, on its own ------------------------------------

    const base: u64[] = [];
    const one = signatureWith(base, 40);
    t.equalUsize("adding to an empty signature", one.length, 1);
    t.equalU64("keeps the id", one[0], 40);

    const two = signatureWith(one, 10);
    t.equalU64("a smaller id sorts first", two[0], 10);
    t.equalU64("and the larger follows", two[1], 40);

    const three = signatureWith(two, 25);
    t.equalU64("and one in the middle lands in the middle", three[1], 25);
    t.equalUsize("three ids", three.length, 3);

    const back = signatureWithout(three, 25);
    t.equalUsize("removing gives two", back.length, 2);
    t.equalU64("the right two", back[0], 10);
    t.equalU64("the right two", back[1], 40);

    t.equalUsize("removing what is not there changes nothing", signatureWithout(three, 99).length, 3);

    // -- an empty world --------------------------------------------------------

    const world = new World();

    // The root table, plus one per shape the reserved entities took on the way
    // in. They all get `Component` in the constructor of nothing, so the count
    // is small and stable; what matters is that a table exists at all.
    t.ok("a fresh world has a root table", world.tableCount >= 1);
    t.ok("ChildOf is alive in it", world.isAlive(childOfId()));
    t.equalText("and is named", world.nameOf(childOfId()), "ChildOf");

    const position = world.component<Position>("Position");
    const velocity = world.component<Velocity>("Velocity");
    const health = world.component<Health>("Health");
    const frozen = world.tag("Frozen");

    t.equalText("a component is named", world.nameOf(position), "Position");
    t.ok("a component id is a live entity", world.isAlive(position));
    t.ok("and carries the Component marker", world.has(position, componentId()));

    t.equalUsize("a registered component knows its size", world.infoFor(position).size, 12);
    t.equalUsize("a tag has none", world.infoFor(frozen).size, 0);
    t.equalUsize("and neither does an unregistered id", world.infoFor(999999).size, 0);

    // -- one entity through a few shapes -----------------------------------------

    const e = world.create();
    t.ok("a new entity is alive", world.isAlive(e));
    t.ok("and holds nothing", !world.has(e, position));
    t.ok("so reading gives null", world.get<Position>(e, position) === null);

    t.ok("adding says it happened", world.add(e, position));
    t.ok("adding again says it did not", !world.add(e, position));
    t.ok("and it is there", world.has(e, position));

    const slot = world.get<Position>(e, position);
    if (slot === null) {
        t.fail("get after add", "returned null");
    } else {
        t.equalF32("a fresh component is zeroed", slot[0].x, 0.0);
        slot[0].x = 4.0;
        slot[0].y = 5.0;
        slot[0].z = 6.0;
    }

    t.ok("set writes", world.set<Velocity>(e, velocity, {dx: 1.0, dy: 2.0}));
    t.ok("and adds the id on the way", world.has(e, velocity));

    // The move to a new table has to have brought Position with it. This is
    // `copySharedFrom` doing its job, and it is the other half of the same bug
    // the row repointing is: silently losing a component on every add.
    const after = world.get<Position>(e, position);
    if (after === null) {
        t.fail("position after adding velocity", "returned null");
    } else {
        t.equalF32("Position survived the move", after[0].x, 4.0);
        t.equalF32("Position survived the move", after[0].y, 5.0);
        t.equalF32("Position survived the move", after[0].z, 6.0);
    }

    const speed = world.get<Velocity>(e, velocity);
    if (speed === null) {
        t.fail("velocity after set", "returned null");
    } else {
        t.equalF32("and the new one holds what was set", speed[0].dx, 1.0);
        t.equalF32("and the new one holds what was set", speed[0].dy, 2.0);
    }

    // A tag moves the entity too, and carries the data with it, but has nothing
    // of its own to read.
    world.add(e, frozen);
    t.ok("the tag is there", world.has(e, frozen));
    t.ok("but has no data", world.get<Position>(e, frozen) === null);
    const stillThere = world.get<Velocity>(e, velocity);
    t.ok("and the data came along", stillThere !== null && stillThere[0].dx === 1.0);

    t.ok("removing says it happened", world.remove(e, velocity));
    t.ok("removing again says it did not", !world.remove(e, velocity));
    t.ok("it is gone", !world.has(e, velocity));
    t.ok("reading it gives null", world.get<Velocity>(e, velocity) === null);

    const survivor = world.get<Position>(e, position);
    t.ok("and the rest survived the removal", survivor !== null && survivor[0].z === 6.0);

    // -- signature identity ------------------------------------------------------
    //
    // Order of addition must not matter. If it did there would be one archetype
    // per permutation, every query would match n! tables, and the whole scheme
    // would be worse than a hash map per entity.

    const forwards = world.create();
    world.add(forwards, position);
    world.add(forwards, velocity);
    world.add(forwards, health);

    const backwards = world.create();
    world.add(backwards, health);
    world.add(backwards, velocity);
    world.add(backwards, position);

    t.equalUsize(
        "the same three ids in any order is one table",
        cast<usize>(world.tableIndexOf(forwards)),
        cast<usize>(world.tableIndexOf(backwards)),
    );

    // And a route taken twice creates nothing new.
    const tablesBefore = world.tableCount;
    const third = world.create();
    world.add(third, position);
    world.add(third, velocity);
    world.add(third, health);
    t.equalUsize("a repeated route builds no new tables", world.tableCount, tablesBefore);

    // Adding then removing returns to exactly the table it left.
    const there = world.tableIndexOf(third);
    world.add(third, frozen);
    t.ok("adding moved it", world.tableIndexOf(third) !== there);
    world.remove(third, frozen);
    t.equalUsize(
        "and removing brought it back to the same table",
        cast<usize>(world.tableIndexOf(third)),
        cast<usize>(there),
    );

    // -- the swap, which is what this suite is for -----------------------------------
    //
    // Eight entities in one table. Components are then added and removed in an
    // order that forces rows to be swap-removed from the *middle*, and the
    // record-to-row mapping is checked after every step.
    //
    // **Checked structurally, not by reading values back**, and that distinction
    // was learned the hard way: an earlier version of this suite compared each
    // entity's component against what had been written into it, and passed with
    // the repointing deliberately deleted. For a plain-data component `drop` is
    // `take`, which the compiler is free to compile to nothing — there is no
    // destructor to run and the zeroing is unobservable — so a vacated row still
    // holds its old bytes and an entity pointing at the wrong row reads exactly
    // what it expected to. The mapping itself is the invariant, so the mapping
    // is what gets asserted: for every live entity, the table it thinks it is in
    // must name it back at the row it thinks it is at.

    const many: u64[] = [];
    for (let i: usize = 0; i < 8; i++) {
        const entity = world.create();
        world.set<Health>(entity, health, {points: cast<i32>(100 + i)});
        many.push(entity);
    }

    let wrong: usize = 0;
    for (let i: usize = 0; i < many.length; i++) {
        const points = world.get<Health>(many[i], health);
        if (points === null || points[0].points !== cast<i32>(100 + i)) {
            wrong += 1;
        }
    }
    t.equalUsize("eight entities each hold their own value", wrong, 0);
    t.equalUsize("and every record names its own row", strayRows(world, many), 0);

    // Move ones out of the middle. Row 2 leaving an eight-row table pulls row 7
    // down into it, so the entity that was last is the one whose record has to
    // be fixed.
    world.add(many[2], position);
    t.equalUsize("after one moves out of the middle", strayRows(world, many), 0);

    world.add(many[5], position);
    world.add(many[3], frozen);
    t.equalUsize("after three have", strayRows(world, many), 0);

    // The behavioural half of the same thing: the vacated row gets reused, so a
    // record still pointing at it now reads a *different entity's* component.
    // This is what the bug actually looks like in a running program.
    const intruder = world.create();
    world.set<Health>(intruder, health, {points: -1});

    wrong = 0;
    for (let i: usize = 0; i < many.length; i++) {
        const points = world.get<Health>(many[i], health);
        if (points !== null && points[0].points === -1) {
            wrong += 1;
        }
    }
    t.equalUsize("nobody reads the new entity's component", wrong, 0);
    t.equalUsize("and the mapping still holds", strayRows(world, many), 0);

    // Destroying from the middle is the same swap through a different path.
    world.destroy(many[1]);
    world.destroy(many[6]);

    let ghosts: usize = 0;
    for (let i: usize = 0; i < many.length; i++) {
        if ((i === 1 || i === 6) === world.isAlive(many[i])) {
            ghosts += 1;
        }
    }
    t.equalUsize("exactly the two destroyed are gone", ghosts, 0);
    t.equalUsize("and the survivors' rows are right", strayRows(world, many), 0);

    wrong = 0;
    for (let i: usize = 0; i < many.length; i++) {
        if (i === 1 || i === 6) {
            continue;
        }
        const points = world.get<Health>(many[i], health);
        if (points === null || points[0].points !== cast<i32>(100 + i)) {
            wrong += 1;
        }
    }
    t.equalUsize("and they still hold their own values", wrong, 0);

    // Removing the id that put them in the table at all, which empties it.
    for (let i: usize = 0; i < many.length; i++) {
        world.remove(many[i], health);
    }
    let remaining: usize = 0;
    for (let i: usize = 0; i < many.length; i++) {
        if (world.has(many[i], health)) {
            remaining += 1;
        }
    }
    t.equalUsize("removing it from all of them leaves none", remaining, 0);

    // -- pairs are ordinary ids to the storage --------------------------------------
    //
    // Nothing in `world.ts` treats a pair specially except `infoFor`, which
    // takes a pair's layout from its relation. Everything below is the ordinary
    // add/remove path, and it working is the whole reason a pair is an id.

    const ship = world.create();
    const child = world.create();
    const childOfShip = pair(childOfId(), ship);

    t.ok("a pair can be added", world.add(child, childOfShip));
    t.ok("and is there", world.has(child, childOfShip));
    t.ok("and it is a tag, since ChildOf carries no data", world.get<Position>(child, childOfShip) === null);

    const other = world.create();
    t.ok("a pair to a different target is a different id", !world.has(child, pair(childOfId(), other)));

    // A relation registered *with* data gives its pairs that data — which is
    // what makes `(Orbits, Earth)` able to carry the orbit.
    const orbits = world.component<Velocity>("Orbits");
    const earth = world.create();
    const moon = world.create();
    const orbitsEarth = pair(orbits, earth);

    t.equalUsize("a pair takes its layout from the relation", world.infoFor(orbitsEarth).size, 8);
    t.ok("so it can be set", world.set<Velocity>(moon, orbitsEarth, {dx: 384.4, dy: 27.3}));

    const orbit = world.get<Velocity>(moon, orbitsEarth);
    if (orbit === null) {
        t.fail("reading a pair's data", "returned null");
    } else {
        t.equalF32("and read back", orbit[0].dx, 384.4);
        t.equalF32("and read back", orbit[0].dy, 27.3);
    }

    // Two pairs with the same relation and different targets are two ids, and an
    // entity can hold both — which is what makes a non-exclusive relation useful
    // and what `Exclusive` will later opt out of.
    const mars = world.create();
    world.set<Velocity>(moon, pair(orbits, mars), {dx: 1.0, dy: 2.0});
    t.ok("an entity can hold two pairs of one relation", world.has(moon, orbitsEarth));
    t.ok("an entity can hold two pairs of one relation", world.has(moon, pair(orbits, mars)));

    const stillEarth = world.get<Velocity>(moon, orbitsEarth);
    t.ok(
        "and they do not share storage",
        stillEarth !== null && stillEarth[0].dx === 384.4,
    );

    // -- churn does not grow storage -------------------------------------------------------
    //
    // The other half of the recycling story. `entities.ts` makes an index cheap
    // to reuse; this is whether the *row* is. A create/destroy pair pushes and
    // pops one row, and `T[].pop` and `Column.swapRemove` both keep their
    // buffers — so a spawner running for hours holds the high-water mark of
    // whatever archetype it churns through, and not a byte more.

    const spawnTable = world.tableIndexOf(many[0]);
    const spawnColumn = world.tableAt(cast<usize>(spawnTable)).columns[0].capacity;
    const spawnTables = world.tableCount;

    for (let i: usize = 0; i < 20000; i++) {
        const transient = world.create();
        world.set<Health>(transient, health, {points: cast<i32>(i)});
        world.destroy(transient);
    }

    t.equalUsize("twenty thousand spawns build no new tables", world.tableCount, spawnTables);
    t.equalUsize(
        "and no new column capacity",
        world.tableAt(cast<usize>(spawnTable)).columns[0].capacity,
        spawnColumn,
    );

    // -- an archetype is never destroyed, and a pair is part of the signature ----------------
    //
    // This is the cost side of relationships being ids, and it is worth pinning
    // because it is the one place entity churn *can* grow memory.
    //
    // `(ChildOf, parent)` is built from the parent's **index**, so a recycled
    // index maps back to the same id and therefore to the same table. A spawner
    // that parents each thing to a short-lived owner reuses one archetype
    // forever, which is the first check below. A world holding many parents
    // alive at once needs one archetype each, which is the second — and those
    // tables are **not** given back when the parents die, because nothing here
    // destroys an archetype.

    const recycled = new World();

    // Warmed up first, because the count settles at *two* rather than one and
    // the reason is worth knowing: the cascade frees the parent and then the
    // child, and a stack hands them back in the opposite order — so the two
    // indices swap roles every iteration and the loop alternates between
    // `(ChildOf, a)` and `(ChildOf, b)`. Bounded, reused, and not one.
    for (let i: usize = 0; i < 10; i++) {
        const parent = recycled.create();
        const kid = recycled.create();
        recycled.add(kid, pair(childOfId(), parent));
        recycled.destroy(parent);
    }
    const settled = recycled.tableCount;

    for (let i: usize = 0; i < 1000; i++) {
        const parent = recycled.create();
        const kid = recycled.create();
        recycled.add(kid, pair(childOfId(), parent));
        // Cascades to the child, so both indices come back and the next
        // iteration rebuilds a pair id that already has a table.
        recycled.destroy(parent);
    }
    t.equalUsize("a thousand short-lived parents build no new archetypes", recycled.tableCount, settled);
    t.ok("and the whole loop used only a handful of tables", settled <= 6);

    const alive = new World();
    const beforeParents = alive.tableCount;
    const held: u64[] = [];
    for (let i: usize = 0; i < 50; i++) {
        const parent = alive.create();
        held.push(parent);
        const kid = alive.create();
        alive.add(kid, pair(childOfId(), parent));
    }
    t.equalUsize(
        "fifty live parents need fifty archetypes",
        alive.tableCount,
        beforeParents + 50,
    );

    for (let i: usize = 0; i < held.length; i++) {
        alive.destroy(held[i]);
    }
    t.equalUsize(
        "and killing them gives none of it back",
        alive.tableCount,
        beforeParents + 50,
    );

    recycled.release();
    alive.release();

    // -- dead entities ----------------------------------------------------------------

    const doomed = world.create();
    world.set<Health>(doomed, health, {points: 1});
    t.ok("destroying works", world.destroy(doomed));
    t.ok("twice does not", !world.destroy(doomed));
    t.ok("a dead entity has nothing", !world.has(doomed, health));
    t.ok("reading it gives null", world.get<Health>(doomed, health) === null);
    t.ok("adding to it fails", !world.add(doomed, position));
    t.ok("removing from it fails", !world.remove(doomed, health));
    t.ok("and setting fails", !world.set<Health>(doomed, health, {points: 2}));

    // A recycled index gets a clean slate, which is the entity index and the
    // table machinery agreeing about what "a new entity" means.
    const reborn = world.create();
    t.equalUsize("the index came back", cast<usize>(indexOf(reborn)), cast<usize>(indexOf(doomed)));
    t.ok("but it holds nothing", !world.has(reborn, health));

    world.release();
}
