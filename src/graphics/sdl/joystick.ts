// Translated from SDL_joystick.h
//
// A joystick is the raw device: numbered axes, buttons, hats and balls, with no
// opinion about what any of them mean. `gamepad.ts` is the layer that maps a
// known device onto the Xbox-style layout; reach for that first, and come here
// for a wheel, a flight stick, or anything SDL has no mapping for.
//
// `SDL_GetJoystickGUIDForID`, `SDL_GetJoystickGUID` and `SDL_GetJoystickGUIDInfo`
// pass an `SDL_GUID` by value — sixteen bytes, so the Windows x64 ABI moves it
// indirectly.

import type { SDL_GUID } from "./guid.ts";
import type { SDL_PowerState } from "./power.ts";
import type { SDL_PropertiesID } from "./properties.ts";
import type { SDL_SensorType } from "./sensor.ts";

/** The joystick structure used to identify an SDL joystick. Opaque. */
export declare class SDL_Joystick {
    private _opaque: never;
}

/** A unique ID for a joystick for the time it is connected. Never zero. */
export type SDL_JoystickID = u32;

/** An enum of some common joystick types. */
export enum SDL_JoystickType {
    UNKNOWN,
    GAMEPAD,
    WHEEL,
    ARCADE_STICK,
    FLIGHT_STICK,
    DANCE_PAD,
    GUITAR,
    DRUM_KIT,
    ARCADE_PAD,
    THROTTLE,
    COUNT,
}

export declare namespace SDL_JoystickType {
    type Underlying = i32;
}

/** Possible connection states for a joystick device. */
export enum SDL_JoystickConnectionState {
    INVALID = -1,
    UNKNOWN,
    WIRED,
    WIRELESS,
}

export declare namespace SDL_JoystickConnectionState {
    type Underlying = i32;
}

/** The range `SDL_GetJoystickAxis` reports. A trigger idles at MIN, not at zero. */
export enum SDL_JoystickAxisRange {
    MAX = 32767,
    MIN = -32768,
}

export declare namespace SDL_JoystickAxisRange {
    type Underlying = i16;
}

/** Hat positions, as returned by `SDL_GetJoystickHat`. */
export enum SDL_Hat {
    CENTERED = 0x00,
    UP = 0x01,
    RIGHT = 0x02,
    DOWN = 0x04,
    LEFT = 0x08,
    RIGHTUP = RIGHT | UP,
    RIGHTDOWN = RIGHT | DOWN,
    LEFTUP = LEFT | UP,
    LEFTDOWN = LEFT | DOWN,
}

export declare namespace SDL_Hat {
    type Underlying = u8;
}

/** The structure that describes a virtual joystick touchpad. */
export interface SDL_VirtualJoystickTouchpadDesc {
    /** The number of simultaneous fingers on this touchpad. */
    nfingers: u16;
    padding: FixedArray<u16, 3>;
}

/** The structure that describes a virtual joystick sensor. */
export interface SDL_VirtualJoystickSensorDesc {
    /** The type of this sensor. */
    type: SDL_SensorType;
    /** The update frequency of this sensor; may be 0.0. */
    rate: f32;
}

/**
 * The structure that describes a virtual joystick.
 *
 * Every element is optional, but `version` is not: the C side reads it to
 * decide how much of the struct exists. `SDL_INIT_INTERFACE` sets it there;
 * here, zero the struct and write `version = sizeOf<SDL_VirtualJoystickDesc>()`
 * yourself before calling `SDL_AttachVirtualJoystick`.
 *
 * The callbacks are plain function pointers — they cannot capture, so
 * `userdata` is how state reaches them.
 */
export interface SDL_VirtualJoystickDesc {
    /** The version of this interface — `sizeOf<SDL_VirtualJoystickDesc>()`. */
    version: u32;
    /** An `SDL_JoystickType`, narrowed to sixteen bits. */
    type: u16;
    /** Unused. */
    padding: u16;
    /** The USB vendor ID of this joystick. */
    vendor_id: u16;
    /** The USB product ID of this joystick. */
    product_id: u16;
    /** The number of axes on this joystick. */
    naxes: u16;
    /** The number of buttons on this joystick. */
    nbuttons: u16;
    /** The number of balls on this joystick. */
    nballs: u16;
    /** The number of hats on this joystick. */
    nhats: u16;
    /** The number of touchpads; requires `touchpads` to point at valid descriptions. */
    ntouchpads: u16;
    /** The number of sensors; requires `sensors` to point at valid descriptions. */
    nsensors: u16;
    /** Unused. */
    padding2: FixedArray<u16, 2>;
    /** A mask of which buttons are valid, e.g. `1 << SDL_GamepadButton.SOUTH`. */
    button_mask: u32;
    /** A mask of which axes are valid, e.g. `1 << SDL_GamepadAxis.LEFTX`. */
    axis_mask: u32;
    /** The name of the joystick. */
    name: CString | null;
    /** An array of touchpad descriptions; required if `ntouchpads` > 0. */
    touchpads: Pointer<SDL_VirtualJoystickTouchpadDesc> | null;
    /** An array of sensor descriptions; required if `nsensors` > 0. */
    sensors: Pointer<SDL_VirtualJoystickSensorDesc> | null;
    /** User data pointer passed to the callbacks. */
    userdata: Pointer<unknown> | null;
    /** Called when the joystick state should be updated. */
    Update: ((userdata: Pointer<unknown> | null) => void) | null;
    /** Called when the player index is set. */
    SetPlayerIndex: ((userdata: Pointer<unknown> | null, player_index: i32) => void) | null;
    /** Implements `SDL_RumbleJoystick`. */
    Rumble: ((userdata: Pointer<unknown> | null, low_frequency_rumble: u16, high_frequency_rumble: u16) => boolean) | null;
    /** Implements `SDL_RumbleJoystickTriggers`. */
    RumbleTriggers: ((userdata: Pointer<unknown> | null, left_rumble: u16, right_rumble: u16) => boolean) | null;
    /** Implements `SDL_SetJoystickLED`. */
    SetLED: ((userdata: Pointer<unknown> | null, red: u8, green: u8, blue: u8) => boolean) | null;
    /** Implements `SDL_SendJoystickEffect`. */
    SendEffect: ((userdata: Pointer<unknown> | null, data: Pointer<unknown>, size: i32) => boolean) | null;
    /** Implements `SDL_SetGamepadSensorEnabled`. */
    SetSensorsEnabled: ((userdata: Pointer<unknown> | null, enabled: boolean) => boolean) | null;
    /** Cleans up the userdata when the joystick is detached. */
    Cleanup: ((userdata: Pointer<unknown> | null) => void) | null;
}

// ---------------------------------------------------------------------------
// Enumeration. Joystick state is shared with SDL's own device thread, so a
// sequence of calls that has to see one consistent picture belongs between
// SDL_LockJoysticks and SDL_UnlockJoysticks.
// ---------------------------------------------------------------------------

export declare function SDL_LockJoysticks(): void;

export declare function SDL_UnlockJoysticks(): void;

export declare function SDL_HasJoystick(): boolean;

/** The array is SDL's allocation: release it with `SDL_free`. */
export declare function SDL_GetJoysticks(count: Pointer<i32> | null): Pointer<SDL_JoystickID> | null;

export declare function SDL_GetJoystickNameForID(instance_id: SDL_JoystickID): CString | null;

export declare function SDL_GetJoystickPathForID(instance_id: SDL_JoystickID): CString | null;

export declare function SDL_GetJoystickPlayerIndexForID(instance_id: SDL_JoystickID): i32;

export declare function SDL_GetJoystickGUIDForID(instance_id: SDL_JoystickID): SDL_GUID;

export declare function SDL_GetJoystickVendorForID(instance_id: SDL_JoystickID): u16;

export declare function SDL_GetJoystickProductForID(instance_id: SDL_JoystickID): u16;

export declare function SDL_GetJoystickProductVersionForID(instance_id: SDL_JoystickID): u16;

export declare function SDL_GetJoystickTypeForID(instance_id: SDL_JoystickID): SDL_JoystickType;

export declare function SDL_OpenJoystick(instance_id: SDL_JoystickID): Pointer<SDL_Joystick> | null;

export declare function SDL_GetJoystickFromID(instance_id: SDL_JoystickID): Pointer<SDL_Joystick> | null;

export declare function SDL_GetJoystickFromPlayerIndex(player_index: i32): Pointer<SDL_Joystick> | null;

// ---------------------------------------------------------------------------
// Virtual joysticks.
// ---------------------------------------------------------------------------

export declare function SDL_AttachVirtualJoystick(desc: Pointer<SDL_VirtualJoystickDesc>): SDL_JoystickID;

export declare function SDL_DetachVirtualJoystick(instance_id: SDL_JoystickID): boolean;

export declare function SDL_IsJoystickVirtual(instance_id: SDL_JoystickID): boolean;

export declare function SDL_SetJoystickVirtualAxis(joystick: Pointer<SDL_Joystick>, axis: i32, value: i16): boolean;

export declare function SDL_SetJoystickVirtualBall(joystick: Pointer<SDL_Joystick>, ball: i32, xrel: i16, yrel: i16): boolean;

export declare function SDL_SetJoystickVirtualButton(joystick: Pointer<SDL_Joystick>, button: i32, down: boolean): boolean;

export declare function SDL_SetJoystickVirtualHat(joystick: Pointer<SDL_Joystick>, hat: i32, value: u8): boolean;

export declare function SDL_SetJoystickVirtualTouchpad(
    joystick: Pointer<SDL_Joystick>,
    touchpad: i32,
    finger: i32,
    down: boolean,
    x: f32,
    y: f32,
    pressure: f32,
): boolean;

export declare function SDL_SendJoystickVirtualSensorData(
    joystick: Pointer<SDL_Joystick>,
    type: SDL_SensorType,
    sensor_timestamp: u64,
    data: Pointer<f32>,
    num_values: i32,
): boolean;

// ---------------------------------------------------------------------------
// An opened joystick.
// ---------------------------------------------------------------------------

/**
 * The joystick's property group.
 *
 * `"SDL.joystick.cap.mono_led"`, `"SDL.joystick.cap.rgb_led"`,
 * `"SDL.joystick.cap.player_led"`, `"SDL.joystick.cap.rumble"`,
 * `"SDL.joystick.cap.trigger_rumble"` — all booleans.
 */
export declare function SDL_GetJoystickProperties(joystick: Pointer<SDL_Joystick>): SDL_PropertiesID;

export declare function SDL_GetJoystickName(joystick: Pointer<SDL_Joystick>): CString | null;

export declare function SDL_GetJoystickPath(joystick: Pointer<SDL_Joystick>): CString | null;

export declare function SDL_GetJoystickPlayerIndex(joystick: Pointer<SDL_Joystick>): i32;

export declare function SDL_SetJoystickPlayerIndex(joystick: Pointer<SDL_Joystick>, player_index: i32): boolean;

export declare function SDL_GetJoystickGUID(joystick: Pointer<SDL_Joystick>): SDL_GUID;

export declare function SDL_GetJoystickVendor(joystick: Pointer<SDL_Joystick>): u16;

export declare function SDL_GetJoystickProduct(joystick: Pointer<SDL_Joystick>): u16;

export declare function SDL_GetJoystickProductVersion(joystick: Pointer<SDL_Joystick>): u16;

export declare function SDL_GetJoystickFirmwareVersion(joystick: Pointer<SDL_Joystick>): u16;

export declare function SDL_GetJoystickSerial(joystick: Pointer<SDL_Joystick>): CString | null;

export declare function SDL_GetJoystickType(joystick: Pointer<SDL_Joystick>): SDL_JoystickType;

/** Unpack a GUID without opening the device. Any out-param may be null. */
export declare function SDL_GetJoystickGUIDInfo(
    guid: SDL_GUID,
    vendor: Pointer<u16> | null,
    product: Pointer<u16> | null,
    version: Pointer<u16> | null,
    crc16: Pointer<u16> | null,
): void;

export declare function SDL_JoystickConnected(joystick: Pointer<SDL_Joystick>): boolean;

export declare function SDL_GetJoystickID(joystick: Pointer<SDL_Joystick>): SDL_JoystickID;

export declare function SDL_GetNumJoystickAxes(joystick: Pointer<SDL_Joystick>): i32;

export declare function SDL_GetNumJoystickBalls(joystick: Pointer<SDL_Joystick>): i32;

export declare function SDL_GetNumJoystickHats(joystick: Pointer<SDL_Joystick>): i32;

export declare function SDL_GetNumJoystickButtons(joystick: Pointer<SDL_Joystick>): i32;

export declare function SDL_CloseJoystick(joystick: Pointer<SDL_Joystick>): void;

export declare function SDL_GetJoystickConnectionState(joystick: Pointer<SDL_Joystick>): SDL_JoystickConnectionState;

/** `percent` gets [0, 100], or -1 when it cannot be determined. */
export declare function SDL_GetJoystickPowerInfo(joystick: Pointer<SDL_Joystick>, percent: Pointer<i32> | null): SDL_PowerState;

// ---------------------------------------------------------------------------
// State.
// ---------------------------------------------------------------------------

/** Off means state only updates on `SDL_UpdateJoysticks`; no events arrive. */
export declare function SDL_SetJoystickEventsEnabled(enabled: boolean): void;

export declare function SDL_JoystickEventsEnabled(): boolean;

/** Only needed when joystick events are disabled; `SDL_PumpEvents` does this otherwise. */
export declare function SDL_UpdateJoysticks(): void;

/** In `SDL_JoystickAxisRange`. A trigger idles at MIN — see `SDL_GetJoystickAxisInitialState`. */
export declare function SDL_GetJoystickAxis(joystick: Pointer<SDL_Joystick>, axis: i32): i16;

export declare function SDL_GetJoystickAxisInitialState(joystick: Pointer<SDL_Joystick>, axis: i32, state: Pointer<i16> | null): boolean;

export declare function SDL_GetJoystickBall(joystick: Pointer<SDL_Joystick>, ball: i32, dx: Pointer<i32> | null, dy: Pointer<i32> | null): boolean;

/** One of the `SDL_Hat` values. */
export declare function SDL_GetJoystickHat(joystick: Pointer<SDL_Joystick>, hat: i32): u8;

export declare function SDL_GetJoystickButton(joystick: Pointer<SDL_Joystick>, button: i32): boolean;

// ---------------------------------------------------------------------------
// Output.
// ---------------------------------------------------------------------------

/** Each magnitude is [0, 0xFFFF]. Calling again replaces the effect rather than queuing it. */
export declare function SDL_RumbleJoystick(
    joystick: Pointer<SDL_Joystick>,
    low_frequency_rumble: u16,
    high_frequency_rumble: u16,
    duration_ms: u32,
): boolean;

export declare function SDL_RumbleJoystickTriggers(joystick: Pointer<SDL_Joystick>, left_rumble: u16, right_rumble: u16, duration_ms: u32): boolean;

export declare function SDL_SetJoystickLED(joystick: Pointer<SDL_Joystick>, red: u8, green: u8, blue: u8): boolean;

/** A device-specific effect payload. What is in it is the driver's business. */
export declare function SDL_SendJoystickEffect(joystick: Pointer<SDL_Joystick>, data: Pointer<unknown>, size: i32): boolean;
