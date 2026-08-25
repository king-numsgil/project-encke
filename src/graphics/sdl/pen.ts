// Translated from SDL_pen.h
//
// Pen input arrives as events (SDL_PenProximityEvent, SDL_PenMotionEvent,
// SDL_PenTouchEvent, SDL_PenButtonEvent, SDL_PenAxisEvent) rather than through
// a query API, so this header is almost entirely types.

import type { SDL_MouseID } from "./mouse.ts";
import type { SDL_TouchID } from "./touch.ts";

/** A unique ID for a pen for the time it is connected. Never zero. */
export type SDL_PenID = u32;

/** The `SDL_MouseID` on a mouse event synthesised from a pen. `(SDL_MouseID)-2`. */
export function SDL_PEN_MOUSEID(): SDL_MouseID {
    return 0xfffffffe;
}

/** The `SDL_TouchID` on a touch event synthesised from a pen. `(SDL_TouchID)-2`. */
export function SDL_PEN_TOUCHID(): SDL_TouchID {
    return 0xfffffffffffffffe;
}

/** Pen input flags, as reported by various pen events' `pen_state` field. */
export enum SDL_PenInputFlags {
    NONE = 0x00000000,
    /** Pen is pressed down */
    DOWN = 0x00000001,
    /** Button 1 is pressed */
    BUTTON_1 = 0x00000002,
    /** Button 2 is pressed */
    BUTTON_2 = 0x00000004,
    /** Button 3 is pressed */
    BUTTON_3 = 0x00000008,
    /** Button 4 is pressed */
    BUTTON_4 = 0x00000010,
    /** Button 5 is pressed */
    BUTTON_5 = 0x00000020,
    /** Eraser tip is used */
    ERASER_TIP = 0x40000000,
    /** Pen is in proximity (since SDL 3.4.0) */
    IN_PROXIMITY = 0x80000000,
}

export declare namespace SDL_PenInputFlags {
    type Underlying = u32;
}

/** Pen axis indices, as they arrive in `SDL_PenAxisEvent.axis`. */
export enum SDL_PenAxis {
    /** Pen pressure, [0, 1] */
    PRESSURE,
    /** Pen horizontal tilt angle in degrees, [-90, 90]; negative is left */
    XTILT,
    /** Pen vertical tilt angle in degrees, [-90, 90]; negative is towards the user */
    YTILT,
    /** Pen distance from the drawing surface, [0, 1]; 0 is touching */
    DISTANCE,
    /** Pen barrel rotation in degrees, (-180, 180]; 0 is the "identity" position */
    ROTATION,
    /** Pen finger wheel or slider, [-1, 1] */
    SLIDER,
    /** Pressure from squeezing the pen (barrel pressure) */
    TANGENTIAL_PRESSURE,
    COUNT,
}

export declare namespace SDL_PenAxis {
    type Underlying = i32;
}

/** How a pen device is attached to the display. */
export enum SDL_PenDeviceType {
    /** Not a pen, or the ID is unknown */
    INVALID = -1,
    /** The pen device type could not be determined */
    UNKNOWN,
    /** The pen draws directly on the display, like a tablet PC or a Wacom Cintiq */
    DIRECT,
    /** The pen draws on a separate surface, like a Wacom Intuos */
    INDIRECT,
}

export declare namespace SDL_PenDeviceType {
    type Underlying = i32;
}

export declare function SDL_GetPenDeviceType(instance_id: SDL_PenID): SDL_PenDeviceType;
