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
    childOfId,
    componentId,
    deleteId,
    exclusiveId,
    firstUserIndex,
    indexOf,
    isPair,
    noneId,
    onDeleteId,
    relationOf,
    removeId,
    wildcardId,
} from "./id.ts";

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

    constructor() {
        this.entities = new Entities();
        this.tables = [];
        this.byHash = new HashMap<u64, u32>();
        this.infos = new HashMap<u64, ComponentInfo>();
        this.names = new HashMap<u64, string>();

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

        this.names.set(wildcardId(), "*");
        this.names.set(childOfId(), "ChildOf");
        this.names.set(componentId(), "Component");
        this.names.set(exclusiveId(), "Exclusive");
        this.names.set(onDeleteId(), "OnDelete");
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
     * Retire an entity and drop its components. `false` if it was not alive.
     *
     * **This does not yet clean up pairs that name it.** An entity holding
     * `(ChildOf, dead)` keeps holding it, because finding those needs an index
     * from target to table that does not exist until `relation.ts`. Until then a
     * pair can outlive its target, which is the documented hole in this pass.
     */
    destroy(handle: u64): boolean {
        if (!this.entities.isAlive(handle)) {
            return false;
        }

        const index = indexOf(handle);
        const table = this.tables[cast<usize>(this.entities.archetypeAt(index))];
        const row = cast<usize>(this.entities.rowAt(index));

        const moved = table.removeRow(row);
        if (moved !== noneId()) {
            this.entities.setRow(indexOf(moved), cast<u32>(row));
        }

        return this.entities.destroy(handle);
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

    /**
     * Register an id with no data: an entity either has it or has not.
     *
     * Also how a **relation** is made — `ChildOf` is a tag that happens to be
     * used as the left half of a pair. Nothing distinguishes the two at
     * registration, and nothing needs to.
     */
    tag(name: string): u64 {
        const id = this.create();
        this.names.set(id, name);
        this.add(id, componentId());
        return id;
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
     */
    add(handle: u64, id: u64): boolean {
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

    /** Take the id away. `false` when the entity is dead or did not have it. */
    remove(handle: u64, id: u64): boolean {
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
     * A pair takes its layout from its **relation**: `(Orbits, Earth)` carries an
     * `Orbits` if that was registered with data, and is a tag otherwise. That is
     * flecs' rule minus the half where the target can supply it instead, which
     * is not needed until something wants two different payloads on one relation.
     */
    infoFor(id: u64): ComponentInfo {
        if (isPair(id)) {
            return this.infos.getOr(this.entities.handleAt(relationOf(id)), tagInfo());
        }
        return this.infos.getOr(id, tagInfo());
    }

    // -- the graph ----------------------------------------------------------------

    private tableOf(handle: u64): Pointer<Archetype> {
        return this.tables[cast<usize>(this.entities.archetypeAt(indexOf(handle)))];
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
