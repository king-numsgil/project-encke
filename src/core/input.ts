// Keyboard and mouse, polled once per frame.
//
// Mouse look is on the right button rather than always-on. An always-on relative
// mouse grabs the cursor for as long as the program runs, which is the correct
// behaviour for a game and a nuisance for a renderer being poked at beside an
// editor — and this build spends most of its life being poked at.

import {
    SDL_GetKeyboardState,
    SDL_GetRelativeMouseState,
    SDL_MouseButtonFlags,
    type SDL_Scancode,
    SDL_SetWindowRelativeMouseMode,
    type SDL_Window,
} from "../bindings/SDL3";

export class Input {
    /** Mouse movement since the last {@link poll}, in pixels. Zero unless looking. */
    mouseDeltaX: f32;
    mouseDeltaY: f32;
    /**
     * SDL's own key array. Fetched once — the pointer is valid for the lifetime
     * of the program and the contents update as events are pumped.
     */
    private keys: Pointer<boolean> | null;
    private window: Pointer<SDL_Window> | null;
    private looking: boolean;

    constructor() {
        this.keys = null;
        this.window = null;
        this.looking = false;
        this.mouseDeltaX = 0.0;
        this.mouseDeltaY = 0.0;
    }

    attach(window: Pointer<SDL_Window>): void {
        this.window = window;
        this.keys = SDL_GetKeyboardState(null);
        this.looking = false;
        this.mouseDeltaX = 0.0;
        this.mouseDeltaY = 0.0;
    }

    /** Call once per frame, after the event pump. */
    poll(): void {
        const x: FixedArray<f32, 1> = fixedArray(1, 0.0);
        const y: FixedArray<f32, 1> = fixedArray(1, 0.0);
        const buttons = SDL_GetRelativeMouseState(x, y);

        const wanted = (buttons & SDL_MouseButtonFlags.RMASK) !== SDL_MouseButtonFlags.NONE;
        const window = this.window;

        if (wanted !== this.looking && window !== null) {
            SDL_SetWindowRelativeMouseMode(window, wanted);
            this.looking = wanted;
        }

        // The deltas are read unconditionally — `SDL_GetRelativeMouseState`
        // reports movement *since the last call*, so skipping the call while not
        // looking would hand back the whole accumulated sweep on the first frame
        // the button goes down, and the camera would jump.
        this.mouseDeltaX = this.looking ? x[0] : 0.0;
        this.mouseDeltaY = this.looking ? y[0] : 0.0;
    }

    down(scancode: SDL_Scancode): boolean {
        const keys = this.keys;
        if (keys === null) {
            return false;
        }
        return keys[cast<usize>(scancode)];
    }
}
