// Turning a compiled shader file into something SDL can bind.
//
// Nothing here decides what the resource counts are — they arrive as arguments,
// from `shaders.generated.ts`, which got them from `shadercc`'s own report on
// the shader being loaded. That indirection exists because SDL takes the counts
// on trust and cannot check them: a shader declaring a sampler its create-info
// does not mention gets no descriptor for it and samples zeroes, with no error
// raised anywhere.
//
// Nor does anything here decide which *file* to open. `build.ts` writes both a
// `.spv` and, on Windows, a `.dxil` for every entry point, and the manifest
// names neither: it hands over the path without an extension, because which
// bytecode is wanted is a property of the device that got opened rather than of
// the build that produced them.

import {
    SDL_CreateGPUComputePipeline,
    SDL_CreateGPUShader,
    SDL_free,
    SDL_GetError,
    SDL_GetGPUShaderFormats,
    type SDL_GPUComputePipeline,
    type SDL_GPUComputePipelineCreateInfo,
    type SDL_GPUDevice,
    type SDL_GPUShader,
    type SDL_GPUShaderCreateInfo,
    SDL_GPUShaderFormat,
    SDL_GPUShaderStage,
    SDL_LoadFile,
} from "../bindings/SDL3";

/**
 * The bytecode format to load for this device.
 *
 * SPIR-V first, because a device accepting it is the Vulkan backend and that is
 * the path everything here was developed against. DXIL is the D3D12 backend's,
 * translated from the same SPIR-V at build time.
 */
function bytecodeFormat(device: Pointer<SDL_GPUDevice>): SDL_GPUShaderFormat {
    const formats = SDL_GetGPUShaderFormats(device);
    if ((formats & SDL_GPUShaderFormat.SPIRV) !== SDL_GPUShaderFormat.INVALID) {
        return SDL_GPUShaderFormat.SPIRV;
    }
    if ((formats & SDL_GPUShaderFormat.DXIL) !== SDL_GPUShaderFormat.INVALID) {
        return SDL_GPUShaderFormat.DXIL;
    }
    return SDL_GPUShaderFormat.INVALID;
}

/** The extension `build.ts` wrote that format under. */
function extensionFor(format: SDL_GPUShaderFormat): string {
    return format === SDL_GPUShaderFormat.DXIL ? ".dxil" : ".spv";
}

/**
 * A graphics shader, with the counts SDL cannot work out for itself.
 *
 * `stem` is the compiled shader's path without an extension; the one that gets
 * opened depends on the device.
 */
export function loadShader(
    device: Pointer<SDL_GPUDevice>,
    stem: string,
    entrypoint: string,
    stage: SDL_GPUShaderStage,
    numSamplers: u32,
    numStorageTextures: u32,
    numStorageBuffers: u32,
    numUniformBuffers: u32,
): Pointer<SDL_GPUShader> | null {
    const format = bytecodeFormat(device);
    if (format === SDL_GPUShaderFormat.INVALID) {
        console.log("shader: this device takes neither SPIR-V nor DXIL, and nothing else was built");
        return null;
    }
    const path = `${stem}${extensionFor(format)}`;

    const size: FixedArray<usize, 1> = fixedArray(1, 0);
    const code = SDL_LoadFile(cstring(path), size);
    if (code === null) {
        console.log(`shader: cannot read ${path} : ${stringFromCString(SDL_GetError())}`);
        return null;
    }

    const info = alloc<SDL_GPUShaderCreateInfo>({
        code: code.reify<u8>(),
        code_size: size[0],
        entrypoint: cstring(entrypoint),
        format: format,
        stage: stage,
        num_samplers: numSamplers,
        num_storage_textures: numStorageTextures,
        num_storage_buffers: numStorageBuffers,
        num_uniform_buffers: numUniformBuffers,
    });

    const shader = SDL_CreateGPUShader(device, info);
    info.free();
    SDL_free(code);

    if (shader === null) {
        console.log(`shader: ${path} rejected : ${stringFromCString(SDL_GetError())}`);
    }
    return shader;
}

/**
 * A compute pipeline.
 *
 * The thread counts are the shader's own `@workgroup_size`, read out of the
 * WGSL by `build.ts`. SDL takes them on trust as well, and a mismatch is a
 * driver fault rather than a diagnostic.
 */
export function loadComputePipeline(
    device: Pointer<SDL_GPUDevice>,
    stem: string,
    entrypoint: string,
    numSamplers: u32,
    numReadonlyStorageTextures: u32,
    numReadonlyStorageBuffers: u32,
    numReadwriteStorageTextures: u32,
    numReadwriteStorageBuffers: u32,
    numUniformBuffers: u32,
    threadsX: u32,
    threadsY: u32,
    threadsZ: u32,
): Pointer<SDL_GPUComputePipeline> | null {
    const format = bytecodeFormat(device);
    if (format === SDL_GPUShaderFormat.INVALID) {
        console.log("shader: this device takes neither SPIR-V nor DXIL, and nothing else was built");
        return null;
    }
    const path = `${stem}${extensionFor(format)}`;

    const size: FixedArray<usize, 1> = fixedArray(1, 0);
    const code = SDL_LoadFile(cstring(path), size);
    if (code === null) {
        console.log(`shader: cannot read ${path} : ${stringFromCString(SDL_GetError())}`);
        return null;
    }

    const info = alloc<SDL_GPUComputePipelineCreateInfo>({
        code: code.reify<u8>(),
        code_size: size[0],
        entrypoint: cstring(entrypoint),
        format: format,
        num_samplers: numSamplers,
        num_readonly_storage_textures: numReadonlyStorageTextures,
        num_readonly_storage_buffers: numReadonlyStorageBuffers,
        num_readwrite_storage_textures: numReadwriteStorageTextures,
        num_readwrite_storage_buffers: numReadwriteStorageBuffers,
        num_uniform_buffers: numUniformBuffers,
        threadcount_x: threadsX,
        threadcount_y: threadsY,
        threadcount_z: threadsZ,
    });

    const pipeline = SDL_CreateGPUComputePipeline(device, info);
    info.free();
    SDL_free(code);

    if (pipeline === null) {
        console.log(`shader: ${path} rejected : ${stringFromCString(SDL_GetError())}`);
    }
    return pipeline;
}
