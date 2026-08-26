// Translated from SDL_rect.h
//
// The four inline helpers SDL_RectToFRect / SDL_PointInRect / SDL_RectEmpty /
// SDL_RectsEqual (and their float twins) are `SDL_FORCE_INLINE` in the header,
// so there is no symbol to link against. They are written out here as ordinary
// Goblin functions instead, which is the same code the C compiler would have
// inlined.

import { SDL_fabsf } from "./stdinc.ts";

/** A point (using integers). */
export interface SDL_Point {
    x: i32;
    y: i32;
}

/** A point (using floating point values). */
export interface SDL_FPoint {
    x: f32;
    y: f32;
}

/** A rectangle, with the origin at the upper left (using integers). */
export interface SDL_Rect {
    x: i32;
    y: i32;
    w: i32;
    h: i32;
}

/** A rectangle, with the origin at the upper left (using floating point values). */
export interface SDL_FRect {
    x: f32;
    y: f32;
    w: f32;
    h: f32;
}

export declare function SDL_HasRectIntersection(A: Pointer<SDL_Rect>, B: Pointer<SDL_Rect>): boolean;

export declare function SDL_GetRectIntersection(A: Pointer<SDL_Rect>, B: Pointer<SDL_Rect>, result: Pointer<SDL_Rect>): boolean;

export declare function SDL_GetRectUnion(A: Pointer<SDL_Rect>, B: Pointer<SDL_Rect>, result: Pointer<SDL_Rect>): boolean;

export declare function SDL_GetRectEnclosingPoints(points: Pointer<SDL_Point>, count: i32, clip: Pointer<SDL_Rect> | null, result: Pointer<SDL_Rect>): boolean;

export declare function SDL_GetRectAndLineIntersection(rect: Pointer<SDL_Rect>, X1: Pointer<i32>, Y1: Pointer<i32>, X2: Pointer<i32>, Y2: Pointer<i32>): boolean;

export declare function SDL_HasRectIntersectionFloat(A: Pointer<SDL_FRect>, B: Pointer<SDL_FRect>): boolean;

export declare function SDL_GetRectIntersectionFloat(A: Pointer<SDL_FRect>, B: Pointer<SDL_FRect>, result: Pointer<SDL_FRect>): boolean;

export declare function SDL_GetRectUnionFloat(A: Pointer<SDL_FRect>, B: Pointer<SDL_FRect>, result: Pointer<SDL_FRect>): boolean;

export declare function SDL_GetRectEnclosingPointsFloat(points: Pointer<SDL_FPoint>, count: i32, clip: Pointer<SDL_FRect> | null, result: Pointer<SDL_FRect>): boolean;

export declare function SDL_GetRectAndLineIntersectionFloat(rect: Pointer<SDL_FRect>, X1: Pointer<f32>, Y1: Pointer<f32>, X2: Pointer<f32>, Y2: Pointer<f32>): boolean;

// ---------------------------------------------------------------------------
// The SDL_FORCE_INLINE helpers, rewritten. There is no exported symbol for any
// of these — the C header defines them in place — so they are ordinary Goblin
// functions here.
//
// They take values rather than `Pointer<T> | null`: the C versions spend their
// first clause testing for NULL, and there is nothing to test here. A rect is
// four scalars, so the copy is what a C compiler would have done with the
// dereference anyway — except for `SDL_RectToFRect`, whose output has to stay a
// pointer because it is written through.
// ---------------------------------------------------------------------------

/** Convert an SDL_Rect to SDL_FRect. */
export function SDL_RectToFRect(rect: SDL_Rect, frect: Pointer<SDL_FRect>): void {
    frect.x = cast<f32>(rect.x);
    frect.y = cast<f32>(rect.y);
    frect.w = cast<f32>(rect.w);
    frect.h = cast<f32>(rect.h);
}

/** Is the point inside the rectangle? */
export function SDL_PointInRect(p: SDL_Point, r: SDL_Rect): boolean {
    return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

/** Is the rectangle empty (no positive width or height)? */
export function SDL_RectEmpty(r: SDL_Rect): boolean {
    return r.w <= 0 || r.h <= 0;
}

/** Do the two rectangles have the same origin and size? */
export function SDL_RectsEqual(a: SDL_Rect, b: SDL_Rect): boolean {
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Is the point inside the rectangle? (floating point) */
export function SDL_PointInRectFloat(p: SDL_FPoint, r: SDL_FRect): boolean {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Is the rectangle empty? (floating point) */
export function SDL_RectEmptyFloat(r: SDL_FRect): boolean {
    return r.w < 0.0 || r.h < 0.0;
}

/** Are the two rectangles equal, within `epsilon` on every field? */
export function SDL_RectsEqualEpsilon(a: SDL_FRect, b: SDL_FRect, epsilon: f32): boolean {
    return SDL_fabsf(a.x - b.x) <= epsilon
        && SDL_fabsf(a.y - b.y) <= epsilon
        && SDL_fabsf(a.w - b.w) <= epsilon
        && SDL_fabsf(a.h - b.h) <= epsilon;
}

/** Are the two rectangles equal, within `SDL_FLT_EPSILON` on every field? */
export function SDL_RectsEqualFloat(a: SDL_FRect, b: SDL_FRect): boolean {
    // SDL_FLT_EPSILON. The compiler has no module-level `const` yet, so the
    // value is written here rather than named.
    return SDL_RectsEqualEpsilon(a, b, 1.1920928955078125e-07);
}
