// Translated from SDL_power.h

/** The basic state for the system's power supply. */
export enum SDL_PowerState {
    /** Error determining power status */
    ERROR = -1,
    /** Cannot determine power status */
    UNKNOWN,
    /** Not plugged in, running on the battery */
    ON_BATTERY,
    /** Plugged in, no battery available */
    NO_BATTERY,
    /** Plugged in, charging battery */
    CHARGING,
    /** Plugged in, battery charged */
    CHARGED,
}

export declare namespace SDL_PowerState {
    type Underlying = i32;
}

/**
 * The battery state.
 *
 * Both out-params are set to -1 when the value cannot be determined — which is
 * common, and is why they are separate from the returned state. Neither should
 * be trusted for anything but a display: the numbers a platform reports while
 * the battery is settling are frequently nonsense.
 */
export declare function SDL_GetPowerInfo(seconds: Pointer<i32> | null, percent: Pointer<i32> | null): SDL_PowerState;
