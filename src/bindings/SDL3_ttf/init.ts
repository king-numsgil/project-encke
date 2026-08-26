// Bringing the library up and down.
//
// `TTF_Init` and `TTF_Quit` are **reference counted**: two inits need two quits,
// and the library only really shuts down on the last one. That is what makes it
// safe for a library and its host to each call `TTF_Init` without either knowing
// about the other.
//
// The counting does not extend to fonts. `TTF_Quit` closes none of them, and
// closing one afterwards is not safe either — the machinery that would free it
// has already gone. Every `TTF_CloseFont` belongs before the last `TTF_Quit`.

/**
 * Bring SDL_ttf up. Nothing else in these bindings works before this succeeds.
 *
 * `false` means failure, with `SDL_GetError` holding the reason.
 */
export declare function TTF_Init(): boolean;

/** Release the library's own resources. See the note above about open fonts. */
export declare function TTF_Quit(): void;

/**
 * How many un-paired `TTF_Init` calls are outstanding — non-zero means the
 * library is up.
 *
 * Signed, but never negative.
 */
export declare function TTF_WasInit(): i32;
