// The frame graph, such as it is: eight stages in a fixed order.
//
//     1  upload lights          copy pass
//     2  sun cascades           depth, into a 6144x2048 atlas
//     3  spot shadows           depth, into a 2048x2048 atlas
//     4  depth pre-pass         depth, full resolution
//     5  cluster clear/mark/cull  compute
//     6  SSAO + blur            colour, half resolution
//     7  forward                colour, HDR, depth tested EQUAL
//     8  tonemap                colour, into the swapchain
//
// The dependencies that fix that order, and they are not all obvious:
//
//   * **4 before 5** — marking reads the depth buffer. This is the entire reason
//     the pre-pass is mandatory rather than an optimisation.
//   * **4 before 6** — SSAO reads depth too, and reconstructs its normals from it.
//   * **1 before 5** — culling reads the light buffer, and `Frame.lightCount`
//     has to be the number that was actually uploaded.
//   * **5 and 6 before 7** — the forward pass reads both results.
//   * **2 and 3 anywhere before 7** — the shadow atlases have no other consumer.
//
// SDL inserts the resource transitions between passes, so nothing here issues a
// barrier. What it will not do is reorder them, which is why this reads top to
// bottom.

import {
    SDL_BeginGPUCopyPass,
    SDL_EndGPUCopyPass,
    SDL_GetError,
    type SDL_GPUCommandBuffer,
    type SDL_GPUDevice,
    type SDL_GPUSampler,
    type SDL_GPUTexture,
    SDL_GPUTextureFormat,
} from "../graphics/sdl/index.ts";
import { cameraFar, cameraNear, shadowDistance } from "./config.ts";
import { ClusterBuffers } from "./cluster/buffers.ts";
import { Targets } from "./frame/targets.ts";
import {
    fillFrame,
    fillShadowParams,
    type FrameUniform,
    type MaterialUniform,
    type ObjectUniform,
    type ShadowUniform,
    type ShadowViewUniform,
    type SsaoUniform,
    type TonemapUniform,
} from "./frame/uniforms.ts";
import { createLinearClamp, createNearestClamp, createShadowCompare, releaseSampler } from "./gpu/sampler.ts";
import { createColorTarget, releaseTexture } from "./gpu/texture.ts";
import { ClusterPasses } from "./passes/clusters.ts";
import { DepthPrepass } from "./passes/depth_prepass.ts";
import { ForwardInputs, ForwardPass } from "./passes/forward.ts";
import { ShadowPasses } from "./passes/shadows.ts";
import { SsaoPass } from "./passes/ssao.ts";
import { TonemapPass } from "./passes/tonemap.ts";
import type { Camera } from "./scene/camera.ts";
import { computeCascades } from "./scene/cascades.ts";
import type { Scene } from "./scene/scene.ts";
import { assignSpotShadows } from "./scene/spotslots.ts";

/** The depth format for the scene buffer and both shadow atlases. */
function depthFormat(): SDL_GPUTextureFormat {
    return SDL_GPUTextureFormat.D32_FLOAT;
}

export class Renderer {
    private targets: Targets;
    private clusters: ClusterBuffers;

    private clusterPasses: ClusterPasses;
    private depthPrepass: DepthPrepass;
    private shadowPasses: ShadowPasses;
    private ssaoPass: SsaoPass;
    private forwardPass: ForwardPass;
    private tonemapPass: TonemapPass;

    // Uniform scratch, allocated once and refilled per frame. Pushing a uniform
    // copies it into the command buffer, so one block per kind is enough — there
    // is never a second live value of any of these.
    private frame: Pointer<FrameUniform> | null;
    private object: Pointer<ObjectUniform> | null;
    private material: Pointer<MaterialUniform> | null;
    private shadows: Pointer<ShadowUniform> | null;
    private shadowView: Pointer<ShadowViewUniform> | null;
    private ssaoParams: Pointer<SsaoUniform> | null;
    private tonemapParams: Pointer<TonemapUniform> | null;

    private linearSampler: Pointer<SDL_GPUSampler> | null;
    private nearestSampler: Pointer<SDL_GPUSampler> | null;
    private shadowSampler: Pointer<SDL_GPUSampler> | null;

    private inputs: ForwardInputs;

    /** Readable stand-in for the swapchain. Null unless `enableCapture` was called. */
    private capture: Pointer<SDL_GPUTexture> | null;
    private captureFormat: SDL_GPUTextureFormat;

    /** Which debug view the forward pass draws. See `DEBUG_*` in `forward.wgsl`. */
    private debug: u32;
    private swapchainIsSrgb: boolean;

    /**
     * Construct the sub-objects.
     *
     * **Required, not tidiness.** A class-typed field is storage, and storage is
     * zeroed — which is not the same as constructed. Calling a method on a field
     * that never had a constructor run jumps through a type descriptor that is
     * not there, and the failure is a segmentation fault at the call rather than
     * anything naming the field.
     */
    constructor() {
        this.frame = null;
        this.object = null;
        this.material = null;
        this.shadows = null;
        this.shadowView = null;
        this.ssaoParams = null;
        this.tonemapParams = null;

        this.linearSampler = null;
        this.nearestSampler = null;
        this.shadowSampler = null;

        this.targets = new Targets();
        this.clusters = new ClusterBuffers();
        this.clusterPasses = new ClusterPasses();
        this.depthPrepass = new DepthPrepass();
        this.shadowPasses = new ShadowPasses();
        this.ssaoPass = new SsaoPass();
        this.forwardPass = new ForwardPass();
        this.tonemapPass = new TonemapPass();
        this.inputs = new ForwardInputs();
        this.capture = null;
        this.captureFormat = SDL_GPUTextureFormat.INVALID;
        this.debug = 0;
        this.swapchainIsSrgb = false;
    }

    /**
     * Choose the debug view.
     *
     * The tonemap curve is bypassed for anything but the ordinary view: a
     * heatmap is data, and running a filmic response over it would make every
     * value it reports a lie.
     */
    setDebugView(view: u32): void {
        this.debug = view;
        const tonemapParams = this.tonemapParams;
        if (tonemapParams !== null) {
            this.tonemapPass.fillParams(tonemapParams, this.swapchainIsSrgb, view !== 0);
        }
    }

    create(
        device: Pointer<SDL_GPUDevice>,
        swapchainFormat: SDL_GPUTextureFormat,
        swapchainIsSrgb: boolean,
        width: u32,
        height: u32,
    ): boolean {
        this.frame = alloc<FrameUniform>();
        this.object = alloc<ObjectUniform>();
        this.material = alloc<MaterialUniform>();
        this.shadows = alloc<ShadowUniform>();
        this.shadowView = alloc<ShadowViewUniform>();
        this.ssaoParams = alloc<SsaoUniform>();
        this.tonemapParams = alloc<TonemapUniform>();

        this.linearSampler = createLinearClamp(device);
        this.nearestSampler = createNearestClamp(device);
        this.shadowSampler = createShadowCompare(device);
        if (this.linearSampler === null || this.nearestSampler === null || this.shadowSampler === null) {
            return false;
        }

        if (!this.targets.createPersistent(device)) {
            return false;
        }
        if (!this.targets.resize(device, width, height)) {
            return false;
        }
        if (!this.clusters.create(device)) {
            return false;
        }

        const colorFormat = SDL_GPUTextureFormat.R16G16B16A16_FLOAT;
        const occlusionFormat = SDL_GPUTextureFormat.R8_UNORM;

        if (!this.clusterPasses.create(device)) {
            return false;
        }
        if (!this.depthPrepass.create(device, depthFormat())) {
            return false;
        }
        if (!this.shadowPasses.create(device, depthFormat())) {
            return false;
        }
        if (!this.ssaoPass.create(device, occlusionFormat)) {
            return false;
        }
        if (!this.forwardPass.create(device, colorFormat, depthFormat())) {
            return false;
        }
        if (!this.tonemapPass.create(device, swapchainFormat)) {
            return false;
        }

        this.swapchainIsSrgb = swapchainIsSrgb;
        this.setDebugView(this.debug);

        this.refreshInputs();
        return true;
    }

    /** Rebuild the screen-sized targets. The cluster bounds depend on them, so they go too. */
    resize(device: Pointer<SDL_GPUDevice>, width: u32, height: u32): boolean {
        if (!this.targets.resize(device, width, height)) {
            return false;
        }
        this.clusterPasses.invalidate();
        this.refreshInputs();
        return true;
    }

    /** Re-point the forward pass at whatever the current targets are. */
    private refreshInputs(): void {
        this.inputs.cascadeAtlas = this.targets.cascadeAtlas;
        this.inputs.spotAtlas = this.targets.spotAtlas;
        this.inputs.occlusion = this.targets.occlusionBlurred;
        this.inputs.shadowSampler = this.shadowSampler;
        this.inputs.occlusionSampler = this.linearSampler;
    }

    render(
        cmd: Pointer<SDL_GPUCommandBuffer>,
        swapchain: Pointer<SDL_GPUTexture>,
        scene: Reference<Scene>,
        camera: Reference<Camera>,
        elapsed: f32,
    ): void {
        const frame = this.frame;
        const object = this.object;
        const material = this.material;
        const shadows = this.shadows;
        const shadowView = this.shadowView;
        const ssaoParams = this.ssaoParams;
        const tonemapParams = this.tonemapParams;

        const sceneTarget = this.targets.scene;
        const depth = this.targets.depth;
        const occlusion = this.targets.occlusion;
        const occlusionBlurred = this.targets.occlusionBlurred;
        const cascadeAtlas = this.targets.cascadeAtlas;
        const spotAtlas = this.targets.spotAtlas;
        const nearest = this.nearestSampler;
        const linear = this.linearSampler;

        if (
            frame === null ||
            object === null ||
            material === null ||
            shadows === null ||
            shadowView === null ||
            ssaoParams === null ||
            tonemapParams === null ||
            sceneTarget === null ||
            depth === null ||
            occlusion === null ||
            occlusionBlurred === null ||
            cascadeAtlas === null ||
            spotAtlas === null ||
            nearest === null ||
            linear === null
        ) {
            return;
        }

        const width = this.targets.width;
        const height = this.targets.height;
        const aspect = cast<f32>(width) / cast<f32>(height);

        const frameBytes = cast<u32>(sizeOf<FrameUniform>());
        const objectBytes = cast<u32>(sizeOf<ObjectUniform>());
        const materialBytes = cast<u32>(sizeOf<MaterialUniform>());
        const shadowBytes = cast<u32>(sizeOf<ShadowUniform>());
        const shadowViewBytes = cast<u32>(sizeOf<ShadowViewUniform>());
        const ssaoBytes = cast<u32>(sizeOf<SsaoUniform>());
        const tonemapBytes = cast<u32>(sizeOf<TonemapUniform>());

        // -- shadow bookkeeping, before anything is recorded --
        const spots = assignSpotShadows(scene.lights, shadows, camera.position);
        computeCascades(shadows, camera, aspect, scene.sunDirection);
        fillShadowParams(shadows);

        // -- 1. lights --
        let lightCount: u32 = 0;
        const copyPass = SDL_BeginGPUCopyPass(cmd);
        if (copyPass === null) {
            console.log(`renderer: copy pass failed : ${stringFromCString(SDL_GetError())}`);
            return;
        }
        lightCount = this.clusters.uploadLights(copyPass, scene.lights, spots.slots);
        SDL_EndGPUCopyPass(copyPass);

        fillFrame(
            frame,
            camera.view(),
            camera.projection(aspect),
            camera.position,
            scene.sunDirection,
            scene.sunColor,
            scene.ambient,
            width,
            height,
            cameraNear(),
            cameraFar(),
            lightCount,
            shadowDistance(),
            elapsed,
            this.debug,
        );

        this.ssaoPass.fillParams(ssaoParams, this.targets.occlusionWidth, this.targets.occlusionHeight);

        // -- 2, 3. shadows --
        this.shadowPasses.recordCascades(cmd, cascadeAtlas, scene, shadows, shadowView, shadowViewBytes);
        if (spots.count > 0) {
            this.shadowPasses.recordSpots(
                cmd,
                spotAtlas,
                scene,
                shadows,
                spots.count,
                shadowView,
                shadowViewBytes,
            );
        }

        // -- 4. depth --
        this.depthPrepass.record(cmd, depth, scene, frame, frameBytes, object, objectBytes);

        // -- 5. clusters --
        this.clusterPasses.record(cmd, this.clusters, frame, frameBytes, depth, nearest, width, height);

        // -- 6. occlusion --
        this.ssaoPass.record(
            cmd,
            depth,
            nearest,
            occlusion,
            occlusionBlurred,
            frame,
            frameBytes,
            ssaoParams,
            ssaoBytes,
        );

        // -- 7. shading --
        this.forwardPass.record(
            cmd,
            sceneTarget,
            depth,
            scene,
            this.clusters,
            this.inputs,
            frame,
            frameBytes,
            shadows,
            shadowBytes,
            object,
            objectBytes,
            material,
            materialBytes,
        );

        // -- 8. present --
        this.tonemapPass.record(cmd, swapchain, sceneTarget, linear, tonemapParams, tonemapBytes);
    }

    /**
     * Create a readable stand-in for the swapchain, for `--screenshot`.
     *
     * The swapchain's own texture cannot be downloaded — it is the presentation
     * engine's — and the HDR scene target has no 8-bit surface to convert to. So
     * the capture target is an ordinary colour target in the *swapchain's format*,
     * which the tonemap pipeline was already built for, and the frame that wants
     * a screenshot is rendered into it and then blitted onward.
     *
     * Created on demand, so an ordinary run never allocates it and never pays
     * the copy.
     */
    enableCapture(device: Pointer<SDL_GPUDevice>, format: SDL_GPUTextureFormat): boolean {
        this.captureFormat = format;
        this.capture = createColorTarget(
            device,
            format,
            this.targets.width,
            this.targets.height,
            "capture",
        );
        return this.capture !== null;
    }

    /** The capture target, or null when `--screenshot` was not asked for. */
    captureTexture(): Pointer<SDL_GPUTexture> | null {
        return this.capture;
    }

    captureTextureFormat(): SDL_GPUTextureFormat {
        return this.captureFormat;
    }

    release(device: Pointer<SDL_GPUDevice>): void {
        this.tonemapPass.release(device);
        this.forwardPass.release(device);
        this.ssaoPass.release(device);
        this.shadowPasses.release(device);
        this.depthPrepass.release(device);
        this.clusterPasses.release(device);

        this.clusters.release(device);
        this.targets.release(device);
        releaseTexture(device, this.capture);
        this.capture = null;

        releaseSampler(device, this.linearSampler);
        releaseSampler(device, this.nearestSampler);
        releaseSampler(device, this.shadowSampler);
        this.linearSampler = null;
        this.nearestSampler = null;
        this.shadowSampler = null;

        // Written out rather than through a helper: a generic function is not
        // something this compiler supports yet, and `Pointer<T>.free()` has no
        // non-generic spelling that would take all seven.
        if (this.frame !== null) {
            this.frame.free();
        }
        if (this.object !== null) {
            this.object.free();
        }
        if (this.material !== null) {
            this.material.free();
        }
        if (this.shadows !== null) {
            this.shadows.free();
        }
        if (this.shadowView !== null) {
            this.shadowView.free();
        }
        if (this.ssaoParams !== null) {
            this.ssaoParams.free();
        }
        if (this.tonemapParams !== null) {
            this.tonemapParams.free();
        }

        this.frame = null;
        this.object = null;
        this.material = null;
        this.shadows = null;
        this.shadowView = null;
        this.ssaoParams = null;
        this.tonemapParams = null;
    }
}
