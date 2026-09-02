// Type-erased column storage.
//
// A column is bytes, a stride, and three function pointers, so the two things
// that can go wrong are arithmetic (a row landing at the wrong offset) and
// wiring (a hook not being called, or being called twice). The arithmetic is
// caught by writing a distinct value into every row and reading them all back;
// the wiring needs a component whose hooks are *observable*, which is what
// `markedInfo` below is for — its `drop` writes a marker rather than doing
// nothing, so "was this row destroyed" becomes a value that can be read.

import { type ComponentInfo, infoOf, isTag, tagInfo } from "../../ecs/component.ts";
import { Column } from "../../ecs/column.ts";
import type { Tester } from "../testing.ts";

/** Three floats, twelve bytes: the shape of nearly every component worth having. */
interface Position {
    x: f32;
    y: f32;
    z: f32;
}

/** A component whose hooks leave evidence. */
interface Marked {
    value: u32;
}

function markedInit(slot: Pointer<unknown>): void {
    slot.reify<Marked>()[0].value = 0x1111;
}

function markedCopy(destination: Pointer<unknown>, source: Pointer<unknown>): void {
    destination.reify<Marked>()[0].value = source.reify<Marked>()[0].value;
}

function markedDrop(slot: Pointer<unknown>): void {
    slot.reify<Marked>()[0].value = 0xdead;
}

function markedInfo(): ComponentInfo {
    return {
        size: sizeOf<Marked>(),
        align: alignOf<Marked>(),
        init: markedInit,
        copy: markedCopy,
        drop: markedDrop,
    };
}

/** The `value` at a row, read back through the erased pointer. */
function markedAt(column: Reference<Column>, row: usize): u32 {
    return column.at(row).reify<Marked>()[0].value;
}

export function testEcsColumn(t: Reference<Tester>): void {
    // -- what a type description says ------------------------------------------

    const position = infoOf<Position>();
    t.equalUsize("Position is twelve bytes", position.size, 12);
    t.equalUsize("aligned like its widest field", position.align, 4);
    t.ok("and is not a tag", !isTag(position));

    const tag = tagInfo();
    t.equalUsize("a tag has no size", tag.size, 0);
    t.ok("and says so", isTag(tag));

    // -- an empty column ----------------------------------------------------------

    const column = new Column(position);
    t.equalUsize("a fresh column is empty", column.count, 0);
    t.equalUsize("and holds no rows", column.capacity, 0);
    t.equalUsize("its stride is the type's size", column.stride, 12);

    // -- one row --------------------------------------------------------------------

    const row = column.pushDefault();
    t.equalUsize("the first row is row zero", row, 0);
    t.equalUsize("the count follows", column.count, 1);

    // A fresh row is zeroed, which is what makes `init` safe to run over it: it
    // is writing over a valid default rather than over garbage.
    const slot = column.at(row).reify<Position>();
    t.equalF32("a fresh row is zeroed", slot[0].x, 0.0);
    t.equalF32("a fresh row is zeroed", slot[0].z, 0.0);

    slot[0].x = 1.5;
    slot[0].y = -2.5;
    slot[0].z = 3.5;
    t.equalF32("written and read back", column.at(0).reify<Position>()[0].x, 1.5);
    t.equalF32("written and read back", column.at(0).reify<Position>()[0].z, 3.5);

    // -- row arithmetic ---------------------------------------------------------------
    //
    // Every row gets a value nothing else has, so a stride that is one field out
    // shows up as the wrong number rather than as a plausible one.

    const total: usize = 5000;
    column.reserve(total);
    t.ok("reserve makes room", column.capacity >= total);
    t.equalUsize("without adding rows", column.count, 1);
    t.equalF32("and without disturbing what was there", column.at(0).reify<Position>()[0].x, 1.5);

    for (let i: usize = 1; i < total; i++) {
        const at = column.pushDefault();
        const cell = column.at(at).reify<Position>();
        cell[0].x = cast<f32>(i);
        cell[0].y = cast<f32>(i) * 2.0;
        cell[0].z = cast<f32>(i) * 3.0;
    }
    t.equalUsize("five thousand rows", column.count, total);

    let wrong: usize = 0;
    for (let i: usize = 1; i < total; i++) {
        const cell = column.at(i).reify<Position>();
        if (cell[0].x !== cast<f32>(i) || cell[0].y !== cast<f32>(i) * 2.0 || cell[0].z !== cast<f32>(i) * 3.0) {
            wrong += 1;
        }
    }
    t.equalUsize("every row reads back what was written", wrong, 0);

    // -- growth ------------------------------------------------------------------------
    //
    // A separate column, grown only by pushing, so the doubling path runs rather
    // than the one reserve took. Twelve bytes a row means the live region is
    // rarely a whole number of words, which is exactly the case the tail of the
    // copy loop exists for — a growth that dropped it would corrupt the last few
    // bytes of the last row and nothing else.

    const grown = new Column(position);
    for (let i: usize = 0; i < 1001; i++) {
        const at = grown.pushDefault();
        const cell = grown.at(at).reify<Position>();
        cell[0].x = cast<f32>(i);
        cell[0].z = cast<f32>(i) + 0.25;
    }

    t.ok("growth kept up", grown.capacity >= 1001);
    t.equalF32("the first row survived every growth", grown.at(0).reify<Position>()[0].x, 0.0);
    t.equalF32("so did the last", grown.at(1000).reify<Position>()[0].x, 1000.0);
    t.equalF32("including its trailing bytes", grown.at(1000).reify<Position>()[0].z, 1000.25);

    let lost: usize = 0;
    for (let i: usize = 0; i < 1001; i++) {
        if (grown.at(i).reify<Position>()[0].z !== cast<f32>(i) + 0.25) {
            lost += 1;
        }
    }
    t.equalUsize("no row was lost in a growth", lost, 0);

    column.release();
    grown.release();

    // -- the hooks ---------------------------------------------------------------------
    //
    // `init` on push, `drop` on the row being removed, `copy` from the last row
    // into the hole, and `drop` again on the vacated last slot. That last one is
    // the easy one to leave out, and leaving it out releases an owning component
    // twice: once here and once when the column is torn down.

    const marked = new Column(markedInfo());

    for (let i: usize = 0; i < 3; i++) {
        const at = marked.pushDefault();
        t.equalUsize(`init ran on row ${at}`, cast<usize>(markedAt(marked, at)), 0x1111);
        marked.at(at).reify<Marked>()[0].value = cast<u32>(10 + i * 10);
    }
    t.equalUsize("three rows", marked.count, 3);

    // Remove the middle of three. The last row moves into the hole, so the order
    // changes — which is why an archetype has to repoint whichever entity got
    // moved, and why nothing here may assume a row keeps its index.
    marked.swapRemove(1);
    t.equalUsize("one fewer row", marked.count, 2);
    t.equalUsize("row 0 is untouched", cast<usize>(markedAt(marked, 0)), 10);
    t.equalUsize("the last row moved into the hole", cast<usize>(markedAt(marked, 1)), 30);
    t.equalUsize("and the slot it left was dropped", cast<usize>(markedAt(marked, 2)), 0xdead);

    // Removing the *last* row copies nothing — there is nothing to move — and
    // must still drop it exactly once.
    marked.swapRemove(1);
    t.equalUsize("one row left", marked.count, 1);
    t.equalUsize("the removed row was dropped", cast<usize>(markedAt(marked, 1)), 0xdead);
    t.equalUsize("the survivor is untouched", cast<usize>(markedAt(marked, 0)), 10);

    // -- moving a row between columns ------------------------------------------------------
    //
    // What an archetype transition is made of: the entity's other components
    // move from the old table to the new one, one column pair at a time.

    const source = new Column(markedInfo());
    const destination = new Column(markedInfo());

    for (let i: usize = 0; i < 4; i++) {
        source.at(source.pushDefault()).reify<Marked>()[0].value = cast<u32>(100 + i);
    }

    const landed = destination.copyRowFrom(source, 2);
    t.equalUsize("the row landed at the end", landed, 0);
    t.equalUsize("carrying its value", cast<usize>(markedAt(destination, landed)), 102);
    t.equalUsize("the source still has it", cast<usize>(markedAt(source, 2)), 102);
    t.equalUsize("and still has four rows", source.count, 4);

    // -- clearing and releasing ---------------------------------------------------------------

    source.clear();
    t.equalUsize("clear empties the column", source.count, 0);
    t.ok("and keeps the storage", source.capacity >= 4);
    t.equalUsize("every row was dropped", cast<usize>(markedAt(source, 0)), 0xdead);
    t.equalUsize("every row was dropped", cast<usize>(markedAt(source, 3)), 0xdead);

    // A cleared column is a working column, not a poisoned one.
    const reused = source.pushDefault();
    t.equalUsize("and it can be filled again", cast<usize>(markedAt(source, reused)), 0x1111);

    source.release();
    t.equalUsize("release empties it", source.count, 0);
    t.equalUsize("and gives the buffer back", source.capacity, 0);

    destination.release();
    marked.release();

    // A released column is still usable, which matters because an archetype
    // releases its columns before dropping them and a half-destroyed object in
    // between is a thing to get wrong for no benefit.
    const after = marked.pushDefault();
    t.equalUsize("a released column still works", cast<usize>(markedAt(marked, after)), 0x1111);
    marked.release();
}
