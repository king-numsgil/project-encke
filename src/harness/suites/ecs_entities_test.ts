// The entity index: liveness, recycling, and the generation that makes a stale
// handle detectable.
//
// The last of those is what the suite is really for. An index-only handle makes
// every dangling reference silently valid — the entity that used to be a
// projectile is now a UI panel and the code that held onto it never finds out.
// The generation closes that, but only for 65,536 recycles of one index, and the
// wrap is tested here rather than hoped about.

import { Entities, noArchetype } from "../../ecs/entities.ts";
import { childOfId, firstUserIndex, generationOf, indexOf, makeEntity, noneId } from "../../ecs/id.ts";
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
    t.ok("ChildOf is alive", entities.isAlive(childOfId()));
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

    // -- the free list is LIFO --------------------------------------------------------
    //
    // Last freed, first reused. Not an arbitrary choice: it keeps a churning
    // workload on one index rather than sweeping across the whole array, which
    // is better for the cache and is what makes the generation wrap below
    // something that can actually happen.

    const d = entities.create();
    const e = entities.create();
    entities.destroy(d);
    entities.destroy(e);

    t.equalUsize("the last freed comes back first", cast<usize>(indexOf(entities.create())), cast<usize>(indexOf(e)));
    t.equalUsize("then the one before it", cast<usize>(indexOf(entities.create())), cast<usize>(indexOf(d)));

    // -- the generation wrap -----------------------------------------------------------
    //
    // 16 bits, so an index recycled 65,536 times hands back the handle it
    // started with. This is the documented cost of packing a pair's two ends
    // into one 64-bit id, and it is asserted rather than warned about — a test
    // that pins the hazard is a test that notices if the layout ever changes.

    const churn = new Entities();
    const original = churn.create();
    churn.destroy(original);

    for (let i: usize = 0; i < 65535; i++) {
        churn.destroy(churn.create());
    }

    const collision = churn.create();
    t.equalU64("after 65,536 recycles the handle repeats exactly", collision, original);
    t.ok("so a handle from the very beginning reads as alive again", churn.isAlive(original));
    t.equalUsize("and the generation is back to zero", cast<usize>(generationOf(collision)), 0);

    // -- a long-lived handle is never reissued -------------------------------------------
    //
    // The counterpart to the wrap above, and the more important half in practice:
    // **the wrap can only reach an index that was destroyed**. An index arrives
    // on the free list through `destroy` and through nothing else, and `destroy`
    // refuses a handle that is not alive — so an entity held for the lifetime of
    // the program has an index that is never in the list and can never be handed
    // out again, however much churn goes past it.
    //
    // 200,000 recycles below, which wraps the recycled index's generation three
    // times over. If the free list could ever contain a live index, this is where
    // it would show.

    const held = new Entities();
    const player = held.create();
    const camera = held.create();
    const world = held.create();
    held.destroy(camera);

    let collisions: usize = 0;
    let indexClashes: usize = 0;
    let wrapped: usize = 0;

    for (let i: usize = 0; i < 200000; i++) {
        const transient = held.create();
        if (transient === player || transient === world) {
            collisions += 1;
        }
        if (indexOf(transient) === indexOf(player) || indexOf(transient) === indexOf(world)) {
            indexClashes += 1;
        }
        if (generationOf(transient) === 0 && i > 0) {
            wrapped += 1;
        }
        held.destroy(transient);
    }

    t.equalUsize("200,000 recycles never reissue a live handle", collisions, 0);
    t.equalUsize("nor even a live index", indexClashes, 0);
    t.ok("and the churned index did wrap, so this was a real test", wrapped >= 3);

    t.ok("the long-lived entity is still alive", held.isAlive(player));
    t.ok("and so is its neighbour", held.isAlive(world));
    t.equalUsize("its generation never moved", cast<usize>(generationOf(player)), 0);
    t.equalU64("and handleAt still resolves to it", held.handleAt(indexOf(player)), player);

    // Only the one destroyed index took the churn, so the record array never grew.
    t.equalUsize(
        "and the churn allocated no new indices",
        held.capacity,
        cast<usize>(firstUserIndex()) + 3,
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
