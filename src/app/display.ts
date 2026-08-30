// The window, the GPU device, and the swapchain that joins them.
//
// Present mode is negotiated rather than set. VSYNC is the only mode SDL
// guarantees; IMMEDIATE and MAILBOX have to be asked about first, and a request
// for one that is not there falls back with a line in the log rather than
// failing — but the *actual* mode is kept, because a benchmark that silently ran
// under a different mode than it reported is worse than no benchmark.
//
// MAILBOX carries a known SDL bug around early-frame vsync behaviour on some
// drivers: the first handful of frames can pace themselves to the display even
// though mailbox should not block. It is worth knowing before reading a
// benchmark's first hundred samples.

import {
    SDL_ClaimWindowForGPUDevice,
    SDL_CreateGPUDevice,
    SDL_CreateWindow,
    SDL_DestroyGPUDevice,
    SDL_DestroyWindow,
    SDL_GetError,
    SDL_GetGPUDeviceDriver,
    SDL_GetGPUSwapchainTextureFormat,
    SDL_GetWindowSizeInPixels,
    type SDL_GPUDevice,
    SDL_GPUPresentMode,
    SDL_GPUShaderFormat,
    SDL_GPUSwapchainComposition,
    SDL_GPUTextureFormat,
    SDL_ReleaseWindowFromGPUDevice,
    SDL_SetGPUAllowedFramesInFlight,
    SDL_SetGPUSwapchainParameters,
    type SDL_Window,
    SDL_WindowFlags,
    SDL_WindowSupportsGPUPresentMode,
} from "../bindings/SDL3";
import { presentModeName } from "./options.ts";

export class Display {
    window: Pointer<SDL_Window> | null;
    device: Pointer<SDL_GPUDevice> | null;

    /** The mode actually in force, which may not be the one asked for. */
    presentMode: SDL_GPUPresentMode;

    /** What a pipeline drawing to the swapchain must declare as its colour format. */
    swapchainFormat: SDL_GPUTextureFormat;

    /** True when the swapchain encodes sRGB on write, so the tonemap must not. */
    swapchainIsSrgb: boolean;

    width: u32;
    height: u32;

    constructor() {
        this.window = null;
        this.device = null;
        this.presentMode = SDL_GPUPresentMode.VSYNC;
        this.swapchainFormat = SDL_GPUTextureFormat.INVALID;
        this.swapchainIsSrgb = false;
        this.width = 0;
        this.height = 0;
    }

    open(title: string, requestedWidth: i32, requestedHeight: i32, requested: SDL_GPUPresentMode): boolean {
        const window = SDL_CreateWindow(cstring(title), requestedWidth, requestedHeight, SDL_WindowFlags.NONE);
        if (window === null) {
            console.log(`display: window failed : ${stringFromCString(SDL_GetError())}`);
            return false;
        }
        this.window = window;

        // SPIR-V and nothing else, which on its own selects Vulkan. Naming the
        // driver too means a machine with a broken loader fails here rather than
        // quietly running somewhere the shaders were not compiled for.
        const device = SDL_CreateGPUDevice(SDL_GPUShaderFormat.SPIRV, true, cstring("vulkan"));
        if (device === null) {
            console.log(`display: device failed : ${stringFromCString(SDL_GetError())}`);
            SDL_DestroyWindow(window);
            this.window = null;
            return false;
        }
        this.device = device;

        const driver = SDL_GetGPUDeviceDriver(device);
        console.log(`display: driver ${driver === null ? "?" : stringFromCString(driver)}`);

        if (!SDL_ClaimWindowForGPUDevice(device, window)) {
            console.log(`display: claiming the window failed : ${stringFromCString(SDL_GetError())}`);
            this.close();
            return false;
        }

        this.presentMode = this.negotiatePresentMode(device, window, requested);
        this.swapchainFormat = SDL_GetGPUSwapchainTextureFormat(device, window);
        this.swapchainIsSrgb =
            this.swapchainFormat === SDL_GPUTextureFormat.R8G8B8A8_UNORM_SRGB ||
            this.swapchainFormat === SDL_GPUTextureFormat.B8G8R8A8_UNORM_SRGB;

        // Two frames in flight. One means the CPU waits on every frame; three
        // adds a frame of input latency to hide a stall this renderer does not
        // have.
        SDL_SetGPUAllowedFramesInFlight(device, 2);

        this.readSize();
        console.log(`display: ${this.width}x${this.height}, present ${presentModeName(this.presentMode)}`);
        return true;
    }

    /** Re-read the drawable size. Returns true when it changed. */
    readSize(): boolean {
        const window = this.window;
        if (window === null) {
            return false;
        }

        const width: FixedArray<i32, 1> = fixedArray(1, 0);
        const height: FixedArray<i32, 1> = fixedArray(1, 0);
        SDL_GetWindowSizeInPixels(window, width, height);

        const w = cast<u32>(width[0] < 1 ? 1 : width[0]);
        const h = cast<u32>(height[0] < 1 ? 1 : height[0]);
        const changed = w !== this.width || h !== this.height;

        this.width = w;
        this.height = h;
        return changed;
    }

    close(): void {
        const device = this.device;
        const window = this.window;

        if (device !== null) {
            if (window !== null) {
                SDL_ReleaseWindowFromGPUDevice(device, window);
            }
            SDL_DestroyGPUDevice(device);
        }
        if (window !== null) {
            SDL_DestroyWindow(window);
        }

        this.device = null;
        this.window = null;
    }

    /**
     * Ask for a present mode, settle for what exists.
     *
     * The returned mode is what was actually installed — including when the
     * install itself failed, in which case the swapchain is still on VSYNC and
     * saying otherwise would mislabel every measurement taken afterwards.
     */
    private negotiatePresentMode(
        device: Pointer<SDL_GPUDevice>,
        window: Pointer<SDL_Window>,
        requested: SDL_GPUPresentMode,
    ): SDL_GPUPresentMode {
        if (requested === SDL_GPUPresentMode.VSYNC) {
            return SDL_GPUPresentMode.VSYNC;
        }

        if (!SDL_WindowSupportsGPUPresentMode(device, window, requested)) {
            console.log(
                `display: ${presentModeName(requested)} is not supported here, falling back to vsync`,
            );
            return SDL_GPUPresentMode.VSYNC;
        }

        if (!SDL_SetGPUSwapchainParameters(device, window, SDL_GPUSwapchainComposition.SDR, requested)) {
            console.log(
                `display: setting ${presentModeName(requested)} failed : ${stringFromCString(SDL_GetError())}`,
            );
            return SDL_GPUPresentMode.VSYNC;
        }

        if (requested === SDL_GPUPresentMode.MAILBOX) {
            console.log("display: mailbox has a known SDL bug — early frames may still pace to vblank");
        }

        return requested;
    }
}
