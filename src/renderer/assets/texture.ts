// Decoding an image into a sampled GPU texture, with mipmaps.
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
//
// Images arrive two ways and both end at the same `textureFromSurface`: a path
// on disk, for the material folders under `assets/materials/`, and a block of
// still-encoded bytes, for the images inside a glTF file. SDL3_image decodes
// both, which is the point of handing the bytes across the loader boundary
// rather than decoding them in Rust — one library in this program knows what a
// JPEG is.

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
    SDL_GPUTextureUsageFlags,
    type SDL_GPUTransferBuffer,
    type SDL_GPUTransferBufferCreateInfo,
    SDL_GPUTransferBufferUsage,
    SDL_IOFromConstMem,
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
import { IMG_Load, IMG_Load_IO } from "../../bindings/SDL3_image";

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
 * Whatever the file held, as four bytes per pixel in a known order.
 *
 * `RGBA32` is SDL's endianness-correct spelling of that, so this is a no-op
 * copy on a file that already matched. Consumes `decoded` either way.
 */
function toRgba(decoded: Pointer<SDL_Surface> | null, label: string): Pointer<SDL_Surface> | null {
    if (decoded === null) {
        return null;
    }

    const surface = SDL_ConvertSurface(decoded, SDL_PixelFormat.RGBA32);
    SDL_DestroySurface(decoded);

    if (surface === null) {
        console.log(`texture: cannot convert ${label} : ${stringFromCString(SDL_GetError())}`);
    }
    return surface;
}

/**
 * Decode a file into an RGBA surface, or null.
 *
 * A material set is allowed to be missing a channel and the caller has a
 * fallback ready, so an absent `optional` map is not worth a line that reads
 * like a failure. Anything else is.
 */
function decodeFile(path: string, optional: boolean): Pointer<SDL_Surface> | null {
    const decoded = IMG_Load(cstring(path));
    if (decoded === null) {
        if (!optional) {
            console.log(`texture: cannot load ${path} : ${stringFromCString(SDL_GetError())}`);
        }
        return null;
    }
    return toRgba(decoded, path);
}

/**
 * Decode an encoded image already in memory, or null.
 *
 * `closeio` is true, so the stream SDL wraps around the block is released
 * whether the decode worked or not. The block itself is the caller's — a glTF
 * image belongs to the loader until the whole scene is freed.
 */
function decodeMemory(bytes: Pointer<u8>, length: usize, label: string): Pointer<SDL_Surface> | null {
    const io = SDL_IOFromConstMem(bytes, length);
    if (io === null) {
        console.log(`texture: cannot wrap ${label} : ${stringFromCString(SDL_GetError())}`);
        return null;
    }

    const decoded = IMG_Load_IO(io, true);
    if (decoded === null) {
        console.log(`texture: cannot decode ${label} : ${stringFromCString(SDL_GetError())}`);
        return null;
    }
    return toRgba(decoded, label);
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

/** One decoded surface, uploaded as a texture with a full mip chain. */
function textureFromSurface(
    device: Pointer<SDL_GPUDevice>,
    surface: Pointer<SDL_Surface>,
    srgb: boolean,
    name: string,
): Pointer<SDL_GPUTexture> | null {
    const width = cast<u32>(surface.w);
    const height = cast<u32>(surface.h);
    const texture = createTarget(device, width, height, srgb, name);

    if (texture === null) {
        return null;
    }

    if (!uploadAndGenerateMips(device, texture, surface, null, width, height)) {
        SDL_ReleaseGPUTexture(device, texture);
        return null;
    }

    return texture;
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
    const surface = decodeFile(path, optional);
    if (surface === null) {
        return null;
    }

    const texture = textureFromSurface(device, surface, srgb, name);
    SDL_DestroySurface(surface);
    return texture;
}

/**
 * The same, for an image that is already in memory rather than on disk.
 *
 * This is the glTF path: a `.glb` carries its textures in its own binary chunk
 * and a `.gltf` may inline them as data URIs, so there is frequently no file to
 * open. `tools/gltf` hands the encoded bytes over untouched and they land here.
 */
export function loadTextureFromMemory(
    device: Pointer<SDL_GPUDevice>,
    bytes: Pointer<u8>,
    length: usize,
    srgb: boolean,
    name: string,
): Pointer<SDL_GPUTexture> | null {
    const surface = decodeMemory(bytes, length, name);
    if (surface === null) {
        return null;
    }

    const texture = textureFromSurface(device, surface, srgb, name);
    SDL_DestroySurface(surface);
    return texture;
}

/**
 * Two grayscale maps, packed into glTF's metallic-roughness layout.
 *
 * The shader samples one texture for both channels — `g` roughness, `b`
 * metallic — because that is how glTF packs them and because the two vary
 * together across a real surface. A folder under `assets/materials/` authors
 * them as separate grayscale files, so they are combined here rather than by
 * asking whoever produced the maps to re-export them.
 *
 * **Either may be absent**, and the missing channel becomes 255 rather than 0:
 * these are factors the shader multiplies its numeric parameters by, so one is
 * the identity and zero would silently pin a metal to a dielectric. That is the
 * same reasoning as the 1x1 white fallback, applied one channel at a time.
 *
 * A metallic map whose size disagrees with the roughness map is dropped with a
 * line in the log. Resampling it would be a legitimate thing to do and is not
 * worth the code for a case that means the two maps were authored apart.
 */
export function loadOrmTexture(
    device: Pointer<SDL_GPUDevice>,
    roughnessPath: string,
    metallicPath: string,
    name: string,
): Pointer<SDL_GPUTexture> | null {
    const roughness = decodeFile(roughnessPath, true);
    let metallic = decodeFile(metallicPath, true);

    if (roughness === null) {
        // Nothing to size the texture by. A metallic map on its own is not a
        // case worth inventing a size for.
        if (metallic !== null) {
            console.log(`texture: '${name}' has a metallic map but no roughness map — both ignored`);
            SDL_DestroySurface(metallic);
        }
        return null;
    }

    if (metallic !== null && (metallic.w !== roughness.w || metallic.h !== roughness.h)) {
        console.log(
            `texture: '${name}' metallic is ${metallic.w}x${metallic.h} and roughness is ` +
            `${roughness.w}x${roughness.h} — the metallic map is ignored`,
        );
        SDL_DestroySurface(metallic);
        metallic = null;
    }

    const width = cast<u32>(roughness.w);
    const height = cast<u32>(roughness.h);

    // Never sRGB. Both channels are numbers the BRDF uses directly, and a
    // transfer curve applied to a roughness is the classic way to get a
    // material that looks subtly, unfixably wrong.
    const texture = createTarget(device, width, height, false, name);
    if (texture === null) {
        SDL_DestroySurface(roughness);
        if (metallic !== null) {
            SDL_DestroySurface(metallic);
        }
        return null;
    }

    const ok = uploadAndGenerateMips(device, texture, roughness, metallic, width, height);

    SDL_DestroySurface(roughness);
    if (metallic !== null) {
        SDL_DestroySurface(metallic);
    }

    if (!ok) {
        SDL_ReleaseGPUTexture(device, texture);
        return null;
    }
    return texture;
}

/**
 * Copy level 0 up, then let the driver build the rest.
 *
 * `metallic` is the packing case and is null for an ordinary texture. When it
 * is present the upload stops being a copy: `source`'s red channel becomes
 * green and `metallic`'s becomes blue, which is glTF's metallic-roughness
 * layout — see {@link loadOrmTexture}.
 */
function uploadAndGenerateMips(
    device: Pointer<SDL_GPUDevice>,
    texture: Pointer<SDL_GPUTexture>,
    source: Pointer<SDL_Surface>,
    metallic: Pointer<SDL_Surface> | null,
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
    const pixels = source.pixels;
    if (mapped === null || pixels === null) {
        console.log(`texture: map failed : ${stringFromCString(SDL_GetError())}`);
        SDL_ReleaseGPUTransferBuffer(device, transfer);
        return false;
    }

    // Row by row rather than one run, because a surface's `pitch` is not
    // necessarily `w * 4` — SDL pads rows for alignment, and copying the whole
    // block would shear the image by the padding on every row after the first.
    const destination = mapped.reify<u8>();
    const from = pixels.reify<u8>();
    const pitch = cast<usize>(source.pitch);
    const rowBytes = cast<usize>(width) * 4;

    if (metallic === null) {
        for (let y: usize = 0; y < cast<usize>(height); y++) {
            const start = y * pitch;
            const to = y * rowBytes;
            for (let x: usize = 0; x < rowBytes; x++) {
                destination[to + x] = from[start + x];
            }
        }
    } else {
        // A decoded surface with no pixels is not a case that happens, but the
        // binding says it can be null and the loop below must not ask twice.
        const metallicPixels = metallic.pixels;
        const metal = metallicPixels === null ? from : metallicPixels.reify<u8>();
        const metalPitch = metallicPixels === null ? pitch : cast<usize>(metallic.pitch);
        const haveMetal = metallicPixels !== null;

        for (let y: usize = 0; y < cast<usize>(height); y++) {
            const roughRow = y * pitch;
            const metalRow = y * metalPitch;
            const to = y * rowBytes;

            for (let x: usize = 0; x < cast<usize>(width); x++) {
                // Red is where an author would pack occlusion. Nothing samples
                // it out of this texture — the occlusion map has a slot of its
                // own — so it is left at the identity rather than at zero.
                destination[to + x * 4] = 255;
                destination[to + x * 4 + 1] = from[roughRow + x * 4];
                destination[to + x * 4 + 2] = haveMetal ? metal[metalRow + x * 4] : 255;
                destination[to + x * 4 + 3] = 255;
            }
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

    const region = alloc<SDL_GPUTextureTransferInfo>({
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

    SDL_UploadToGPUTexture(pass, region, to, false);
    SDL_EndGPUCopyPass(pass);
    region.free();
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
 * "unchanged", and a white metallic-roughness or occlusion map leaves the
 * numeric parameters alone. So an untextured material takes exactly the same
 * code path as a textured one and comes out looking exactly as it did before
 * textures existed.
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
