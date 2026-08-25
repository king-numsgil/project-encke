// Translated from SDL_properties.h
//
// A property group is a handle (a `Uint32`), not a pointer — zero is the
// invalid one, which is why nothing here is `| null`.

export type SDL_PropertiesID = u32;

export enum SDL_PropertyType {
    INVALID = 0,
    POINTER = 1,
    STRING = 2,
    NUMBER = 3,
    FLOAT = 4,
    BOOLEAN = 5,
}

export declare namespace SDL_PropertyType {
    type Underlying = i32;
}

// SDL's property *names* are `#define`d string literals. They are not exported
// as bindings because the compiler has no module-level `const` yet — write the
// literal at the call site, which is where `cstring()` has to borrow it anyway:
//
//     SDL_SetStringProperty(props, cstring("SDL.global.name"), cstring(name));
//
// The names each function group uses are listed in a comment beside it.

export declare function SDL_GetGlobalProperties(): SDL_PropertiesID;

export declare function SDL_CreateProperties(): SDL_PropertiesID;

export declare function SDL_CopyProperties(src: SDL_PropertiesID, dst: SDL_PropertiesID): boolean;

export declare function SDL_LockProperties(props: SDL_PropertiesID): boolean;

export declare function SDL_UnlockProperties(props: SDL_PropertiesID): void;

export declare function SDL_SetPointerPropertyWithCleanup(
    props: SDL_PropertiesID,
    name: CString,
    value: Pointer<unknown> | null,
    cleanup: ((userdata: Pointer<unknown> | null, value: Pointer<unknown> | null) => void) | null,
    userdata: Pointer<unknown> | null,
): boolean;

export declare function SDL_SetPointerProperty(props: SDL_PropertiesID, name: CString, value: Pointer<unknown> | null): boolean;

export declare function SDL_SetStringProperty(props: SDL_PropertiesID, name: CString, value: CString | null): boolean;

export declare function SDL_SetNumberProperty(props: SDL_PropertiesID, name: CString, value: i64): boolean;

export declare function SDL_SetFloatProperty(props: SDL_PropertiesID, name: CString, value: f32): boolean;

export declare function SDL_SetBooleanProperty(props: SDL_PropertiesID, name: CString, value: boolean): boolean;

export declare function SDL_HasProperty(props: SDL_PropertiesID, name: CString): boolean;

export declare function SDL_GetPropertyType(props: SDL_PropertiesID, name: CString): SDL_PropertyType;

/**
 * Only safe between {@link SDL_LockProperties} and {@link SDL_UnlockProperties}
 * if another thread might be touching the group — SDL says so, and nothing here
 * enforces it.
 */
export declare function SDL_GetPointerProperty(props: SDL_PropertiesID, name: CString, default_value: Pointer<unknown> | null): Pointer<unknown> | null;

export declare function SDL_GetStringProperty(props: SDL_PropertiesID, name: CString, default_value: CString | null): CString | null;

export declare function SDL_GetNumberProperty(props: SDL_PropertiesID, name: CString, default_value: i64): i64;

export declare function SDL_GetFloatProperty(props: SDL_PropertiesID, name: CString, default_value: f32): f32;

export declare function SDL_GetBooleanProperty(props: SDL_PropertiesID, name: CString, default_value: boolean): boolean;

export declare function SDL_ClearProperty(props: SDL_PropertiesID, name: CString): boolean;

export declare function SDL_EnumerateProperties(
    props: SDL_PropertiesID,
    callback: ((userdata: Pointer<unknown> | null, props: SDL_PropertiesID, name: CString) => void) | null,
    userdata: Pointer<unknown> | null,
): boolean;

export declare function SDL_DestroyProperties(props: SDL_PropertiesID): void;
