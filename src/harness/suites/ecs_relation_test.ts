// Relationships: exclusivity, delete policies, and the cascade.
//
// This is the suite that decides whether relationships are a feature or a
// footgun. A pair packs two entity references into 64 bits, which leaves nothing
// for a generation, so `(ChildOf, ship)` names the ship by index and goes on
// naming it after the ship is gone. A stale *handle* is detectable; a stale pair
// is not. Everything below is about the machinery that finds those pairs before
// the target stops existing.
//
// The cases that matter are the ones where the obvious implementation is wrong:
// a hierarchy deep enough to blow a recursive delete, a cycle that a recursive
// delete never leaves, and stripping a pair while walking the very tables the
// stripping reorders.

import {
    childOfId,
    deleteId,
    exclusiveId,
    noneId,
    onDeleteId,
    pair,
    removeId,
    wildcardId,
} from "../../ecs/id.ts";
import { has, Query } from "../../ecs/query.ts";
import { World } from "../../ecs/world.ts";
import type { Tester } from "../testing.ts";

interface Position {
    x: f32;
    y: f32;
    z: f32;
}

/** How many of `handles` are still alive. */
function livingOf(world: Reference<World>, handles: Reference<u64[]>): usize {
    let alive: usize = 0;
    for (let i: usize = 0; i < handles.length; i++) {
        if (world.isAlive(handles[i])) {
            alive += 1;
        }
    }
    return alive;
}

export function testEcsRelation(t: Reference<Tester>): void {
    // -- what ChildOf is configured as ----------------------------------------

    const world = new World();

    t.ok("ChildOf is exclusive", world.isExclusive(childOfId()));
    t.equalU64("and cascades on delete", world.onDeleteOf(childOfId()), deleteId());
    t.ok("OnDelete is itself exclusive", world.isExclusive(onDeleteId()));

    // An ordinary relation is neither, which is the right default: a pair that
    // deleted its holder by surprise would be much worse than one that lingered.
    const likes = world.tag("Likes");
    t.ok("a fresh relation is not exclusive", !world.isExclusive(likes));
    t.equalU64("and only strips on delete", world.onDeleteOf(likes), removeId());
    t.equalU64("as does an unregistered id", world.onDeleteOf(999999), removeId());

    // -- exclusivity -----------------------------------------------------------

    const alice = world.create();
    const bob = world.create();
    const carol = world.create();

    // Not exclusive: several targets at once.
    world.add(alice, pair(likes, bob));
    world.add(alice, pair(likes, carol));
    t.ok("a plain relation holds two targets", world.has(alice, pair(likes, bob)));
    t.ok("a plain relation holds two targets", world.has(alice, pair(likes, carol)));

    // Exclusive: the second replaces the first.
    const ship = world.create();
    const station = world.create();
    const crate = world.create();

    world.add(crate, pair(childOfId(), ship));
    t.equalU64("the parent is the one that was set", world.parentOf(crate), ship);

    world.add(crate, pair(childOfId(), station));
    t.ok("adding a second parent removed the first", !world.has(crate, pair(childOfId(), ship)));
    t.ok("and installed the second", world.has(crate, pair(childOfId(), station)));
    t.equalU64("so parentOf says the new one", world.parentOf(crate), station);

    // Re-adding the same parent is not a replacement and not a move.
    const settled = world.tableIndexOf(crate);
    t.ok("re-adding the same parent does nothing", !world.add(crate, pair(childOfId(), station)));
    t.equalUsize(
        "and does not move the entity",
        cast<usize>(world.tableIndexOf(crate)),
        cast<usize>(settled),
    );

    // Exclusivity is a property of the relation, applied to any of them.
    const dockedTo = world.tag("DockedTo");
    world.markExclusive(dockedTo);
    t.ok("a relation can be made exclusive", world.isExclusive(dockedTo));

    world.add(ship, pair(dockedTo, station));
    world.add(ship, pair(dockedTo, crate));
    t.ok("and then behaves like one", !world.has(ship, pair(dockedTo, station)));
    t.ok("and then behaves like one", world.has(ship, pair(dockedTo, crate)));

    // The replacement carries the entity's other components with it, because it
    // is one ordinary archetype move.
    const position = world.component<Position>("Position");
    world.set<Position>(crate, position, {x: 7.0, y: 8.0, z: 9.0});
    world.add(crate, pair(childOfId(), ship));

    const moved = world.get<Position>(crate, position);
    t.ok("re-parenting keeps the other components", moved !== null && moved[0].x === 7.0);
    t.ok("and it really re-parented", world.parentOf(crate) === ship);

    // -- the target index ---------------------------------------------------------

    t.ok("the index knows a table names the ship", world.tablesNaming(ship) >= 1);
    t.equalUsize("and knows nothing names a fresh entity", world.tablesNaming(world.create()), 0);

    // -- looking children up --------------------------------------------------------

    const crew: u64[] = [];
    for (let i: usize = 0; i < 6; i++) {
        const member = world.create();
        world.add(member, pair(childOfId(), i < 4 ? ship : station));
        crew.push(member);
    }

    const children: u64[] = [];
    world.childrenOf(ship, children);
    // Four crew plus the crate, which was re-parented to the ship above.
    t.equalUsize("the ship has five children", children.length, 5);

    const stationChildren: u64[] = [];
    world.childrenOf(station, stationChildren);
    t.equalUsize("the station has two", stationChildren.length, 2);

    const noChildren: u64[] = [];
    world.childrenOf(crew[0], noChildren);
    t.equalUsize("a leaf has none", noChildren.length, 0);

    // Every child agrees about who its parent is, which is the other direction
    // of the same fact and the check that the index is not just plausible.
    let agreed: usize = 0;
    for (let i: usize = 0; i < children.length; i++) {
        if (world.parentOf(children[i]) === ship) {
            agreed += 1;
        }
    }
    t.equalUsize("and every one of them says so", agreed, 5);

    t.equalU64("an entity with no parent says none", world.parentOf(alice), noneId());
    t.equalU64("and so does a dead handle", world.parentOf(makeDead(world)), noneId());

    // -- the Remove policy ------------------------------------------------------------
    //
    // The default. The pair goes, the holder stays. `alice` likes `bob` and
    // `carol`; deleting `bob` must leave `alice` alive and still liking `carol`.

    t.ok("bob is deleted", world.destroy(bob));
    t.ok("alice survives", world.isAlive(alice));
    t.ok("and no longer likes bob", !world.has(alice, pair(likes, bob)));
    t.ok("but still likes carol", world.has(alice, pair(likes, carol)));

    // -- the Delete policy ---------------------------------------------------------------
    //
    // `ChildOf` cascades, so deleting the station deletes its two children.

    const stationCrew: u64[] = [];
    world.childrenOf(station, stationCrew);
    t.equalUsize("the station has two children before", stationCrew.length, 2);

    t.ok("the station is deleted", world.destroy(station));
    t.equalUsize("and its children with it", livingOf(world, stationCrew), 0);
    t.ok("while the ship's crew is untouched", world.isAlive(crew[0]));

    // -- a deep hierarchy -----------------------------------------------------------------
    //
    // Two hundred deep, which a recursive delete would be entitled to survive
    // and a badly written one would not. The worklist makes the depth irrelevant.

    const deep = new World();
    const chain: u64[] = [];
    let previous = deep.create();
    chain.push(previous);
    for (let i: usize = 0; i < 200; i++) {
        const next = deep.create();
        deep.add(next, pair(childOfId(), previous));
        chain.push(next);
        previous = next;
    }

    t.equalUsize("a chain of 201 is alive", livingOf(deep, chain), 201);
    t.ok("deleting the root works", deep.destroy(chain[0]));
    t.equalUsize("and takes the whole chain", livingOf(deep, chain), 0);

    // -- a wide hierarchy -------------------------------------------------------------------
    //
    // One parent, five hundred children, each also holding a component — so the
    // cascade is stripping and destroying across a table it is walking.

    const wide = new World();
    const widePosition = wide.component<Position>("Position");
    const root = wide.create();
    const brood: u64[] = [];
    for (let i: usize = 0; i < 500; i++) {
        const child = wide.create();
        wide.set<Position>(child, widePosition, {x: cast<f32>(i), y: 0.0, z: 0.0});
        wide.add(child, pair(childOfId(), root));
        brood.push(child);
    }

    t.equalUsize("five hundred children", livingOf(wide, brood), 500);
    wide.destroy(root);
    t.equalUsize("all deleted with the parent", livingOf(wide, brood), 0);
    t.ok("and the root is gone", !wide.isAlive(root));

    const orphanQuery = new Query([has(pair(childOfId(), wildcardId()))]);
    t.equalUsize("nothing has a parent any more", orphanQuery.count(wide), 0);

    // -- a cycle -------------------------------------------------------------------------------
    //
    // Nothing forbids `a` being a child of `b` and `b` a child of `a`. A
    // recursive delete would not come back; the worklist terminates because the
    // entity that closes the cycle is already dead when it comes round again.

    const looped = new World();
    const a = looped.create();
    const b = looped.create();
    const c = looped.create();
    looped.add(a, pair(childOfId(), c));
    looped.add(b, pair(childOfId(), a));
    looped.add(c, pair(childOfId(), b));

    t.ok("a three-way cycle is allowed", looped.parentOf(a) === c);
    t.ok("deleting into it terminates", looped.destroy(a));
    t.ok("and takes the whole cycle", !looped.isAlive(a) && !looped.isAlive(b) && !looped.isAlive(c));

    // A self-parent, which is the degenerate case of the same thing.
    const selfish = looped.create();
    looped.add(selfish, pair(childOfId(), selfish));
    t.ok("an entity can be its own parent", looped.parentOf(selfish) === selfish);
    t.ok("and deleting it terminates", looped.destroy(selfish));
    t.ok("and it is gone", !looped.isAlive(selfish));

    // -- mixed policies through one delete -------------------------------------------------------
    //
    // One entity is both a parent and the target of an ordinary relation, so the
    // cascade and the strip both run for the same delete.

    const mixed = new World();
    const admires = mixed.tag("Admires");
    const captain = mixed.create();

    const followers: u64[] = [];
    for (let i: usize = 0; i < 3; i++) {
        const child = mixed.create();
        mixed.add(child, pair(childOfId(), captain));
        followers.push(child);
    }

    const admirers: u64[] = [];
    for (let i: usize = 0; i < 4; i++) {
        const fan = mixed.create();
        mixed.add(fan, pair(admires, captain));
        admirers.push(fan);
    }

    mixed.destroy(captain);
    t.equalUsize("the children are deleted", livingOf(mixed, followers), 0);
    t.equalUsize("the admirers are not", livingOf(mixed, admirers), 4);

    let stillAdmiring: usize = 0;
    for (let i: usize = 0; i < admirers.length; i++) {
        if (mixed.has(admirers[i], pair(admires, captain))) {
            stillAdmiring += 1;
        }
    }
    t.equalUsize("but the pair is stripped from all of them", stillAdmiring, 0);

    // A grandchild through the cascade: deleting the captain deletes the
    // followers, and deleting a follower deletes *its* children in turn.
    const generations = new World();
    const grandparent = generations.create();
    const parent = generations.create();
    const grandchild = generations.create();
    generations.add(parent, pair(childOfId(), grandparent));
    generations.add(grandchild, pair(childOfId(), parent));

    generations.destroy(grandparent);
    t.ok("the cascade reaches a grandchild", !generations.isAlive(grandchild));

    // -- setOnDelete ---------------------------------------------------------------------------------

    const configured = new World();
    const carries = configured.tag("Carries");
    configured.setOnDelete(carries, deleteId());
    t.equalU64("the policy took", configured.onDeleteOf(carries), deleteId());

    const cargo = configured.create();
    const hold = configured.create();
    configured.add(cargo, pair(carries, hold));
    configured.destroy(hold);
    t.ok("and a custom cascade works", !configured.isAlive(cargo));

    // Set again, to the other policy, and the exclusivity of OnDelete means it
    // replaces rather than accumulates.
    configured.setOnDelete(carries, removeId());
    t.equalU64("the policy can be changed back", configured.onDeleteOf(carries), removeId());
    t.ok("and OnDelete did not accumulate", configured.has(carries, pair(onDeleteId(), removeId())));
    t.ok("and OnDelete did not accumulate", !configured.has(carries, pair(onDeleteId(), deleteId())));

    const kept = configured.create();
    const gone = configured.create();
    configured.add(kept, pair(carries, gone));
    configured.destroy(gone);
    t.ok("so the holder survives now", configured.isAlive(kept));
    t.ok("with the pair stripped", !configured.has(kept, pair(carries, gone)));

    // -- an exclusive relation with a data payload -----------------------------------------------------
    //
    // The replacement is one archetype move, so the *old* pair's data goes and
    // the new pair's starts at its default. Anything else would be a value
    // carried across two different relationships by accident.

    const payload = new World();
    const orbits = payload.component<Position>("Orbits");
    payload.markExclusive(orbits);

    const moon = payload.create();
    const earth = payload.create();
    const mars = payload.create();

    payload.set<Position>(moon, pair(orbits, earth), {x: 384.4, y: 0.0, z: 0.0});
    const around = payload.get<Position>(moon, pair(orbits, earth));
    t.ok("an exclusive relation can carry data", around !== null && around[0].x === 384.4);

    payload.set<Position>(moon, pair(orbits, mars), {x: 1.0, y: 2.0, z: 3.0});
    t.ok("switching targets removed the old pair", !payload.has(moon, pair(orbits, earth)));
    t.ok("and reading it gives null", payload.get<Position>(moon, pair(orbits, earth)) === null);

    const now = payload.get<Position>(moon, pair(orbits, mars));
    t.ok("while the new one holds its own value", now !== null && now[0].x === 1.0);

    // -- the builtins are ordinary entities --------------------------------------------------------------

    t.ok("Exclusive is on ChildOf as a plain id", world.has(childOfId(), exclusiveId()));
    t.ok(
        "and OnDelete is on it as a plain pair",
        world.has(childOfId(), pair(onDeleteId(), deleteId())),
    );

    payload.release();
    configured.release();
    generations.release();
    mixed.release();
    looped.release();
    wide.release();
    deep.release();
    world.release();
}

/** A handle that was alive and is not. */
function makeDead(world: Reference<World>): u64 {
    const doomed = world.create();
    world.destroy(doomed);
    return doomed;
}
