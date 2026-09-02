// The entity index: liveness, recycling, and the generation that makes a stale
// handle detectable.
//
// The last of those is what the suite is really for. An index-only handle makes
// every dangling reference silently valid — the entity that used to be a
// projectile is now a UI panel and the code that held onto it never finds out.
// The generation closes that, but only for 65,536 recycles of one index, and the
// wrap is tested here rather than hoped about.

import { Entities, noArchetype } from "../../ecs/entities.ts";
import { componentId, firstUserIndex, generationOf, indexOf, makeEntity, noneId } from "../../ecs/id.ts";
import type { Tester } from "../testing.ts";

export function testEcsEntities(t: Reference<Tester>): void {
    // -- what exists before anything is created --------------------------------

    const entities = new Entities();

    t.equalUsize("the reserved indices exist", entities.capacity, cast<usize>(firstUserIndex()));
    t.equalUsize(
        "all but the null one are alive",
        cast<usize>(entities.count),
        cast<usize>(firstUserIndex()) - 1,
    );

    t.ok("the null id is not alive", !entities.isAlive(noneId()));
    t.ok("a reserved builtin is alive", entities.isAlive(componentId()));
    t.ok("a handle past the end is not alive", !entities.isAlive(makeEntity(99999, 0)));

    // -- creating --------------------------------------------------------------

    const a = entities.create();
    const b = entities.create();
    const c = entities.create();

    t.ok("the first user entity is past the reserved block", indexOf(a) >= firstUserIndex());
    t.ok("fresh entities are alive", entities.isAlive(a) && entities.isAlive(b) && entities.isAlive(c));
    t.ok("they are distinct", a !== b && b !== c && a !== c);
    t.equalUsize("indices are dense", cast<usize>(indexOf(b)), cast<usize>(indexOf(a)) + 1);
    t.equalUsize("a fresh entity has generation 0", cast<usize>(generationOf(a)), 0);
    t.equalUsize(
        "the count follows",
        cast<usize>(entities.count),
        cast<usize>(firstUserIndex()) - 1 + 3,
    );

    t.equalUsize("a fresh entity is in no archetype", cast<usize>(entities.archetypeAt(indexOf(a))), cast<usize>(noArchetype()));

    // -- locations ---------------------------------------------------------------

    entities.setLocation(indexOf(a), 3, 17);
    t.equalUsize("archetype recorded", cast<usize>(entities.archetypeAt(indexOf(a))), 3);
    t.equalUsize("row recorded", cast<usize>(entities.rowAt(indexOf(a))), 17);

    entities.setRow(indexOf(a), 4);
    t.equalUsize("row moved", cast<usize>(entities.rowAt(indexOf(a))), 4);
    t.equalUsize("archetype untouched by a row move", cast<usize>(entities.archetypeAt(indexOf(a))), 3);

    t.equalU64("handleAt finds a live entity", entities.handleAt(indexOf(a)), a);

    // -- destroying ----------------------------------------------------------------

    t.ok("destroying a live entity says so", entities.destroy(b));
    t.ok("it is no longer alive", !entities.isAlive(b));
    t.ok("its neighbours are untouched", entities.isAlive(a) && entities.isAlive(c));
    t.equalU64("handleAt finds nothing at a dead index", entities.handleAt(indexOf(b)), noneId());

    // Not an error. Cleanup code destroys things twice as a matter of course,
    // and a caller that has to check first is a caller that will forget.
    t.ok("destroying it again says no", !entities.destroy(b));
    t.ok("destroying the null id says no", !entities.destroy(noneId()));
    t.ok("destroying a handle past the end says no", !entities.destroy(makeEntity(99999, 0)));

    // -- recycling ------------------------------------------------------------------

    const recycled = entities.create();
    t.equalUsize("the freed index comes back", cast<usize>(indexOf(recycled)), cast<usize>(indexOf(b)));
    t.equalUsize("with the generation bumped", cast<usize>(generationOf(recycled)), 1);
    t.ok("so the new handle is alive", entities.isAlive(recycled));

    // The whole point. Same index, older generation, and the index says nothing
    // about it — only the comparison does.
    t.ok("and the old handle is not", !entities.isAlive(b));
    t.equalUsize(
        "even though they share an index",
        cast<usize>(indexOf(b)),
        cast<usize>(indexOf(recycled)),
    );

    // A location set through the old handle's index belongs to the new entity,
    // which is correct and worth being explicit about: the record is the slot's,
    // not the handle's.
    t.equalUsize(
        "a recycled slot starts in no archetype",
        cast<usize>(entities.archetypeAt(indexOf(recycled))),
        cast<usize>(noArchetype()),
    );

    // -- the free list is a stack ---------------------------------------------------------
    //
    // Last freed, first reused. A queue was tried, to spread generation churn
    // across every index in flight rather than burning one index's whole range;
    // retirement below removes the reason for it, because the total number of
    // retirements is the same whichever end you take from. So the stack, which
    // is one field and warmer in cache.

    const d = entities.create();
    const e = entities.create();
    entities.destroy(d);
    entities.destroy(e);

    t.equalUsize("the last freed comes back first", cast<usize>(indexOf(entities.create())), cast<usize>(indexOf(e)));
    t.equalUsize("then the one before it", cast<usize>(indexOf(entities.create())), cast<usize>(indexOf(d)));

    // Emptying the stack and refilling it, which is where a mishandled head
    // pointer shows up.
    const drained = new Entities();
    const only = drained.create();
    drained.destroy(only);
    t.equalUsize("one on the stack", drained.freeCount, 1);
    drained.destroy(drained.create());
    t.equalUsize("drained and refilled", drained.freeCount, 1);
    t.equalUsize(
        "and it is still the same index",
        cast<usize>(indexOf(drained.create())),
        cast<usize>(indexOf(only)),
    );
    t.equalUsize("with no new index allocated", drained.capacity, cast<usize>(firstUserIndex()) + 1);

    // -- retirement -----------------------------------------------------------------------
    //
    // The generation is 16 bits, so an index can serve 65,536 entities and no
    // more. Rather than wrapping — which would hand back a handle from the very
    // beginning, naming an entity that had nothing to do with it — the slot is
    // taken out of circulation and a fresh index is allocated in its place.
    //
    // The guarantee that buys: **no handle is ever reissued**. That is what makes
    // it safe to keep one in a save file, a script, or an undo stack, and it is
    // the property this block exists to pin.

    const churn = new Entities();
    const original = churn.create();
    const spentIndex = indexOf(original);
    churn.destroy(original);

    // Generations 1 through 65,534, on the same index every time.
    for (let i: usize = 0; i < 65534; i++) {
        churn.destroy(churn.create());
    }

    const last = churn.create();
    t.equalUsize("the same index all the way", cast<usize>(indexOf(last)), cast<usize>(spentIndex));
    t.equalUsize("serving its last generation", cast<usize>(generationOf(last)), 65535);
    t.equalUsize("and nothing retired yet", cast<usize>(churn.retiredCount), 0);
    t.equalUsize("no extra index allocated on the way", churn.capacity, cast<usize>(firstUserIndex()) + 1);

    churn.destroy(last);
    t.equalUsize("the destroy that would wrap retires instead", cast<usize>(churn.retiredCount), 1);
    t.equalUsize("and the index is off the free list", churn.freeCount, 0);

    const afterwards = churn.create();
    t.ok("so the next create allocates a new index", indexOf(afterwards) !== spentIndex);
    t.equalUsize("costing exactly one slot", churn.capacity, cast<usize>(firstUserIndex()) + 2);
    t.equalUsize("which starts at generation zero", cast<usize>(generationOf(afterwards)), 0);

    // The whole point: neither the first handle nor the last one ever comes back.
    t.ok("the first handle stays dead", !churn.isAlive(original));
    t.ok("and so does the last", !churn.isAlive(last));
    t.ok("and the new one is not either of them", afterwards !== original && afterwards !== last);

    // A retired index is never handed out again however hard it is asked for.
    let reissued: usize = 0;
    for (let i: usize = 0; i < 1000; i++) {
        const transient = churn.create();
        if (indexOf(transient) === spentIndex) {
            reissued += 1;
        }
        churn.destroy(transient);
    }
    t.equalUsize("a retired index never comes back", reissued, 0);

    // -- a long-lived handle is never reissued -------------------------------------------
    //
    // The counterpart to the wrap above, and the more important half in practice:
    // **the wrap can only reach an index that was destroyed**. An index arrives
    // on the free list through `destroy` and through nothing else, and `destroy`
    // refuses a handle that is not alive — so an entity held for the lifetime of
    // the program has an index that is never in the list and can never be handed
    // out again, however much churn goes past it.
    //
    // 200,000 recycles below, which is more than three whole generation ranges —
    // so the churned index is retired three times over and the record array
    // grows. If a live index could ever reach the free list, this is where it
    // would show.

    const held = new Entities();
    const player = held.create();
    const camera = held.create();
    const world = held.create();
    held.destroy(camera);

    let collisions: usize = 0;
    let indexClashes: usize = 0;

    for (let i: usize = 0; i < 200000; i++) {
        const transient = held.create();
        if (transient === player || transient === world) {
            collisions += 1;
        }
        if (indexOf(transient) === indexOf(player) || indexOf(transient) === indexOf(world)) {
            indexClashes += 1;
        }
        held.destroy(transient);
    }

    t.equalUsize("200,000 recycles never reissue a live handle", collisions, 0);
    t.equalUsize("nor even a live index", indexClashes, 0);

    t.ok("the long-lived entity is still alive", held.isAlive(player));
    t.ok("and so is its neighbour", held.isAlive(world));
    t.equalUsize("its generation never moved", cast<usize>(generationOf(player)), 0);
    t.equalU64("and handleAt still resolves to it", held.handleAt(indexOf(player)), player);

    // 200,000 destroys of one index at a time is three full ranges and a little
    // over, so three slots are spent.
    t.equalUsize("three indices were retired", cast<usize>(held.retiredCount), 3);

    // And the array grew by exactly one per retirement, which is the arithmetic
    // in the file header — twelve bytes per 65,536 entity lifetimes — stated as
    // a relationship rather than a magic number.
    t.equalUsize(
        "the array grew by exactly one slot per retirement",
        held.capacity,
        cast<usize>(firstUserIndex()) + 3 + cast<usize>(held.retiredCount),
    );

    // -- many entities --------------------------------------------------------------------

    const many = new Entities();
    const handles: u64[] = [];
    handles.reserve(4096);
    for (let i: usize = 0; i < 4096; i++) {
        handles.push(many.create());
    }

    let alive: usize = 0;
    for (let i: usize = 0; i < handles.length; i++) {
        if (many.isAlive(handles[i])) {
            alive += 1;
        }
    }
    t.equalUsize("four thousand entities are all alive", alive, 4096);

    // Destroy every other one, then check the survivors and the casualties are
    // exactly the two sets they should be. A free list that corrupted a record
    // would show up here and nowhere earlier.
    for (let i: usize = 0; i < handles.length; i += 2) {
        many.destroy(handles[i]);
    }

    let survivors: usize = 0;
    let ghosts: usize = 0;
    for (let i: usize = 0; i < handles.length; i++) {
        if (many.isAlive(handles[i])) {
            survivors += 1;
        } else {
            ghosts += 1;
        }
    }
    t.equalUsize("half survive", survivors, 2048);
    t.equalUsize("half do not", ghosts, 2048);
    t.equalUsize(
        "and the count agrees",
        cast<usize>(many.count),
        cast<usize>(firstUserIndex()) - 1 + 2048,
    );

    // Refilling reuses every freed index and adds no new ones.
    const before = many.capacity;
    for (let i: usize = 0; i < 2048; i++) {
        many.create();
    }
    t.equalUsize("refilling allocates no new indices", many.capacity, before);
}
