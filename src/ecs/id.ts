// What an id is, in bits.
//
// Everything in this ECS is addressed by one `u64`: an entity, a component type,
// a relationship kind. All three are the same kind of thing, so one query
// engine, one storage layer and one cleanup pass serve all of them.
//
//     [63..48]  16 flag bits, all reserved
//     [47..32]  generation, 16 bits
//     [31..0]   index, 32 bits
//
// 4,294,967,295 entities, and 65,536 of them per index — after which
// `entities.ts` retires the index rather than wrapping it, so **no handle is
// ever reissued**.
//
// ## The flag bits are reserved
//
// Nothing sets one today. An earlier design spent bit 63 marking an id as a
// *pair* — `(ChildOf, ship)` packed into a single id sitting in an archetype's
// signature, the way flecs does it. That is gone, because a pair in the
// signature means a separate table per target. Measured: 10,000 entities across
// 2,000 parents iterated **22 times slower** than the same 10,000 across one,
// because the query pays per-table setup for five entities at a time.
//
// Relationships now live outside the archetypes entirely and put nothing in a
// signature; see `relation.ts`. The bits stay reserved because the next thing
// likely to want one is a marker for a relation holding several targets at once,
// and renumbering an id layout is not a thing to do twice.

/** 16 bits of generation, at bit 32. */
function generationMask(): u32 {
    return 0xffff;
}

/**
 * An entity handle from an index and a generation.
 *
 * The generation is masked rather than checked, because the caller that
 * increments it — `entities.ts` — wraps at the same 16 bits and there is no
 * useful answer to give a number that does not fit.
 */
export function makeEntity(index: u32, generation: u32): u64 {
    return (cast<u64>(generation & generationMask()) << 32) | cast<u64>(index);
}

/** The index half: which slot in the entity table. */
export function indexOf(id: u64): u32 {
    return cast<u32>(id & cast<u64>(0xffffffff));
}

/** The generation half: which occupant of that slot. */
export function generationOf(id: u64): u32 {
    return cast<u32>((id >> 32) & cast<u64>(generationMask()));
}

// ---------------------------------------------------------------------------
// The reserved entities.
//
// Low indices, generation zero, so each one's handle *is* its index and the
// numbers below can be read directly in a debugger. `firstUserIndex` leaves room
// to add more without renumbering anything a saved world might hold.
// ---------------------------------------------------------------------------

/** The null id. Never alive, never in a signature. */
export function noneId(): u64 {
    return 0;
}

/**
 * Index 1 is **reserved and unused**.
 *
 * It was the wildcard, `*`, which a query needed back when a relationship lived
 * in the archetype signature and `(ChildOf, *)` had to match many ids at once.
 * Relationships have their own stores now, and every query term is one exact id,
 * so a wildcard has nothing left to do.
 *
 * Held rather than reclaimed so the numbers below do not move, and because a
 * relation holding several targets would want a marker of some kind.
 */
export function reservedId(): u64 {
    return makeEntity(1, 0);
}

/** Carried by every entity that is a component type or a relation. */
export function componentId(): u64 {
    return makeEntity(3, 0);
}

/** Carried by every entity registered with {@link World.relation}. */
export function relationId(): u64 {
    return makeEntity(4, 0);
}

/** The default delete policy: clear the relation, leave the entity alone. */
export function removeId(): u64 {
    return makeEntity(6, 0);
}

/** `ChildOf`'s policy: destroy everything related to the entity that died. */
export function deleteId(): u64 {
    return makeEntity(7, 0);
}

/** The first index handed out by {@link Entities.create}. */
export function firstUserIndex(): u32 {
    return 16;
}

/** Whether `index` names one of the reserved entities above. */
export function isReserved(index: u32): boolean {
    return index < firstUserIndex();
}
