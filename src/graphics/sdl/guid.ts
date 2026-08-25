// Translated from SDL_guid.h
//
// These two are the only calls in the bindings that pass and return a struct
// *by value*: `SDL_GUID` is sixteen bytes, so the Windows x64 ABI moves it
// indirectly in both directions. Verified against the real library rather than
// assumed — see the note on SDL_StringToGUID.

/**
 * An SDL_GUID is a 128-bit identifier for an input device.
 *
 * The bytes are in the same order across every platform, which is what makes a
 * device's GUID something an application can store in a config file and
 * recognise again later.
 */
export interface SDL_GUID {
    data: FixedArray<u8, 16>;
}

/**
 * Write a GUID as 32 hex digits plus a NUL.
 *
 * `cbGUID` is the size of the buffer, so it must be at least 33.
 */
export declare function SDL_GUIDToString(guid: SDL_GUID, pszGUID: Pointer<u8>, cbGUID: i32): void;

/** The reverse. An unparseable string gives an all-zero GUID rather than an error. */
export declare function SDL_StringToGUID(pchGUID: CString): SDL_GUID;
