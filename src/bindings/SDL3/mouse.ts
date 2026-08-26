// Translated from SDL_mouse.h

import type { SDL_Surface } from "./surface.ts";
import type { SDL_Window } from "./video.ts";

/** This is a unique ID for a mouse for the time it is connected. Never zero. */
export type SDL_MouseID = u32;

/** The structure used to identify an SDL cursor. Opaque. */
export declare class SDL_Cursor {
    private _opaque: never;
}

/** Cursor types for `SDL_CreateSystemCursor`. */
export enum SDL_SystemCursor {
    /** Default cursor. Usually an arrow. */
    DEFAULT,
    /** Text selection. Usually an I-beam. */
    TEXT,
    /** Wait. Usually an hourglass or watch or spinning ball. */
    WAIT,
    /** Crosshair. */
    CROSSHAIR,
    /** Program is busy but still interactive. Usually an arrow with an hourglass. */
    PROGRESS,
    /** Double arrow pointing northwest and southeast. */
    NWSE_RESIZE,
    /** Double arrow pointing northeast and southwest. */
    NESW_RESIZE,
    /** Double arrow pointing west and east. */
    EW_RESIZE,
    /** Double arrow pointing north and south. */
    NS_RESIZE,
    /** Four-pointed arrow pointing north, south, east and west. */
    MOVE,
    /** Not permitted. Usually a slashed circle or crossbones. */
    NOT_ALLOWED,
    /** Pointer that indicates a link. Usually a pointing hand. */
    POINTER,
    /** Window resize top-left. */
    NW_RESIZE,
    /** Window resize top. */
    N_RESIZE,
    /** Window resize top-right. */
    NE_RESIZE,
    /** Window resize right. */
    E_RESIZE,
    /** Window resize bottom-right. */
    SE_RESIZE,
    /** Window resize bottom. */
    S_RESIZE,
    /** Window resize bottom-left. */
    SW_RESIZE,
    /** Window resize left. */
    W_RESIZE,
    COUNT,
}

export declare namespace SDL_SystemCursor {
    type Underlying = i32;
}

/** Scroll direction types for the Scroll event. */
export enum SDL_MouseWheelDirection {
    /** The scroll direction is normal */
    NORMAL,
    /** The scroll direction is flipped / natural */
    FLIPPED,
}

export declare namespace SDL_MouseWheelDirection {
    type Underlying = i32;
}

/** One frame of an animated cursor. */
export interface SDL_CursorFrameInfo {
    /** The surface data for this frame. */
    surface: Pointer<SDL_Surface> | null;
    /** The frame duration in milliseconds; 0 is infinite. */
    duration: u32;
}

/**
 * A bitmask of pressed mouse buttons.
 *
 * Test with `SDL_BUTTON_MASK` or the named masks. Button 1 is left, 2 middle,
 * 3 right, 4 and 5 the side buttons.
 */
export enum SDL_MouseButtonFlags {
    NONE = 0x00000000,
    LMASK = 0x00000001,
    MMASK = 0x00000002,
    RMASK = 0x00000004,
    X1MASK = 0x00000008,
    X2MASK = 0x00000010,
}

export declare namespace SDL_MouseButtonFlags {
    type Underlying = u32;
}

/** Button indices, as they arrive in `SDL_MouseButtonEvent.button`. */
export enum SDL_Button {
    LEFT = 1,
    MIDDLE = 2,
    RIGHT = 3,
    X1 = 4,
    X2 = 5,
}

export declare namespace SDL_Button {
    type Underlying = u8;
}

/** The mask for button `X`, where `X` is 1-based — an `SDL_Button`. */
export function SDL_BUTTON_MASK(X: u32): u32 {
    return 1 << (X - 1);
}

export declare function SDL_HasMouse(): boolean;

/** The array is SDL's allocation: release it with `SDL_free`. */
export declare function SDL_GetMice(count: Pointer<i32> | null): Pointer<SDL_MouseID> | null;

export declare function SDL_GetMouseNameForID(instance_id: SDL_MouseID): CString | null;

export declare function SDL_GetMouseFocus(): Pointer<SDL_Window> | null;

/** Position is relative to the focused window. */
export declare function SDL_GetMouseState(x: Pointer<f32> | null, y: Pointer<f32> | null): SDL_MouseButtonFlags;

/** Position is relative to the desktop. */
export declare function SDL_GetGlobalMouseState(x: Pointer<f32> | null, y: Pointer<f32> | null): SDL_MouseButtonFlags;

/** Position is the accumulated motion since the last call to this function. */
export declare function SDL_GetRelativeMouseState(x: Pointer<f32> | null, y: Pointer<f32> | null): SDL_MouseButtonFlags;

/** `null` for `window` warps within the window that currently has mouse focus. */
export declare function SDL_WarpMouseInWindow(window: Pointer<SDL_Window> | null, x: f32, y: f32): void;

export declare function SDL_WarpMouseGlobal(x: f32, y: f32): boolean;

/**
 * Filter relative mouse motion before SDL delivers it.
 *
 * The callback rewrites `x` and `y` in place. It is a plain function pointer —
 * no captures — and it runs on whichever thread produced the motion, which is
 * not necessarily the main one. `null` removes the filter.
 */
export declare function SDL_SetRelativeMouseTransform(
    callback:
        | ((
            userdata: Pointer<unknown> | null,
            timestamp: u64,
            window: Pointer<SDL_Window> | null,
            mouseID: SDL_MouseID,
            x: Pointer<f32>,
            y: Pointer<f32>,
        ) => void)
        | null,
    userdata: Pointer<unknown> | null,
): boolean;

/** Relative mode hides the cursor, holds it in place, and reports only deltas. */
export declare function SDL_SetWindowRelativeMouseMode(window: Pointer<SDL_Window>, enabled: boolean): boolean;

export declare function SDL_GetWindowRelativeMouseMode(window: Pointer<SDL_Window>): boolean;

/** Keep receiving mouse events while the cursor is outside the window. */
export declare function SDL_CaptureMouse(enabled: boolean): boolean;

// ---------------------------------------------------------------------------
// Cursors.
// ---------------------------------------------------------------------------

/**
 * A black-and-white cursor from packed 1-bit rows.
 *
 * `data` and `mask` are `(w + 7) / 8 * h` bytes each, MSB first. The pair
 * (data, mask) means: 0,1 white; 1,1 black; 0,0 transparent; 1,0 inverted where
 * the platform supports it and black where it does not.
 */
export declare function SDL_CreateCursor(
    data: Pointer<u8>,
    mask: Pointer<u8>,
    w: i32,
    h: i32,
    hot_x: i32,
    hot_y: i32,
): Pointer<SDL_Cursor> | null;

export declare function SDL_CreateColorCursor(surface: Pointer<SDL_Surface>, hot_x: i32, hot_y: i32): Pointer<SDL_Cursor> | null;

export declare function SDL_CreateAnimatedCursor(
    frames: Pointer<SDL_CursorFrameInfo>,
    frame_count: i32,
    hot_x: i32,
    hot_y: i32,
): Pointer<SDL_Cursor> | null;

export declare function SDL_CreateSystemCursor(id: SDL_SystemCursor): Pointer<SDL_Cursor> | null;

/** `null` forces a redraw of the current cursor. */
export declare function SDL_SetCursor(cursor: Pointer<SDL_Cursor> | null): boolean;

/** Null if there is no mouse. SDL owns it — do not destroy it. */
export declare function SDL_GetCursor(): Pointer<SDL_Cursor> | null;

/** SDL owns it — do not destroy it. */
export declare function SDL_GetDefaultCursor(): Pointer<SDL_Cursor> | null;

export declare function SDL_DestroyCursor(cursor: Pointer<SDL_Cursor>): void;

export declare function SDL_ShowCursor(): boolean;

export declare function SDL_HideCursor(): boolean;

export declare function SDL_CursorVisible(): boolean;
