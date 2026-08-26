// The buffers the cluster passes read and write.
//
// Sizes, all fixed at startup:
//
//     bounds       3456 clusters * 32 B      110 KB   view-space AABBs
//     active       3456 * 4 B                 14 KB   one flag per cluster
//     lightCount   3456 * 4 B                 14 KB   lights kept per cluster
//     lightIndex   3456 * 96 * 4 B          1.33 MB   the lists themselves
//     lights        384 * 64 B                24 KB   the scene's lights
//
// `lightIndex` dominates and is the reason the per-cluster cap is 96 rather than
// something more generous: it is linear in that number, and every byte of it is
// read by the forward pass.
//
// Usage flags carry both roles a buffer plays. `lightCount` is written by a
// compute pass and read by a fragment shader, so it needs
// `COMPUTE_STORAGE_WRITE | GRAPHICS_STORAGE_READ` — declaring only one is not a
// creation error, it is a binding error much later.

import {
    type SDL_GPUBuffer,
    SDL_GPUBufferUsageFlags,
    type SDL_GPUCopyPass,
    type SDL_GPUDevice,
} from "../../graphics/sdl/index.ts";
import { clusterCount, maxLights, maxLightsPerCluster } from "../config.ts";
import { createBuffer, releaseBuffer, Staging } from "../gpu/buffer.ts";
import { lightStride, writeLight } from "../scene/light.ts";
import type { Light } from "../scene/light.ts";

export class ClusterBuffers {
    /** View-space AABB per cluster. Written by `cluster_build`, read by `cluster_cull`. */
    bounds: Pointer<SDL_GPUBuffer> | null;

    /** One flag per cluster, from `cluster_mark`. Zeroed by `cluster_clear` each frame. */
    active: Pointer<SDL_GPUBuffer> | null;

    /** How many lights each cluster kept. */
    lightCount: Pointer<SDL_GPUBuffer> | null;

    /** `clusterCount * 96` indices into {@link lights}, furthest-first within each cluster. */
    lightIndex: Pointer<SDL_GPUBuffer> | null;

    /** The scene's lights, as `struct Light`. */
    lights: Pointer<SDL_GPUBuffer> | null;

    private staging: Staging;

    /**
     * Whether the over-cap warning has already been printed.
     *
     * A latch, because `uploadLights` runs every frame and the condition it
     * reports is a property of the scene, not of the frame. Without it a scene
     * one light over the cap prints a line per frame for as long as it runs,
     * which buries everything else in the log.
     */
    private warnedOverCap: boolean;

    /** See the note on `Renderer`'s constructor: a class-typed field is storage, not an object. */
    constructor() {
        this.staging = new Staging();
        this.warnedOverCap = false;
        this.bounds = null;
        this.active = null;
        this.lightCount = null;
        this.lightIndex = null;
        this.lights = null;
    }

    create(device: Pointer<SDL_GPUDevice>): boolean {
        const clusters = clusterCount();

        this.bounds = createBuffer(
            device,
            SDL_GPUBufferUsageFlags.COMPUTE_STORAGE_WRITE | SDL_GPUBufferUsageFlags.COMPUTE_STORAGE_READ,
            clusters * 32,
            "cluster.bounds",
        );
        this.active = createBuffer(
            device,
            SDL_GPUBufferUsageFlags.COMPUTE_STORAGE_WRITE | SDL_GPUBufferUsageFlags.COMPUTE_STORAGE_READ,
            clusters * 4,
            "cluster.active",
        );
        this.lightCount = createBuffer(
            device,
            SDL_GPUBufferUsageFlags.COMPUTE_STORAGE_WRITE | SDL_GPUBufferUsageFlags.GRAPHICS_STORAGE_READ,
            clusters * 4,
            "cluster.light_count",
        );
        this.lightIndex = createBuffer(
            device,
            SDL_GPUBufferUsageFlags.COMPUTE_STORAGE_WRITE | SDL_GPUBufferUsageFlags.GRAPHICS_STORAGE_READ,
            clusters * maxLightsPerCluster() * 4,
            "cluster.light_index",
        );
        this.lights = createBuffer(
            device,
            SDL_GPUBufferUsageFlags.COMPUTE_STORAGE_READ | SDL_GPUBufferUsageFlags.GRAPHICS_STORAGE_READ,
            maxLights() * lightStride(),
            "scene.lights",
        );

        if (!this.staging.create(device, maxLights() * lightStride(), "scene.lights.staging")) {
            return false;
        }

        return (
            this.bounds !== null &&
            this.active !== null &&
            this.lightCount !== null &&
            this.lightIndex !== null &&
            this.lights !== null
        );
    }

    /**
     * Stage the scene's lights and record the copy onto `pass`.
     *
     * Returns how many were written, which becomes `Frame.lightCount` — the
     * culling loop runs to exactly that, so a stale larger number would have it
     * reading lights nobody wrote.
     *
     * Lights past the scene cap are dropped with a line in the log rather than
     * silently, because the symptom otherwise is one light in a busy scene
     * simply not being there.
     */
    uploadLights(
        pass: Pointer<SDL_GPUCopyPass>,
        lights: Reference<Light[]>,
        shadowSlots: Reference<i32[]>,
    ): u32 {
        const destination = this.lights;
        if (destination === null) {
            return 0;
        }

        let count = cast<u32>(lights.length);
        if (count > maxLights()) {
            if (!this.warnedOverCap) {
                console.log(
                    `cluster: scene has ${lights.length} lights, cap is ${maxLights()} — dropping the rest`,
                );
                this.warnedOverCap = true;
            }
            count = maxLights();
        }
        if (count === 0) {
            return 0;
        }

        // `cycle: true` — this runs inside a frame, and the previous frame's
        // copy may still be reading the old block.
        if (!this.staging.map(true)) {
            return 0;
        }

        const floats = this.staging.floats();
        const words = this.staging.words();
        for (let i: usize = 0; i < cast<usize>(count); i++) {
            writeLight(floats, words, i, lights[i], shadowSlots[i]);
        }

        this.staging.unmap();
        this.staging.record(pass, destination, 0, 0, count * lightStride());
        return count;
    }

    release(device: Pointer<SDL_GPUDevice>): void {
        releaseBuffer(device, this.bounds);
        releaseBuffer(device, this.active);
        releaseBuffer(device, this.lightCount);
        releaseBuffer(device, this.lightIndex);
        releaseBuffer(device, this.lights);
        this.staging.destroy();

        this.bounds = null;
        this.active = null;
        this.lightCount = null;
        this.lightIndex = null;
        this.lights = null;
    }
}
