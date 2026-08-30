// The buffers the cluster passes read and write.
//
// Sizes, all fixed at startup:
//
//     bounds       3456 clusters * 32 B      110 KB   view-space AABBs
//     active       3456 * 4 B                 14 KB   one flag per cluster
//     lightCount   3456 * 4 B                 14 KB   lights kept per cluster
//     lightIndex   3456 * 96 * 4 B          1.33 MB   the lists themselves
//     lights        384 * 64 B                24 KB   the scene's lights
//     cullLights    384 * 16 B                 6 KB   view position + range only
//
// `lights` and `cullLights` describe the same lights and are both written every
// frame from one staging block. They are separate buffers because their readers
// want different things: shading reads all sixty-four bytes of a light, culling
// reads a position and a radius and nothing else. One buffer serving both meant
// the cull loop — the innermost loop in the frame — pulling four times the bytes
// it uses. See `writeCullLight`.
//
// `lightIndex` dominates and is the reason the per-cluster cap is 96 rather than
// something more generous: it is linear in that number, and every byte of it is
// read by the forward pass.
//
// Usage flags carry both roles a buffer plays. `lightCount` is written by a
// compute pass and read by a fragment shader, so it needs
// `COMPUTE_STORAGE_WRITE | GRAPHICS_STORAGE_READ` — declaring only one is not a
// creation error, it is a binding error much later.

import { type fmat4, fvec4 } from "std/linalg";
import {
    type SDL_GPUBuffer,
    SDL_GPUBufferUsageFlags,
    type SDL_GPUCopyPass,
    type SDL_GPUDevice,
} from "../../bindings/SDL3";
import { clusterCount, maxLights, maxLightsPerCluster } from "../config.ts";
import { createBuffer, releaseBuffer, Staging } from "../gpu/buffer.ts";
import type { Light } from "../scene/light.ts";
import { cullLightStride, lightStride, writeCullLight, writeLight } from "../scene/light.ts";

export class ClusterBuffers {
    /** View-space AABB per cluster. Written by `cluster_build`, read by `cluster_cull`. */
    bounds: Pointer<SDL_GPUBuffer> | null;

    /** One flag per cluster, from `cluster_mark`. Zeroed by `cluster_clear` each frame. */
    active: Pointer<SDL_GPUBuffer> | null;

    /** How many lights each cluster kept. */
    lightCount: Pointer<SDL_GPUBuffer> | null;

    /** `clusterCount * 96` indices into {@link lights}, furthest-first within each cluster. */
    lightIndex: Pointer<SDL_GPUBuffer> | null;

    /** The scene's lights, as `struct Light`. Read by the forward pass. */
    lights: Pointer<SDL_GPUBuffer> | null;

    /** The same lights as `vec4(view_position, range)`. Read by `cluster_cull`. */
    cullLights: Pointer<SDL_GPUBuffer> | null;

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
        this.cullLights = null;
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
        // GRAPHICS_STORAGE_READ only: the forward pass reads this, and since the
        // culling buffer arrived the cluster passes do not.
        this.lights = createBuffer(
            device,
            SDL_GPUBufferUsageFlags.GRAPHICS_STORAGE_READ,
            maxLights() * lightStride(),
            "scene.lights",
        );
        this.cullLights = createBuffer(
            device,
            SDL_GPUBufferUsageFlags.COMPUTE_STORAGE_READ,
            maxLights() * cullLightStride(),
            "scene.lights.cull",
        );

        // One staging block for both, shading region first. Two transfer buffers
        // would mean two mappings of memory that is written in the same loop.
        const stagingBytes = maxLights() * (lightStride() + cullLightStride());
        if (!this.staging.create(device, stagingBytes, "scene.lights.staging")) {
            return false;
        }

        return (
            this.bounds !== null &&
            this.active !== null &&
            this.lightCount !== null &&
            this.lightIndex !== null &&
            this.lights !== null &&
            this.cullLights !== null
        );
    }

    /**
     * Stage the scene's lights and record both copies onto `pass`.
     *
     * Returns how many were written, which becomes `Frame.lightCount` — the
     * culling loop runs to exactly that, so a stale larger number would have it
     * reading lights nobody wrote.
     *
     * `view` is this frame's world-to-view matrix, and it is here rather than in
     * the culling shader because the transform it drives does not vary by
     * cluster — see {@link writeCullLight}. It must be the same matrix that
     * reaches `Frame.view`, or lights are culled against froxels measured in a
     * different space than they were placed in.
     *
     * Lights past the scene cap are dropped with a line in the log rather than
     * silently, because the symptom otherwise is one light in a busy scene
     * simply not being there.
     */
    uploadLights(
        pass: Pointer<SDL_GPUCopyPass>,
        lights: Reference<Light[]>,
        shadowSlots: Reference<i32[]>,
        view: fmat4,
    ): u32 {
        const destination = this.lights;
        const cullDestination = this.cullLights;
        if (destination === null || cullDestination === null) {
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

        // Where the culling region starts, as a float index. Anchored to the
        // cap rather than to `count` so the two regions cannot overlap on a
        // frame with fewer lights than the last one.
        const cullBase = cast<usize>(maxLights() * lightStride()) / 4;

        for (let i: usize = 0; i < cast<usize>(count); i++) {
            writeLight(floats, words, i, lights[i], shadowSlots[i]);

            const position = lights[i].position;
            const viewPosition = view.mulVec(new fvec4(position.x, position.y, position.z, 1.0));
            writeCullLight(floats, cullBase + i * 4, viewPosition, lights[i].range);
        }

        this.staging.unmap();
        this.staging.record(pass, destination, 0, 0, count * lightStride());
        this.staging.record(
            pass,
            cullDestination,
            0,
            maxLights() * lightStride(),
            count * cullLightStride(),
        );
        return count;
    }

    release(device: Pointer<SDL_GPUDevice>): void {
        releaseBuffer(device, this.bounds);
        releaseBuffer(device, this.active);
        releaseBuffer(device, this.lightCount);
        releaseBuffer(device, this.lightIndex);
        releaseBuffer(device, this.lights);
        releaseBuffer(device, this.cullLights);
        this.staging.destroy();

        this.bounds = null;
        this.active = null;
        this.lightCount = null;
        this.lightIndex = null;
        this.lights = null;
        this.cullLights = null;
    }
}
