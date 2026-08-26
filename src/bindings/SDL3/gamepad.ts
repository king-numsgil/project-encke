// Translated from SDL_gamepad.h
//
// A gamepad is a joystick SDL has a mapping for: the same device, addressed by
// what the controls *mean* rather than by their index. Open one with
// `SDL_OpenGamepad` when `SDL_IsGamepad` says the joystick qualifies, and drop
// to `joystick.ts` when it does not.
//
// Several calls here return `char *` rather than `const char *` — SDL allocated
// the string and it is yours to release with `SDL_free`. They are the ones
// typed `CString | null` with a note; every other string return is SDL's own.

import type { SDL_GUID } from "./guid.ts";
import type { SDL_IOStream } from "./iostream.ts";
import type { SDL_Joystick, SDL_JoystickConnectionState, SDL_JoystickID } from "./joystick.ts";
import type { SDL_PowerState } from "./power.ts";
import type { SDL_PropertiesID } from "./properties.ts";
import type { SDL_SensorType } from "./sensor.ts";

/** The structure used to identify an SDL gamepad. Opaque. */
export declare class SDL_Gamepad {
    private _opaque: never;
}

/** Standard gamepad types. */
export enum SDL_GamepadType {
    UNKNOWN = 0,
    STANDARD,
    XBOX360,
    XBOXONE,
    PS3,
    PS4,
    PS5,
    NINTENDO_SWITCH_PRO,
    NINTENDO_SWITCH_JOYCON_LEFT,
    NINTENDO_SWITCH_JOYCON_RIGHT,
    NINTENDO_SWITCH_JOYCON_PAIR,
    GAMECUBE,
    COUNT,
}

export declare namespace SDL_GamepadType {
    type Underlying = i32;
}

/**
 * The list of buttons available on a gamepad.
 *
 * The face buttons are named by *position*, not by label: `SOUTH` is the bottom
 * one, which is A on an Xbox pad and B on a Nintendo one. Use
 * `SDL_GetGamepadButtonLabel` when you need to tell the player what to press.
 */
export enum SDL_GamepadButton {
    INVALID = -1,
    /** Bottom face button (e.g. Xbox A button) */
    SOUTH,
    /** Right face button (e.g. Xbox B button) */
    EAST,
    /** Left face button (e.g. Xbox X button) */
    WEST,
    /** Top face button (e.g. Xbox Y button) */
    NORTH,
    BACK,
    GUIDE,
    START,
    LEFT_STICK,
    RIGHT_STICK,
    LEFT_SHOULDER,
    RIGHT_SHOULDER,
    DPAD_UP,
    DPAD_DOWN,
    DPAD_LEFT,
    DPAD_RIGHT,
    /** Additional button (e.g. Xbox Series X share button, PS5 microphone button) */
    MISC1,
    /** Upper or primary paddle, under your right hand */
    RIGHT_PADDLE1,
    /** Upper or primary paddle, under your left hand */
    LEFT_PADDLE1,
    /** Lower or secondary paddle, under your right hand */
    RIGHT_PADDLE2,
    /** Lower or secondary paddle, under your left hand */
    LEFT_PADDLE2,
    /** PS4/PS5 touchpad button */
    TOUCHPAD,
    /** Additional button */
    MISC2,
    MISC3,
    MISC4,
    MISC5,
    MISC6,
    COUNT,
}

export declare namespace SDL_GamepadButton {
    type Underlying = i32;
}

/** The label printed on a gamepad's face button — what the player actually sees. */
export enum SDL_GamepadButtonLabel {
    UNKNOWN,
    A,
    B,
    X,
    Y,
    CROSS,
    CIRCLE,
    SQUARE,
    TRIANGLE,
}

export declare namespace SDL_GamepadButtonLabel {
    type Underlying = i32;
}

/**
 * The list of axes available on a gamepad.
 *
 * Sticks report the full `SDL_JoystickAxisRange`. Triggers report 0 to 32767 —
 * they idle at zero, unlike a raw joystick axis.
 */
export enum SDL_GamepadAxis {
    INVALID = -1,
    LEFTX,
    LEFTY,
    RIGHTX,
    RIGHTY,
    LEFT_TRIGGER,
    RIGHT_TRIGGER,
    COUNT,
}

export declare namespace SDL_GamepadAxis {
    type Underlying = i32;
}

/** The kind of physical control a mapping entry reads from or writes to. */
export enum SDL_GamepadBindingType {
    NONE = 0,
    BUTTON,
    AXIS,
    HAT,
}

export declare namespace SDL_GamepadBindingType {
    type Underlying = i32;
}

/** The `axis` arm of `SDL_GamepadBindingInput`. */
export interface SDL_GamepadBindingInputAxis {
    axis: i32;
    axis_min: i32;
    axis_max: i32;
}

/** The `hat` arm of `SDL_GamepadBindingInput`. */
export interface SDL_GamepadBindingInputHat {
    hat: i32;
    hat_mask: i32;
}

/** The physical side of a binding. `SDL_GamepadBinding.input_type` says which arm is live. */
export interface SDL_GamepadBindingInput extends Union {
    button: i32;
    axis: SDL_GamepadBindingInputAxis;
    hat: SDL_GamepadBindingInputHat;
}

/** The `axis` arm of `SDL_GamepadBindingOutput`. */
export interface SDL_GamepadBindingOutputAxis {
    axis: SDL_GamepadAxis;
    axis_min: i32;
    axis_max: i32;
}

/** The logical side of a binding. `SDL_GamepadBinding.output_type` says which arm is live. */
export interface SDL_GamepadBindingOutput extends Union {
    button: SDL_GamepadButton;
    axis: SDL_GamepadBindingOutputAxis;
}

/** One entry of a gamepad mapping: this physical control drives that logical one. */
export interface SDL_GamepadBinding {
    input_type: SDL_GamepadBindingType;
    input: SDL_GamepadBindingInput;
    output_type: SDL_GamepadBindingType;
    output: SDL_GamepadBindingOutput;
}

// ---------------------------------------------------------------------------
// Mappings.
// ---------------------------------------------------------------------------

/** 1 if a new mapping was added, 0 if an existing one was updated, -1 on failure. */
export declare function SDL_AddGamepadMapping(mapping: CString): i32;

/** The number of mappings added, or -1 on failure. */
export declare function SDL_AddGamepadMappingsFromIO(src: Pointer<SDL_IOStream>, closeio: boolean): i32;

export declare function SDL_AddGamepadMappingsFromFile(file: CString): i32;

/** Re-apply the built-in mappings and the hints on top of what has been added. */
export declare function SDL_ReloadGamepadMappings(): boolean;

/** One `SDL_free` releases the array and every string in it. */
export declare function SDL_GetGamepadMappings(count: Pointer<i32> | null): Pointer<CString> | null;

/** SDL allocated this string — release it with `SDL_free`. */
export declare function SDL_GetGamepadMappingForGUID(guid: SDL_GUID): CString | null;

/** SDL allocated this string — release it with `SDL_free`. */
export declare function SDL_GetGamepadMapping(gamepad: Pointer<SDL_Gamepad>): CString | null;

/** `null` for `mapping` removes the device's mapping, so it stops being a gamepad. */
export declare function SDL_SetGamepadMapping(instance_id: SDL_JoystickID, mapping: CString | null): boolean;

/** SDL allocated this string — release it with `SDL_free`. */
export declare function SDL_GetGamepadMappingForID(instance_id: SDL_JoystickID): CString | null;

// ---------------------------------------------------------------------------
// Enumeration.
// ---------------------------------------------------------------------------

export declare function SDL_HasGamepad(): boolean;

/** The array is SDL's allocation: release it with `SDL_free`. */
export declare function SDL_GetGamepads(count: Pointer<i32> | null): Pointer<SDL_JoystickID> | null;

export declare function SDL_IsGamepad(instance_id: SDL_JoystickID): boolean;

export declare function SDL_GetGamepadNameForID(instance_id: SDL_JoystickID): CString | null;

export declare function SDL_GetGamepadPathForID(instance_id: SDL_JoystickID): CString | null;

export declare function SDL_GetGamepadPlayerIndexForID(instance_id: SDL_JoystickID): i32;

export declare function SDL_GetGamepadGUIDForID(instance_id: SDL_JoystickID): SDL_GUID;

export declare function SDL_GetGamepadVendorForID(instance_id: SDL_JoystickID): u16;

export declare function SDL_GetGamepadProductForID(instance_id: SDL_JoystickID): u16;

export declare function SDL_GetGamepadProductVersionForID(instance_id: SDL_JoystickID): u16;

/** The type the mapping claims, which a hint can override. */
export declare function SDL_GetGamepadTypeForID(instance_id: SDL_JoystickID): SDL_GamepadType;

/** The type of the hardware itself, ignoring any override. */
export declare function SDL_GetRealGamepadTypeForID(instance_id: SDL_JoystickID): SDL_GamepadType;

export declare function SDL_OpenGamepad(instance_id: SDL_JoystickID): Pointer<SDL_Gamepad> | null;

export declare function SDL_GetGamepadFromID(instance_id: SDL_JoystickID): Pointer<SDL_Gamepad> | null;

export declare function SDL_GetGamepadFromPlayerIndex(player_index: i32): Pointer<SDL_Gamepad> | null;

// ---------------------------------------------------------------------------
// An opened gamepad.
// ---------------------------------------------------------------------------

/**
 * The gamepad's property group.
 *
 * `"SDL.gamepad.cap.mono_led"`, `"SDL.gamepad.cap.rgb_led"`,
 * `"SDL.gamepad.cap.player_led"`, `"SDL.gamepad.cap.rumble"`,
 * `"SDL.gamepad.cap.trigger_rumble"` — all booleans.
 */
export declare function SDL_GetGamepadProperties(gamepad: Pointer<SDL_Gamepad>): SDL_PropertiesID;

export declare function SDL_GetGamepadID(gamepad: Pointer<SDL_Gamepad>): SDL_JoystickID;

export declare function SDL_GetGamepadName(gamepad: Pointer<SDL_Gamepad>): CString | null;

export declare function SDL_GetGamepadPath(gamepad: Pointer<SDL_Gamepad>): CString | null;

export declare function SDL_GetGamepadType(gamepad: Pointer<SDL_Gamepad>): SDL_GamepadType;

export declare function SDL_GetRealGamepadType(gamepad: Pointer<SDL_Gamepad>): SDL_GamepadType;

export declare function SDL_GetGamepadPlayerIndex(gamepad: Pointer<SDL_Gamepad>): i32;

export declare function SDL_SetGamepadPlayerIndex(gamepad: Pointer<SDL_Gamepad>, player_index: i32): boolean;

export declare function SDL_GetGamepadVendor(gamepad: Pointer<SDL_Gamepad>): u16;

export declare function SDL_GetGamepadProduct(gamepad: Pointer<SDL_Gamepad>): u16;

export declare function SDL_GetGamepadProductVersion(gamepad: Pointer<SDL_Gamepad>): u16;

export declare function SDL_GetGamepadFirmwareVersion(gamepad: Pointer<SDL_Gamepad>): u16;

export declare function SDL_GetGamepadSerial(gamepad: Pointer<SDL_Gamepad>): CString | null;

/** Zero if the device is not registered with Steam Input. */
export declare function SDL_GetGamepadSteamHandle(gamepad: Pointer<SDL_Gamepad>): u64;

export declare function SDL_GetGamepadConnectionState(gamepad: Pointer<SDL_Gamepad>): SDL_JoystickConnectionState;

/** `percent` gets [0, 100], or -1 when it cannot be determined. */
export declare function SDL_GetGamepadPowerInfo(gamepad: Pointer<SDL_Gamepad>, percent: Pointer<i32> | null): SDL_PowerState;

export declare function SDL_GamepadConnected(gamepad: Pointer<SDL_Gamepad>): boolean;

/** The joystick underneath. SDL owns it — do not close it. */
export declare function SDL_GetGamepadJoystick(gamepad: Pointer<SDL_Gamepad>): Pointer<SDL_Joystick> | null;

export declare function SDL_CloseGamepad(gamepad: Pointer<SDL_Gamepad>): void;

/**
 * The mapping, one binding at a time.
 *
 * An array of *pointers*, NULL-terminated. Release the array with `SDL_free`;
 * the bindings it points at are SDL's.
 */
export declare function SDL_GetGamepadBindings(gamepad: Pointer<SDL_Gamepad>, count: Pointer<i32> | null): Pointer<Pointer<SDL_GamepadBinding>> | null;

// ---------------------------------------------------------------------------
// State.
// ---------------------------------------------------------------------------

/** Off means state only updates on `SDL_UpdateGamepads`; no events arrive. */
export declare function SDL_SetGamepadEventsEnabled(enabled: boolean): void;

export declare function SDL_GamepadEventsEnabled(): boolean;

/** Only needed when gamepad events are disabled; `SDL_PumpEvents` does this otherwise. */
export declare function SDL_UpdateGamepads(): void;

export declare function SDL_GetGamepadTypeFromString(str: CString): SDL_GamepadType;

export declare function SDL_GetGamepadStringForType(type: SDL_GamepadType): CString | null;

export declare function SDL_GetGamepadAxisFromString(str: CString): SDL_GamepadAxis;

export declare function SDL_GetGamepadStringForAxis(axis: SDL_GamepadAxis): CString | null;

export declare function SDL_GamepadHasAxis(gamepad: Pointer<SDL_Gamepad>, axis: SDL_GamepadAxis): boolean;

/** Sticks span the full signed range; triggers run 0 to 32767. */
export declare function SDL_GetGamepadAxis(gamepad: Pointer<SDL_Gamepad>, axis: SDL_GamepadAxis): i16;

export declare function SDL_GetGamepadButtonFromString(str: CString): SDL_GamepadButton;

export declare function SDL_GetGamepadStringForButton(button: SDL_GamepadButton): CString | null;

export declare function SDL_GamepadHasButton(gamepad: Pointer<SDL_Gamepad>, button: SDL_GamepadButton): boolean;

export declare function SDL_GetGamepadButton(gamepad: Pointer<SDL_Gamepad>, button: SDL_GamepadButton): boolean;

/** What a given pad *type* prints on that position, without needing a device open. */
export declare function SDL_GetGamepadButtonLabelForType(type: SDL_GamepadType, button: SDL_GamepadButton): SDL_GamepadButtonLabel;

export declare function SDL_GetGamepadButtonLabel(gamepad: Pointer<SDL_Gamepad>, button: SDL_GamepadButton): SDL_GamepadButtonLabel;

// ---------------------------------------------------------------------------
// Touchpads and sensors.
// ---------------------------------------------------------------------------

export declare function SDL_GetNumGamepadTouchpads(gamepad: Pointer<SDL_Gamepad>): i32;

export declare function SDL_GetNumGamepadTouchpadFingers(gamepad: Pointer<SDL_Gamepad>, touchpad: i32): i32;

export declare function SDL_GetGamepadTouchpadFinger(
    gamepad: Pointer<SDL_Gamepad>,
    touchpad: i32,
    finger: i32,
    down: Pointer<boolean> | null,
    x: Pointer<f32> | null,
    y: Pointer<f32> | null,
    pressure: Pointer<f32> | null,
): boolean;

export declare function SDL_GamepadHasSensor(gamepad: Pointer<SDL_Gamepad>, type: SDL_SensorType): boolean;

export declare function SDL_SetGamepadSensorEnabled(gamepad: Pointer<SDL_Gamepad>, type: SDL_SensorType, enabled: boolean): boolean;

export declare function SDL_GamepadSensorEnabled(gamepad: Pointer<SDL_Gamepad>, type: SDL_SensorType): boolean;

/** In Hz, or 0.0 if the gamepad has no such sensor. */
export declare function SDL_GetGamepadSensorDataRate(gamepad: Pointer<SDL_Gamepad>, type: SDL_SensorType): f32;

export declare function SDL_GetGamepadSensorData(gamepad: Pointer<SDL_Gamepad>, type: SDL_SensorType, data: Pointer<f32>, num_values: i32): boolean;

// ---------------------------------------------------------------------------
// Output.
// ---------------------------------------------------------------------------

/** Each magnitude is [0, 0xFFFF]. Calling again replaces the effect rather than queuing it. */
export declare function SDL_RumbleGamepad(
    gamepad: Pointer<SDL_Gamepad>,
    low_frequency_rumble: u16,
    high_frequency_rumble: u16,
    duration_ms: u32,
): boolean;

export declare function SDL_RumbleGamepadTriggers(gamepad: Pointer<SDL_Gamepad>, left_rumble: u16, right_rumble: u16, duration_ms: u32): boolean;

export declare function SDL_SetGamepadLED(gamepad: Pointer<SDL_Gamepad>, red: u8, green: u8, blue: u8): boolean;

/** A device-specific effect payload. What is in it is the driver's business. */
export declare function SDL_SendGamepadEffect(gamepad: Pointer<SDL_Gamepad>, data: Pointer<unknown>, size: i32): boolean;

/** Apple platforms only; null elsewhere. */
export declare function SDL_GetGamepadAppleSFSymbolsNameForButton(gamepad: Pointer<SDL_Gamepad>, button: SDL_GamepadButton): CString | null;

/** Apple platforms only; null elsewhere. */
export declare function SDL_GetGamepadAppleSFSymbolsNameForAxis(gamepad: Pointer<SDL_Gamepad>, axis: SDL_GamepadAxis): CString | null;
