// What an id is, in bits.
//
// Everything in this ECS is addressed by one `u64`. An entity is one, a
// component type is one, a relationship kind is one — and a **pair** like
// `(ChildOf, Ship)` is one too, which is the decision the whole design turns on.
// A pair being an ordinary id is what lets it sit in an archetype's signature
// beside the plain components, be matched by a query with the same code, and be
// looked up in the same index. The alternative is a relationship table off to
// one side that every other mechanism has to learn about separately.
//
//     plain id
//       [63]      PAIR, clear
//       [62..48]  15 flag bits, all spare today
//       [47..32]  generation, 16 bits
//       [31..0]   index, 32 bits
//
//     pair id
//       [63]      PAIR, set
//       [62..32]  relation index, 31 bits
//       [31..0]   target index, 32 bits
//
// 4,294,967,295 entities, and **65,536 recycles of one index before a stale
// handle can come back valid**. That second number is the cost of this split and
// it is worth stating plainly: an index that has been freed and reused 65,536
// times is addressed by a handle that used to name something else, and nothing
// here can tell the difference. A simulation churning ten thousand entities a
// second through one slot reaches it in about seven seconds; one recycling a
// handful per frame never will.
//
// **A pair spends the flag and generation space on its relation.** There is
// nowhere else to put it — two full entity references do not fit in 64 bits with
// room left over — so a pair records its two ends *by index*, without
// generations. That is not a shortcut, it is the shape of the problem, and it is
// exactly why deleting an entity has to go and find the pairs that name it
// rather than leaving them to fail a generation check. `relation.ts` is that
// cleanup and it is not optional.
//
// Flags are functions rather than constants because the language has no
// top-level `const` to bind one to. They are folded at every call site.

/** Bit 63: this id is a pair. */
function pairBit(): u64 {
    return cast<u64>(1) << 63;
}

/** The low 32 bits — an index, in either kind of id. */
function indexMask(): u64 {
    return cast<u64>(0xffffffff);
}

/** 16 bits of generation, at bit 32. */
function generationMask(): u32 {
    return 0xffff;
}

/** 31 bits of relation index, at bit 32, once the pair bit is cleared. */
function relationMask(): u64 {
    return cast<u64>(0x7fffffff);
}

// ---------------------------------------------------------------------------
// Plain ids.
// ---------------------------------------------------------------------------

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

/** The index half. For a pair this is the **target**; see {@link targetOf}. */
export function indexOf(id: u64): u32 {
    return cast<u32>(id & indexMask());
}

/** The generation half. Meaningless on a pair, which has none. */
export function generationOf(id: u64): u32 {
    return cast<u32>((id >> 32) & cast<u64>(generationMask()));
}

// ---------------------------------------------------------------------------
// Pairs.
// ---------------------------------------------------------------------------

export function isPair(id: u64): boolean {
    return (id & pairBit()) !== 0;
}

/**
 * `(relation, target)`, from two entity **handles**.
 *
 * The generations are dropped, which is what the layout comment above is about.
 * This is the spelling to use — `world.add(child, pair(childOf(), ship))` — and
 * {@link makePairFromIndices} is the one for code that already has indices.
 */
export function pair(relation: u64, target: u64): u64 {
    return makePairFromIndices(indexOf(relation), indexOf(target));
}

/** `(relation, target)` from two indices. */
export function makePairFromIndices(relation: u32, target: u32): u64 {
    return pairBit() | ((cast<u64>(relation) & relationMask()) << 32) | cast<u64>(target);
}

/** The relation index of a pair. Zero for anything that is not one. */
export function relationOf(id: u64): u32 {
    if (!isPair(id)) {
        return 0;
    }
    return cast<u32>((id >> 32) & relationMask());
}

/** The target index of a pair. Zero for anything that is not one. */
export function targetOf(id: u64): u32 {
    if (!isPair(id)) {
        return 0;
    }
    return cast<u32>(id & indexMask());
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
 * `*` — matches anything, in either half of a pair.
 *
 * A real entity rather than a sentinel value, so `pair(childOf(), wildcard())`
 * is built by the same function that builds every other pair.
 */
export function wildcardId(): u64 {
    return makeEntity(1, 0);
}

/** `(ChildOf, parent)`. Exclusive, and its targets cascade on delete. */
export function childOfId(): u64 {
    return makeEntity(2, 0);
}

/** Carried by every entity that is a component type. */
export function componentId(): u64 {
    return makeEntity(3, 0);
}

/** A relation carrying this admits one target at a time; adding a second replaces the first. */
export function exclusiveId(): u64 {
    return makeEntity(4, 0);
}

/** `(OnDelete, policy)` on a relation says what happens to its pairs when a target dies. */
export function onDeleteId(): u64 {
    return makeEntity(5, 0);
}

/** The default policy: strip the pair and leave the entity alone. */
export function removeId(): u64 {
    return makeEntity(6, 0);
}

/** `ChildOf`'s policy: delete every entity holding the pair. */
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

// ---------------------------------------------------------------------------
// Wildcards.
// ---------------------------------------------------------------------------

/** Whether `id` is the bare wildcard. */
export function isWildcard(id: u64): boolean {
    return !isPair(id) && indexOf(id) === indexOf(wildcardId());
}

/**
 * Whether `id` matches more than one concrete id — the question a query asks
 * before deciding whether it can look an id up exactly.
 *
 * True for `*` itself, for `(R, *)`, for `(*, T)` and for `(*, *)`.
 */
export function hasWildcard(id: u64): boolean {
    if (!isPair(id)) {
        return isWildcard(id);
    }
    const wildcard = indexOf(wildcardId());
    return relationOf(id) === wildcard || targetOf(id) === wildcard;
}

/**
 * Whether `candidate` — a concrete id out of an archetype's signature — is
 * matched by `pattern`, which may hold wildcards.
 *
 * The asymmetry is deliberate: a wildcard in the *candidate* is an id somebody
 * stored on an entity, which is a bug rather than a match, and this treats it as
 * the ordinary index it is.
 */
export function matches(pattern: u64, candidate: u64): boolean {
    if (pattern === candidate) {
        return true;
    }

    const wildcard = indexOf(wildcardId());

    if (!isPair(pattern)) {
        // A bare `*` matches any id at all, pairs included. That is what makes
        // "everything this entity has" expressible as one term. Any other plain
        // pattern had its chance at the equality above, generation included — a
        // stale component handle should not match the component.
        return indexOf(pattern) === wildcard;
    }

    if (!isPair(candidate)) {
        return false;
    }

    const relation = relationOf(pattern);
    const target = targetOf(pattern);
    return (relation === wildcard || relation === relationOf(candidate)) &&
        (target === wildcard || target === targetOf(candidate));
}
