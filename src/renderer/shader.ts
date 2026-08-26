// Turning a `.spv` file into something SDL can bind.
//
// Nothing here decides what the resource counts are — they arrive as arguments,
// from `shaders.generated.ts`, which got them from `shadercc`'s own report on
// the shader being loaded. That indirection exists because SDL takes the counts
// on trust and cannot check them: a shader declaring a sampler its create-info
// does not mention gets no descriptor for it and samples zeroes, with no error
// raised anywhere.

import {
    SDL_CreateGPUComputePipeline,
    SDL_CreateGPUShader,
    SDL_free,
    SDL_GetError,
    type SDL_GPUComputePipeline,
    type SDL_GPUComputePipelineCreateInfo,
    type SDL_GPUDevice,
    type SDL_GPUShader,
    type SDL_GPUShaderCreateInfo,
    SDL_GPUShaderFormat,
    SDL_GPUShaderStage,
    SDL_LoadFile,
} from "../graphics/sdl/index.ts";

/**
 * A graphics shader, with the counts SDL cannot work out for itself.
 *
 * SPIR-V only. `SDL_CreateGPUDevice` was asked for SPIR-V and nothing else,
 * which on its own selects Vulkan.
 */
export function loadShader(
    device: Pointer<SDL_GPUDevice>,
    path: string,
    entrypoint: string,
    stage: SDL_GPUShaderStage,
    numSamplers: u32,
    numStorageTextures: u32,
    numStorageBuffers: u32,
    numUniformBuffers: u32,
): Pointer<SDL_GPUShader> | null {
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
        format: SDL_GPUShaderFormat.SPIRV,
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
    path: string,
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
        format: SDL_GPUShaderFormat.SPIRV,
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
