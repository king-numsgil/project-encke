// HDR to the swapchain.
//
// Forward shading with physical falloff produces radiance well outside `[0, 1]`
// — a light two metres away is not 1.4 times brighter than one at three metres,
// it is 2.25 times — so the scene target is `R16G16B16A16_FLOAT` and something
// has to map it down. This is that something, and it is the last pass.
//
// The curve is Stephen Hill's fit to the ACES filmic tonemap: two 3x3 matrices
// around a rational function. It is a handful of instructions, it rolls
// highlights off instead of clipping them to white, and it desaturates as it
// does — which is what stops a bright light from becoming a flat magenta blob.

//!include "fullscreen.wgsl"

struct Tonemap {
    /**
     * `x`: exposure multiplier.
     * `y`: 1 if the swapchain encodes sRGB itself.
     * `z`: 1 to bypass the curve — a debug view is data, not radiance, and
     *      running a filmic curve over it would misreport every value it shows.
     * `w`: unused.
     */
    settings : vec4<f32>,
}

@group(2) @binding(0) var scene : texture_2d<f32>;
@group(2) @binding(1) var scene_sampler : sampler;
@group(3) @binding(0) var<uniform> tonemap : Tonemap;

fn aces_input(color : vec3<f32>) -> vec3<f32> {
    let m = mat3x3<f32>(
        vec3<f32>(0.59719, 0.07600, 0.02840),
        vec3<f32>(0.35458, 0.90834, 0.13383),
        vec3<f32>(0.04823, 0.01566, 0.83777),
    );
    return m * color;
}

fn aces_output(color : vec3<f32>) -> vec3<f32> {
    let m = mat3x3<f32>(
        vec3<f32>(1.60475, -0.10208, -0.00327),
        vec3<f32>(-0.53108, 1.10813, -0.07276),
        vec3<f32>(-0.07367, -0.00605, 1.07602),
    );
    return m * color;
}

fn aces_fitted(color : vec3<f32>) -> vec3<f32> {
    var v = aces_input(color);
    let a = v * (v + vec3<f32>(0.0245786)) - vec3<f32>(0.000090537);
    let b = v * (0.983729 * v + vec3<f32>(0.4329510)) + vec3<f32>(0.238081);
    v = aces_output(a / b);
    return saturate(v);
}

/** Linear to sRGB, the piecewise transfer function rather than a 2.2 power. */
fn encode_srgb(color : vec3<f32>) -> vec3<f32> {
    let low = color * 12.92;
    let high = 1.055 * pow(color, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
    return select(high, low, color <= vec3<f32>(0.0031308));
}

@vertex
fn vs_main(@builtin(vertex_index) index : u32) -> FullscreenOut {
    return fullscreen_vertex(index);
}

@fragment
fn fs_main(in : FullscreenOut) -> @location(0) vec4<f32> {
    let hdr = textureSample(scene, scene_sampler, in.uv).rgb;
    let mapped = select(aces_fitted(hdr * tonemap.settings.x), saturate(hdr), tonemap.settings.z > 0.5);

    // A `_SRGB` swapchain format encodes on write and doing it here as well
    // would wash the image out. Which one this is depends on what the platform
    // handed back from `SDL_GetGPUSwapchainTextureFormat`, so it is a uniform
    // rather than a compile-time choice.
    let encoded = select(encode_srgb(mapped), mapped, tonemap.settings.y > 0.5);
    return vec4<f32>(encoded, 1.0);
}
