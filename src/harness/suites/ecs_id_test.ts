// The id bit layout.
//
// Every other file in `ecs/` reads ids through these functions and none of them
// touches a bit itself, so this suite is where a shifted mask turns into a
// failure instead of into an entity that is somebody else. The cases that matter
// are the boundaries — index zero and index 2^32-1, generation zero and 65535 —
// because a mask that is one bit short works perfectly for every small number
// anyone tests by hand.

import {
    childOfId,
    componentId,
    deleteId,
    exclusiveId,
    firstUserIndex,
    generationOf,
    hasWildcard,
    indexOf,
    isPair,
    isReserved,
    isWildcard,
    makeEntity,
    makePairFromIndices,
    matches,
    noneId,
    onDeleteId,
    pair,
    relationOf,
    removeId,
    targetOf,
    wildcardId,
} from "../../ecs/id.ts";
import type { Tester } from "../testing.ts";

export function testEcsId(t: Reference<Tester>): void {
    // -- plain ids, at the boundaries -----------------------------------------

    const first = makeEntity(0, 0);
    t.equalU64("index 0 generation 0 is the null id", first, 0);
    t.equalUsize("index of it", cast<usize>(indexOf(first)), 0);
    t.equalUsize("generation of it", cast<usize>(generationOf(first)), 0);

    const ordinary = makeEntity(1234567, 7);
    t.equalUsize("an ordinary index", cast<usize>(indexOf(ordinary)), 1234567);
    t.equalUsize("an ordinary generation", cast<usize>(generationOf(ordinary)), 7);
    t.ok("an entity is not a pair", !isPair(ordinary));

    // The last index there is. A 31-bit mask would give 2147483647 here.
    const last = makeEntity(0xffffffff, 0xffff);
    t.equalUsize("the largest index survives", cast<usize>(indexOf(last)), 4294967295);
    t.equalUsize("the largest generation survives", cast<usize>(generationOf(last)), 65535);
    t.ok("the largest id is still not a pair", !isPair(last));

    // A generation past 16 bits wraps rather than bleeding into the flags. The
    // caller that increments it wraps at the same width, so the two always agree.
    const wrapped = makeEntity(9, 0x10000);
    t.equalUsize("a generation of 65536 wraps to 0", cast<usize>(generationOf(wrapped)), 0);
    t.equalUsize("and does not disturb the index", cast<usize>(indexOf(wrapped)), 9);

    // Generation is not index. This is the check that catches a shift of the
    // wrong size, which otherwise makes two different entities equal.
    t.ok(
        "index and generation are different fields",
        makeEntity(3, 0) !== makeEntity(0, 3),
    );

    // -- pairs ------------------------------------------------------------------

    const ship = makeEntity(200, 4);
    const parented = pair(childOfId(), ship);

    t.ok("a pair says it is one", isPair(parented));
    t.equalUsize("the relation half", cast<usize>(relationOf(parented)), cast<usize>(indexOf(childOfId())));
    t.equalUsize("the target half", cast<usize>(targetOf(parented)), 200);

    // A pair has nowhere to put a generation, so it records both ends by index.
    // Two handles for the same index therefore build the same pair — which is
    // the whole reason `relation.ts` has to clean up after a delete rather than
    // relying on a generation check to invalidate the pair.
    const shipAgain = makeEntity(200, 9);
    t.equalU64("a pair drops generations", pair(childOfId(), shipAgain), parented);

    const wide = makePairFromIndices(0x7fffffff, 0xffffffff);
    t.ok("a pair with both halves full is a pair", isPair(wide));
    t.equalUsize("the widest relation", cast<usize>(relationOf(wide)), 2147483647);
    t.equalUsize("the widest target", cast<usize>(targetOf(wide)), 4294967295);

    // Asking a plain id for its halves is answered rather than undefined, so a
    // caller that forgot to check `isPair` gets zero and not somebody's index.
    t.equalUsize("a plain id has no relation", cast<usize>(relationOf(ordinary)), 0);
    t.equalUsize("a plain id has no target", cast<usize>(targetOf(ordinary)), 0);

    // The two halves are distinct fields, the same check as for index and
    // generation above.
    t.ok(
        "relation and target are different fields",
        makePairFromIndices(5, 9) !== makePairFromIndices(9, 5),
    );

    // -- the reserved entities ---------------------------------------------------
    //
    // Generation zero, so each handle *is* its index and these numbers can be
    // read in a debugger. Distinctness matters more than the values: two
    // builtins sharing an index would make `ChildOf` and `Component` the same
    // thing, which would be a very confusing afternoon.

    t.equalU64("none is 0", noneId(), 0);
    t.equalU64("wildcard is 1", wildcardId(), 1);
    t.equalU64("ChildOf is 2", childOfId(), 2);
    t.equalU64("Component is 3", componentId(), 3);
    t.equalU64("Exclusive is 4", exclusiveId(), 4);
    t.equalU64("OnDelete is 5", onDeleteId(), 5);
    t.equalU64("Remove is 6", removeId(), 6);
    t.equalU64("Delete is 7", deleteId(), 7);

    t.ok("the builtins are reserved", isReserved(indexOf(deleteId())));
    t.ok("the first user index is not", !isReserved(firstUserIndex()));
    t.ok("nor is anything past it", !isReserved(firstUserIndex() + 1000));

    // -- wildcards ----------------------------------------------------------------

    t.ok("* is a wildcard", isWildcard(wildcardId()));
    t.ok("ChildOf is not", !isWildcard(childOfId()));
    t.ok("a pair is not a bare wildcard", !isWildcard(pair(childOfId(), wildcardId())));

    const anyChild = pair(childOfId(), wildcardId());
    const anyRelationToShip = pair(wildcardId(), ship);
    const anyPair = pair(wildcardId(), wildcardId());

    t.ok("* holds a wildcard", hasWildcard(wildcardId()));
    t.ok("(ChildOf, *) holds one", hasWildcard(anyChild));
    t.ok("(*, Ship) holds one", hasWildcard(anyRelationToShip));
    t.ok("(*, *) holds one", hasWildcard(anyPair));
    t.ok("(ChildOf, Ship) holds none", !hasWildcard(parented));
    t.ok("a plain component holds none", !hasWildcard(ordinary));

    // -- matching ------------------------------------------------------------------
    //
    // The asymmetry is the point: wildcards are only ever *patterns*. An id that
    // an entity actually holds is concrete, and a wildcard turning up on that
    // side is a bug rather than a match.

    t.ok("an exact id matches itself", matches(parented, parented));
    t.ok("a different target does not match", !matches(parented, pair(childOfId(), makeEntity(201, 0))));

    t.ok("(ChildOf, *) matches (ChildOf, Ship)", matches(anyChild, parented));
    t.ok(
        "(ChildOf, *) matches any other target",
        matches(anyChild, pair(childOfId(), makeEntity(999, 0))),
    );
    t.ok(
        "(ChildOf, *) does not match another relation",
        !matches(anyChild, pair(componentId(), ship)),
    );

    t.ok("(*, Ship) matches (ChildOf, Ship)", matches(anyRelationToShip, parented));
    t.ok(
        "(*, Ship) matches another relation to the same target",
        matches(anyRelationToShip, pair(componentId(), ship)),
    );
    t.ok(
        "(*, Ship) does not match a different target",
        !matches(anyRelationToShip, pair(childOfId(), makeEntity(201, 0))),
    );

    t.ok("(*, *) matches any pair", matches(anyPair, parented));
    t.ok("(*, *) does not match a plain id", !matches(anyPair, ordinary));

    // A bare `*` matches everything there is, which is what makes "every id this
    // entity holds" one term rather than two.
    t.ok("* matches a plain id", matches(wildcardId(), ordinary));
    t.ok("* matches a pair", matches(wildcardId(), parented));

    // And a plain pattern never matches a pair, however the numbers line up. The
    // pair bit is what separates them, and this is the check that it is read.
    t.ok(
        "a plain pattern does not match a pair with the same low bits",
        !matches(makeEntity(200, 0), pair(childOfId(), ship)),
    );

    // A stale component handle is a different id from the live one, so it
    // matches nothing — which is the behaviour that stops a recycled index
    // silently addressing a component it no longer names.
    t.ok(
        "generation is part of a plain match",
        !matches(makeEntity(200, 4), makeEntity(200, 5)),
    );
}
