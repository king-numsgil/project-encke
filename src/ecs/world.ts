// The world: everything that exists, and the operations that change it.
//
// Four things live here and nothing else does. The entity index says which
// handles are alive and where each one's row is; the tables hold the rows; the
// component registry says how big each id's data is; and the archetype graph
// remembers where adding or removing an id leads, so the second entity down a
// route follows a cached edge instead of hashing a signature.
//
// ## Every alive entity is in exactly one table
//
// Including a brand new one, which lands in table 0 — the archetype with an
// empty signature. There is no "not in a table yet" state to handle, so
// `add`, `remove` and `destroy` each have one path rather than two, and the
// reserved entities from `id.ts` are ordinary rows like everything else.
//
// ## Tables are pointers, and that is not incidental
//
// `alloc(Archetype, …)` puts each table on the heap and `tables` holds addresses,
// so a table's address survives the array growing. Code here routinely takes a
// table, creates another one — which may reallocate `tables` — and then keeps
// using the first. Held by value that would be a dangling reference on the line
// after every `findOrCreateTable`.

import { HashMap } from "std/collection";
import {
    Archetype,
    hashSignature,
    noTable,
    signatureWith,
    signatureWithout,
    signaturesEqual,
} from "./archetype.ts";
import { type ComponentInfo, infoOf, tagInfo } from "./component.ts";
import { Entities } from "./entities.ts";
import {
    componentId,
    deleteId,
    firstUserIndex,
    indexOf,
    noneId,
    relationId,
    removeId,
} from "./id.ts";
import { RelationIndex, View } from "./relation.ts";

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

    /** Who points at whom, from the target's end. See `relation.ts`. */
    private links: RelationIndex;

    /** Registered relations, and what each does when a target is destroyed. */
    private relations: HashMap<u64, u64>;

    /** The registered relations in order, for the destroy path to walk. */
    private relationList: u64[];

    constructor() {
        this.entities = new Entities();
        this.tables = [];
        this.byHash = new HashMap<u64, u32>();
        this.infos = new HashMap<u64, ComponentInfo>();
        this.names = new HashMap<u64, string>();
        this.links = new RelationIndex();
        this.relations = new HashMap<u64, u64>();
        this.relationList = [];

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
     * therefore about *policy* rather than about correctness: `Remove` clears the
     * relation so the holder is not left pointing at a ghost, and `Delete`
     * destroys the holder as well, which is what makes a ship take its turrets
     * with it.
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
            // cycle. This is what makes the walk terminate.
            if (!this.entities.isAlive(current)) {
                continue;
            }

            this.settleHolders(current, doomed);
            this.forgetLinks(current);
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
     * The id is an ordinary entity — it can hold components, be a relation, and
     * be destroyed — which is what makes `(ChildOf, Ship)` and `Position` the
     * same kind of thing to everything downstream of here.
     */
    component<T>(name: string): u64 {
        const id = this.create();
        this.infos.set(id, infoOf<T>());
        this.names.set(id, name);
        this.add(id, componentId());
        return id;
    }

    /** Register an id with no data: an entity either has it or has not. */
    tag(name: string): u64 {
        const id = this.create();
        this.names.set(id, name);
        this.add(id, componentId());
        return id;
    }

    /**
     * Register a relation, and hand back its id.
     *
     *     const childOf = world.relation("ChildOf");
     *     world.setOnDelete(childOf, deleteId());
     *
     *     world.relate(turret, childOf, ship);
     *
     * A relation **is a component whose value is an entity handle**. That is the
     * whole implementation: relating writes the target into a `u64` column on
     * the holder, so every entity with a parent shares one table however many
     * parents exist, and the targets are readable as a contiguous column by an
     * ordinary query.
     *
     * The reverse direction — "what points at this ship" — is the index in
     * `relation.ts`, which relating and unrelating keep up to date.
     *
     * **One target at a time.** Relating to a second replaces the first, because
     * a column holds one value. A relation that should hold several at once is
     * not here; the id layout keeps flag bits reserved for marking one.
     */
    relation(name: string): u64 {
        const id = this.create();
        // The value is an entity handle, so the column is `u64` wide and its
        // rows are copied and dropped like any other plain data.
        this.infos.set(id, infoOf<u64>());
        this.names.set(id, name);
        this.add(id, componentId());
        this.add(id, relationId());

        this.relations.set(id, removeId());
        this.relationList.push(id);
        return id;
    }

    /** Whether `id` was registered with {@link relation}. */
    isRelation(id: u64): boolean {
        return this.relations.has(id);
    }

    /**
     * Say what happens to the entities pointing at a target when it is destroyed.
     *
     * {@link removeId} — the default — clears the relation and leaves the holder
     * alone. {@link deleteId} destroys the holder too, which is what makes a
     * hierarchy behave like one: deleting a ship deletes its turrets, and
     * anything parented to those.
     */
    setOnDelete(relation: u64, policy: u64): void {
        if (this.relations.has(relation)) {
            this.relations.set(relation, policy);
        }
    }

    /** What `relation` does when a target dies. {@link removeId} by default. */
    onDeleteOf(relation: u64): u64 {
        return this.relations.getOr(relation, removeId());
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
        return this.tableOf(handle).has(id);
    }

    /**
     * Give `handle` the id, moving it to the table that has one.
     *
     * `false` when the entity is dead or already had it — neither is an error,
     * and adding twice in particular is the ordinary shape of code that does not
     * want to check first.
     *
     * **Refuses a relation**, because a relation's target lives in two places —
     * the holder's column and the target's list — and this can only write one of
     * them. Adding one here would produce an entity that `hasRelation` says yes
     * about, `targetOf` says nothing about, and no list names. {@link relate} is
     * the operation that keeps the two ends together.
     */
    add(handle: u64, id: u64): boolean {
        if (this.relations.has(id)) {
            return false;
        }
        return this.attach(handle, id);
    }

    /**
     * Take the id away. `false` when the entity is dead or did not have it.
     *
     * **Refuses a relation**, for the reason {@link add} gives: taking the column
     * away here would leave the target's list naming a holder that no longer
     * points at it, and `related` would hand that holder out.
     * {@link unrelate} does both halves.
     */
    remove(handle: u64, id: u64): boolean {
        if (this.relations.has(id)) {
            return false;
        }
        return this.detach(handle, id);
    }

    /** {@link add} without the relation check. The only caller is {@link relate}. */
    private attach(handle: u64, id: u64): boolean {
        if (!this.entities.isAlive(handle)) {
            return false;
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
     */
    get<T>(handle: u64, id: u64): Pointer<T> | null {
        if (!this.entities.isAlive(handle)) {
            return null;
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
     *
     * **Refuses a relation.** A relation's column holds a target, and writing one
     * here would leave the old target's list still naming this holder and the new
     * target's list not naming it at all — the index and the column disagreeing,
     * silently, in both directions. {@link relate} is the way, and it is one call
     * rather than two.
     */
    set<T>(handle: u64, id: u64, value: T): boolean {
        if (this.relations.has(id)) {
            return false;
        }

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
     * The whole operation is a column write plus two index updates. **It does not
     * move the entity between tables** unless this is the first time it has held
     * this relation at all — which is why two thousand ships cost one table
     * rather than two thousand.
     */
    relate(holder: u64, relation: u64, target: u64): boolean {
        if (!this.entities.isAlive(holder) || !this.entities.isAlive(target)) {
            return false;
        }
        if (!this.relations.has(relation)) {
            return false;
        }

        // One target at a time: whatever was there stops being pointed at.
        const previous = this.targetOf(holder, relation);
        if (previous === target) {
            return true;
        }
        if (previous !== noneId()) {
            this.links.remove(relation, previous, holder);
        }

        // `attach`, not `add`: the public one refuses a relation precisely so
        // that this is the only route by which a relation column can appear.
        this.attach(holder, relation);
        const slot = this.get<u64>(holder, relation);
        if (slot === null) {
            return false;
        }
        slot[0] = target;

        this.links.add(relation, target, holder);
        return true;
    }

    /**
     * Stop `holder` pointing at anything through `relation`. `false` if it was
     * not.
     *
     * The entity leaves the relation's table, because it no longer has the id at
     * all — a relation with no target is not a relation held with a null in it.
     */
    unrelate(holder: u64, relation: u64): boolean {
        const target = this.targetOf(holder, relation);
        if (target === noneId()) {
            return false;
        }

        this.links.remove(relation, target, holder);
        this.detach(holder, relation);
        return true;
    }

    /**
     * What `holder` points at through `relation`, or {@link noneId}.
     *
     * One load out of a column. The value is a **full handle**, so a target that
     * has since been destroyed comes back as a handle that fails `isAlive` — the
     * staleness is detectable without anything having had to clean up first,
     * which is the property a target packed into an id could not have.
     */
    targetOf(holder: u64, relation: u64): u64 {
        const slot = this.get<u64>(holder, relation);
        if (slot === null) {
            return noneId();
        }
        return slot[0];
    }

    /** Whether `holder` points at anything through `relation`. */
    hasRelation(holder: u64, relation: u64): boolean {
        return this.has(holder, relation);
    }

    /**
     * Append everything pointing at `target` through `relation` onto `out`.
     *
     *     const parts: u64[] = [];
     *     world.related(childOf, ship, parts);
     *
     * One hash lookup and a copy of that target's list, so it costs the number of
     * parts rather than the size of the world.
     *
     * A copy into the caller's array rather than a borrow, because what a caller
     * does with a ship's parts is usually to destroy or re-relate them, and doing
     * that while walking the index would move entries under the cursor.
     * {@link view} is the version that keeps the copy and only re-takes it when
     * something has changed.
     */
    related(relation: u64, target: u64, out: Reference<u64[]>): void {
        this.links.collect(relation, target, out);
    }

    /** How many entities point at `target` through `relation`. */
    relatedCount(relation: u64, target: u64): usize {
        return this.links.countFor(relation, target);
    }

    /**
     * A cached, self-maintaining list of everything pointing at `target`.
     *
     *     const parts = world.view(childOf, ship);
     *     world.walk(parts, (part) => { … });
     *
     * Spends one `u64` per member to make repeated walks a contiguous array with
     * no lookup: while nothing is relating or unrelating, a walk costs one
     * integer comparison; when something changes, the next walk re-copies once.
     *
     * Hold it for as long as it is useful. It is an ordinary value with no
     * registration behind it, so dropping one costs nothing and nothing has to be
     * told.
     */
    view(relation: u64, target: u64): View {
        return new View(relation, target);
    }

    /** Sync `view` against the world and call `body` with every member. */
    walk(view: Reference<View>, body: LocalFn<(member: u64) => void>): void {
        view.walk(this.links, body);
    }

    /** Sync `view` without walking it, so {@link View.at} can be used directly. */
    sync(view: Reference<View>): void {
        view.sync(this.links);
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
     * One lookup, and a relation is not a special case: it was registered with a
     * `u64` layout, so its column holds one entity handle per row exactly as a
     * `Position` column holds three floats.
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
     * One index lookup per registered relation — a handful — rather than a scan
     * of anything. `Delete`-policy holders go onto `doomed` for the caller's
     * worklist; `Remove`-policy holders are unrelated here and now.
     *
     * **The lists are copied before anything is changed.** Unrelating moves an
     * entity out of the relation's table and removes it from the very list being
     * walked, so acting inside the walk would step over entries. `related` takes
     * a snapshot for exactly this reason.
     */
    private settleHolders(handle: u64, doomed: Reference<u64[]>): void {
        for (let i: usize = 0; i < this.relationList.length; i++) {
            const relation = this.relationList[i];
            if (this.links.countFor(relation, handle) === 0) {
                continue;
            }

            const holders: u64[] = [];
            this.links.collect(relation, handle, holders);

            const cascades = this.onDeleteOf(relation) === deleteId();
            for (let h: usize = 0; h < holders.length; h++) {
                if (cascades) {
                    doomed.push(holders[h]);
                } else {
                    this.unrelate(holders[h], relation);
                }
            }
        }
    }

    /**
     * Take `handle` out of the index for everything **it** points at.
     *
     * The other direction from {@link settleHolders}, and easy to forget: a
     * turret that dies has to stop being listed among its ship's parts, or the
     * ship keeps handing out a handle to something that no longer exists. Cheap,
     * because the targets are in the entity's own columns.
     */
    private forgetLinks(handle: u64): void {
        const table = this.tableOf(handle);
        for (let i: usize = 0; i < table.signature.length; i++) {
            const id = table.signature[i];
            if (!this.relations.has(id)) {
                continue;
            }
            const target = this.targetOf(handle, id);
            if (target !== noneId()) {
                this.links.remove(id, target, handle);
            }
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
