// Encke — a clustered forward renderer on SDL3's GPU API.
//
// This file is the entry point and nothing else. Argument handling is
// `app/options.ts`, the window and device are `app/display.ts`, the frame loop
// is `app/run.ts`, and everything that draws is under `renderer/`.

import { mi_calloc, mi_free, mi_malloc, mi_realloc } from "std/alloc";
import {
    SDL_GetError,
    SDL_GetRevision,
    SDL_GetVersion,
    SDL_Init,
    SDL_InitFlags,
    SDL_Quit,
    SDL_SetMemoryFunctions,
} from "./bindings/SDL3";
import { parseOptions, printUsage } from "./app/options.ts";
import { run } from "./app/run.ts";

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

    console.log(`SDL ${SDL_GetVersion()} (${stringFromCString(SDL_GetRevision())})`);

    if (!SDL_Init(SDL_InitFlags.VIDEO)) {
        console.log(`main: SDL_Init failed : ${stringFromCString(SDL_GetError())}`);
        return -1;
    }

    const status = run(options);

    SDL_Quit();
    return status;
}
