// Graphics pipeline construction.
//
// Three shapes cover every pass in this renderer, and the differences between
// them are exactly the ones worth spelling out:
//
//   * **Depth-only** — the pre-pass and both shadow passes. No colour target,
//     depth written, one vertex attribute fetched out of four.
//   * **Mesh colour** — the forward pass. Depth tested `EQUAL` against the
//     pre-pass and *not* written.
//   * **Fullscreen** — SSAO, its blur, and the tonemap. No vertex buffer at all.
//
// The vertex layout is declared per pipeline rather than globally, so a pass
// that only needs positions says so and the other three attributes are never
// fetched.

import {
    SDL_CreateGPUGraphicsPipeline,
    SDL_GetError,
    type SDL_GPUColorTargetDescription,
    SDL_GPUCompareOp,
    SDL_GPUCullMode,
    type SDL_GPUDevice,
    SDL_GPUFrontFace,
    type SDL_GPUGraphicsPipeline,
    type SDL_GPUGraphicsPipelineCreateInfo,
    type SDL_GPUShader,
    SDL_GPUTextureFormat,
    type SDL_GPUVertexAttribute,
    type SDL_GPUVertexBufferDescription,
    SDL_GPUVertexElementFormat,
    SDL_GPUVertexInputRate,
} from "../../bindings/SDL3";
import { vertexStride } from "../geometry/meshdata.ts";

/**
 * The mesh vertex attributes, `count` of them. Released with `freeArray`.
 *
 * Offsets are into the interleaved stream `meshdata.ts` builds: position at 0,
 * normal at 12, UV at 24. Asking for fewer than three is how the depth-only
 * pipelines avoid fetching normals nothing reads.
 *
 * `allocArray` rather than a `FixedArray`, and the reason is worth knowing
 * before reaching for the other one. A fixed array decays to `Pointer<T>` only
 * where `T` is a primitive: for a struct, `Pointer<T>` is `T & CorePointer<T>`
 * and carries `T`'s own members, which a `FixedArray<T, N>` does not have. On
 * this struct in particular the two also collide — `SDL_GPUVertexAttribute` has
 * a field called `offset` and `CorePointer` has a method by that name.
 */
function meshAttributes(count: u32): Pointer<SDL_GPUVertexAttribute> {
    const attributes = allocArray<SDL_GPUVertexAttribute>(cast<usize>(count));

    attributes[0].location = 0;
    attributes[0].buffer_slot = 0;
    attributes[0].format = SDL_GPUVertexElementFormat.FLOAT3;
    attributes[0].offset = 0;

    if (count > 1) {
        attributes[1].location = 1;
        attributes[1].buffer_slot = 0;
        attributes[1].format = SDL_GPUVertexElementFormat.FLOAT3;
        attributes[1].offset = 12;
    }

    if (count > 2) {
        attributes[2].location = 2;
        attributes[2].buffer_slot = 0;
        attributes[2].format = SDL_GPUVertexElementFormat.FLOAT2;
        attributes[2].offset = 24;
    }

    return attributes;
}

/**
 * A depth-only pipeline, optionally with rasteriser depth bias.
 *
 * The bias is the shadow passes' and the pre-pass leaves it off. It is applied
 * during *rasterisation of the caster*, scaled by the polygon's depth slope in
 * light space, which is the only bias that adapts to geometry — a constant
 * offset large enough for the steepest surface in the scene is far too large for
 * a floor, and detaching every contact shadow is how that shows up.
 *
 * `slopeFactor` multiplies the polygon's maximum depth slope; `constantFactor`
 * multiplies the smallest resolvable depth difference. Both are ignored unless
 * `slopeFactor` or `constantFactor` is non-zero.
 */
export function createDepthOnlyPipeline(
    device: Pointer<SDL_GPUDevice>,
    vertex: Pointer<SDL_GPUShader>,
    fragment: Pointer<SDL_GPUShader>,
    depthFormat: SDL_GPUTextureFormat,
    cull: SDL_GPUCullMode,
    constantFactor: f32,
    slopeFactor: f32,
    name: string,
): Pointer<SDL_GPUGraphicsPipeline> | null {
    const attributes = meshAttributes(1);
    const buffers = meshBufferDescription();
    const biased = constantFactor !== 0.0 || slopeFactor !== 0.0;

    const info = alloc<SDL_GPUGraphicsPipelineCreateInfo>({
        vertex_shader: vertex,
        fragment_shader: fragment,
        vertex_input_state: {
            vertex_buffer_descriptions: buffers,
            num_vertex_buffers: 1,
            vertex_attributes: attributes,
            num_vertex_attributes: 1,
        },
        rasterizer_state: {
            cull_mode: cull,
            front_face: SDL_GPUFrontFace.COUNTER_CLOCKWISE,
            enable_depth_clip: true,
            enable_depth_bias: biased,
            depth_bias_constant_factor: constantFactor,
            depth_bias_slope_factor: slopeFactor,
            // Unclamped. A clamp exists to stop a polygon seen almost edge-on
            // from being pushed an absurd distance, but that case is already
            // handled here by the receiver's normal offset, which grows with
            // exactly the same obliquity.
            depth_bias_clamp: 0.0,
        },
        depth_stencil_state: {
            compare_op: SDL_GPUCompareOp.LESS,
            enable_depth_test: true,
            enable_depth_write: true,
        },
        target_info: {
            num_color_targets: 0,
            depth_stencil_format: depthFormat,
            has_depth_stencil_target: true,
        },
    });

    const pipeline = SDL_CreateGPUGraphicsPipeline(device, info);
    info.free();
    attributes.freeArray();
    buffers.freeArray();

    if (pipeline === null) {
        console.log(`pipeline: '${name}' failed : ${stringFromCString(SDL_GetError())}`);
    }
    return pipeline;
}

/**
 * The forward pipeline: one HDR colour target, depth tested `EQUAL`.
 *
 * `EQUAL` and not `LESS_OR_EQUAL`, and depth writes **off**. The pre-pass has
 * already established the nearest surface at every pixel, so a fragment either
 * is that surface or is not, and testing for equality is what turns the light
 * loop into something that runs exactly once per pixel. It also means the
 * pre-pass and this pass must transform vertices *identically* — same matrices,
 * same order of operations — or fragments fail the test and vanish.
 */
export function createForwardPipeline(
    device: Pointer<SDL_GPUDevice>,
    vertex: Pointer<SDL_GPUShader>,
    fragment: Pointer<SDL_GPUShader>,
    colorFormat: SDL_GPUTextureFormat,
    depthFormat: SDL_GPUTextureFormat,
    name: string,
): Pointer<SDL_GPUGraphicsPipeline> | null {
    const attributes = meshAttributes(3);
    const buffers = meshBufferDescription();

    const colorTarget = alloc<SDL_GPUColorTargetDescription>({
        format: colorFormat,
    });

    const info = alloc<SDL_GPUGraphicsPipelineCreateInfo>({
        vertex_shader: vertex,
        fragment_shader: fragment,
        vertex_input_state: {
            vertex_buffer_descriptions: buffers,
            num_vertex_buffers: 1,
            vertex_attributes: attributes,
            num_vertex_attributes: 3,
        },
        rasterizer_state: {
            cull_mode: SDL_GPUCullMode.BACK,
            front_face: SDL_GPUFrontFace.COUNTER_CLOCKWISE,
            enable_depth_clip: true,
        },
        depth_stencil_state: {
            compare_op: SDL_GPUCompareOp.EQUAL,
            enable_depth_test: true,
            enable_depth_write: false,
        },
        target_info: {
            num_color_targets: 1,
            color_target_descriptions: colorTarget,
            depth_stencil_format: depthFormat,
            has_depth_stencil_target: true,
        },
    });

    const pipeline = SDL_CreateGPUGraphicsPipeline(device, info);
    info.free();
    colorTarget.free();
    attributes.freeArray();
    buffers.freeArray();

    if (pipeline === null) {
        console.log(`pipeline: '${name}' failed : ${stringFromCString(SDL_GetError())}`);
    }
    return pipeline;
}

/**
 * A fullscreen pass: no vertex buffer, no depth.
 *
 * The three corners come from `@builtin(vertex_index)`, so the vertex input
 * state stays entirely empty — see `shaders/include/fullscreen.wgsl`.
 */
export function createFullscreenPipeline(
    device: Pointer<SDL_GPUDevice>,
    vertex: Pointer<SDL_GPUShader>,
    fragment: Pointer<SDL_GPUShader>,
    colorFormat: SDL_GPUTextureFormat,
    name: string,
): Pointer<SDL_GPUGraphicsPipeline> | null {
    const colorTarget = alloc<SDL_GPUColorTargetDescription>({
        format: colorFormat,
    });

    const info = alloc<SDL_GPUGraphicsPipelineCreateInfo>({
        vertex_shader: vertex,
        fragment_shader: fragment,
        rasterizer_state: {
            cull_mode: SDL_GPUCullMode.NONE,
            front_face: SDL_GPUFrontFace.COUNTER_CLOCKWISE,
        },
        target_info: {
            num_color_targets: 1,
            color_target_descriptions: colorTarget,
        },
    });

    const pipeline = SDL_CreateGPUGraphicsPipeline(device, info);
    info.free();
    colorTarget.free();

    if (pipeline === null) {
        console.log(`pipeline: '${name}' failed : ${stringFromCString(SDL_GetError())}`);
    }
    return pipeline;
}

/** One vertex buffer, per-vertex, at the interleaved stride. Released with `freeArray`. */
function meshBufferDescription(): Pointer<SDL_GPUVertexBufferDescription> {
    const buffers = allocArray<SDL_GPUVertexBufferDescription>(1);
    buffers[0].slot = 0;
    buffers[0].pitch = vertexStride();
    buffers[0].input_rate = SDL_GPUVertexInputRate.VERTEX;
    buffers[0].instance_step_rate = 0;
    return buffers;
}
