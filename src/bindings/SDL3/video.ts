// Translated from SDL_video.h
//
// Two notes on shapes that recur here:
//
//   * Several getters hand back an SDL-allocated array — `SDL_GetDisplays`,
//     `SDL_GetFullscreenDisplayModes`, `SDL_GetWindows`. The array is
//     NULL-terminated *and* reports its length through the `count` out-param,
//     and it is released with `SDL_free`, never with `.free()`: the block came
//     from SDL's allocator, whichever one that is.
//   * A getter returning `const SDL_DisplayMode *` or `const SDL_Rect *` hands
//     back a pointer SDL owns. Do not free it, and do not assume it outlives
//     the next call that could change it.

import type { SDL_PixelFormat } from "./pixels.ts";
import type { SDL_PropertiesID } from "./properties.ts";
import type { SDL_Point, SDL_Rect } from "./rect.ts";
import type { SDL_Surface } from "./surface.ts";

export type SDL_DisplayID = u32;
export type SDL_WindowID = u32;

/** The struct used as an opaque handle to a window. */
export declare class SDL_Window {
    private _opaque: never;
}

/** Opaque state behind an OpenGL context — `SDL_GLContext` is a pointer to one. */
export declare class SDL_GLContextState {
    private _opaque: never;
}

/** Private data attached to a display mode. Opaque, and SDL's to touch. */
export declare class SDL_DisplayModeData {
    private _opaque: never;
}

/** System theme. */
export enum SDL_SystemTheme {
    /** Unknown system theme */
    UNKNOWN,
    /** Light colored system theme */
    LIGHT,
    /** Dark colored system theme */
    DARK,
}

export declare namespace SDL_SystemTheme {
    type Underlying = i32;
}

/** The structure that defines a display mode. */
export interface SDL_DisplayMode {
    /** The display this mode is associated with. */
    displayID: SDL_DisplayID;
    /** Pixel format. */
    format: SDL_PixelFormat;
    /** Width. */
    w: i32;
    /** Height. */
    h: i32;
    /** Scale converting size to pixels — a 1920x1080 mode at 2.0 has 3840x2160 pixels. */
    pixel_density: f32;
    /** Refresh rate, or 0.0 for unspecified. */
    refresh_rate: f32;
    /** Precise refresh rate numerator, or 0 for unspecified. */
    refresh_rate_numerator: i32;
    /** Precise refresh rate denominator. */
    refresh_rate_denominator: i32;
    /** Private. */
    internal: Pointer<SDL_DisplayModeData> | null;
}

/** Display orientation values; the way a display is rotated. */
export enum SDL_DisplayOrientation {
    /** The display orientation can't be determined */
    UNKNOWN,
    /** Landscape, with the right side up, relative to portrait mode */
    LANDSCAPE,
    /** Landscape, with the left side up, relative to portrait mode */
    LANDSCAPE_FLIPPED,
    /** Portrait */
    PORTRAIT,
    /** Portrait, upside down */
    PORTRAIT_FLIPPED,
}

export declare namespace SDL_DisplayOrientation {
    type Underlying = i32;
}

export enum SDL_WindowFlags {
    NONE = 0x0000000000000000,
    FULLSCREEN = 0x0000000000000001,
    OPENGL = 0x0000000000000002,
    OCCLUDED = 0x0000000000000004,
    HIDDEN = 0x0000000000000008,
    BORDERLESS = 0x0000000000000010,
    RESIZABLE = 0x0000000000000020,
    MINIMIZED = 0x0000000000000040,
    MAXIMIZED = 0x0000000000000080,
    MOUSE_GRABBED = 0x0000000000000100,
    INPUT_FOCUS = 0x0000000000000200,
    MOUSE_FOCUS = 0x0000000000000400,
    EXTERNAL = 0x0000000000000800,
    MODAL = 0x0000000000001000,
    HIGH_PIXEL_DENSITY = 0x0000000000002000,
    MOUSE_CAPTURE = 0x0000000000004000,
    MOUSE_RELATIVE_MODE = 0x0000000000008000,
    ALWAYS_ON_TOP = 0x0000000000010000,
    UTILITY = 0x0000000000020000,
    TOOLTIP = 0x0000000000040000,
    POPUP_MENU = 0x0000000000080000,
    KEYBOARD_GRABBED = 0x0000000000100000,
    FILL_DOCUMENT = 0x0000000000200000,
    VULKAN = 0x0000000010000000,
    METAL = 0x0000000020000000,
    TRANSPARENT = 0x0000000040000000,
    NOT_FOCUSABLE = 0x0000000080000000,
}

export declare namespace SDL_WindowFlags {
    type Underlying = u64;
}

/** Window flash operation. */
export enum SDL_FlashOperation {
    /** Cancel any window flash state */
    CANCEL,
    /** Flash the window briefly to get attention */
    BRIEFLY,
    /** Flash the window until it gets focus */
    UNTIL_FOCUSED,
}

export declare namespace SDL_FlashOperation {
    type Underlying = i32;
}

/** Window progress state, for a taskbar / dock progress bar. */
export enum SDL_ProgressState {
    /** An invalid progress state, indicating an error; check SDL_GetError() */
    INVALID = -1,
    /** No progress bar is displayed */
    NONE,
    /** The progress bar is displayed in an indeterminate state */
    INDETERMINATE,
    /** The progress bar is displayed with a value */
    NORMAL,
    /** The progress bar is displayed in a paused state */
    PAUSED,
    /** The progress bar is displayed in an error state */
    ERROR,
}

export declare namespace SDL_ProgressState {
    type Underlying = i32;
}

/** An enumeration of OpenGL configuration attributes. */
export enum SDL_GLAttr {
    RED_SIZE,
    GREEN_SIZE,
    BLUE_SIZE,
    ALPHA_SIZE,
    BUFFER_SIZE,
    DOUBLEBUFFER,
    DEPTH_SIZE,
    STENCIL_SIZE,
    ACCUM_RED_SIZE,
    ACCUM_GREEN_SIZE,
    ACCUM_BLUE_SIZE,
    ACCUM_ALPHA_SIZE,
    STEREO,
    MULTISAMPLEBUFFERS,
    MULTISAMPLESAMPLES,
    ACCELERATED_VISUAL,
    RETAINED_BACKING,
    CONTEXT_MAJOR_VERSION,
    CONTEXT_MINOR_VERSION,
    CONTEXT_FLAGS,
    CONTEXT_PROFILE_MASK,
    SHARE_WITH_CURRENT_CONTEXT,
    FRAMEBUFFER_SRGB_CAPABLE,
    CONTEXT_RELEASE_BEHAVIOR,
    CONTEXT_RESET_NOTIFICATION,
    CONTEXT_NO_ERROR,
    FLOATBUFFERS,
    EGL_PLATFORM,
}

export declare namespace SDL_GLAttr {
    type Underlying = i32;
}

/** Values for `SDL_GLAttr.CONTEXT_PROFILE_MASK`. */
export enum SDL_GLProfile {
    /** OpenGL Core Profile context */
    CORE = 0x0001,
    /** OpenGL Compatibility Profile context */
    COMPATIBILITY = 0x0002,
    /** GLX_CONTEXT_ES2_PROFILE_BIT_EXT */
    ES = 0x0004,
}

export declare namespace SDL_GLProfile {
    type Underlying = u32;
}

/** Values for `SDL_GLAttr.CONTEXT_FLAGS`. */
export enum SDL_GLContextFlag {
    DEBUG = 0x0001,
    FORWARD_COMPATIBLE = 0x0002,
    ROBUST_ACCESS = 0x0004,
    RESET_ISOLATION = 0x0008,
}

export declare namespace SDL_GLContextFlag {
    type Underlying = u32;
}

/** Values for `SDL_GLAttr.CONTEXT_RELEASE_BEHAVIOR`. */
export enum SDL_GLContextReleaseFlag {
    NONE = 0x0000,
    FLUSH = 0x0001,
}

export declare namespace SDL_GLContextReleaseFlag {
    type Underlying = u32;
}

/** Values for `SDL_GLAttr.CONTEXT_RESET_NOTIFICATION`. */
export enum SDL_GLContextResetNotification {
    NO_NOTIFICATION = 0x0000,
    LOSE_CONTEXT = 0x0001,
}

export declare namespace SDL_GLContextResetNotification {
    type Underlying = u32;
}

/** Possible return values from the `SDL_HitTest` callback. */
export enum SDL_HitTestResult {
    /** Region is normal. No special properties. */
    NORMAL,
    /** Region can drag entire window. */
    DRAGGABLE,
    RESIZE_TOPLEFT,
    RESIZE_TOP,
    RESIZE_TOPRIGHT,
    RESIZE_RIGHT,
    RESIZE_BOTTOMRIGHT,
    RESIZE_BOTTOM,
    RESIZE_BOTTOMLEFT,
    RESIZE_LEFT,
}

export declare namespace SDL_HitTestResult {
    type Underlying = i32;
}

/** Values for `SDL_SetWindowSurfaceVSync`. Any other value is a swap interval. */
export enum SDL_WindowSurfaceVSync {
    DISABLED = 0,
    ADAPTIVE = -1,
}

export declare namespace SDL_WindowSurfaceVSync {
    type Underlying = i32;
}

// ---------------------------------------------------------------------------
// The SDL_WINDOWPOS_* macros. `#define`s in C, so they are ordinary functions
// here — the compiler has no module-level `const` yet either way.
// ---------------------------------------------------------------------------

/** A window position: "don't care", on display `X`. */
export function SDL_WINDOWPOS_UNDEFINED_DISPLAY(X: u32): i32 {
    return cast<i32>(0x1fff0000 | X);
}

/** A window position: "don't care". */
export function SDL_WINDOWPOS_UNDEFINED(): i32 {
    return SDL_WINDOWPOS_UNDEFINED_DISPLAY(0);
}

export function SDL_WINDOWPOS_ISUNDEFINED(X: i32): boolean {
    return (cast<u32>(X) & 0xffff0000) === 0x1fff0000;
}

/** A window position: centred on display `X`. */
export function SDL_WINDOWPOS_CENTERED_DISPLAY(X: u32): i32 {
    return cast<i32>(0x2fff0000 | X);
}

/** A window position: centred on the primary display. */
export function SDL_WINDOWPOS_CENTERED(): i32 {
    return SDL_WINDOWPOS_CENTERED_DISPLAY(0);
}

export function SDL_WINDOWPOS_ISCENTERED(X: i32): boolean {
    return (cast<u32>(X) & 0xffff0000) === 0x2fff0000;
}

// ---------------------------------------------------------------------------
// Video drivers.
// ---------------------------------------------------------------------------

export declare function SDL_GetNumVideoDrivers(): i32;

export declare function SDL_GetVideoDriver(index: i32): CString;

export declare function SDL_GetCurrentVideoDriver(): CString | null;

export declare function SDL_GetSystemTheme(): SDL_SystemTheme;

// ---------------------------------------------------------------------------
// Displays.
// ---------------------------------------------------------------------------

/**
 * The displays currently connected, NULL-terminated, `count` of them.
 *
 * The array is SDL's allocation: release it with `SDL_free`, not `.free()`.
 */
export declare function SDL_GetDisplays(count: Pointer<i32> | null): Pointer<SDL_DisplayID> | null;

export declare function SDL_GetPrimaryDisplay(): SDL_DisplayID;

/**
 * Display properties. Read with the `SDL_Get*Property` calls:
 *
 *   * `"SDL.display.HDR_enabled"`      — boolean
 *   * `"SDL.display.KMSDRM.panel_orientation"` — number, degrees of rotation
 */
export declare function SDL_GetDisplayProperties(displayID: SDL_DisplayID): SDL_PropertiesID;

export declare function SDL_GetDisplayName(displayID: SDL_DisplayID): CString | null;

export declare function SDL_GetDisplayBounds(displayID: SDL_DisplayID, rect: Pointer<SDL_Rect>): boolean;

export declare function SDL_GetDisplayUsableBounds(displayID: SDL_DisplayID, rect: Pointer<SDL_Rect>): boolean;

export declare function SDL_GetNaturalDisplayOrientation(displayID: SDL_DisplayID): SDL_DisplayOrientation;

export declare function SDL_GetCurrentDisplayOrientation(displayID: SDL_DisplayID): SDL_DisplayOrientation;

export declare function SDL_GetDisplayContentScale(displayID: SDL_DisplayID): f32;

/**
 * The full-screen modes a display supports.
 *
 * An array of *pointers*, NULL-terminated. Release the array itself with
 * `SDL_free`; the modes it points at are SDL's.
 */
export declare function SDL_GetFullscreenDisplayModes(displayID: SDL_DisplayID, count: Pointer<i32> | null): Pointer<Pointer<SDL_DisplayMode>> | null;

export declare function SDL_GetClosestFullscreenDisplayMode(
    displayID: SDL_DisplayID,
    w: i32,
    h: i32,
    refresh_rate: f32,
    include_high_density_modes: boolean,
    closest: Pointer<SDL_DisplayMode>,
): boolean;

/** SDL's own pointer — do not free it. */
export declare function SDL_GetDesktopDisplayMode(displayID: SDL_DisplayID): Pointer<SDL_DisplayMode> | null;

/** SDL's own pointer — do not free it. */
export declare function SDL_GetCurrentDisplayMode(displayID: SDL_DisplayID): Pointer<SDL_DisplayMode> | null;

export declare function SDL_GetDisplayForPoint(point: Pointer<SDL_Point>): SDL_DisplayID;

export declare function SDL_GetDisplayForRect(rect: Pointer<SDL_Rect>): SDL_DisplayID;

export declare function SDL_GetDisplayForWindow(window: Pointer<SDL_Window>): SDL_DisplayID;

// ---------------------------------------------------------------------------
// Window lifetime.
// ---------------------------------------------------------------------------

export declare function SDL_CreateWindow(title: CString, w: i32, h: i32, flags: SDL_WindowFlags): Pointer<SDL_Window> | null;

export declare function SDL_CreatePopupWindow(
    parent: Pointer<SDL_Window>,
    offset_x: i32,
    offset_y: i32,
    w: i32,
    h: i32,
    flags: SDL_WindowFlags,
): Pointer<SDL_Window> | null;

/**
 * Create a window from a property group.
 *
 * The names are `#define`d string literals in the header and are not bound
 * here — the compiler has no module-level `const` yet — so write them out:
 *
 * ```ts
 * const props = SDL_CreateProperties();
 * SDL_SetStringProperty(props, cstring("SDL.window.create.title"), cstring("Hello"));
 * SDL_SetNumberProperty(props, cstring("SDL.window.create.width"), 1280);
 * SDL_SetNumberProperty(props, cstring("SDL.window.create.height"), 720);
 * const wnd = SDL_CreateWindowWithProperties(props);
 * SDL_DestroyProperties(props);
 * ```
 *
 * The full set, from SDL_video.h:
 *
 *   `SDL.window.create.always_on_top` `.borderless` `.constrain_popup`
 *   `.focusable` `.external_graphics_context` `.flags` `.fullscreen`
 *   `.height` `.hidden` `.high_pixel_density` `.maximized` `.menu` `.metal`
 *   `.minimized` `.modal` `.mouse_grabbed` `.opengl` `.parent` `.resizable`
 *   `.title` `.transparent` `.tooltip` `.utility` `.vulkan` `.width` `.x` `.y`
 *
 * plus the platform-specific `.cocoa.window` `.cocoa.view`
 * `.uikit.windowscene` `.wayland.*` `.win32.hwnd`
 * `.win32.pixel_format_hwnd` `.x11.window` `.emscripten.*`.
 */
export declare function SDL_CreateWindowWithProperties(props: SDL_PropertiesID): Pointer<SDL_Window> | null;

export declare function SDL_GetWindowID(window: Pointer<SDL_Window>): SDL_WindowID;

export declare function SDL_GetWindowFromID(id: SDL_WindowID): Pointer<SDL_Window> | null;

export declare function SDL_GetWindowParent(window: Pointer<SDL_Window>): Pointer<SDL_Window> | null;

/**
 * Every window currently open, NULL-terminated, `count` of them.
 *
 * Release the array with `SDL_free`; the windows in it are not yours to
 * destroy just because they turned up here.
 */
export declare function SDL_GetWindows(count: Pointer<i32> | null): Pointer<Pointer<SDL_Window>> | null;

/**
 * The window's property group.
 *
 * Read-only unless the documentation for a name says otherwise. Useful ones on
 * Windows: `"SDL.window.win32.hwnd"`, `"SDL.window.win32.hdc"`,
 * `"SDL.window.win32.instance"`. Cross-platform: `"SDL.window.shape"`,
 * `"SDL.window.HDR_enabled"`, `"SDL.window.SDR_white_level"`,
 * `"SDL.window.HDR_headroom"`.
 */
export declare function SDL_GetWindowProperties(window: Pointer<SDL_Window>): SDL_PropertiesID;

export declare function SDL_DestroyWindow(window: Pointer<SDL_Window>): void;

// ---------------------------------------------------------------------------
// Window state.
// ---------------------------------------------------------------------------

export declare function SDL_GetWindowFlags(window: Pointer<SDL_Window>): SDL_WindowFlags;

export declare function SDL_SetWindowTitle(window: Pointer<SDL_Window>, title: CString): boolean;

/** SDL's own pointer, and never null — an empty string if the window has no title. */
export declare function SDL_GetWindowTitle(window: Pointer<SDL_Window>): CString;

export declare function SDL_SetWindowIcon(window: Pointer<SDL_Window>, icon: Pointer<SDL_Surface>): boolean;

/** `x` and `y` may be `SDL_WINDOWPOS_CENTERED()` or `SDL_WINDOWPOS_UNDEFINED()`. */
export declare function SDL_SetWindowPosition(window: Pointer<SDL_Window>, x: i32, y: i32): boolean;

export declare function SDL_GetWindowPosition(window: Pointer<SDL_Window>, x: Pointer<i32> | null, y: Pointer<i32> | null): boolean;

export declare function SDL_SetWindowSize(window: Pointer<SDL_Window>, w: i32, h: i32): boolean;

export declare function SDL_GetWindowSize(window: Pointer<SDL_Window>, w: Pointer<i32> | null, h: Pointer<i32> | null): boolean;

export declare function SDL_GetWindowSafeArea(window: Pointer<SDL_Window>, rect: Pointer<SDL_Rect>): boolean;

export declare function SDL_SetWindowAspectRatio(window: Pointer<SDL_Window>, min_aspect: f32, max_aspect: f32): boolean;

export declare function SDL_GetWindowAspectRatio(window: Pointer<SDL_Window>, min_aspect: Pointer<f32> | null, max_aspect: Pointer<f32> | null): boolean;

export declare function SDL_GetWindowBordersSize(
    window: Pointer<SDL_Window>,
    top: Pointer<i32> | null,
    left: Pointer<i32> | null,
    bottom: Pointer<i32> | null,
    right: Pointer<i32> | null,
): boolean;

export declare function SDL_GetWindowSizeInPixels(window: Pointer<SDL_Window>, w: Pointer<i32> | null, h: Pointer<i32> | null): boolean;

export declare function SDL_SetWindowMinimumSize(window: Pointer<SDL_Window>, min_w: i32, min_h: i32): boolean;

export declare function SDL_GetWindowMinimumSize(window: Pointer<SDL_Window>, w: Pointer<i32> | null, h: Pointer<i32> | null): boolean;

export declare function SDL_SetWindowMaximumSize(window: Pointer<SDL_Window>, max_w: i32, max_h: i32): boolean;

export declare function SDL_GetWindowMaximumSize(window: Pointer<SDL_Window>, w: Pointer<i32> | null, h: Pointer<i32> | null): boolean;

export declare function SDL_SetWindowBordered(window: Pointer<SDL_Window>, bordered: boolean): boolean;

export declare function SDL_SetWindowResizable(window: Pointer<SDL_Window>, resizable: boolean): boolean;

export declare function SDL_SetWindowAlwaysOnTop(window: Pointer<SDL_Window>, on_top: boolean): boolean;

export declare function SDL_SetWindowFillDocument(window: Pointer<SDL_Window>, fill: boolean): boolean;

export declare function SDL_ShowWindow(window: Pointer<SDL_Window>): boolean;

export declare function SDL_HideWindow(window: Pointer<SDL_Window>): boolean;

export declare function SDL_RaiseWindow(window: Pointer<SDL_Window>): boolean;

export declare function SDL_MaximizeWindow(window: Pointer<SDL_Window>): boolean;

export declare function SDL_MinimizeWindow(window: Pointer<SDL_Window>): boolean;

export declare function SDL_RestoreWindow(window: Pointer<SDL_Window>): boolean;

export declare function SDL_SetWindowFullscreen(window: Pointer<SDL_Window>, fullscreen: boolean): boolean;

/** Block until any pending window state the compositor owes us has landed. */
export declare function SDL_SyncWindow(window: Pointer<SDL_Window>): boolean;

export declare function SDL_SetWindowOpacity(window: Pointer<SDL_Window>, opacity: f32): boolean;

/** The window's opacity, or -1.0 on failure. */
export declare function SDL_GetWindowOpacity(window: Pointer<SDL_Window>): f32;

export declare function SDL_SetWindowParent(window: Pointer<SDL_Window>, parent: Pointer<SDL_Window> | null): boolean;

export declare function SDL_SetWindowModal(window: Pointer<SDL_Window>, modal: boolean): boolean;

export declare function SDL_SetWindowFocusable(window: Pointer<SDL_Window>, focusable: boolean): boolean;

export declare function SDL_ShowWindowSystemMenu(window: Pointer<SDL_Window>, x: i32, y: i32): boolean;

export declare function SDL_FlashWindow(window: Pointer<SDL_Window>, operation: SDL_FlashOperation): boolean;

export declare function SDL_SetWindowProgressState(window: Pointer<SDL_Window>, state: SDL_ProgressState): boolean;

export declare function SDL_GetWindowProgressState(window: Pointer<SDL_Window>): SDL_ProgressState;

/** A value in [0.0, 1.0]; only meaningful in `SDL_ProgressState.NORMAL`. */
export declare function SDL_SetWindowProgressValue(window: Pointer<SDL_Window>, value: f32): boolean;

export declare function SDL_GetWindowProgressValue(window: Pointer<SDL_Window>): f32;

// ---------------------------------------------------------------------------
// Full-screen modes and pixel geometry.
// ---------------------------------------------------------------------------

export declare function SDL_GetWindowPixelDensity(window: Pointer<SDL_Window>): f32;

export declare function SDL_GetWindowDisplayScale(window: Pointer<SDL_Window>): f32;

/** `null` for `mode` means borderless full-screen desktop. */
export declare function SDL_SetWindowFullscreenMode(window: Pointer<SDL_Window>, mode: Pointer<SDL_DisplayMode> | null): boolean;

export declare function SDL_GetWindowFullscreenMode(window: Pointer<SDL_Window>): Pointer<SDL_DisplayMode> | null;

/** The raw ICC profile bytes. Release with `SDL_free`. */
export declare function SDL_GetWindowICCProfile(window: Pointer<SDL_Window>, size: Pointer<usize>): Pointer<unknown> | null;

export declare function SDL_GetWindowPixelFormat(window: Pointer<SDL_Window>): SDL_PixelFormat;

// ---------------------------------------------------------------------------
// The window surface — software rendering straight into the window.
// ---------------------------------------------------------------------------

export declare function SDL_WindowHasSurface(window: Pointer<SDL_Window>): boolean;

/** SDL owns this surface; it is freed by `SDL_DestroyWindowSurface` or window destruction. */
export declare function SDL_GetWindowSurface(window: Pointer<SDL_Window>): Pointer<SDL_Surface> | null;

/** `vsync` is a swap interval, or one of `SDL_WindowSurfaceVSync`. */
export declare function SDL_SetWindowSurfaceVSync(window: Pointer<SDL_Window>, vsync: i32): boolean;

export declare function SDL_GetWindowSurfaceVSync(window: Pointer<SDL_Window>, vsync: Pointer<i32>): boolean;

export declare function SDL_UpdateWindowSurface(window: Pointer<SDL_Window>): boolean;

export declare function SDL_UpdateWindowSurfaceRects(window: Pointer<SDL_Window>, rects: Pointer<SDL_Rect>, numrects: i32): boolean;

export declare function SDL_DestroyWindowSurface(window: Pointer<SDL_Window>): boolean;

// ---------------------------------------------------------------------------
// Grabbing, shaping and hit testing.
// ---------------------------------------------------------------------------

export declare function SDL_SetWindowKeyboardGrab(window: Pointer<SDL_Window>, grabbed: boolean): boolean;

export declare function SDL_SetWindowMouseGrab(window: Pointer<SDL_Window>, grabbed: boolean): boolean;

export declare function SDL_GetWindowKeyboardGrab(window: Pointer<SDL_Window>): boolean;

export declare function SDL_GetWindowMouseGrab(window: Pointer<SDL_Window>): boolean;

export declare function SDL_GetGrabbedWindow(): Pointer<SDL_Window> | null;

/** `null` for `rect` clears the confinement. */
export declare function SDL_SetWindowMouseRect(window: Pointer<SDL_Window>, rect: Pointer<SDL_Rect> | null): boolean;

/** SDL's own pointer — do not free it. */
export declare function SDL_GetWindowMouseRect(window: Pointer<SDL_Window>): Pointer<SDL_Rect> | null;

/**
 * Hand SDL a callback that decides what part of the window a point is.
 *
 * The callback is a plain function pointer: it cannot capture, and its
 * `callback_data` is how state reaches it. `null` clears the hit test.
 */
export declare function SDL_SetWindowHitTest(
    window: Pointer<SDL_Window>,
    callback: ((win: Pointer<SDL_Window>, area: Pointer<SDL_Point>, data: Pointer<unknown> | null) => SDL_HitTestResult) | null,
    callback_data: Pointer<unknown> | null,
): boolean;

/** The surface's alpha channel is the mask. `null` removes the shape. */
export declare function SDL_SetWindowShape(window: Pointer<SDL_Window>, shape: Pointer<SDL_Surface> | null): boolean;

// ---------------------------------------------------------------------------
// Screensaver.
// ---------------------------------------------------------------------------

export declare function SDL_ScreenSaverEnabled(): boolean;

export declare function SDL_EnableScreenSaver(): boolean;

export declare function SDL_DisableScreenSaver(): boolean;

// ---------------------------------------------------------------------------
// OpenGL.
//
// `SDL_GL_GetProcAddress` hands back an untyped function pointer. There is no
// way to give that a signature here, so it arrives as a `Pointer<unknown>`;
// reaching a real GL entry point through it is a job for a generated GL
// binding, not for this file.
// ---------------------------------------------------------------------------

/** `null` for `path` loads the default OpenGL library. */
export declare function SDL_GL_LoadLibrary(path: CString | null): boolean;

export declare function SDL_GL_GetProcAddress(proc: CString): Pointer<unknown> | null;

export declare function SDL_EGL_GetProcAddress(proc: CString): Pointer<unknown> | null;

export declare function SDL_GL_UnloadLibrary(): void;

export declare function SDL_GL_ExtensionSupported(extension: CString): boolean;

export declare function SDL_GL_ResetAttributes(): void;

export declare function SDL_GL_SetAttribute(attr: SDL_GLAttr, value: i32): boolean;

export declare function SDL_GL_GetAttribute(attr: SDL_GLAttr, value: Pointer<i32>): boolean;

export declare function SDL_GL_CreateContext(window: Pointer<SDL_Window>): Pointer<SDL_GLContextState> | null;

export declare function SDL_GL_MakeCurrent(window: Pointer<SDL_Window>, context: Pointer<SDL_GLContextState> | null): boolean;

export declare function SDL_GL_GetCurrentWindow(): Pointer<SDL_Window> | null;

export declare function SDL_GL_GetCurrentContext(): Pointer<SDL_GLContextState> | null;

/** 0 for immediate, 1 for vsync, -1 for adaptive vsync. */
export declare function SDL_GL_SetSwapInterval(interval: i32): boolean;

export declare function SDL_GL_GetSwapInterval(interval: Pointer<i32>): boolean;

export declare function SDL_GL_SwapWindow(window: Pointer<SDL_Window>): boolean;

export declare function SDL_GL_DestroyContext(context: Pointer<SDL_GLContextState>): boolean;

// ---------------------------------------------------------------------------
// EGL. The three handle types are `void *` in the header, so they are erased
// pointers here — there is nothing to give them a layout.
// ---------------------------------------------------------------------------

export declare function SDL_EGL_GetCurrentDisplay(): Pointer<unknown> | null;

export declare function SDL_EGL_GetCurrentConfig(): Pointer<unknown> | null;

export declare function SDL_EGL_GetWindowSurface(window: Pointer<SDL_Window>): Pointer<unknown> | null;

/**
 * Callbacks that supply EGL attribute arrays at context creation.
 *
 * Each returns an array SDL will release with `SDL_free`, so it must come from
 * `SDL_malloc` — not from `alloc`, and not from a Goblin array. `SDL_EGLAttrib`
 * is `intptr_t` and `SDL_EGLint` is `int`.
 */
export declare function SDL_EGL_SetAttributeCallbacks(
    platformAttribCallback: ((userdata: Pointer<unknown> | null) => Pointer<isize> | null) | null,
    surfaceAttribCallback: ((userdata: Pointer<unknown> | null, display: Pointer<unknown> | null, config: Pointer<unknown> | null) => Pointer<i32> | null) | null,
    contextAttribCallback: ((userdata: Pointer<unknown> | null, display: Pointer<unknown> | null, config: Pointer<unknown> | null) => Pointer<i32> | null) | null,
    userdata: Pointer<unknown> | null,
): void;
