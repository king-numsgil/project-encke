// A triangle, on SDL_gpu's Vulkan backend.
//
// The shaders are WGSL, compiled to SPIR-V by tools/shadercc:
//
//     shadercc shaders/triangle.wgsl -e vs_main -o shaders/out -f spirv
//     shadercc shaders/triangle.wgsl -e fs_main -o shaders/out -f spirv
//
// The frame is drawn into an offscreen R8G8B8A8 texture and then blitted to the
// swapchain, rather than drawn straight into the swapchain. That costs a blit
// and buys the screenshot: a swapchain texture is the presentation engine's and
// is not a thing to read back, while an ordinary colour target is.
//
//     bin/app.exe                       — run until the window closes
//     bin/app.exe --screenshot out.png  — render a few frames, save one, exit

import { mi_calloc, mi_free, mi_malloc, mi_realloc } from "std/alloc";
import {
    SDL_AcquireGPUCommandBuffer,
    SDL_BeginGPUComputePass,
    SDL_BeginGPUCopyPass,
    SDL_BeginGPURenderPass,
    SDL_BindGPUComputePipeline,
    SDL_BindGPUFragmentSamplers,
    SDL_BindGPUGraphicsPipeline,
    SDL_BlitGPUTexture,
    SDL_ClaimWindowForGPUDevice,
    SDL_CreateGPUComputePipeline,
    SDL_CreateGPUDevice,
    SDL_CreateGPUGraphicsPipeline,
    SDL_CreateGPUSampler,
    SDL_CreateGPUShader,
    SDL_CreateGPUTexture,
    SDL_CreateGPUTransferBuffer,
    SDL_CreateSurfaceFrom,
    SDL_CreateWindow,
    SDL_DestroyGPUDevice,
    SDL_DestroySurface,
    SDL_DestroyWindow,
    SDL_DispatchGPUCompute,
    SDL_DownloadFromGPUTexture,
    SDL_DrawGPUPrimitives,
    SDL_EndGPUComputePass,
    SDL_EndGPUCopyPass,
    SDL_EndGPURenderPass,
    type SDL_Event,
    SDL_EventType,
    SDL_free,
    SDL_GetError,
    SDL_GetGPUDeviceDriver,
    SDL_GetPixelFormatFromGPUTextureFormat,
    SDL_GetRevision,
    SDL_GetVersion,
    SDL_GetWindowSizeInPixels,
    type SDL_GPUBlitInfo,
    type SDL_GPUColorTargetDescription,
    type SDL_GPUColorTargetInfo,
    type SDL_GPUComputePipeline,
    type SDL_GPUComputePipelineCreateInfo,
    type SDL_GPUDevice,
    SDL_GPUFilter,
    type SDL_GPUGraphicsPipelineCreateInfo,
    SDL_GPULoadOp,
    SDL_GPUSamplerAddressMode,
    type SDL_GPUSamplerCreateInfo,
    SDL_GPUSamplerMipmapMode,
    type SDL_GPUShader,
    type SDL_GPUShaderCreateInfo,
    SDL_GPUShaderFormat,
    SDL_GPUShaderStage,
    type SDL_GPUStorageTextureReadWriteBinding,
    SDL_GPUStoreOp,
    type SDL_GPUTexture,
    type SDL_GPUTextureCreateInfo,
    SDL_GPUTextureFormat,
    type SDL_GPUTextureRegion,
    type SDL_GPUTextureSamplerBinding,
    type SDL_GPUTextureTransferInfo,
    SDL_GPUTextureUsageFlags,
    type SDL_GPUTransferBufferCreateInfo,
    SDL_GPUTransferBufferUsage,
    SDL_Init,
    SDL_InitFlags,
    SDL_LoadFile,
    SDL_MapGPUTransferBuffer,
    SDL_PollEvent,
    SDL_PushGPUFragmentUniformData,
    SDL_Quit,
    SDL_ReleaseGPUComputePipeline,
    SDL_ReleaseGPUGraphicsPipeline,
    SDL_ReleaseGPUSampler,
    SDL_ReleaseGPUShader,
    SDL_ReleaseGPUTexture,
    SDL_ReleaseGPUTransferBuffer,
    SDL_ReleaseWindowFromGPUDevice,
    SDL_SavePNG,
    SDL_Scancode,
    SDL_SetMemoryFunctions,
    SDL_SubmitGPUCommandBuffer,
    SDL_UnmapGPUTransferBuffer,
    SDL_WaitAndAcquireGPUSwapchainTexture,
    SDL_WaitForGPUIdle,
    SDL_WindowFlags,
} from "./graphics/sdl";

/**
 * Read a `.spv` file and hand it to SDL as a shader.
 *
 * `num_uniform_buffers` is not something SDL works out for itself — it takes
 * the number on trust. These are the ones `shadercc` reported for each entry
 * point: none for the vertex shader, one for the fragment shader's `tint`.
 */
function loadShader(
    device: Pointer<SDL_GPUDevice>,
    path: string,
    entrypoint: string,
    stage: SDL_GPUShaderStage,
    numSamplers: u32,
    numUniformBuffers: u32,
): Pointer<SDL_GPUShader> | null {
    const size: FixedArray<usize, 1> = fixedArray(1, 0);
    const code = SDL_LoadFile(cstring(path), size);
    if (code === null) {
        console.log(`Failed to read ${path} : ${stringFromCString(SDL_GetError())}`);
        return null;
    }

    const info = alloc<SDL_GPUShaderCreateInfo>({
        code: code.reify<u8>(),
        code_size: size[0],
        entrypoint: cstring(entrypoint),
        format: SDL_GPUShaderFormat.SPIRV,
        stage: stage,
        num_samplers: numSamplers,
        num_uniform_buffers: numUniformBuffers,
    });

    const shader = SDL_CreateGPUShader(device, info);
    info.free();
    SDL_free(code);

    if (shader === null) {
        console.log(`Failed to create shader from ${path} : ${stringFromCString(SDL_GetError())}`);
    }
    return shader;
}

/**
 * Read a `.spv` file and build a compute pipeline from it.
 *
 * The resource counts and the thread counts are the ones `shadercc` reported
 * for `checker.wgsl`. SDL takes all of them on trust; the thread counts in
 * particular have to match the shader's own `@workgroup_size`.
 */
function loadComputePipeline(
    device: Pointer<SDL_GPUDevice>,
    path: string,
    entrypoint: string,
): Pointer<SDL_GPUComputePipeline> | null {
    const size: FixedArray<usize, 1> = fixedArray(1, 0);
    const code = SDL_LoadFile(cstring(path), size);
    if (code === null) {
        console.log(`Failed to read ${path} : ${stringFromCString(SDL_GetError())}`);
        return null;
    }

    const info = alloc<SDL_GPUComputePipelineCreateInfo>({
        code: code.reify<u8>(),
        code_size: size[0],
        entrypoint: cstring(entrypoint),
        format: SDL_GPUShaderFormat.SPIRV,
        num_readwrite_storage_textures: 1,
        threadcount_x: 8,
        threadcount_y: 8,
        threadcount_z: 1,
    });

    const pipeline = SDL_CreateGPUComputePipeline(device, info);
    info.free();
    SDL_free(code);

    if (pipeline === null) {
        console.log(`Compute pipeline creation failed : ${stringFromCString(SDL_GetError())}`);
    }
    return pipeline;
}

/**
 * Run the checkerboard generator once, filling `texture`.
 *
 * The read-write binding is declared at the pass rather than per dispatch —
 * that is how the driver learns which resources the pass writes to, and why it
 * cannot be rebound partway through.
 */
function generateTexture(
    device: Pointer<SDL_GPUDevice>,
    pipeline: Pointer<SDL_GPUComputePipeline>,
    texture: Pointer<SDL_GPUTexture>,
    size: u32,
): boolean {
    const cmd = SDL_AcquireGPUCommandBuffer(device);
    if (cmd === null) {
        console.log(`Command buffer acquisition failed : ${stringFromCString(SDL_GetError())}`);
        return false;
    }

    const binding = alloc<SDL_GPUStorageTextureReadWriteBinding>({
        texture: texture,
        cycle: true,
    });
    const pass = SDL_BeginGPUComputePass(cmd, binding, 1, null, 0);
    binding.free();

    if (pass === null) {
        console.log(`Compute pass failed : ${stringFromCString(SDL_GetError())}`);
        SDL_SubmitGPUCommandBuffer(cmd);
        return false;
    }

    SDL_BindGPUComputePipeline(pass, pipeline);
    // One thread per texel, in 8x8 groups — the shader's `@workgroup_size`.
    SDL_DispatchGPUCompute(pass, size / 8, size / 8, 1);
    SDL_EndGPUComputePass(pass);

    return SDL_SubmitGPUCommandBuffer(cmd);
}

/**
 * Read the offscreen texture back and write it out as a PNG.
 *
 * The download is recorded on its own command buffer and then waited on:
 * nothing may read the transfer buffer until the copy has actually run, and
 * `SDL_WaitForGPUIdle` is the blunt way to be sure of that. A frame loop would
 * use a fence; a one-shot screenshot does not need the ceremony.
 */
function saveScreenshot(
    device: Pointer<SDL_GPUDevice>,
    texture: Pointer<SDL_GPUTexture>,
    width: u32,
    height: u32,
    path: string,
): boolean {
    const bufferInfo = alloc<SDL_GPUTransferBufferCreateInfo>({
        usage: SDL_GPUTransferBufferUsage.DOWNLOAD,
        size: width * height * 4,
    });
    const transfer = SDL_CreateGPUTransferBuffer(device, bufferInfo);
    bufferInfo.free();
    if (transfer === null) {
        console.log(`Transfer buffer creation failed : ${stringFromCString(SDL_GetError())}`);
        return false;
    }

    const cmd = SDL_AcquireGPUCommandBuffer(device);
    if (cmd === null) {
        console.log(`Command buffer acquisition failed : ${stringFromCString(SDL_GetError())}`);
        SDL_ReleaseGPUTransferBuffer(device, transfer);
        return false;
    }

    const source = alloc<SDL_GPUTextureRegion>({
        texture: texture,
        w: width,
        h: height,
        d: 1,
    });

    const destination = alloc<SDL_GPUTextureTransferInfo>({
        transfer_buffer: transfer,
        // Zero would mean "tightly packed", which is the same thing here;
        // written out because the pitch is what the surface below is built from.
        pixels_per_row: width,
        rows_per_layer: height,
    });

    const copyPass = SDL_BeginGPUCopyPass(cmd);
    if (copyPass === null) {
        console.log(`Copy pass failed : ${stringFromCString(SDL_GetError())}`);
        source.free();
        destination.free();
        SDL_ReleaseGPUTransferBuffer(device, transfer);
        return false;
    }
    SDL_DownloadFromGPUTexture(copyPass, source, destination);
    SDL_EndGPUCopyPass(copyPass);
    source.free();
    destination.free();

    SDL_SubmitGPUCommandBuffer(cmd);
    SDL_WaitForGPUIdle(device);

    const pixels = SDL_MapGPUTransferBuffer(device, transfer, false);
    if (pixels === null) {
        console.log(`Mapping the transfer buffer failed : ${stringFromCString(SDL_GetError())}`);
        SDL_ReleaseGPUTransferBuffer(device, transfer);
        return false;
    }

    // The GPU format and the surface format are the same bytes under two
    // spellings, and SDL knows the translation — no need to guess at whether
    // R8G8B8A8 is ABGR8888 on this endianness.
    const surface = SDL_CreateSurfaceFrom(
        cast<i32>(width),
        cast<i32>(height),
        SDL_GetPixelFormatFromGPUTextureFormat(SDL_GPUTextureFormat.R8G8B8A8_UNORM),
        pixels,
        cast<i32>(width * 4),
    );

    let saved = false;
    if (surface === null) {
        console.log(`Surface creation failed : ${stringFromCString(SDL_GetError())}`);
    } else {
        saved = SDL_SavePNG(surface, cstring(path));
        if (!saved) {
            console.log(`Saving ${path} failed : ${stringFromCString(SDL_GetError())}`);
        }
        SDL_DestroySurface(surface);
    }

    SDL_UnmapGPUTransferBuffer(device, transfer);
    SDL_ReleaseGPUTransferBuffer(device, transfer);
    return saved;
}

export function main(args: string[]): i32 {
    // SDL allocates from the same heap the program does. Before SDL_Init, so
    // that nothing has been taken from SDL's own allocator yet.
    if (!SDL_SetMemoryFunctions(mi_malloc, mi_calloc, mi_realloc, mi_free)) {
        console.log(`Failed to set SDL3's memory functions : ${stringFromCString(SDL_GetError())}`);
    }

    let screenshotPath = "";
    for (let i: usize = 0; i < args.length; i++) {
        if (args[i] === "--screenshot" && i + 1 < args.length) {
            screenshotPath = args[i + 1];
        }
    }

    console.log(`SDL Version : ${SDL_GetVersion()}`);
    console.log(`SDL Revision : ${stringFromCString(SDL_GetRevision())}`);

    if (!SDL_Init(SDL_InitFlags.VIDEO)) {
        console.log(`Failed to init SDL3 : ${stringFromCString(SDL_GetError())}`);
        return -1;
    }

    const wnd = SDL_CreateWindow(cstring("Goblin Forge — SDL3 GPU triangle"), 1280, 720, SDL_WindowFlags.NONE);
    if (wnd === null) {
        console.log(`Window creation failed : ${stringFromCString(SDL_GetError())}`);
        SDL_Quit();
        return -1;
    }

    // SPIR-V is the only format asked for, which on its own is enough to select
    // Vulkan — no other backend accepts it. Naming the driver anyway means a
    // machine with a broken Vulkan loader fails here rather than silently
    // running somewhere else.
    const device = SDL_CreateGPUDevice(SDL_GPUShaderFormat.SPIRV, true, cstring("vulkan"));
    if (device === null) {
        console.log(`GPU device creation failed : ${stringFromCString(SDL_GetError())}`);
        SDL_DestroyWindow(wnd);
        SDL_Quit();
        return -1;
    }

    const driver = SDL_GetGPUDeviceDriver(device);
    console.log(`GPU driver : ${driver === null ? "?" : stringFromCString(driver)}`);

    if (!SDL_ClaimWindowForGPUDevice(device, wnd)) {
        console.log(`Claiming the window failed : ${stringFromCString(SDL_GetError())}`);
        SDL_DestroyGPUDevice(device);
        SDL_DestroyWindow(wnd);
        SDL_Quit();
        return -1;
    }

    // The counts are `shadercc`'s output for each entry point, and SDL takes
    // them on trust — a shader that declares a sampler the create-info does not
    // mention gets no descriptor for it, and samples zeroes.
    const vertexShader = loadShader(
        device,
        "shaders/out/triangle.vs_main.spv",
        "vs_main",
        SDL_GPUShaderStage.VERTEX,
        0,
        0,
    );
    const fragmentShader = loadShader(
        device,
        "shaders/out/triangle.fs_main.spv",
        "fs_main",
        SDL_GPUShaderStage.FRAGMENT,
        1,
        1,
    );
    if (vertexShader === null || fragmentShader === null) {
        SDL_ReleaseWindowFromGPUDevice(device, wnd);
        SDL_DestroyGPUDevice(device);
        SDL_DestroyWindow(wnd);
        SDL_Quit();
        return -1;
    }

    const width: FixedArray<i32, 1> = fixedArray(1, 0);
    const height: FixedArray<i32, 1> = fixedArray(1, 0);
    SDL_GetWindowSizeInPixels(wnd, width, height);
    const texWidth = cast<u32>(width[0]);
    const texHeight = cast<u32>(height[0]);

    // The pipeline's colour target format has to match what it renders into,
    // which is the offscreen texture rather than the swapchain.
    const textureInfo = alloc<SDL_GPUTextureCreateInfo>({
        format: SDL_GPUTextureFormat.R8G8B8A8_UNORM,
        // SAMPLER as well as COLOR_TARGET: SDL_BlitGPUTexture reads its source
        // through a sampler, so a plain colour target cannot be blitted from.
        usage: SDL_GPUTextureUsageFlags.COLOR_TARGET | SDL_GPUTextureUsageFlags.SAMPLER,
        width: texWidth,
        height: texHeight,
        layer_count_or_depth: 1,
        num_levels: 1,
    });
    const offscreen = SDL_CreateGPUTexture(device, textureInfo);
    textureInfo.free();
    if (offscreen === null) {
        console.log(`Offscreen texture creation failed : ${stringFromCString(SDL_GetError())}`);
        SDL_ReleaseGPUShader(device, vertexShader);
        SDL_ReleaseGPUShader(device, fragmentShader);
        SDL_ReleaseWindowFromGPUDevice(device, wnd);
        SDL_DestroyGPUDevice(device);
        SDL_DestroyWindow(wnd);
        SDL_Quit();
        return -1;
    }

    // The texture the compute shader fills and the fragment shader samples.
    // COMPUTE_STORAGE_WRITE to be written through `textureStore`, SAMPLER to be
    // read through a sampler afterwards.
    const checkerSize: u32 = 256;
    const checkerInfo = alloc<SDL_GPUTextureCreateInfo>({
        format: SDL_GPUTextureFormat.R8G8B8A8_UNORM,
        usage: SDL_GPUTextureUsageFlags.COMPUTE_STORAGE_WRITE | SDL_GPUTextureUsageFlags.SAMPLER,
        width: checkerSize,
        height: checkerSize,
        layer_count_or_depth: 1,
        num_levels: 1,
    });
    const checker = SDL_CreateGPUTexture(device, checkerInfo);
    checkerInfo.free();

    const computePipeline = loadComputePipeline(device, "shaders/out/checker.generate.spv", "generate");

    // NEAREST throughout, so the checkerboard edges stay exactly on texel
    // boundaries and a screenshot can be checked against the shader's own
    // arithmetic rather than against whatever a filter did to it.
    const samplerInfo = alloc<SDL_GPUSamplerCreateInfo>({
        min_filter: SDL_GPUFilter.NEAREST,
        mag_filter: SDL_GPUFilter.NEAREST,
        mipmap_mode: SDL_GPUSamplerMipmapMode.NEAREST,
        address_mode_u: SDL_GPUSamplerAddressMode.CLAMP_TO_EDGE,
        address_mode_v: SDL_GPUSamplerAddressMode.CLAMP_TO_EDGE,
        address_mode_w: SDL_GPUSamplerAddressMode.CLAMP_TO_EDGE,
    });
    const sampler = SDL_CreateGPUSampler(device, samplerInfo);
    samplerInfo.free();

    if (checker === null || computePipeline === null || sampler === null) {
        console.log(`Texture, compute pipeline or sampler creation failed : ${stringFromCString(SDL_GetError())}`);
        SDL_ReleaseGPUTexture(device, offscreen);
        SDL_ReleaseGPUShader(device, vertexShader);
        SDL_ReleaseGPUShader(device, fragmentShader);
        SDL_ReleaseWindowFromGPUDevice(device, wnd);
        SDL_DestroyGPUDevice(device);
        SDL_DestroyWindow(wnd);
        SDL_Quit();
        return -1;
    }

    if (!generateTexture(device, computePipeline, checker, checkerSize)) {
        console.log(`Compute dispatch failed : ${stringFromCString(SDL_GetError())}`);
    }

    const colorTarget = alloc<SDL_GPUColorTargetDescription>({
        format: SDL_GPUTextureFormat.R8G8B8A8_UNORM,
    });

    // Everything left out — TRIANGLELIST, FILL, CULL_NONE, COUNTER_CLOCKWISE,
    // one sample — is zero, and the initialiser zeroes what it does not name.
    // Culling stays off on purpose: whether the winding comes out clockwise
    // depends on the Y-flip convention, and a triangle that vanishes is a poor
    // test of a binding layout.
    const pipelineInfo = alloc<SDL_GPUGraphicsPipelineCreateInfo>({
        vertex_shader: vertexShader,
        fragment_shader: fragmentShader,
        target_info: {
            num_color_targets: 1,
            color_target_descriptions: colorTarget,
        },
    });

    const pipeline = SDL_CreateGPUGraphicsPipeline(device, pipelineInfo);
    pipelineInfo.free();
    colorTarget.free();

    // The shaders are baked into the pipeline now.
    SDL_ReleaseGPUShader(device, vertexShader);
    SDL_ReleaseGPUShader(device, fragmentShader);

    if (pipeline === null) {
        console.log(`Pipeline creation failed : ${stringFromCString(SDL_GetError())}`);
        SDL_ReleaseGPUTexture(device, offscreen);
        SDL_ReleaseWindowFromGPUDevice(device, wnd);
        SDL_DestroyGPUDevice(device);
        SDL_DestroyWindow(wnd);
        SDL_Quit();
        return -1;
    }

    console.log(`Rendering ${texWidth}x${texHeight}`);

    // The fragment shader's `tint`, pushed to uniform slot 0 — descriptor set 3
    // once shadercc has placed it. Not 1.0 across the board, so that a binding
    // that silently failed reads as a wrong colour rather than as no change.
    const tint: FixedArray<f32, 4> = fixedArray(4, 1.0);
    tint[0] = 1.0;
    tint[1] = 0.85;
    tint[2] = 0.7;
    tint[3] = 1.0;

    const event = alloc<SDL_Event>();
    const swapchain = allocArray<Pointer<SDL_GPUTexture>>(1);
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

        const cmd = SDL_AcquireGPUCommandBuffer(device);
        if (cmd === null) {
            console.log(`Command buffer acquisition failed : ${stringFromCString(SDL_GetError())}`);
            running = false;
            continue;
        }

        // Blocks until the swapchain has an image free, which is what paces
        // this loop to the display rather than to a spin.
        if (!SDL_WaitAndAcquireGPUSwapchainTexture(cmd, wnd, swapchain, null, null)) {
            console.log(`Swapchain acquisition failed : ${stringFromCString(SDL_GetError())}`);
            SDL_SubmitGPUCommandBuffer(cmd);
            running = false;
            continue;
        }

        const target = alloc<SDL_GPUColorTargetInfo>({
            texture: offscreen,
            clear_color: {r: 0.07, g: 0.09, b: 0.13, a: 1.0},
            load_op: SDL_GPULoadOp.CLEAR,
            store_op: SDL_GPUStoreOp.STORE,
        });

        const pass = SDL_BeginGPURenderPass(cmd, target, 1, null);
        target.free();
        if (pass === null) {
            console.log(`Render pass failed : ${stringFromCString(SDL_GetError())}`);
            SDL_SubmitGPUCommandBuffer(cmd);
            running = false;
            continue;
        }

        SDL_BindGPUGraphicsPipeline(pass, pipeline);

        // The pair under test: SDL takes a texture and a sampler together, and
        // whether that reaches a WGSL shader's two separate descriptors is the
        // question the screenshot answers.
        const texBinding = alloc<SDL_GPUTextureSamplerBinding>({
            texture: checker,
            sampler: sampler,
        });
        SDL_BindGPUFragmentSamplers(pass, 0, texBinding, 1);
        texBinding.free();

        SDL_PushGPUFragmentUniformData(cmd, 0, tint, 16);
        SDL_DrawGPUPrimitives(pass, 3, 1, 0, 0);
        SDL_EndGPURenderPass(pass);

        // Nothing to present to if the window is minimised — the acquire hands
        // back a null texture and says so by succeeding.
        if (swapchain[0].address !== 0) {
            const blit = alloc<SDL_GPUBlitInfo>({
                source: {texture: offscreen, w: texWidth, h: texHeight},
                destination: {texture: swapchain[0], w: texWidth, h: texHeight},
                load_op: SDL_GPULoadOp.DONT_CARE,
                filter: SDL_GPUFilter.NEAREST,
            });
            SDL_BlitGPUTexture(cmd, blit);
            blit.free();
        }

        SDL_SubmitGPUCommandBuffer(cmd);

        frame += 1;

        // A couple of frames in: late enough that the swapchain has settled,
        // early enough that an unattended run finishes quickly.
        if (screenshotPath.length > 0 && !captured && frame >= 3) {
            captured = true;
            if (saveScreenshot(device, offscreen, texWidth, texHeight, screenshotPath)) {
                console.log(`Wrote ${screenshotPath}`);
            }
            // The compute-generated texture, straight out of the GPU. Separates
            // "the compute shader did not run" from "the fragment shader could
            // not read what it wrote".
            if (saveScreenshot(device, checker, checkerSize, checkerSize, "checker.png")) {
                console.log("Wrote checker.png");
            }
            running = false;
        }
    }

    swapchain.freeArray();
    event.free();

    SDL_WaitForGPUIdle(device);
    SDL_ReleaseGPUGraphicsPipeline(device, pipeline);
    SDL_ReleaseGPUComputePipeline(device, computePipeline);
    SDL_ReleaseGPUSampler(device, sampler);
    SDL_ReleaseGPUTexture(device, checker);
    SDL_ReleaseGPUTexture(device, offscreen);
    SDL_ReleaseWindowFromGPUDevice(device, wnd);
    SDL_DestroyGPUDevice(device);
    SDL_DestroyWindow(wnd);
    SDL_Quit();
    return 0;
}
