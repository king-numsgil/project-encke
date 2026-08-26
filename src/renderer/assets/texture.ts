// Decoding an image file into a sampled GPU texture, with mipmaps.
//
// Not `IMG_LoadGPUTexture`, which would be one call instead of this whole file.
// That call gives back a texture with a single mip level, and a single mip level
// on a 1K brick texture across a scene this size aliases badly — a crate twenty
// metres away samples a handful of texels per pixel and crawls as the camera
// moves. Generating the chain needs the texture created with `num_levels`
// up front, which means creating it here rather than having it handed back.
//
// The **format is the other reason**. A colour map is authored in sRGB and must
// be sampled through an `_SRGB` format so the hardware linearises it before
// filtering; roughness, occlusion and normals are linear data and must not be.
// Getting that backwards is not subtle — an sRGB roughness map reads as a
// mirror — and `IMG_LoadGPUTexture` has no parameter to say which is which.

import {
    SDL_AcquireGPUCommandBuffer,
    SDL_BeginGPUCopyPass,
    SDL_ConvertSurface,
    SDL_CreateGPUTexture,
    SDL_CreateGPUTransferBuffer,
    SDL_DestroySurface,
    SDL_EndGPUCopyPass,
    SDL_GenerateMipmapsForGPUTexture,
    SDL_GetError,
    type SDL_GPUDevice,
    type SDL_GPUTexture,
    type SDL_GPUTextureCreateInfo,
    SDL_GPUTextureFormat,
    type SDL_GPUTextureRegion,
    type SDL_GPUTextureTransferInfo,
    type SDL_GPUTransferBuffer,
    type SDL_GPUTransferBufferCreateInfo,
    SDL_GPUTransferBufferUsage,
    SDL_GPUTextureUsageFlags,
    SDL_MapGPUTransferBuffer,
    SDL_PixelFormat,
    SDL_ReleaseGPUTexture,
    SDL_ReleaseGPUTransferBuffer,
    SDL_SetGPUTextureName,
    SDL_SubmitGPUCommandBuffer,
    type SDL_Surface,
    SDL_UnmapGPUTransferBuffer,
    SDL_UploadToGPUTexture,
    SDL_WaitForGPUIdle,
} from "../../bindings/SDL3";
import { IMG_Load } from "../../bindings/SDL3_image";

/**
 * How many mip levels a texture of this size has, down to 1x1.
 *
 * `floor(log2(max(w, h))) + 1`, computed by halving rather than with a log so
 * there is no float rounding to get wrong at a power of two.
 */
function mipLevelCount(width: u32, height: u32): u32 {
    let size = width > height ? width : height;
    let levels: u32 = 1;
    while (size > 1) {
        size = size / 2;
        levels += 1;
    }
    return levels;
}

/**
 * Load an image file as a sampled texture with a full mip chain.
 *
 * `srgb` must be true for colour maps and false for anything the shader reads as
 * data. Blocking — this is a load-time call and the texture is ready to bind
 * when it returns.
 */
export function loadTexture(
    device: Pointer<SDL_GPUDevice>,
    path: string,
    srgb: boolean,
    optional: boolean,
    name: string,
): Pointer<SDL_GPUTexture> | null {
    const decoded = IMG_Load(cstring(path));
    if (decoded === null) {
        // A material set is allowed to be missing a channel, and the caller has
        // a fallback ready — so an absent optional map is not worth a line that
        // reads like a failure. Anything else is.
        if (!optional) {
            console.log(`texture: cannot load ${path} : ${stringFromCString(SDL_GetError())}`);
        }
        return null;
    }

    // Whatever the file held, the upload path wants four bytes per pixel in a
    // known order. `RGBA32` is SDL's endianness-correct spelling of that, so
    // this is a no-op copy on a file that already matched.
    const surface = SDL_ConvertSurface(decoded, SDL_PixelFormat.RGBA32);
    SDL_DestroySurface(decoded);

    if (surface === null) {
        console.log(`texture: cannot convert ${path} : ${stringFromCString(SDL_GetError())}`);
        return null;
    }

    const width = cast<u32>(surface.w);
    const height = cast<u32>(surface.h);
    const texture = createTarget(device, width, height, srgb, name);

    if (texture === null) {
        SDL_DestroySurface(surface);
        return null;
    }

    if (!uploadAndGenerateMips(device, texture, surface, width, height)) {
        SDL_DestroySurface(surface);
        SDL_ReleaseGPUTexture(device, texture);
        return null;
    }

    SDL_DestroySurface(surface);
    return texture;
}

/**
 * The texture itself.
 *
 * `COLOR_TARGET` alongside `SAMPLER`, which looks wrong for something nothing
 * renders into — but `SDL_GenerateMipmapsForGPUTexture` builds each level by
 * drawing into it, so a texture without it cannot have a mip chain generated.
 */
function createTarget(
    device: Pointer<SDL_GPUDevice>,
    width: u32,
    height: u32,
    srgb: boolean,
    name: string,
): Pointer<SDL_GPUTexture> | null {
    const info = alloc<SDL_GPUTextureCreateInfo>({
        format: srgb ? SDL_GPUTextureFormat.R8G8B8A8_UNORM_SRGB : SDL_GPUTextureFormat.R8G8B8A8_UNORM,
        usage: SDL_GPUTextureUsageFlags.SAMPLER | SDL_GPUTextureUsageFlags.COLOR_TARGET,
        width: width,
        height: height,
        layer_count_or_depth: 1,
        num_levels: mipLevelCount(width, height),
    });
    const texture = SDL_CreateGPUTexture(device, info);
    info.free();

    if (texture === null) {
        console.log(`texture: '${name}' ${width}x${height} failed : ${stringFromCString(SDL_GetError())}`);
        return null;
    }

    SDL_SetGPUTextureName(device, texture, cstring(name));
    return texture;
}

/** Copy level 0 up, then let the driver build the rest. */
function uploadAndGenerateMips(
    device: Pointer<SDL_GPUDevice>,
    texture: Pointer<SDL_GPUTexture>,
    surface: Pointer<SDL_Surface>,
    width: u32,
    height: u32,
): boolean {
    const bytes = width * height * 4;

    const bufferInfo = alloc<SDL_GPUTransferBufferCreateInfo>({
        usage: SDL_GPUTransferBufferUsage.UPLOAD,
        size: bytes,
    });
    const transfer = SDL_CreateGPUTransferBuffer(device, bufferInfo);
    bufferInfo.free();

    if (transfer === null) {
        console.log(`texture: transfer buffer failed : ${stringFromCString(SDL_GetError())}`);
        return false;
    }

    const mapped = SDL_MapGPUTransferBuffer(device, transfer, false);
    const pixels = surface.pixels;
    if (mapped === null || pixels === null) {
        console.log(`texture: map failed : ${stringFromCString(SDL_GetError())}`);
        SDL_ReleaseGPUTransferBuffer(device, transfer);
        return false;
    }

    // Row by row rather than one run, because a surface's `pitch` is not
    // necessarily `w * 4` — SDL pads rows for alignment, and copying the whole
    // block would shear the image by the padding on every row after the first.
    const destination = mapped.reify<u8>();
    const source = pixels.reify<u8>();
    const pitch = cast<usize>(surface.pitch);
    const rowBytes = cast<usize>(width) * 4;

    for (let y: usize = 0; y < cast<usize>(height); y++) {
        const from = y * pitch;
        const to = y * rowBytes;
        for (let x: usize = 0; x < rowBytes; x++) {
            destination[to + x] = source[from + x];
        }
    }

    SDL_UnmapGPUTransferBuffer(device, transfer);

    const cmd = SDL_AcquireGPUCommandBuffer(device);
    if (cmd === null) {
        console.log(`texture: command buffer failed : ${stringFromCString(SDL_GetError())}`);
        SDL_ReleaseGPUTransferBuffer(device, transfer);
        return false;
    }

    const pass = SDL_BeginGPUCopyPass(cmd);
    if (pass === null) {
        console.log(`texture: copy pass failed : ${stringFromCString(SDL_GetError())}`);
        SDL_SubmitGPUCommandBuffer(cmd);
        SDL_ReleaseGPUTransferBuffer(device, transfer);
        return false;
    }

    const from = alloc<SDL_GPUTextureTransferInfo>({
        transfer_buffer: transfer,
        pixels_per_row: width,
        rows_per_layer: height,
    });
    const to = alloc<SDL_GPUTextureRegion>({
        texture: texture,
        w: width,
        h: height,
        d: 1,
    });

    SDL_UploadToGPUTexture(pass, from, to, false);
    SDL_EndGPUCopyPass(pass);
    from.free();
    to.free();

    // Outside the copy pass, on the command buffer itself — mipmap generation
    // is a sequence of draws, not a copy.
    SDL_GenerateMipmapsForGPUTexture(cmd, texture);

    SDL_SubmitGPUCommandBuffer(cmd);
    SDL_WaitForGPUIdle(device);
    SDL_ReleaseGPUTransferBuffer(device, transfer);
    return true;
}

/**
 * A 1x1 texture of one colour, for a material that has no map for a channel.
 *
 * The point is that shading needs no branch: a white albedo map multiplies to
 * the material's own colour, a flat `(0.5, 0.5, 1)` normal map decodes to
 * "unchanged", and a white roughness or occlusion map leaves the numeric
 * parameter alone. So an untextured material takes exactly the same code path
 * as a textured one and comes out looking exactly as it did before textures
 * existed.
 */
export function createSolidTexture(
    device: Pointer<SDL_GPUDevice>,
    r: u8,
    g: u8,
    b: u8,
    a: u8,
    name: string,
): Pointer<SDL_GPUTexture> | null {
    const info = alloc<SDL_GPUTextureCreateInfo>({
        format: SDL_GPUTextureFormat.R8G8B8A8_UNORM,
        usage: SDL_GPUTextureUsageFlags.SAMPLER,
        width: 1,
        height: 1,
        layer_count_or_depth: 1,
        num_levels: 1,
    });
    const texture = SDL_CreateGPUTexture(device, info);
    info.free();

    if (texture === null) {
        console.log(`texture: '${name}' failed : ${stringFromCString(SDL_GetError())}`);
        return null;
    }
    SDL_SetGPUTextureName(device, texture, cstring(name));

    const bufferInfo = alloc<SDL_GPUTransferBufferCreateInfo>({
        usage: SDL_GPUTransferBufferUsage.UPLOAD,
        size: 4,
    });
    const transfer: Pointer<SDL_GPUTransferBuffer> | null = SDL_CreateGPUTransferBuffer(device, bufferInfo);
    bufferInfo.free();

    if (transfer === null) {
        SDL_ReleaseGPUTexture(device, texture);
        return null;
    }

    const mapped = SDL_MapGPUTransferBuffer(device, transfer, false);
    if (mapped === null) {
        SDL_ReleaseGPUTransferBuffer(device, transfer);
        SDL_ReleaseGPUTexture(device, texture);
        return null;
    }

    const bytes = mapped.reify<u8>();
    bytes[0] = r;
    bytes[1] = g;
    bytes[2] = b;
    bytes[3] = a;
    SDL_UnmapGPUTransferBuffer(device, transfer);

    const cmd = SDL_AcquireGPUCommandBuffer(device);
    if (cmd === null) {
        SDL_ReleaseGPUTransferBuffer(device, transfer);
        SDL_ReleaseGPUTexture(device, texture);
        return null;
    }

    const pass = SDL_BeginGPUCopyPass(cmd);
    if (pass === null) {
        SDL_SubmitGPUCommandBuffer(cmd);
        SDL_ReleaseGPUTransferBuffer(device, transfer);
        SDL_ReleaseGPUTexture(device, texture);
        return null;
    }

    const from = alloc<SDL_GPUTextureTransferInfo>({
        transfer_buffer: transfer,
        pixels_per_row: 1,
        rows_per_layer: 1,
    });
    const to = alloc<SDL_GPUTextureRegion>({
        texture: texture,
        w: 1,
        h: 1,
        d: 1,
    });

    SDL_UploadToGPUTexture(pass, from, to, false);
    SDL_EndGPUCopyPass(pass);
    from.free();
    to.free();

    SDL_SubmitGPUCommandBuffer(cmd);
    SDL_WaitForGPUIdle(device);
    SDL_ReleaseGPUTransferBuffer(device, transfer);
    return texture;
}
