// The world: everything that exists, and the operations that change it.
//
// Four things live here and nothing else. The entity index says which handles
// are alive and where each one's row is; the tables hold the rows; the component
// registry says how big each id's data is; and the archetype graph remembers
// where adding or removing an id leads, so the second entity down a route
// follows a cached edge instead of hashing a signature.
//
// ## An id is stored one of three ways, and this file decides which
//
// `add`, `remove`, `get`, `set` and `has` all take an id, and each has to work
// out what is behind it first:
//
//   * a **dense** component or tag — a column in whatever table the entity is
//     in. Changing it moves the entity's whole row. This is the default.
//   * a **sparse** component or tag — a pool of its own outside the archetypes,
//     registered with `sparseComponent`. Changing it moves nothing. `pool.ts`.
//   * a **relation** — a store of its own, reached through `relate` and friends
//     and never through the five operations above. `relation.ts`.
//
// Dense and sparse share every entry point, so all five start with one sparse
// index lookup to decide which way to go. A `pools.length === 0` test guards it,
// so a world that registered no sparse component pays a load and a compare.
//
// ## Every alive entity is in exactly one table
//
// Including a brand new one, which lands in table 0 — the archetype with an
// empty signature. There is no "not in a table yet" state to handle, so
// `add`, `remove` and `destroy` each have one path rather than two, and the
// reserved entities from `id.ts` are ordinary rows like everything else.
//
// ## Tables are held by pointer, and they have to be
//
// `alloc(Archetype, …)` puts each table on the heap and `tables` holds
// addresses, so a table's address survives the array growing. Code here
// routinely takes a table, creates another one — which may reallocate `tables` —
// and goes on using the first. Held by value, that would be a dangling reference
// on the line after every `findOrCreateTable`.

import { HashMap } from "std/collection";
import {
    Archetype,
    hashSignature,
    noTable,
    signatureWith,
    signatureWithout,
    signaturesEqual,
} from "./archetype.ts";
import { type ComponentInfo, infoOf, maxComponentBytes, tagInfo } from "./component.ts";
import { Entities } from "./entities.ts";
import { fatal } from "./fatal.ts";
import {
    componentId,
    deleteId,
    firstUserIndex,
    indexOf,
    noneId,
    relationId,
    removeId,
} from "./id.ts";
import { SparsePool } from "./pool.ts";
import { RelationStore, View } from "./relation.ts";
import { noSlot, SparseIndex } from "./sparse.ts";

/** The archetype with an empty signature, where every entity starts. */
function rootTable(): u32 {
    return 0;
}

export class World {
    private entities: Entities;
    private tables: Pointer<Archetype>[];

    /** Signature hash to the first table with it; `Archetype.hashNext` chains the rest. */
    private byHash: HashMap<u64, u32>;

    /** Component id to its layout. An id with no entry here is a tag. */
    private infos: HashMap<u64, ComponentInfo>;

    /** Component and relation names, for diagnostics only. Nothing branches on one. */
    private names: HashMap<u64, string>;

    /**
     * One store per registered relation, held by pointer.
     *
     * Nothing about a relation touches an archetype. A relation id is not a
     * component id, so `add`, `remove` and `set` have nothing here to reach and
     * need no guard against doing so.
     *
     * By pointer rather than by value so a store's address survives this array
     * growing: a store holds several arrays, and copying one to grow the outer
     * array would deep-copy every link in it.
     */
    private stores: Pointer<RelationStore>[];

    /**
     * Relation entity index to its slot in {@link stores}.
     *
     * A sparse index rather than a `HashMap<u64, u32>`, and the difference is
     * measurable: every `targetOf`, `related` and `walk` goes through here first,
     * so a hash probe on the way in put 15 ns in front of a 3 ns lookup and made
     * the whole exercise pointless. A relation's index is small and there are a
     * handful of them, so this is one page.
     */
    private storeOf: SparseIndex;

    /** The registered relation ids, parallel to {@link stores}. */
    private relationList: u64[];

    /** What each relation does when one of its targets is destroyed. */
    private policies: HashMap<u64, u64>;

    /**
     * One pool per component registered {@link sparseComponent sparse}.
     *
     * Held by pointer for the same reason {@link stores} is: a pool owns three
     * arrays and a column buffer, and growing the outer array would deep-copy
     * every one of them.
     */
    private pools: Pointer<SparsePool>[];

    /**
     * A sparse component's entity index to its slot in {@link pools}.
     *
     * The same shape as {@link storeOf}, for the same reason: this sits on the
     * way in to every `add`, `remove`, `get` and `has`, so it has to cost less
     * than the operation it is choosing between. A sparse index is three loads,
     * where a hash probe would put fifteen nanoseconds in front of everything.
     *
     * `pools.length === 0` short-circuits even that, so a world with no sparse
     * components pays one compare on each of those calls.
     */
    private poolOf: SparseIndex;

    /** The registered sparse ids, parallel to {@link pools}. */
    private poolList: u64[];

    constructor() {
        this.entities = new Entities();
        this.tables = [];
        this.byHash = new HashMap<u64, u32>();
        this.infos = new HashMap<u64, ComponentInfo>();
        this.names = new HashMap<u64, string>();
        this.stores = [];
        this.storeOf = new SparseIndex();
        this.relationList = [];
        this.policies = new HashMap<u64, u64>();
        this.pools = [];
        this.poolOf = new SparseIndex();
        this.poolList = [];

        // Table 0, empty, before anything can want one.
        const empty: u64[] = [];
        this.findOrCreateTable(empty);

        // `Entities` created the reserved ids but knows nothing about tables, so
        // they are placed here — after which they are ordinary entities and every
        // operation below works on them without a special case.
        for (let index: u32 = 1; index < firstUserIndex(); index++) {
            const handle = this.entities.handleAt(index);
            if (handle !== noneId()) {
                const row = this.tables[cast<usize>(rootTable())].addRow(handle);
                this.entities.setLocation(index, rootTable(), cast<u32>(row));
            }
        }

        this.names.set(componentId(), "Component");
        this.names.set(relationId(), "Relation");
        this.names.set(removeId(), "Remove");
        this.names.set(deleteId(), "Delete");
    }

    /**
     * Give every table's memory back.
     *
     * Must be called exactly once. There are no destructors here, so a `World`
     * that goes out of scope releases its `HashMap`s and its arrays — those are
     * values — and leaks every column buffer and every `alloc`ated table, which
     * `GOBLIN_LEAK_CHECK` will say so about.
     */
    release(): void {
        for (let i: usize = 0; i < this.tables.length; i++) {
            this.tables[i].release();
            this.tables[i].free();
        }
        this.tables = [];

        // A store owns only arrays, which its destructor releases — but the
        // store itself was `alloc`ed and nothing else will give that back.
        for (let i: usize = 0; i < this.stores.length; i++) {
            this.stores[i].free();
        }
        this.stores = [];

        // A pool owns a column buffer as well, which no destructor reaches.
        for (let i: usize = 0; i < this.pools.length; i++) {
            this.pools[i].release();
            this.pools[i].free();
        }
        this.pools = [];
    }

    // -- entities -----------------------------------------------------------

    /** A new entity, holding nothing, in the root table. */
    create(): u64 {
        const handle = this.entities.create();
        const row = this.tables[cast<usize>(rootTable())].addRow(handle);
        this.entities.setLocation(indexOf(handle), rootTable(), cast<u32>(row));
        return handle;
    }

    /**
     * Retire an entity, drop its components, and settle everything that pointed
     * at it. `false` if it was not alive.
     *
     * A relation's target is stored as a **full handle**, generation included, so
     * a turret whose ship has died already reads as pointing at something dead —
     * `targetOf` says so without anyone having to clean up first. This pass is
     * therefore about *policy* rather than correctness: `Remove` clears the
     * relation so the holder is not left pointing at a ghost, and `Delete`
     * destroys the holder too, so a ship takes its turrets with it.
     *
     * **Worklist, not recursion.** A hierarchy is as deep as the content makes
     * it, and a cycle — which nothing forbids — would be a recursion that does
     * not end. Here it terminates on the liveness check, because the entity that
     * closed the cycle is already dead by the time it comes back round.
     */
    destroy(handle: u64): boolean {
        if (!this.entities.isAlive(handle)) {
            return false;
        }

        const doomed: u64[] = [];
        doomed.push(handle);

        let at: usize = 0;
        while (at < doomed.length) {
            const current = doomed[at];
            at += 1;

            // Already gone: reached twice through two relations, or through a
            // cycle. This check is what terminates the walk.
            if (!this.entities.isAlive(current)) {
                continue;
            }

            this.settleHolders(current, doomed);
            this.forgetLinks(current);
            this.forgetSparse(current);
            this.removeEntity(current);
        }

        return true;
    }

    isAlive(handle: u64): boolean {
        return this.entities.isAlive(handle);
    }

    /** How many entities are alive, the reserved ones included. */
    get count(): u32 {
        return this.entities.count;
    }

    // -- registration ---------------------------------------------------------

    /**
     * Register `T` as a component and hand back its id.
     *
     *     const Position = world.component<Position>("Position");
     *     world.set<Position>(e, Position, {x: 1.0, y: 2.0, z: 3.0});
     *
     * The id is an ordinary entity: it can hold components, be a relation, and
     * be destroyed. That is what lets everything downstream treat `ChildOf` and
     * `Position` as the same kind of thing.
     */
    component<T>(name: string): u64 {
        const id = this.create();
        this.infos.set(id, this.checkedInfo<T>(name));
        this.names.set(id, name);
        this.add(id, componentId());
        return id;
    }

    /**
     * `T`'s layout, or the process stops.
     *
     * The one check between a component type and the storage. It aborts instead
     * of returning `false` because there is nothing a caller could do with a
     * `false`: the size comes from a type written in the source, so a component
     * over the limit is wrong in every run of the program. See `fatal.ts`.
     */
    private checkedInfo<T>(name: string): ComponentInfo {
        const info = infoOf<T>();
        if (info.size > maxComponentBytes()) {
            fatal(
                `component "${name}" is ${info.size} bytes, over the ` +
                `${maxComponentBytes()} byte limit. Split it into smaller ` +
                `components, or keep the data somewhere else and make the ` +
                `component a handle to it.`,
            );
        }
        return info;
    }

    /** Register an id with no data: an entity either has it or has not. */
    tag(name: string): u64 {
        const id = this.create();
        this.names.set(id, name);
        this.add(id, componentId());
        return id;
    }

    /**
     * Register `T` as a **sparse** component and hand back its id.
     *
     *     const stunned = world.sparseComponent<Stunned>("Stunned");
     *     world.set<Stunned>(fighter, stunned, {turns: 3});
     *
     * The id works exactly like any other — `add`, `remove`, `get`, `set`, `has`
     * and query terms all take it — but its data lives in a pool outside the
     * archetypes. **Adding or removing it moves no rows and creates no table**:
     * a push and a sparse write, instead of copying the entity's whole row into
     * a table with a different signature.
     *
     * Iteration pays for that. A query reading it does a lookup per entity where
     * a dense component does an increment, and a `has` or `not` term on one has
     * no per-table answer, so it is tested per row and the body is called once
     * per run of entities that pass. `pool.ts` has the storage; `query.ts` has
     * what a term does.
     *
     * **Use it for ids that change more often than they are walked**:
     * `Selected`, `Dirty`, `Stunned`, `JustSpawned` — the ones a gameplay rule
     * toggles and a few systems ask about, rather than the ones a frame's hot
     * loop streams through. Nothing here guesses. Dense is the default and this
     * is the exception, stated where the component is named.
     */
    sparseComponent<T>(name: string): u64 {
        return this.registerPool(name, this.checkedInfo<T>(name));
    }

    /**
     * Register a sparse id with no data.
     *
     * The cheapest thing in this ECS to put on and take off an entity: two array
     * writes and no data to copy. A tag that goes on and off every frame is what
     * the archetype layout handles worst, since each change moves a whole row to
     * another table, and this is the way out of that.
     */
    sparseTag(name: string): u64 {
        return this.registerPool(name, tagInfo());
    }

    /** The body of the two above. */
    private registerPool(name: string, info: ComponentInfo): u64 {
        const id = this.create();
        this.names.set(id, name);
        // On the component's own entity, exactly as a dense one carries it.
        // Sparse is a storage choice, not a different kind of thing.
        this.add(id, componentId());

        // Deliberately not in `infos`. `findOrCreateTable` reads that map to
        // give a signature its columns, and a sparse id must never reach a
        // signature.
        this.poolOf.set(indexOf(id), cast<u32>(this.pools.length));
        this.pools.push(alloc(SparsePool, info));
        this.poolList.push(id);
        return id;
    }

    /** Whether `id` was registered with {@link sparseComponent} or {@link sparseTag}. */
    isSparse(id: u64): boolean {
        return this.slotOfPool(id) !== noSlot();
    }

    /**
     * Which pool `id` owns, or {@link noSlot}.
     *
     * The handle comparison inside refuses a stale component handle, for the
     * same reason {@link slotOfRelation} has one: the sparse index is keyed by
     * entity index, so a destroyed component whose index was recycled would
     * otherwise hand back somebody else's pool.
     */
    poolSlotOf(id: u64): u32 {
        return this.slotOfPool(id);
    }

    /** Pool `slot`. The query layer resolves its terms through here; nothing else should. */
    poolAt(slot: u32): Pointer<SparsePool> {
        return this.pools[cast<usize>(slot)];
    }

    /** How much a sparse component occupies: its pages, its handles and its rows. */
    sparseBytes(id: u64): usize {
        const pool = this.poolFor(id);
        if (pool === null) {
            return 0;
        }
        return pool.bytes;
    }

    /** How many entities hold `id`, when it is sparse. Zero when it is not. */
    sparseCount(id: u64): usize {
        const pool = this.poolFor(id);
        if (pool === null) {
            return 0;
        }
        return pool.count;
    }

    /**
     * Call `body` with every holder of a sparse `id`, in the pool's own order.
     *
     * The one walk this layout is good at: straight down the dense arrays, with
     * no table to find and nothing to skip. It cannot join two components, so a
     * body wanting a second one asks for it by handle.
     */
    eachSparse(id: u64, body: LocalFn<(handle: u64) => void>): void {
        const pool = this.poolFor(id);
        if (pool === null) {
            return;
        }
        pool.each((handle, row) => {
            body(handle);
        });
    }

    private slotOfPool(id: u64): u32 {
        if (this.pools.length === 0) {
            return noSlot();
        }
        const slot = this.poolOf.get(indexOf(id));
        if (slot === noSlot()) {
            return noSlot();
        }
        if (this.poolList[cast<usize>(slot)] !== id) {
            return noSlot();
        }
        return slot;
    }

    /** The pool behind `id`, or null when it is not a sparse component. */
    private poolFor(id: u64): Pointer<SparsePool> | null {
        const slot = this.slotOfPool(id);
        if (slot === noSlot()) {
            return null;
        }
        return this.pools[cast<usize>(slot)];
    }

    /**
     * Register a relation, and hand back its id.
     *
     *     const childOf = world.relation("ChildOf");
     *     world.setOnDelete(childOf, deleteId());
     *
     *     world.relate(turret, childOf, ship);
     *
     * A relation is **not a component**. It gets a store of its own outside the
     * archetypes — see `relation.ts` — so its id never enters a signature, never
     * creates a table, and cannot be reached by `add`, `remove` or `set`. That
     * leaves nothing to guard against, which is why it is built this way: while
     * the target lived in a column a relation *was* a component, and anything
     * that could touch a component could corrupt it.
     *
     * **One target at a time.** Relating to a second replaces the first. The
     * generalisation is one more chain in the store, and the id layout keeps
     * flag bits reserved for marking a relation that wants it.
     */
    relation(name: string): u64 {
        const id = this.create();
        this.names.set(id, name);
        // On the relation's own entity, which is metadata about the relation
        // rather than anything a holder carries. Nothing reads it but a debugger.
        this.attach(id, relationId());

        this.storeOf.set(indexOf(id), cast<u32>(this.stores.length));
        this.stores.push(alloc(RelationStore));
        this.relationList.push(id);
        this.policies.set(id, removeId());
        return id;
    }

    /** Whether `id` was registered with {@link relation}. */
    isRelation(id: u64): boolean {
        return this.slotOfRelation(id) !== noSlot();
    }

    /**
     * Say what happens to the entities pointing at a target when it is destroyed.
     *
     * {@link removeId}, the default, clears the relation and leaves the holder
     * alone. {@link deleteId} destroys the holder too, so a hierarchy behaves
     * like one: deleting a ship deletes its turrets, and anything parented to
     * those.
     */
    setOnDelete(relation: u64, policy: u64): void {
        if (this.isRelation(relation)) {
            this.policies.set(relation, policy);
        }
    }

    /** What `relation` does when a target dies. {@link removeId} by default. */
    onDeleteOf(relation: u64): u64 {
        return this.policies.getOr(relation, removeId());
    }

    /**
     * Which store `relation` owns, or {@link noSlot}.
     *
     * Two array reads and a handle comparison. The comparison is what refuses a
     * *stale* relation handle: the sparse index is keyed by entity index, so
     * without it a destroyed relation whose index was recycled would hand back
     * somebody else's store.
     */
    private slotOfRelation(relation: u64): u32 {
        const slot = this.storeOf.get(indexOf(relation));
        if (slot === noSlot()) {
            return noSlot();
        }
        if (this.relationList[cast<usize>(slot)] !== relation) {
            return noSlot();
        }
        return slot;
    }

    /** The store behind `relation`, or null when it is not one. */
    private storeFor(relation: u64): Pointer<RelationStore> | null {
        const slot = this.slotOfRelation(relation);
        if (slot === noSlot()) {
            return null;
        }
        return this.stores[cast<usize>(slot)];
    }

    /** What something was registered as. Empty for anything unnamed. */
    nameOf(id: u64): string {
        return this.names.getOr(id, "");
    }

    // -- components on entities -------------------------------------------------

    has(handle: u64, id: u64): boolean {
        if (!this.entities.isAlive(handle)) {
            return false;
        }
        const pool = this.poolFor(id);
        if (pool !== null) {
            return pool.has(handle);
        }
        return this.tableOf(handle).has(id);
    }

    /**
     * Give `handle` the id.
     *
     * `false` when the entity is dead or already had it — neither is an error,
     * and adding twice in particular is the ordinary shape of code that does not
     * want to check first.
     *
     * What it costs depends on how the id was registered, though the caller
     * writes the same line either way. A **dense** id moves the entity to the
     * table that has one, copying its whole row. A **sparse** id is a push and
     * one write into that component's pool, moving nothing and creating no
     * archetype. Measured as a pair with {@link remove}, on an entity holding
     * two components: 168 ns dense, 67 ns sparse.
     *
     * A relation id passed here is an ordinary tag and has **nothing to do with
     * the relation** — relations live outside the archetypes entirely, so there
     * is no state for this to corrupt and no check standing in the way. An
     * earlier design put a relation's target in a column, which made it a
     * component, which made this function a hazard that had to be guarded with a
     * hash probe on every call.
     */
    add(handle: u64, id: u64): boolean {
        return this.attach(handle, id);
    }

    /** Take the id away. `false` when the entity is dead or did not have it. */
    remove(handle: u64, id: u64): boolean {
        return this.detach(handle, id);
    }

    /** The body of {@link add}, so registration can use it before `add` exists. */
    private attach(handle: u64, id: u64): boolean {
        if (!this.entities.isAlive(handle)) {
            return false;
        }

        // A sparse id never enters a signature, so this is the whole of it: a
        // push and one write, with no table to find, no row to copy and no
        // archetype to create.
        const pool = this.poolFor(id);
        if (pool !== null) {
            // Comparing the count rather than calling `has` first. `add` is
            // idempotent and finds the row itself, so a `has` would be a second
            // sparse lookup answering what the first one is about to.
            const before = pool.count;
            pool.add(handle);
            return pool.count !== before;
        }

        const from = this.entities.archetypeAt(indexOf(handle));
        const source = this.tables[cast<usize>(from)];
        if (source.has(id)) {
            return false;
        }

        this.moveEntity(handle, this.tableAfterAdding(source, from, id));
        return true;
    }

    /** {@link remove} without the relation check. The only caller is {@link unrelate}. */
    private detach(handle: u64, id: u64): boolean {
        if (!this.entities.isAlive(handle)) {
            return false;
        }

        const pool = this.poolFor(id);
        if (pool !== null) {
            return pool.remove(handle);
        }

        const from = this.entities.archetypeAt(indexOf(handle));
        const source = this.tables[cast<usize>(from)];
        if (!source.has(id)) {
            return false;
        }

        this.moveEntity(handle, this.tableAfterRemoving(source, from, id));
        return true;
    }

    /**
     * A pointer to `handle`'s data for `id`, or null.
     *
     * Null for a dead entity, an id it does not hold, and a tag — which has no
     * data to point at. **The pointer is invalidated by the next structural
     * change**, exactly as a pointer into a `std::vector` is: adding a component
     * to anything in the same table can reallocate the column, and adding one to
     * *this* entity moves the row to a different table entirely.
     *
     * A **sparse** id follows the same rule with a different scope. The pointer
     * is into that component's pool, so it survives anything done to the
     * entity's archetype, and it is invalidated by adding or removing *that*
     * component on *any* entity, since a removal swap-moves the last row into
     * the hole. It is also the cheaper read: two array loads and no table
     * lookup.
     */
    get<T>(handle: u64, id: u64): Pointer<T> | null {
        if (!this.entities.isAlive(handle)) {
            return null;
        }

        const pool = this.poolFor(id);
        if (pool !== null) {
            const row = pool.rowOf(handle);
            if (row === noSlot() || pool.isTag) {
                return null;
            }
            return pool.at(cast<usize>(row)).reify<T>();
        }

        const index = indexOf(handle);
        const table = this.tables[cast<usize>(this.entities.archetypeAt(index))];
        const column = table.columnFor(id);
        if (column < 0) {
            return null;
        }

        return table.columns[cast<usize>(column)]
            .at(cast<usize>(this.entities.rowAt(index)))
            .reify<T>();
    }

    /**
     * Write `handle`'s data for `id`, adding the id if it does not have it.
     *
     * Adding is the behaviour worth having: `set` is what a caller writes when
     * it wants the entity to end up with that value, and making it fail because
     * of a missing `add` would only ever be answered by writing the `add`.
     */
    set<T>(handle: u64, id: u64, value: T): boolean {
        this.add(handle, id);

        const slot = this.get<T>(handle, id);
        if (slot === null) {
            return false;
        }
        slot[0] = value;
        return true;
    }

    // -- relationships -------------------------------------------------------

    /**
     * Point `holder` at `target` through `relation`, replacing any previous one.
     *
     *     world.relate(turret, childOf, ship);
     *     world.relate(ship, orbiting, luna);
     *
     * `false` when either entity is dead or `relation` was never registered.
     *
     * **Nothing about the archetypes moves.** The link is a row in the relation's
     * own store, so a ship gaining a thirteenth part does not change any table,
     * and two thousand ships are two thousand rows rather than two thousand
     * tables.
     */
    relate(holder: u64, relation: u64, target: u64): boolean {
        if (!this.entities.isAlive(holder) || !this.entities.isAlive(target)) {
            return false;
        }

        const store = this.storeFor(relation);
        if (store === null) {
            return false;
        }

        store.relate(holder, target);
        return true;
    }

    /** Stop `holder` pointing at anything through `relation`. `false` if it was not. */
    unrelate(holder: u64, relation: u64): boolean {
        const store = this.storeFor(relation);
        if (store === null) {
            return false;
        }
        return store.unrelate(holder);
    }

    /**
     * What `holder` points at through `relation`, or {@link noneId}.
     *
     * A sparse lookup and an array read — no hashing — measured at about 9 ns.
     * The value is a **full handle**, so a target that has since been destroyed
     * comes back as a handle that fails `isAlive`, and the store's own read
     * refuses a stale *holder* for the same reason.
     */
    targetOf(holder: u64, relation: u64): u64 {
        const store = this.storeFor(relation);
        if (store === null) {
            return noneId();
        }
        return store.targetOf(holder);
    }

    /** Whether `holder` points at anything through `relation`. */
    hasRelation(holder: u64, relation: u64): boolean {
        const store = this.storeFor(relation);
        if (store === null) {
            return false;
        }
        return store.holds(holder);
    }

    /**
     * Append everything pointing at `target` through `relation` onto `out`.
     *
     *     const parts: u64[] = [];
     *     world.related(childOf, ship, parts);
     *
     * A sparse lookup for the first, then a walk down the sibling chain, so it
     * costs the number of parts and nothing per target is allocated to hold them.
     *
     * A copy into the caller's array rather than a walk the caller drives,
     * because what a caller does with a ship's parts is usually to destroy or
     * re-relate them, and that would unlink the row the walk is standing on.
     * {@link view} keeps the copy and re-takes it only when something changed.
     */
    related(relation: u64, target: u64, out: Reference<u64[]>): void {
        const store = this.storeFor(relation);
        if (store !== null) {
            store.collect(target, out);
        }
    }

    /** How many entities point at `target`. Costs the answer; the chain has no count. */
    relatedCount(relation: u64, target: u64): usize {
        const store = this.storeFor(relation);
        if (store === null) {
            return 0;
        }
        return store.countNaming(target);
    }

    /**
     * A cached, self-maintaining list of everything pointing at `target`.
     *
     *     const parts = world.view(childOf, ship);
     *     world.walk(parts, (part) => { … });
     *
     * Spends one `u64` per member to make repeated walks a contiguous array: while
     * nothing is relating or unrelating, a walk costs one integer comparison, and
     * when something changes the next walk re-copies once.
     *
     * Hold it for as long as it is useful. It is an ordinary value with no
     * registration behind it, so dropping one costs nothing and nothing has to be
     * told.
     */
    view(relation: u64, target: u64): View {
        return new View(relation, target);
    }

    /** How much the relation's sparse pages occupy. A gauge; see `sparse.ts`. */
    relationBytes(relation: u64): usize {
        const store = this.storeFor(relation);
        if (store === null) {
            return 0;
        }
        return store.sparseBytes + store.count * 24;
    }

    /** Sync `view` against the world and call `body` with every member. */
    walk(view: Reference<View>, body: LocalFn<(member: u64) => void>): void {
        const store = this.storeFor(view.through);
        if (store !== null) {
            view.walk(store.deref(), body);
        }
    }

    /** Sync `view` without walking it, so {@link View.at} can be used directly. */
    sync(view: Reference<View>): void {
        const store = this.storeFor(view.through);
        if (store !== null) {
            view.sync(store.deref());
        }
    }

    // -- what the tests and the query layer look at ------------------------------

    /** How many distinct archetypes exist. Only ever grows. */
    get tableCount(): usize {
        return this.tables.length;
    }

    /** Table `index`. The query layer walks these; nothing else should. */
    tableAt(index: usize): Pointer<Archetype> {
        return this.tables[index];
    }

    /** Which table holds `handle`. Undefined for a dead entity. */
    tableIndexOf(handle: u64): u32 {
        return this.entities.archetypeAt(indexOf(handle));
    }

    /** Which row of its table holds `handle`. Undefined for a dead entity. */
    rowOf(handle: u64): u32 {
        return this.entities.rowAt(indexOf(handle));
    }

    /**
     * How big `id`'s data is, and how to move it.
     *
     * One lookup, answering only for **dense** ids. A sparse component's layout
     * belongs to its pool and never lands in this map, and a relation has no
     * layout here at all — neither can reach a signature, and this is what
     * `findOrCreateTable` reads to give a signature its columns.
     */
    infoFor(id: u64): ComponentInfo {
        return this.infos.getOr(id, tagInfo());
    }

    // -- the graph ----------------------------------------------------------------

    private tableOf(handle: u64): Pointer<Archetype> {
        return this.tables[cast<usize>(this.entities.archetypeAt(indexOf(handle)))];
    }

    /**
     * Act on everything pointing at `handle`, before it stops existing.
     *
     * One sparse lookup per registered relation — a handful — rather than a scan
     * of anything. `Delete`-policy holders go onto `doomed` for the caller's
     * worklist; `Remove`-policy holders are unrelated here and now.
     *
     * **The chain is copied before anything is changed.** Unrelating unlinks the
     * very row a walk would be standing on, so the scan collects and the loop
     * after it acts — the same discipline `Query.each` asks of its body.
     */
    private settleHolders(handle: u64, doomed: Reference<u64[]>): void {
        for (let i: usize = 0; i < this.relationList.length; i++) {
            const relation = this.relationList[i];
            const store = this.stores[i];
            if (store.firstNaming(handle) === noSlot()) {
                continue;
            }

            const holders: u64[] = [];
            store.collect(handle, holders);

            const cascades = this.onDeleteOf(relation) === deleteId();
            for (let h: usize = 0; h < holders.length; h++) {
                if (cascades) {
                    doomed.push(holders[h]);
                } else {
                    store.unrelate(holders[h]);
                }
            }
        }
    }

    /**
     * Take `handle` out of every store it is a **holder** in.
     *
     * The other direction from {@link settleHolders}, and easy to forget: a
     * turret that dies has to stop being listed among its ship's parts, or the
     * ship keeps handing out a handle to something that no longer exists.
     *
     * One sparse lookup per registered relation, answering no almost every time.
     * Nothing else here cares how long the relation list is, but this does, so
     * keep it short.
     */
    private forgetLinks(handle: u64): void {
        for (let i: usize = 0; i < this.stores.length; i++) {
            this.stores[i].unrelate(handle);
        }
    }

    /**
     * Take `handle` out of every sparse pool it is in.
     *
     * A dense component disappears when the row does. A sparse one has to be
     * hunted down, so **every destroy costs one sparse lookup per registered
     * sparse component** — three loads apiece, answering no almost every time.
     * That is a cost sparse components impose on the whole world rather than on
     * their own users, and the reason to keep the list short. `forgetLinks` says
     * the same about relations.
     *
     * It cannot be skipped the way it can for relations, where the whole handle
     * stored in a link already reads as dead. A pool is keyed by entity index,
     * so a row left behind would sit there holding data forever, and the next
     * entity to take that index would land on it. {@link SparsePool.rowOf}
     * compares the handle and refuses to return it, but the row is still there.
     */
    private forgetSparse(handle: u64): void {
        for (let i: usize = 0; i < this.pools.length; i++) {
            this.pools[i].remove(handle);
        }
    }

    /**
     * Take one entity's row out and retire its handle.
     *
     * The other half of {@link destroy}, split out because the worklist calls it
     * once per entity and the relationship settling has already happened by then.
     */
    private removeEntity(handle: u64): void {
        const index = indexOf(handle);
        const table = this.tables[cast<usize>(this.entities.archetypeAt(index))];
        const row = cast<usize>(this.entities.rowAt(index));

        const moved = table.removeRow(row);
        if (moved !== noneId()) {
            this.entities.setRow(indexOf(moved), cast<u32>(row));
        }

        this.entities.destroy(handle);
    }

    /** Where `source` leads on adding `id`, following the cached edge or building it. */
    private tableAfterAdding(source: Pointer<Archetype>, from: u32, id: u64): u32 {
        const cached = source.addEdge.indexOf(id);
        if (cached >= 0) {
            return source.addEdge.valueAt(cast<usize>(cached));
        }

        const to = this.findOrCreateTable(signatureWith(source.signature, id));
        source.addEdge.set(id, to);
        // The way back, while it is known. Adding and then removing the same id
        // is what an entity that is briefly tagged does every frame.
        this.tables[cast<usize>(to)].removeEdge.set(id, from);
        return to;
    }

    /** Where `source` leads on removing `id`. */
    private tableAfterRemoving(source: Pointer<Archetype>, from: u32, id: u64): u32 {
        const cached = source.removeEdge.indexOf(id);
        if (cached >= 0) {
            return source.removeEdge.valueAt(cast<usize>(cached));
        }

        const to = this.findOrCreateTable(signatureWithout(source.signature, id));
        source.removeEdge.set(id, to);
        this.tables[cast<usize>(to)].addEdge.set(id, from);
        return to;
    }

    /**
     * Move one entity's row from its table to `to`.
     *
     * Three steps and the third is the one that gets forgotten: the row is
     * appended to the destination, the shared columns are copied across, the
     * source row is swap-removed — **and the entity that the swap moved into the
     * hole has its record repointed**. Without that last line the displaced
     * entity's record names a row that now belongs to somebody else, and the
     * symptom is one entity reading another's components, arbitrarily far from
     * here.
     */
    private moveEntity(handle: u64, to: u32): void {
        const index = indexOf(handle);
        const from = this.entities.archetypeAt(index);
        if (from === to) {
            return;
        }

        const row = cast<usize>(this.entities.rowAt(index));
        const source = this.tables[cast<usize>(from)];
        const destination = this.tables[cast<usize>(to)];

        const landed = destination.addRow(handle);
        destination.copySharedFrom(source, row, landed);

        const moved = source.removeRow(row);
        if (moved !== noneId()) {
            this.entities.setRow(indexOf(moved), cast<u32>(row));
        }

        this.entities.setLocation(index, to, cast<u32>(landed));
    }

    /**
     * The table with exactly this signature, building it if there is none.
     *
     * Cold: the graph edges above answer this for every route that has been
     * taken once already. It is written for correctness rather than speed, which
     * is why the collision chain is a walk.
     */
    private findOrCreateTable(signature: Reference<u64[]>): u32 {
        const hash = hashSignature(signature);
        const bucket = this.byHash.indexOf(hash);

        if (bucket >= 0) {
            let candidate = cast<i32>(this.byHash.valueAt(cast<usize>(bucket)));
            while (candidate !== noTable()) {
                const table = this.tables[cast<usize>(candidate)];
                if (signaturesEqual(table.signature, signature)) {
                    return cast<u32>(candidate);
                }
                candidate = table.hashNext;
            }
        }

        const id = cast<u32>(this.tables.length);
        const table = alloc(Archetype, id);
        for (let i: usize = 0; i < signature.length; i++) {
            table.push(signature[i], this.infoFor(signature[i]));
        }

        if (bucket >= 0) {
            // Push onto the front of the chain rather than the back, so this
            // needs no walk and the newest table — the one being asked about —
            // is found first.
            table.hashNext = cast<i32>(this.byHash.valueAt(cast<usize>(bucket)));
            this.byHash.setAt(cast<usize>(bucket), id);
        } else {
            this.byHash.set(hash, id);
        }

        this.tables.push(table);
        return id;
    }
}
