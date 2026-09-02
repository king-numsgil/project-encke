// Relationships: targets in columns, the reverse index, views, and cleanup.
//
// A relation is a component whose value is an entity handle. Relating a turret
// to a ship writes the ship's handle into the turret's row, so every turret in
// the game shares one table however many ships there are — which is the whole
// reason this design replaced the one that put the target in the table's
// identity and cost a table per ship.
//
// Two consequences get most of the attention here:
//
//   * a column holds a **full handle, generation included**, so a turret whose
//     ship has died reads as pointing at something dead all by itself. Cleanup
//     is policy, not correctness, and that distinction is worth pinning.
//   * the reverse direction — "what are this ship's parts" — is an index, and an
//     index is a thing that goes wrong quietly. Every operation that changes a
//     link has to update it, including the ones nobody thinks about: an entity
//     being destroyed has to stop being listed among its ship's parts.

import { deleteId, indexOf, noneId, removeId } from "../../ecs/id.ts";
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
    const world = new World();
    const childOf = world.relation("ChildOf");
    world.setOnDelete(childOf, deleteId());

    const orbiting = world.relation("Orbiting");
    const insideSystem = world.relation("InsideSystem");
    const position = world.component<Position>("Position");

    t.ok("a relation is a relation", world.isRelation(childOf));
    t.ok("a component is not", !world.isRelation(position));
    t.equalText("and it is named", world.nameOf(childOf), "ChildOf");
    t.equalU64("ChildOf cascades", world.onDeleteOf(childOf), deleteId());
    t.equalU64("a fresh relation only clears", world.onDeleteOf(orbiting), removeId());
    t.equalU64("and an unregistered id does too", world.onDeleteOf(999999), removeId());

    // -- one ship, thirteen parts ----------------------------------------------
    //
    // The shape this design exists for: many parents, few children each.

    const ship = world.create();
    const parts: u64[] = [];
    for (let i: usize = 0; i < 13; i++) {
        const part = world.create();
        world.relate(part, childOf, ship);
        parts.push(part);
    }

    t.equalU64("a part knows its ship", world.targetOf(parts[0], childOf), ship);
    t.ok("and says it has one", world.hasRelation(parts[0], childOf));
    t.ok("the ship does not", !world.hasRelation(ship, childOf));
    t.equalU64("and asking gives none", world.targetOf(ship, childOf), noneId());

    t.equalUsize("the ship has thirteen parts", world.relatedCount(childOf, ship), 13);

    const found: u64[] = [];
    world.related(childOf, ship, found);
    t.equalUsize("and the lookup returns all of them", found.length, 13);

    let agreed: usize = 0;
    for (let i: usize = 0; i < found.length; i++) {
        if (world.targetOf(found[i], childOf) === ship) {
            agreed += 1;
        }
    }
    t.equalUsize("every one of them points back", agreed, 13);

    // **One table.** This is the number the whole redesign is about.
    const parentedTable = world.tableIndexOf(parts[0]);
    let sameTable: usize = 0;
    for (let i: usize = 0; i < parts.length; i++) {
        if (world.tableIndexOf(parts[i]) === parentedTable) {
            sameTable += 1;
        }
    }
    t.equalUsize("all thirteen live in one table", sameTable, 13);

    // A second ship adds no table at all, where the old design added one per ship.
    const tablesBefore = world.tableCount;
    const secondShip = world.create();
    for (let i: usize = 0; i < 13; i++) {
        world.relate(world.create(), childOf, secondShip);
    }
    t.equalUsize("a second ship adds no tables", world.tableCount, tablesBefore);
    t.equalUsize("and has its own thirteen", world.relatedCount(childOf, secondShip), 13);
    t.equalUsize("without disturbing the first", world.relatedCount(childOf, ship), 13);

    // -- several relations at once ------------------------------------------------
    //
    // The ship is inside a system and orbiting a moon, and neither has anything
    // to do with the other or with its parts.

    const sol = world.create();
    const luna = world.create();
    world.relate(ship, insideSystem, sol);
    world.relate(ship, orbiting, luna);

    t.equalU64("the ship is in a system", world.targetOf(ship, insideSystem), sol);
    t.equalU64("and orbiting a moon", world.targetOf(ship, orbiting), luna);
    t.equalUsize("the system knows its ship", world.relatedCount(insideSystem, sol), 1);
    t.equalUsize("and the moon knows too", world.relatedCount(orbiting, luna), 1);
    t.equalUsize("but not through the wrong relation", world.relatedCount(childOf, sol), 0);

    // -- one target at a time -------------------------------------------------------

    const mars = world.create();
    world.relate(ship, orbiting, mars);
    t.equalU64("relating again replaces", world.targetOf(ship, orbiting), mars);
    t.equalUsize("the old target is forgotten", world.relatedCount(orbiting, luna), 0);
    t.equalUsize("and the new one knows", world.relatedCount(orbiting, mars), 1);

    // Relating to the same target twice is a no-op, not a duplicate entry.
    world.relate(ship, orbiting, mars);
    t.equalUsize("relating twice does not duplicate", world.relatedCount(orbiting, mars), 1);

    // -- unrelating ---------------------------------------------------------------------

    t.ok("unrelating says it happened", world.unrelate(ship, orbiting));
    t.ok("again says it did not", !world.unrelate(ship, orbiting));
    t.equalU64("the target is gone", world.targetOf(ship, orbiting), noneId());
    t.ok("and the relation with it", !world.hasRelation(ship, orbiting));
    t.equalUsize("the old target is empty", world.relatedCount(orbiting, mars), 0);
    t.equalU64("while the other relation is untouched", world.targetOf(ship, insideSystem), sol);

    // -- a stale target is detectable on its own -----------------------------------------
    //
    // The property a target packed into an id could not have. A column holds the
    // whole 64-bit handle, so the generation is there and `isAlive` answers
    // without anything having had to clean up first.

    const doomedMoon = world.create();
    const orbiter = world.create();
    world.relate(orbiter, orbiting, doomedMoon);

    // Reach past the world's own bookkeeping by reading the column, so this
    // tests the *storage* rather than the cleanup that follows a destroy.
    const held = world.targetOf(orbiter, orbiting);
    t.ok("the target is alive to start", world.isAlive(held));
    t.equalU64("and is exactly the handle that was stored", held, doomedMoon);

    // -- delete policies -------------------------------------------------------------------

    // `Remove` — the default. The link goes, the holder stays.
    world.destroy(doomedMoon);
    t.ok("the holder survives a Remove-policy target", world.isAlive(orbiter));
    t.ok("with the relation cleared", !world.hasRelation(orbiter, orbiting));
    t.equalU64("and nothing left to point at", world.targetOf(orbiter, orbiting), noneId());

    // `Delete` — the holder goes too.
    t.ok("the ship is destroyed", world.destroy(ship));
    t.equalUsize("and every part with it", livingOf(world, parts), 0);
    t.equalUsize("the ship's list is empty", world.relatedCount(childOf, ship), 0);
    t.equalUsize("while the other ship is untouched", world.relatedCount(childOf, secondShip), 13);

    // Destroying the ship also took it out of the system's list, which is the
    // direction that is easy to forget: a dead entity has to stop being listed
    // among the things pointing at *its* targets.
    t.equalUsize("a dead entity leaves its target's list", world.relatedCount(insideSystem, sol), 0);

    // -- a deep chain -------------------------------------------------------------------------
    //
    // Two hundred deep, which a recursive delete would be entitled to survive
    // and a badly written one would not.

    const deep = new World();
    const deepChild = deep.relation("ChildOf");
    deep.setOnDelete(deepChild, deleteId());

    const chain: u64[] = [];
    let previous = deep.create();
    chain.push(previous);
    for (let i: usize = 0; i < 200; i++) {
        const next = deep.create();
        deep.relate(next, deepChild, previous);
        chain.push(next);
        previous = next;
    }

    t.equalUsize("a chain of 201 is alive", livingOf(deep, chain), 201);
    t.ok("deleting the root works", deep.destroy(chain[0]));
    t.equalUsize("and takes the whole chain", livingOf(deep, chain), 0);

    // -- a wide fan-out -------------------------------------------------------------------------

    const wide = new World();
    const wideChild = wide.relation("ChildOf");
    wide.setOnDelete(wideChild, deleteId());
    const widePosition = wide.component<Position>("Position");

    const root = wide.create();
    const brood: u64[] = [];
    for (let i: usize = 0; i < 500; i++) {
        const child = wide.create();
        wide.set<Position>(child, widePosition, {x: cast<f32>(i), y: 0.0, z: 0.0});
        wide.relate(child, wideChild, root);
        brood.push(child);
    }

    t.equalUsize("five hundred children", livingOf(wide, brood), 500);
    wide.destroy(root);
    t.equalUsize("all deleted with the parent", livingOf(wide, brood), 0);

    const stillParented = new Query([has(wideChild)]);
    t.equalUsize("and nothing has a parent any more", stillParented.count(wide), 0);

    // -- a cycle -------------------------------------------------------------------------------
    //
    // Nothing forbids `a` pointing at `c` pointing at `b` pointing at `a`. A
    // recursive delete would not come back; the worklist terminates because the
    // entity that closes the cycle is already dead when it comes round again.

    const looped = new World();
    const loopChild = looped.relation("ChildOf");
    looped.setOnDelete(loopChild, deleteId());

    const a = looped.create();
    const b = looped.create();
    const c = looped.create();
    looped.relate(a, loopChild, c);
    looped.relate(b, loopChild, a);
    looped.relate(c, loopChild, b);

    t.equalU64("a three-way cycle is allowed", looped.targetOf(a, loopChild), c);
    t.ok("deleting into it terminates", looped.destroy(a));
    t.ok("and takes the whole cycle", !looped.isAlive(a) && !looped.isAlive(b) && !looped.isAlive(c));

    // A self-reference, which is the degenerate case of the same thing.
    const selfish = looped.create();
    looped.relate(selfish, loopChild, selfish);
    t.equalU64("an entity can point at itself", looped.targetOf(selfish, loopChild), selfish);
    t.ok("and deleting it terminates", looped.destroy(selfish));
    t.ok("and it is gone", !looped.isAlive(selfish));

    // -- mixed policies through one delete ---------------------------------------------------------

    const mixed = new World();
    const mixedChild = mixed.relation("ChildOf");
    mixed.setOnDelete(mixedChild, deleteId());
    const admires = mixed.relation("Admires");

    const captain = mixed.create();
    const followers: u64[] = [];
    for (let i: usize = 0; i < 3; i++) {
        const child = mixed.create();
        mixed.relate(child, mixedChild, captain);
        followers.push(child);
    }
    const admirers: u64[] = [];
    for (let i: usize = 0; i < 4; i++) {
        const fan = mixed.create();
        mixed.relate(fan, admires, captain);
        admirers.push(fan);
    }

    mixed.destroy(captain);
    t.equalUsize("the children are deleted", livingOf(mixed, followers), 0);
    t.equalUsize("the admirers are not", livingOf(mixed, admirers), 4);

    let stillAdmiring: usize = 0;
    for (let i: usize = 0; i < admirers.length; i++) {
        if (mixed.hasRelation(admirers[i], admires)) {
            stillAdmiring += 1;
        }
    }
    t.equalUsize("but the relation is cleared on all of them", stillAdmiring, 0);

    // -- views ---------------------------------------------------------------------------------------
    //
    // A cached list that re-copies only when the underlying one has changed. The
    // memory-for-speed trade, and the checks below are that it is *correct* under
    // change rather than merely fast when nothing moves.

    const viewed = new World();
    const partOf = viewed.relation("PartOf");
    const hull = viewed.create();

    const view = viewed.view(partOf, hull);
    t.equalUsize("a view of nothing is empty", view.length, 0);

    const bits: u64[] = [];
    for (let i: usize = 0; i < 5; i++) {
        const bit = viewed.create();
        viewed.relate(bit, partOf, hull);
        bits.push(bit);
    }

    let walked: usize = 0;
    viewed.walk(view, (member) => {
        walked += 1;
    });
    t.equalUsize("and picks up five added after it was made", walked, 5);
    t.equalUsize("with the length to match", view.length, 5);

    // Walking again with nothing changed must give the same answer — this is the
    // path where the version check short-circuits the copy.
    walked = 0;
    viewed.walk(view, (member) => {
        walked += 1;
    });
    t.equalUsize("a second walk with nothing changed agrees", walked, 5);

    // Adding one is seen.
    const extra = viewed.create();
    viewed.relate(extra, partOf, hull);
    walked = 0;
    viewed.walk(view, (member) => {
        walked += 1;
    });
    t.equalUsize("adding a member is seen", walked, 6);

    // Removing one is seen.
    viewed.unrelate(bits[0], partOf);
    walked = 0;
    viewed.walk(view, (member) => {
        walked += 1;
    });
    t.equalUsize("removing one is seen", walked, 5);

    // Destroying one is seen, which goes through a different path again.
    viewed.destroy(bits[1]);
    walked = 0;
    let allAlive = true;
    viewed.walk(view, (member) => {
        walked += 1;
        if (!viewed.isAlive(member)) {
            allAlive = false;
        }
    });
    t.equalUsize("destroying one is seen", walked, 4);
    t.ok("and the view holds no dead handles", allAlive);

    // Two views of the same thing agree, and a view of something else does not
    // pick up the first one's members.
    const second = viewed.view(partOf, hull);
    viewed.sync(second);
    t.equalUsize("a second view of the same target agrees", second.length, 4);

    const elsewhere = viewed.view(partOf, extra);
    viewed.sync(elsewhere);
    t.equalUsize("a view of a different target is empty", elsewhere.length, 0);

    t.equalU64("a view remembers what it is of", view.of, hull);
    t.equalU64("and through what", view.through, partOf);

    // Indexed access after an explicit sync, which is the other way to read one.
    viewed.sync(view);
    let byIndex: usize = 0;
    for (let i: usize = 0; i < view.length; i++) {
        if (viewed.targetOf(view.at(i), partOf) === hull) {
            byIndex += 1;
        }
    }
    t.equalUsize("every member reads back through the column", byIndex, 4);

    // -- the column and the index must never disagree ---------------------------------------------------
    //
    // The target lives in two places: a column on the holder, and a list on the
    // target. `relate` and `unrelate` write both. Everything else that could
    // write one of them without the other is a way to desync the two, and the
    // generic component API is exactly such a way — a relation *is* a component,
    // so `add`, `remove` and `set` will happily reach it.

    const strict = new World();
    const attached = strict.relation("Attached");
    const anchorA = strict.create();
    const anchorB = strict.create();
    const thing = strict.create();

    strict.relate(thing, attached, anchorA);
    t.equalUsize("related, and the index knows", strict.relatedCount(attached, anchorA), 1);

    // `remove` would take the column away and leave the list naming an entity
    // that no longer points at anything.
    t.ok("remove refuses a relation", !strict.remove(thing, attached));
    t.ok("so the relation is still there", strict.hasRelation(thing, attached));
    t.equalUsize("and the index still agrees", strict.relatedCount(attached, anchorA), 1);

    // `set` would rewrite the column and leave both lists wrong: the old target
    // still naming the holder, the new one not naming it at all.
    t.ok("set refuses a relation", !strict.set<u64>(thing, attached, anchorB));
    t.equalU64("so the target is unchanged", strict.targetOf(thing, attached), anchorA);
    t.equalUsize("the old target still has it", strict.relatedCount(attached, anchorA), 1);
    t.equalUsize("and the new one does not", strict.relatedCount(attached, anchorB), 0);

    // `add` would give an entity the relation with nothing behind it — present
    // according to `hasRelation`, absent according to `targetOf`, and in no list.
    const bare = strict.create();
    t.ok("add refuses a relation", !strict.add(bare, attached));
    t.ok("so it holds nothing", !strict.hasRelation(bare, attached));

    // The supported way round does all of it.
    t.ok("relate moves it", strict.relate(thing, attached, anchorB));
    t.equalUsize("the old target loses it", strict.relatedCount(attached, anchorA), 0);
    t.equalUsize("and the new one gains it", strict.relatedCount(attached, anchorB), 1);
    t.ok("unrelate clears it", strict.unrelate(thing, attached));
    t.equalUsize("everywhere", strict.relatedCount(attached, anchorB), 0);
    t.ok("and the column with it", !strict.hasRelation(thing, attached));

    // A component is untouched by any of this — the refusal is for relations
    // only, not a general restriction on the generic API.
    const plain = strict.component<Position>("Position");
    t.ok("a component still adds", strict.add(thing, plain));
    t.ok("still sets", strict.set<Position>(thing, plain, {x: 1.0, y: 2.0, z: 3.0}));
    t.ok("and still removes", strict.remove(thing, plain));

    strict.release();

    // -- a recycled target index must not inherit the old one's members ----------------------------------
    //
    // The index is keyed by the target. If that key were the target's *index*
    // rather than its whole handle, a stale handle to a dead ship would collide
    // with whatever entity took the slot over — and `related` would answer a
    // question about the dead ship with the live one's parts. That is exactly the
    // staleness the column avoids by storing a full handle, and it would have
    // come straight back in through the map.

    const recycle = new World();
    const heldBy = recycle.relation("HeldBy");

    const firstShip = recycle.create();
    const firstPart = recycle.create();
    recycle.relate(firstPart, heldBy, firstShip);

    const staleView = recycle.view(heldBy, firstShip);
    recycle.sync(staleView);
    t.equalUsize("the view sees the first ship's part", staleView.length, 1);

    // `HeldBy` is Remove-policy, so the part survives with its relation cleared
    // and the ship's index goes back on the free list.
    recycle.destroy(firstShip);
    t.ok("the part survives", recycle.isAlive(firstPart));

    const replacement = recycle.create();
    t.equalUsize(
        "the new ship reuses the index",
        cast<usize>(indexOf(replacement)),
        cast<usize>(indexOf(firstShip)),
    );
    t.ok("but is a different entity", replacement !== firstShip);

    const secondPart = recycle.create();
    recycle.relate(secondPart, heldBy, replacement);
    t.equalUsize("the new ship has its own part", recycle.relatedCount(heldBy, replacement), 1);

    // The two checks this block exists for.
    const stale: u64[] = [];
    recycle.related(heldBy, firstShip, stale);
    t.equalUsize("a stale target handle finds nothing", stale.length, 0);
    t.equalUsize("and counts nothing", recycle.relatedCount(heldBy, firstShip), 0);

    recycle.sync(staleView);
    t.equalUsize("a view of a dead target stays empty", staleView.length, 0);

    recycle.release();

    // -- relating things that are not there ------------------------------------------------------------

    const dead = viewed.create();
    viewed.destroy(dead);
    t.ok("relating a dead holder fails", !viewed.relate(dead, partOf, hull));
    t.ok("relating to a dead target fails", !viewed.relate(hull, partOf, dead));
    t.ok("relating through a component fails", !viewed.relate(hull, viewed.tag("NotARelation"), hull));
    t.equalU64("and a dead entity has no target", viewed.targetOf(dead, partOf), noneId());

    viewed.release();
    mixed.release();
    looped.release();
    wide.release();
    deep.release();
    world.release();
}
