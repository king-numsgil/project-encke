// Translated from SDL_keyboard.h

import type { SDL_Keycode, SDL_Keymod } from "./keycode.ts";
import type { SDL_PropertiesID } from "./properties.ts";
import type { SDL_Rect } from "./rect.ts";
import type { SDL_Scancode } from "./scancode.ts";
import type { SDL_Window } from "./video.ts";

/** This is a unique ID for a keyboard for the time it is connected. Never zero. */
export type SDL_KeyboardID = u32;

/** Text input type, a hint to an on-screen keyboard about what is being typed. */
export enum SDL_TextInputType {
    /** The input is text */
    TEXT,
    /** The input is a person's name */
    TEXT_NAME,
    /** The input is an e-mail address */
    TEXT_EMAIL,
    /** The input is a username */
    TEXT_USERNAME,
    /** The input is a secure password that is hidden */
    TEXT_PASSWORD_HIDDEN,
    /** The input is a secure password that is visible */
    TEXT_PASSWORD_VISIBLE,
    /** The input is a number */
    NUMBER,
    /** The input is a secure PIN that is hidden */
    NUMBER_PASSWORD_HIDDEN,
    /** The input is a secure PIN that is visible */
    NUMBER_PASSWORD_VISIBLE,
}

export declare namespace SDL_TextInputType {
    type Underlying = i32;
}

/** Auto-capitalisation type, another on-screen keyboard hint. */
export enum SDL_Capitalization {
    /** No auto-capitalization will be done */
    NONE,
    /** The first letter of sentences will be capitalized */
    SENTENCES,
    /** The first letter of words will be capitalized */
    WORDS,
    /** All letters will be capitalized */
    LETTERS,
}

export declare namespace SDL_Capitalization {
    type Underlying = i32;
}

export declare function SDL_HasKeyboard(): boolean;

/** The array is SDL's allocation: release it with `SDL_free`. */
export declare function SDL_GetKeyboards(count: Pointer<i32> | null): Pointer<SDL_KeyboardID> | null;

export declare function SDL_GetKeyboardNameForID(instance_id: SDL_KeyboardID): CString | null;

export declare function SDL_GetKeyboardFocus(): Pointer<SDL_Window> | null;

/**
 * The current key state, indexed by `SDL_Scancode`.
 *
 * SDL owns this array and keeps it alive for the life of the program, so it can
 * be read straight through:
 *
 * ```ts
 * const keys = SDL_GetKeyboardState(null);
 * if (keys !== null && keys[cast<i32>(SDL_Scancode.LEFT)]) { … }
 * ```
 *
 * `SDL_PumpEvents` — which `SDL_PollEvent` calls for you — is what updates it.
 */
export declare function SDL_GetKeyboardState(numkeys: Pointer<i32> | null): Pointer<boolean> | null;

/** Release every currently-held key, generating the key-up events for them. */
export declare function SDL_ResetKeyboard(): void;

export declare function SDL_GetModState(): SDL_Keymod;

/** Does not change the keyboard; it changes what SDL believes about it. */
export declare function SDL_SetModState(modstate: SDL_Keymod): void;

/** `key_event` true asks for the keycode a key event would carry, honouring the keymap. */
export declare function SDL_GetKeyFromScancode(scancode: SDL_Scancode, modstate: SDL_Keymod, key_event: boolean): SDL_Keycode;

/** `modstate` receives the modifiers needed to produce `key`; may be null. */
export declare function SDL_GetScancodeFromKey(key: SDL_Keycode, modstate: Pointer<SDL_Keymod> | null): SDL_Scancode;

/** The name is *not* copied — the string has to outlive every later `SDL_GetScancodeName`. */
export declare function SDL_SetScancodeName(scancode: SDL_Scancode, name: CString): boolean;

/** SDL's own pointer, and never null — an empty string for an unnamed scancode. */
export declare function SDL_GetScancodeName(scancode: SDL_Scancode): CString;

export declare function SDL_GetScancodeFromName(name: CString): SDL_Scancode;

/** SDL's own pointer, and never null — an empty string for an unnamed key. */
export declare function SDL_GetKeyName(key: SDL_Keycode): CString;

export declare function SDL_GetKeyFromName(name: CString): SDL_Keycode;

// ---------------------------------------------------------------------------
// Text input. Without this, `SDL_EventType.TextInput` never arrives — a key
// event is a key, and turning keys into characters is the platform's job.
// ---------------------------------------------------------------------------

export declare function SDL_StartTextInput(window: Pointer<SDL_Window>): boolean;

/**
 * Property names, as `#define`d string literals in the header:
 *
 *   * `"SDL.textinput.type"` — number, an `SDL_TextInputType`
 *   * `"SDL.textinput.capitalization"` — number, an `SDL_Capitalization`
 *   * `"SDL.textinput.autocorrect"` — boolean
 *   * `"SDL.textinput.multiline"` — boolean
 *   * `"SDL.textinput.android.inputtype"` — number, an Android `InputType`
 */
export declare function SDL_StartTextInputWithProperties(window: Pointer<SDL_Window>, props: SDL_PropertiesID): boolean;

export declare function SDL_TextInputActive(window: Pointer<SDL_Window>): boolean;

export declare function SDL_StopTextInput(window: Pointer<SDL_Window>): boolean;

export declare function SDL_ClearComposition(window: Pointer<SDL_Window>): boolean;

/**
 * Where the text being typed is, so the IME candidate window can avoid it.
 *
 * `cursor` is the cursor's offset in pixels from the left of `rect`. `null` for
 * `rect` clears the area.
 */
export declare function SDL_SetTextInputArea(window: Pointer<SDL_Window>, rect: Pointer<SDL_Rect> | null, cursor: i32): boolean;

export declare function SDL_GetTextInputArea(window: Pointer<SDL_Window>, rect: Pointer<SDL_Rect> | null, cursor: Pointer<i32> | null): boolean;

export declare function SDL_HasScreenKeyboardSupport(): boolean;

export declare function SDL_ScreenKeyboardShown(window: Pointer<SDL_Window>): boolean;
