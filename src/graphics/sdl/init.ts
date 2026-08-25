export enum SDL_InitFlags {
    AUDIO = 0x00000010,
    VIDEO = 0x00000020,
    JOYSTICK = 0x00000200,
    HAPTIC = 0x00001000,
    GAMEPAD = 0x00002000,
    EVENTS = 0x00004000,
    SENSOR = 0x00008000,
    CAMERA = 0x00010000,
}
export declare namespace SDL_InitFlags {
    type Underlying = u32;
}

export declare function SDL_Init(flags: SDL_InitFlags): boolean;
export declare function SDL_InitSubSystem(flags: SDL_InitFlags): boolean;
export declare function SDL_QuitSubSystem(flags: SDL_InitFlags): void;
export declare function SDL_WasInit(flags: SDL_InitFlags): SDL_InitFlags;
export declare function SDL_Quit(): void;
export declare function SDL_IsMainThread(): boolean;
