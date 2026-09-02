// Encke — a clustered forward renderer on SDL3's GPU API.
//
// This file is the entry point and nothing else. Argument handling is
// `app/options.ts`, the window and device are `app/display.ts`, the frame loop
// is `app/run.ts`, and everything that draws is under `renderer/`.

import { mi_calloc, mi_free, mi_malloc, mi_realloc } from "std/alloc";
import { parseOptions, printUsage } from "./app/options.ts";
import { run } from "./app/run.ts";
import {
    SDL_GetError,
    SDL_GetRevision,
    SDL_GetVersion,
    SDL_Init,
    SDL_InitFlags,
    SDL_Quit,
    SDL_SetMemoryFunctions,
} from "./bindings/SDL3";
import { IMG_Version } from "./bindings/SDL3_image";
import { TTF_Init, TTF_Quit, TTF_Version } from "./bindings/SDL3_ttf";
import { runHeadless } from "./harness/run.ts";

export function main(args: string[]): i32 {
    // Before SDL_Init, so that nothing has been taken from SDL's own allocator
    // yet: memory a library took from one allocator has to go back to that one,
    // and swapping afterwards is heap corruption rather than a leak.
    if (!SDL_SetMemoryFunctions(mi_malloc, mi_calloc, mi_realloc, mi_free)) {
        console.log(`main: cannot install allocator : ${stringFromCString(SDL_GetError())}`);
    }

    const options = parseOptions(args);
    if (options.help) {
        printUsage();
        return 0;
    }
    if (options.invalid) {
        printUsage();
        return 2;
    }

    // All three versions, because a mismatched DLL beside the executable is the
    // failure this catches — SDL3_image has no init call to fail, so the first
    // sign of a wrong one would otherwise be an image that will not decode.
    console.log(`SDL ${SDL_GetVersion()} (${stringFromCString(SDL_GetRevision())})`);
    console.log(`SDL_image ${IMG_Version()}`);
    console.log(`SDL_ttf ${TTF_Version()}`);

    // EVENTS rather than VIDEO for a headless run, and the difference is the
    // whole point of the mode: the harness has to come up on a machine with no
    // display and no GPU driver. `SDL_GetPerformanceCounter`, which is all the
    // benchmarks want from SDL, needs no subsystem at all.
    if (!SDL_Init(options.headless ? SDL_InitFlags.EVENTS : SDL_InitFlags.VIDEO)) {
        console.log(`main: SDL_Init failed : ${stringFromCString(SDL_GetError())}`);
        return -1;
    }

    // The branch, and it is here rather than inside `run` so that everything
    // below it — the window, the device, the glyph atlas — is unreachable from
    // the harness by construction rather than by discipline.
    if (options.headless) {
        const headlessStatus = runHeadless(options);
        SDL_Quit();
        return headlessStatus;
    }

    // SDL_ttf, unlike SDL3_image, has to be brought up before anything in it
    // works — the overlay's glyph atlas is baked during renderer creation. Not
    // fatal: the atlas registers empty faces and the overlay loses its text,
    // which is a worse HUD rather than no renderer.
    if (!TTF_Init()) {
        console.log(`main: TTF_Init failed, the overlay will have no text : ${stringFromCString(SDL_GetError())}`);
    }

    const status = run(options);

    TTF_Quit();
    SDL_Quit();
    return status;
}
