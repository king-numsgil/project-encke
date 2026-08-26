// Rasterising the shadow atlases.
//
// One render pass per atlas, not one per tile. The atlas is cleared once at the
// start of the pass and each cascade then draws inside its own viewport — four
// tiles from one pass, which matters because a render pass is the expensive
// boundary here and the tiles are otherwise identical work.
//
// The **scissor** is what makes that safe. A viewport confines the vertex
// transform but does nothing about a triangle whose rasterisation spills past
// it; without a scissor a caster near the edge of cascade 1 writes depth into
// cascade 2's tile, and the result is a band of shadow from the wrong frustum.
//
// **Back faces are culled, not front faces.** This renderer culled front faces
// at first, which is a well-known way to avoid shadow acne: the map then records
// the surface facing *away* from the light, so a lit point is unambiguously
// nearer and can never shadow itself.
//
// It is also a well-known way to cause peter-panning, and the size of it is not
// subtle. A crate 1.6 units thick under a sun at roughly 53 degrees has its
// recorded occluder a full thickness further along the light ray, so its shadow
// starts about 1.6 / tan(53) — some 1.2 units — downrange of the crate. The
// shadow visibly detaches from the object at the floor.
//
// Culling back faces puts the occluder back on the lit surface, where it
// belongs, and the acne that reintroduces is handled where it should be: by
// slope-scaled bias during rasterisation, and by the receiver's normal offset.
// Both scale with obliquity, which is what actually governs how much bias a
// surface needs — a constant large enough for the worst case was the thing
// detaching contacts in the first place.

import { fmat4 } from "std/linalg";
import {
    SDL_BeginGPURenderPass,
    SDL_BindGPUGraphicsPipeline,
    SDL_EndGPURenderPass,
    SDL_GetError,
    type SDL_GPUCommandBuffer,
    SDL_GPUCullMode,
    type SDL_GPUDepthStencilTargetInfo,
    type SDL_GPUDevice,
    type SDL_GPUGraphicsPipeline,
    SDL_GPULoadOp,
    type SDL_GPURenderPass,
    SDL_GPUStoreOp,
    type SDL_GPUTexture,
    SDL_GPUTextureFormat,
    type SDL_GPUViewport,
    SDL_PushGPUVertexUniformData,
    type SDL_Rect,
    SDL_ReleaseGPUGraphicsPipeline,
    SDL_ReleaseGPUShader,
    SDL_SetGPUScissor,
    SDL_SetGPUViewport,
} from "../../bindings/SDL3";
import { cascadeCount, shadowConstantBias, shadowSlopeBias, spotShadowSize } from "../config.ts";
import type { ShadowUniform, ShadowViewUniform } from "../frame/uniforms.ts";
import { createDepthOnlyPipeline } from "../gpu/pipeline.ts";
import { cascadeSize, cascadeTileX, spotTileX, spotTileY } from "../scene/cascades.ts";
import { Frustum } from "../scene/frustum.ts";
import type { Scene } from "../scene/scene.ts";
import { shadowDepthFsMain, shadowDepthVsMain } from "../shaders.generated.ts";

export class ShadowPasses {
    private pipeline: Pointer<SDL_GPUGraphicsPipeline> | null;

    /**
     * Rebuilt for each tile, in {@link drawScene}. A field rather than a local
     * because it holds six `vec4` inline and this runs eight times a frame.
     */
    private frustum: Frustum;

    constructor() {
        this.pipeline = null;
        this.frustum = new Frustum();
    }

    create(device: Pointer<SDL_GPUDevice>, depthFormat: SDL_GPUTextureFormat): boolean {
        const vertex = shadowDepthVsMain(device);
        const fragment = shadowDepthFsMain(device);
        if (vertex === null || fragment === null) {
            return false;
        }

        this.pipeline = createDepthOnlyPipeline(
            device,
            vertex,
            fragment,
            depthFormat,
            // BACK, so the map records the surface the light actually strikes.
            // See the file header for why FRONT was wrong.
            SDL_GPUCullMode.BACK,
            shadowConstantBias(),
            shadowSlopeBias(),
            "shadow-depth",
        );

        SDL_ReleaseGPUShader(device, vertex);
        SDL_ReleaseGPUShader(device, fragment);
        return this.pipeline !== null;
    }

    /** The sun's four cascades, into one atlas. */
    recordCascades(
        cmd: Pointer<SDL_GPUCommandBuffer>,
        atlas: Pointer<SDL_GPUTexture>,
        scene: Reference<Scene>,
        shadows: Pointer<ShadowUniform>,
        view: Pointer<ShadowViewUniform>,
        viewBytes: u32,
    ): void {
        const pass = this.begin(cmd, atlas, "cascades");
        if (pass === null) {
            return;
        }

        const count = cascadeCount();
        for (let i: u32 = 0; i < count; i++) {
            const size = cascadeSize(i);
            this.setTile(pass, cascadeTileX(i), 0, size, size);
            this.drawScene(cmd, pass, scene, shadows.cascadeViewProj[cast<usize>(i)], view, viewBytes);
        }

        SDL_EndGPURenderPass(pass);
    }

    /**
     * The shadow-casting spotlights, into a 2x2 atlas.
     *
     * `count` is how many slots were actually assigned this frame. Tiles beyond
     * it keep whatever the clear left — depth 1.0, which reads as "nothing in
     * front of this", so an unassigned slot is fully lit rather than black.
     */
    recordSpots(
        cmd: Pointer<SDL_GPUCommandBuffer>,
        atlas: Pointer<SDL_GPUTexture>,
        scene: Reference<Scene>,
        shadows: Pointer<ShadowUniform>,
        count: u32,
        view: Pointer<ShadowViewUniform>,
        viewBytes: u32,
    ): void {
        const pass = this.begin(cmd, atlas, "spots");
        if (pass === null) {
            return;
        }

        const size = spotShadowSize();
        for (let i: u32 = 0; i < count; i++) {
            this.setTile(pass, spotTileX(i), spotTileY(i), size, size);
            this.drawScene(cmd, pass, scene, shadows.spotViewProj[cast<usize>(i)], view, viewBytes);
        }

        SDL_EndGPURenderPass(pass);
    }

    private begin(
        cmd: Pointer<SDL_GPUCommandBuffer>,
        atlas: Pointer<SDL_GPUTexture>,
        name: string,
    ): Pointer<SDL_GPURenderPass> | null {
        const target = alloc<SDL_GPUDepthStencilTargetInfo>({
            texture: atlas,
            clear_depth: 1.0,
            load_op: SDL_GPULoadOp.CLEAR,
            store_op: SDL_GPUStoreOp.STORE,
            stencil_load_op: SDL_GPULoadOp.DONT_CARE,
            stencil_store_op: SDL_GPUStoreOp.DONT_CARE,
            cycle: true,
        });

        const pass = SDL_BeginGPURenderPass(cmd, null, 0, target);
        target.free();

        if (pass === null) {
            console.log(`shadows: ${name} pass failed : ${stringFromCString(SDL_GetError())}`);
            return null;
        }

        const pipeline = this.pipeline;
        if (pipeline === null) {
            SDL_EndGPURenderPass(pass);
            return null;
        }
        SDL_BindGPUGraphicsPipeline(pass, pipeline);
        return pass;
    }

    /** Confine rasterisation to one tile. Both calls are needed; see the file header. */
    private setTile(pass: Pointer<SDL_GPURenderPass>, x: u32, y: u32, width: u32, height: u32): void {
        const viewport = alloc<SDL_GPUViewport>({
            x: cast<f32>(x),
            y: cast<f32>(y),
            w: cast<f32>(width),
            h: cast<f32>(height),
            min_depth: 0.0,
            max_depth: 1.0,
        });
        SDL_SetGPUViewport(pass, viewport);
        viewport.free();

        const scissor = alloc<SDL_Rect>({
            x: cast<i32>(x),
            y: cast<i32>(y),
            w: cast<i32>(width),
            h: cast<i32>(height),
        });
        SDL_SetGPUScissor(pass, scissor);
        scissor.free();
    }

    /**
     * Draw every caster this tile can actually record.
     *
     * **This is where a cascade stops paying for the whole scene.** Each
     * cascade is fitted to its own frustum *slice* — cascade 1 covers from
     * cascade 0's far plane outwards, not from the camera — so their volumes
     * are largely disjoint rather than nested. A crate two metres from the
     * camera is inside cascade 0's volume and outside cascade 3's, and used to
     * be rasterised into all four. It contributed nothing to three of them: the
     * only fragments that read cascade 3 are beyond cascade 2's split, and the
     * crate's shadow does not reach them.
     *
     * The test asks the narrower question, which is the one that is safe to ask:
     * would any fragment of this object survive clipping against this tile's
     * volume? The frustum comes from the tile's own matrix, so a rejection here
     * is a rejection the rasteriser was going to make anyway — see
     * `scene/frustum.ts`. Nothing about which cascade a *receiver* samples
     * enters into it, and so nothing about the cascade blend band can break it.
     *
     * The same test serves the spotlights, where it is worth more: a spot has a
     * range of a few metres and a cone narrower than that, and the scene it was
     * being handed is the whole world.
     */
    private drawScene(
        cmd: Pointer<SDL_GPUCommandBuffer>,
        pass: Pointer<SDL_GPURenderPass>,
        scene: Reference<Scene>,
        viewProj: fmat4,
        view: Pointer<ShadowViewUniform>,
        viewBytes: u32,
    ): void {
        view.viewProj = viewProj;
        this.frustum.build(viewProj);

        for (let i: usize = 0; i < scene.instances.length; i++) {
            if (!this.frustum.containsSphere(scene.instances[i].boundsCenter, scene.instances[i].boundsRadius)) {
                continue;
            }

            view.model = scene.instances[i].transform;
            SDL_PushGPUVertexUniformData(cmd, 0, view, viewBytes);
            scene.meshes[scene.instances[i].mesh].draw(pass);
        }
    }

    release(device: Pointer<SDL_GPUDevice>): void {
        const pipeline = this.pipeline;
        if (pipeline !== null) {
            SDL_ReleaseGPUGraphicsPipeline(device, pipeline);
        }
        this.pipeline = null;
    }
}
