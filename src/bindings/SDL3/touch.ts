// Translated from SDL_touch.h
//
// `SDL_TouchID` and `SDL_FingerID` are `Uint64`, unlike the `Uint32` ID
// typedefs elsewhere in SDL. The comment in events.ts flagged this; it is
// settled here.

import type { SDL_MouseID } from "./mouse.ts";

/** A unique ID for a touch device. Never zero. */
export type SDL_TouchID = u64;

/** A unique ID for a single finger on a touch device. Never zero. */
export type SDL_FingerID = u64;

export enum SDL_TouchDeviceType {
    INVALID = -1,
    /** Touch screen with window-relative coordinates */
    DIRECT,
    /** Trackpad with absolute device coordinates */
    INDIRECT_ABSOLUTE,
    /** Trackpad with screen cursor-relative coordinates */
    INDIRECT_RELATIVE,
}

export declare namespace SDL_TouchDeviceType {
    type Underlying = i32;
}

/** Data about a single finger in a multitouch event. */
export interface SDL_Finger {
    /** The finger ID. */
    id: SDL_FingerID;
    /** The x-axis location of the touch event, normalized (0...1). */
    x: f32;
    /** The y-axis location of the touch event, normalized (0...1). */
    y: f32;
    /** The quantity of pressure applied, normalized (0...1). */
    pressure: f32;
}

/**
 * The `SDL_MouseID` on a mouse event synthesised from a touch.
 *
 * `(SDL_MouseID)-1` in the header — a `#define`, so it is a function here.
 */
export function SDL_TOUCH_MOUSEID(): SDL_MouseID {
    return 0xffffffff;
}

/** The `SDL_TouchID` on a touch event synthesised from a mouse. `(SDL_TouchID)-1`. */
export function SDL_MOUSE_TOUCHID(): SDL_TouchID {
    return 0xffffffffffffffff;
}

/** The array is SDL's allocation: release it with `SDL_free`. */
export declare function SDL_GetTouchDevices(count: Pointer<i32> | null): Pointer<SDL_TouchID> | null;

export declare function SDL_GetTouchDeviceName(touchID: SDL_TouchID): CString | null;

export declare function SDL_GetTouchDeviceType(touchID: SDL_TouchID): SDL_TouchDeviceType;

/**
 * The fingers currently down on a device.
 *
 * An array of *pointers*, NULL-terminated. Release the array with `SDL_free`;
 * the fingers it points at are SDL's.
 */
export declare function SDL_GetTouchFingers(touchID: SDL_TouchID, count: Pointer<i32> | null): Pointer<Pointer<SDL_Finger>> | null;
