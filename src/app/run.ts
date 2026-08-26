// The frame loop.
//
// Owns the window, the clock, the camera and the profiler; the renderer is
// handed a command buffer and a swapchain texture and told to fill it. Everything
// about *when* a frame happens lives here, and everything about *what* is in one
// lives under `renderer/`.

import { fvec3 } from "std/linalg";
import {
    SDL_AcquireGPUCommandBuffer,
    SDL_BlitGPUTexture,
    type SDL_Event,
    SDL_EventType,
    SDL_GetError,
    type SDL_GPUBlitInfo,
    type SDL_GPUFence,
    SDL_GPUFilter,
    SDL_GPULoadOp,
    type SDL_GPUTexture,
    SDL_PollEvent,
    SDL_ReleaseGPUFence,
    SDL_Scancode,
    SDL_SubmitGPUCommandBuffer,
    SDL_SubmitGPUCommandBufferAndAcquireFence,
    SDL_WaitAndAcquireGPUSwapchainTexture,
    SDL_WaitForGPUFences,
    SDL_WaitForGPUIdle,
} from "../bindings/SDL3";
import { Clock, Stopwatch } from "../core/clock.ts";
import { Input } from "../core/input.ts";
import { cameraFar, cameraFovY, cameraNear } from "../renderer/config.ts";
import { Profiler } from "../renderer/profiler.ts";
import { Renderer } from "../renderer/renderer.ts";
import { Camera } from "../renderer/scene/camera.ts";
import { saveTexturePng } from "../renderer/screenshot.ts";
import { Display } from "./display.ts";
import { type Options, presentModeName } from "./options.ts";
import { buildTestScene, populateLights } from "./testscene.ts";

/** Metres per second the camera flies at. Shift multiplies it. */
function moveSpeed(): f32 {
    return 8.0;
}

/** Radians per pixel of mouse movement. */
function lookSpeed(): f32 {
    return 0.0025;
}

export function run(options: Reference<Options>): i32 {
    const display = new Display();
    if (!display.open("Encke — clustered forward", options.width, options.height, options.present)) {
        return -1;
    }

    const device = display.device;
    const window = display.window;
    if (device === null || window === null) {
        display.close();
        return -1;
    }

    const renderer = new Renderer();
    if (
        !renderer.create(
            device,
            display.swapchainFormat,
            display.swapchainIsSrgb,
            display.width,
            display.height,
        )
    ) {
        console.log("run: renderer initialisation failed");
        renderer.release(device);
        display.close();
        return -1;
    }

    renderer.setDebugView(options.debug);

    if (options.screenshot.length > 0 && !renderer.enableCapture(device, display.swapchainFormat)) {
        console.log("run: capture target failed — no screenshot will be written");
    }

    const scene = buildTestScene(device, options.lights);

    const camera = new Camera();
    camera.fovY = cameraFovY();
    camera.near = cameraNear();
    camera.far = cameraFar();
    // Off-axis and above, so the pillar grid is seen through rather than from
    // inside, and so the sun's shadows fall across the camera's view rather than
    // away from it.
    camera.place(new fvec3(14.0, 7.0, 20.0), -0.61, -0.24);

    const input = new Input();
    input.attach(window);

    const clock = new Clock();
    clock.start();

    const profiler = new Profiler();
    profiler.begin(options.bench ? cast<usize>(options.frames) : 0);

    const stopwatch = new Stopwatch();
    const event = alloc<SDL_Event>();
    const swapchain = allocArray<Pointer<SDL_GPUTexture>>(1);
    const fences = allocArray<Pointer<SDL_GPUFence>>(1);

    let running = true;
    let frame: u32 = 0;
    let captured = false;

    while (running) {
        while (SDL_PollEvent(event)) {
            if (event.type === SDL_EventType.Quit) {
                running = false;
            }
            if (event.type === SDL_EventType.KeyDown && event.key.scancode === SDL_Scancode.ESCAPE) {
                running = false;
            }
        }

        const delta = clock.tick();
        input.poll();
        driveCamera(camera, input, delta);
        populateLights(scene, clock.elapsed, options.lights);

        if (display.readSize()) {
            // The window changed size, so the targets and the cluster bounds are
            // both stale. Idle first: the old textures are still referenced by
            // frames the GPU has not finished.
            SDL_WaitForGPUIdle(device);
            if (!renderer.resize(device, display.width, display.height)) {
                console.log("run: resize failed");
                running = false;
                continue;
            }
        }

        const cmd = SDL_AcquireGPUCommandBuffer(device);
        if (cmd === null) {
            console.log(`run: command buffer failed : ${stringFromCString(SDL_GetError())}`);
            running = false;
            continue;
        }

        // Blocks until the swapchain has an image free, which is what paces this
        // loop to the display under VSYNC.
        if (!SDL_WaitAndAcquireGPUSwapchainTexture(cmd, window, swapchain, null, null)) {
            console.log(`run: swapchain acquire failed : ${stringFromCString(SDL_GetError())}`);
            SDL_SubmitGPUCommandBuffer(cmd);
            running = false;
            continue;
        }

        // A few frames in: late enough that the swapchain and the cluster bounds
        // have settled, early enough that an unattended run finishes quickly.
        const capturing = options.screenshot.length > 0 && !captured && frame >= 4;

        // A null texture with a successful acquire is the ordinary "window is
        // minimised" answer. Nothing to draw into, so the command buffer is
        // submitted empty rather than cancelled — cancelling is not allowed once
        // a swapchain texture has been acquired on it.
        if (swapchain[0].address !== 0) {
            const capture = renderer.captureTexture();

            if (capturing && capture !== null) {
                // Tonemap into a texture that can actually be downloaded, then
                // hand the same pixels to the swapchain so the window still
                // shows the frame that was captured.
                renderer.render(cmd, capture, scene, camera, clock.elapsed);

                const blit = alloc<SDL_GPUBlitInfo>({
                    source: { texture: capture, w: display.width, h: display.height },
                    destination: { texture: swapchain[0], w: display.width, h: display.height },
                    load_op: SDL_GPULoadOp.DONT_CARE,
                    filter: SDL_GPUFilter.NEAREST,
                });
                SDL_BlitGPUTexture(cmd, blit);
                blit.free();
            } else {
                renderer.render(cmd, swapchain[0], scene, camera, clock.elapsed);
            }
        }

        if (options.bench) {
            // Fence only in benchmark mode. Waiting flattens the CPU/GPU overlap
            // an ordinary frame depends on — see `renderer/profiler.ts`.
            stopwatch.begin();
            const fence = SDL_SubmitGPUCommandBufferAndAcquireFence(cmd);
            if (fence !== null) {
                fences[0] = fence;
                SDL_WaitForGPUFences(device, true, fences, 1);
                SDL_ReleaseGPUFence(device, fence);
                profiler.record(stopwatch.end());
            }
        } else {
            SDL_SubmitGPUCommandBuffer(cmd);
        }

        frame += 1;

        if (capturing) {
            captured = true;
            const capture = renderer.captureTexture();
            if (capture !== null) {
                if (
                    saveTexturePng(
                        device,
                        capture,
                        renderer.captureTextureFormat(),
                        display.width,
                        display.height,
                        options.screenshot,
                    )
                ) {
                    console.log(`run: wrote ${options.screenshot}`);
                }
            }
            running = false;
        }

        if (options.frames > 0 && frame >= options.frames) {
            running = false;
        }
    }

    SDL_WaitForGPUIdle(device);

    if (options.bench) {
        profiler.report(presentModeName(display.presentMode));
    }

    fences.freeArray();
    swapchain.freeArray();
    event.free();

    scene.release(device);
    renderer.release(device);
    display.close();
    return 0;
}

/** WASD to move, right mouse to look, shift to hurry, space and control for height. */
function driveCamera(camera: Reference<Camera>, input: Reference<Input>, delta: f32): void {
    camera.rotate(input.mouseDeltaX * lookSpeed(), -input.mouseDeltaY * lookSpeed());

    let speed = moveSpeed();
    if (input.down(SDL_Scancode.LSHIFT) || input.down(SDL_Scancode.RSHIFT)) {
        speed *= 4.0;
    }
    const step = speed * delta;

    let forward: f32 = 0.0;
    let right: f32 = 0.0;
    let up: f32 = 0.0;

    if (input.down(SDL_Scancode.W)) {
        forward += step;
    }
    if (input.down(SDL_Scancode.S)) {
        forward -= step;
    }
    if (input.down(SDL_Scancode.D)) {
        right += step;
    }
    if (input.down(SDL_Scancode.A)) {
        right -= step;
    }
    if (input.down(SDL_Scancode.SPACE)) {
        up += step;
    }
    if (input.down(SDL_Scancode.LCTRL)) {
        up -= step;
    }

    camera.move(forward, right, up);
}
