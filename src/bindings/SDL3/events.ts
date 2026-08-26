// Translated from SDL_events.h
//
// Notes on type mapping:
//   - Uint8/16/32/64  -> u8/u16/u32/u64
//   - Sint8/16/32/64  -> i8/i16/i32/i64
//   - int             -> i32
//   - float           -> f32
//   - bool            -> boolean
//   - SDL_*ID typedefs -> u32, EXCEPT SDL_TouchID and SDL_FingerID, which are
//     Uint64 in SDL3 (flagged inline below — double check against your own
//     id.ts / touch.ts bindings if you've already picked a representation).
//   - const char*     -> left as `cstring` per your existing SDL_CreateWindow
//     usage; const char* const* left as a raw comment, adjust to whatever
//     your pointer-to-pointer convention ends up being.
//   - void*           -> left as a comment placeholder; depends on how you're
//     representing untyped C pointers.
//   - `type`/`mod`/`repeat` fields that collide with reserved words follow
//     the `mod_` / `repeat_` convention already used in SDL_KeyboardEvent
//     in your test file.
//
// SDL_EventType itself and the various ID/flag typedefs (SDL_WindowID,
// SDL_JoystickID, SDL_Keycode, SDL_Scancode, SDL_Keymod, SDL_MouseButtonFlags,
// SDL_MouseWheelDirection, SDL_PowerState, SDL_PenID, SDL_PenAxis,
// SDL_PenInputFlags, SDL_SensorID, SDL_AudioDeviceID, SDL_CameraID) are
// assumed to already exist elsewhere in your sdl/ bindings (enums.ts,
// ids.ts, or similar) and are referenced here by name, not redefined.

import { type SDL_Keycode, SDL_Keymod } from "./keycode.ts";
import type { SDL_Scancode } from "./scancode.ts";

export enum SDL_EventType {
    First = 0x0000, // Unused (do not remove)

    // Application events
    Quit = 0x100,
    Terminating = 0x101,
    LowMemory = 0x102,
    WillEnterBackground = 0x103,
    DidEnterBackground = 0x104,
    WillEnterForeground = 0x105,
    DidEnterForeground = 0x106,
    LocaleChanged = 0x107,
    SystemThemeChanged = 0x108,

    // Display events
    DisplayOrientation = 0x151,
    DisplayAdded = 0x152,
    DisplayRemoved = 0x153,
    DisplayMoved = 0x154,
    DisplayDesktopModeChanged = 0x155,
    DisplayCurrentModeChanged = 0x156,
    DisplayContentScaleChanged = 0x157,
    DisplayUsableBoundsChanged = 0x158,

    // Window events
    WindowShown = 0x202,
    WindowHidden = 0x203,
    WindowExposed = 0x204,
    WindowMoved = 0x205,
    WindowResized = 0x206,
    WindowPixelSizeChanged = 0x207,
    WindowMetalViewResized = 0x208,
    WindowMinimized = 0x209,
    WindowMaximized = 0x20A,
    WindowRestored = 0x20B,
    WindowMouseEnter = 0x20C,
    WindowMouseLeave = 0x20D,
    WindowFocusGained = 0x20E,
    WindowFocusLost = 0x20F,
    WindowCloseRequested = 0x210,
    WindowHitTest = 0x211,
    WindowIccprofChanged = 0x212,
    WindowDisplayChanged = 0x213,
    WindowDisplayScaleChanged = 0x214,
    WindowSafeAreaChanged = 0x215,
    WindowOccluded = 0x216,
    WindowEnterFullscreen = 0x217,
    WindowLeaveFullscreen = 0x218,
    WindowDestroyed = 0x219,
    WindowHdrStateChanged = 0x21A,

    // Keyboard events
    KeyDown = 0x300,
    KeyUp = 0x301,
    TextEditing = 0x302,
    TextInput = 0x303,
    KeymapChanged = 0x304,
    KeyboardAdded = 0x305,
    KeyboardRemoved = 0x306,
    TextEditingCandidates = 0x307,
    ScreenKeyboardShown = 0x308,
    ScreenKeyboardHidden = 0x309,

    // Mouse events
    MouseMotion = 0x400,
    MouseButtonDown = 0x401,
    MouseButtonUp = 0x402,
    MouseWheel = 0x403,
    MouseAdded = 0x404,
    MouseRemoved = 0x405,

    // Joystick events
    JoystickAxisMotion = 0x600,
    JoystickBallMotion = 0x601,
    JoystickHatMotion = 0x602,
    JoystickButtonDown = 0x603,
    JoystickButtonUp = 0x604,
    JoystickAdded = 0x605,
    JoystickRemoved = 0x606,
    JoystickBatteryUpdated = 0x607,
    JoystickUpdateComplete = 0x608,

    // Gamepad events
    GamepadAxisMotion = 0x650,
    GamepadButtonDown = 0x651,
    GamepadButtonUp = 0x652,
    GamepadAdded = 0x653,
    GamepadRemoved = 0x654,
    GamepadRemapped = 0x655,
    GamepadTouchpadDown = 0x656,
    GamepadTouchpadMotion = 0x657,
    GamepadTouchpadUp = 0x658,
    GamepadSensorUpdate = 0x659,
    GamepadUpdateComplete = 0x65A,
    GamepadSteamHandleUpdated = 0x65B,

    // Touch events
    FingerDown = 0x700,
    FingerUp = 0x701,
    FingerMotion = 0x702,
    FingerCanceled = 0x703,

    // Pinch events
    PinchBegin = 0x710,
    PinchUpdate = 0x711,
    PinchEnd = 0x712,

    // Clipboard events
    ClipboardUpdate = 0x900,

    // Drag and drop events
    DropFile = 0x1000,
    DropText = 0x1001,
    DropBegin = 0x1002,
    DropComplete = 0x1003,
    DropPosition = 0x1004,

    // Audio hotplug events
    AudioDeviceAdded = 0x1100,
    AudioDeviceRemoved = 0x1101,
    AudioDeviceFormatChanged = 0x1102,

    // Sensor events
    SensorUpdate = 0x1200,

    // Pressure-sensitive pen events
    PenProximityIn = 0x1300,
    PenProximityOut = 0x1301,
    PenDown = 0x1302,
    PenUp = 0x1303,
    PenButtonDown = 0x1304,
    PenButtonUp = 0x1305,
    PenMotion = 0x1306,
    PenAxis = 0x1307,

    // Camera hotplug events
    CameraDeviceAdded = 0x1400,
    CameraDeviceRemoved = 0x1401,
    CameraDeviceApproved = 0x1402,
    CameraDeviceDenied = 0x1403,

    // Render events
    RenderTargetsReset = 0x2000,
    RenderDeviceReset = 0x2001,
    RenderDeviceLost = 0x2002,

    // Reserved events for private platforms
    Private0 = 0x4000,
    Private1 = 0x4001,
    Private2 = 0x4002,
    Private3 = 0x4003,

    // Internal events
    PollSentinel = 0x7F00, // Signals the end of an event poll cycle

    // Events User through Last are for application use, allocated with
    // SDL_RegisterEvents()
    User = 0x8000,

    // This last event is only for bounding internal arrays
    Last = 0xFFFF,
}

export declare namespace SDL_EventType {
    type Underlying = u32;
}

/** Fields shared by every event. */
export interface SDL_CommonEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
}

/** Display state change event data (event.display.*) */
export interface SDL_DisplayEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    displayID: u32;
    data1: i32;
    data2: i32;
}

/** Window state change event data (event.window.*) */
export interface SDL_WindowEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    windowID: u32;
    data1: i32;
    data2: i32;
}

/** Keyboard device event structure (event.kdevice.*) */
export interface SDL_KeyboardDeviceEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    which: u32;
}

/** Keyboard button event structure (event.key.*) */
export interface SDL_KeyboardEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    windowID: u32;
    which: u32;
    scancode: SDL_Scancode;
    key: SDL_Keycode;
    mod_: SDL_Keymod;
    raw: u16;
    down: boolean;
    repeat_: boolean;
}

/** Keyboard text editing event structure (event.edit.*) */
export interface SDL_TextEditingEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    windowID: u32;
    text: CString; // const char *
    start: i32;
    length: i32;
}

/** Keyboard IME candidates event structure (event.edit_candidates.*) */
export interface SDL_TextEditingCandidatesEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    windowID: u32;
    candidates: usize; // const char * const * — pointer-to-pointer, adjust to your convention
    num_candidates: i32;
    selected_candidate: i32;
    horizontal: boolean;
    padding1: u8;
    padding2: u8;
    padding3: u8;
}

/** Keyboard text input event structure (event.text.*) */
export interface SDL_TextInputEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    windowID: u32;
    text: CString; // const char *
}

/** Mouse device event structure (event.mdevice.*) */
export interface SDL_MouseDeviceEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    which: u32;
}

/** Mouse motion event structure (event.motion.*) */
export interface SDL_MouseMotionEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    windowID: u32;
    which: u32;
    state: u32; // SDL_MouseButtonFlags
    x: f32;
    y: f32;
    xrel: f32;
    yrel: f32;
}

/** Mouse button event structure (event.button.*) */
export interface SDL_MouseButtonEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    windowID: u32;
    which: u32;
    button: u8;
    down: boolean;
    clicks: u8;
    padding: u8;
    x: f32;
    y: f32;
}

/** Mouse wheel event structure (event.wheel.*) */
export interface SDL_MouseWheelEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    windowID: u32;
    which: u32;
    x: f32;
    y: f32;
    direction: u32; // SDL_MouseWheelDirection
    mouse_x: f32;
    mouse_y: f32;
    integer_x: i32;
    integer_y: i32;
}

/** Joystick axis motion event structure (event.jaxis.*) */
export interface SDL_JoyAxisEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    which: u32;
    axis: u8;
    padding1: u8;
    padding2: u8;
    padding3: u8;
    value: i16;
    padding4: u16;
}

/** Joystick trackball motion event structure (event.jball.*) */
export interface SDL_JoyBallEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    which: u32;
    ball: u8;
    padding1: u8;
    padding2: u8;
    padding3: u8;
    xrel: i16;
    yrel: i16;
}

/** Joystick hat position change event structure (event.jhat.*) */
export interface SDL_JoyHatEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    which: u32;
    hat: u8;
    value: u8;
    padding1: u8;
    padding2: u8;
}

/** Joystick button event structure (event.jbutton.*) */
export interface SDL_JoyButtonEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    which: u32;
    button: u8;
    down: boolean;
    padding1: u8;
    padding2: u8;
}

/** Joystick device event structure (event.jdevice.*) */
export interface SDL_JoyDeviceEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    which: u32;
}

/** Joystick battery level change event structure (event.jbattery.*) */
export interface SDL_JoyBatteryEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    which: u32;
    state: u32; // SDL_PowerState
    percent: i32;
}

/** Gamepad axis motion event structure (event.gaxis.*) */
export interface SDL_GamepadAxisEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    which: u32;
    axis: u8;
    padding1: u8;
    padding2: u8;
    padding3: u8;
    value: i16;
    padding4: u16;
}

/** Gamepad button event structure (event.gbutton.*) */
export interface SDL_GamepadButtonEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    which: u32;
    button: u8;
    down: boolean;
    padding1: u8;
    padding2: u8;
}

/** Gamepad device event structure (event.gdevice.*) */
export interface SDL_GamepadDeviceEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    which: u32;
}

/** Gamepad touchpad event structure (event.gtouchpad.*) */
export interface SDL_GamepadTouchpadEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    which: u32;
    touchpad: i32;
    finger: i32;
    x: f32;
    y: f32;
    pressure: f32;
}

/** Gamepad sensor event structure (event.gsensor.*) */
export interface SDL_GamepadSensorEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    which: u32;
    sensor: i32;
    data: FixedArray<f32, 3>;
    sensor_timestamp: u64;
}

/** Audio device event structure (event.adevice.*) */
export interface SDL_AudioDeviceEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    which: u32;
    recording: boolean;
    padding1: u8;
    padding2: u8;
    padding3: u8;
}

/** Camera device event structure (event.cdevice.*) */
export interface SDL_CameraDeviceEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    which: u32;
}

/** Renderer event structure (event.render.*) */
export interface SDL_RenderEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    windowID: u32;
}

/**
 * Touch finger event structure (event.tfinger.*)
 *
 * NOTE: SDL_TouchID and SDL_FingerID are Uint64 in SDL3, unlike the other
 * *ID typedefs used elsewhere in this file which are Uint32. Left as u64
 * here — double check against whatever id.ts already declares.
 */
export interface SDL_TouchFingerEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    touchID: u64;
    fingerID: u64;
    x: f32;
    y: f32;
    dx: f32;
    dy: f32;
    pressure: f32;
    windowID: u32;
}

/** Pinch event structure (event.pinch.*) */
export interface SDL_PinchFingerEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    scale: f32;
    windowID: u32;
}

/** Pressure-sensitive pen proximity event structure (event.pproximity.*) */
export interface SDL_PenProximityEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    windowID: u32;
    which: u32;
}

/** Pressure-sensitive pen motion event structure (event.pmotion.*) */
export interface SDL_PenMotionEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    windowID: u32;
    which: u32;
    pen_state: u32; // SDL_PenInputFlags
    x: f32;
    y: f32;
}

/** Pressure-sensitive pen touched event structure (event.ptouch.*) */
export interface SDL_PenTouchEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    windowID: u32;
    which: u32;
    pen_state: u32; // SDL_PenInputFlags
    x: f32;
    y: f32;
    eraser: boolean;
    down: boolean;
}

/** Pressure-sensitive pen button event structure (event.pbutton.*) */
export interface SDL_PenButtonEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    windowID: u32;
    which: u32;
    pen_state: u32; // SDL_PenInputFlags
    x: f32;
    y: f32;
    button: u8;
    down: boolean;
}

/** Pressure-sensitive pen pressure / angle event structure (event.paxis.*) */
export interface SDL_PenAxisEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    windowID: u32;
    which: u32;
    pen_state: u32; // SDL_PenInputFlags
    x: f32;
    y: f32;
    axis: u32; // SDL_PenAxis
    value: f32;
}

/** An event used to drop text or request a file open by the system (event.drop.*) */
export interface SDL_DropEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    windowID: u32;
    x: f32;
    y: f32;
    source: CString; // const char *, nullable
    data: CString; // const char *, nullable
}

/** An event triggered when the clipboard contents have changed (event.clipboard.*) */
export interface SDL_ClipboardEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    owner: boolean;
    num_mime_types: i32;
    mime_types: usize; // const char ** — adjust to your pointer-to-pointer convention
}

/** Sensor event structure (event.sensor.*) */
export interface SDL_SensorEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
    which: u32;
    data: FixedArray<f32, 6>;
    sensor_timestamp: u64;
}

/** The "quit requested" event */
export interface SDL_QuitEvent {
    type: SDL_EventType;
    reserved: u32;
    timestamp: u64;
}

/**
 * A user-defined event type (event.user.*)
 *
 * data1/data2 are `void *` in C — left as `usize` placeholders since this
 * event type is application-pushed, not SDL-filled; adjust once you have a
 * convention for opaque pointers.
 */
export interface SDL_UserEvent {
    type: u32;
    reserved: u32;
    timestamp: u64;
    windowID: u32;
    code: i32;
    data1: usize; // void *
    data2: usize; // void *
}

/**
 * The structure for all events in SDL. A union of every event struct above,
 * tagged by `type` at offset 0, with `padding` forcing the size to match
 * SDL's own `sizeof(SDL_Event) == 128` assert.
 */
export interface SDL_Event extends Union {
    type: u32;
    common: SDL_CommonEvent;
    display: SDL_DisplayEvent;
    window: SDL_WindowEvent;
    kdevice: SDL_KeyboardDeviceEvent;
    key: SDL_KeyboardEvent;
    edit: SDL_TextEditingEvent;
    edit_candidates: SDL_TextEditingCandidatesEvent;
    text: SDL_TextInputEvent;
    mdevice: SDL_MouseDeviceEvent;
    motion: SDL_MouseMotionEvent;
    button: SDL_MouseButtonEvent;
    wheel: SDL_MouseWheelEvent;
    jdevice: SDL_JoyDeviceEvent;
    jaxis: SDL_JoyAxisEvent;
    jball: SDL_JoyBallEvent;
    jhat: SDL_JoyHatEvent;
    jbutton: SDL_JoyButtonEvent;
    jbattery: SDL_JoyBatteryEvent;
    gdevice: SDL_GamepadDeviceEvent;
    gaxis: SDL_GamepadAxisEvent;
    gbutton: SDL_GamepadButtonEvent;
    gtouchpad: SDL_GamepadTouchpadEvent;
    gsensor: SDL_GamepadSensorEvent;
    adevice: SDL_AudioDeviceEvent;
    cdevice: SDL_CameraDeviceEvent;
    sensor: SDL_SensorEvent;
    quit: SDL_QuitEvent;
    user: SDL_UserEvent;
    tfinger: SDL_TouchFingerEvent;
    pinch: SDL_PinchFingerEvent;
    pproximity: SDL_PenProximityEvent;
    ptouch: SDL_PenTouchEvent;
    pmotion: SDL_PenMotionEvent;
    pbutton: SDL_PenButtonEvent;
    paxis: SDL_PenAxisEvent;
    render: SDL_RenderEvent;
    drop: SDL_DropEvent;
    clipboard: SDL_ClipboardEvent;
    padding: FixedArray<u8, 128>;
}

export declare function SDL_PumpEvents(): void;

export declare function SDL_HasEvent(type: SDL_EventType): boolean;

export declare function SDL_HasEvents(minType: SDL_EventType, maxType: SDL_EventType): boolean;

export declare function SDL_FlushEvent(type: SDL_EventType): void;

export declare function SDL_FlushEvents(minType: SDL_EventType, maxType: SDL_EventType): void;

export declare function SDL_PollEvent(event: Pointer<SDL_Event>): boolean;

export declare function SDL_WaitEvent(event: Pointer<SDL_Event>): boolean;

export declare function SDL_WaitEventTimeout(event: Pointer<SDL_Event>, timeoutMS: i32): boolean;
