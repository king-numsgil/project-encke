// The overlay: textured, tinted quads in pixel coordinates.
//
// One pipeline draws the whole UI — rectangles, circles, lines and text — and it
// can, because every one of those is a quad sampling **the same atlas**. Shapes
// point at a block of solid white texels, glyphs point at their own cell, and a
// circle points at a pre-rasterised antialiased disc. So the fragment shader is a
// multiply, and the entire overlay is one draw call with no state changes in it.
//
// See `renderer/ui/atlas.ts` for what is in that atlas and why the disc is baked
// rather than tessellated or evaluated as a distance field here.

struct Ui {
    /**
     * Pixels to clip space: `clip = position * transform.xy + transform.zw`.
     *
     * `transform.y` is negative and `transform.w` is `+1`, which is what puts
     * `y = 0` at the *top* of the window. Clip `+Y` is up on screen here because
     * SDL_gpu's Vulkan backend flips its own viewport — the same reasoning as
     * `include/fullscreen.wgsl`.
     */
    transform : vec4<f32>,

    /**
     * `x`: 1 when the swapchain format encodes sRGB on write.
     * `yzw`: unused.
     */
    flags : vec4<f32>,
}

@group(1) @binding(0) var<uniform> ui : Ui;

@group(2) @binding(0) var atlas : texture_2d<f32>;
@group(2) @binding(1) var atlas_sampler : sampler;

struct VertexOut {
    @builtin(position) position : vec4<f32>,
    @location(0) uv : vec2<f32>,
    @location(1) color : vec4<f32>,
}

/** sRGB to linear, the piecewise transfer function — the inverse of `tonemap.wgsl`'s. */
fn decode_srgb(color : vec3<f32>) -> vec3<f32> {
    let low = color / 12.92;
    let high = pow((color + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    return select(high, low, color <= vec3<f32>(0.04045));
}

/**
 * Colours arrive **sRGB-encoded**, which is how a UI is authored — `0.5` means
 * mid grey to the eye, not half the photons.
 *
 * Where the swapchain is a `_SRGB` format the hardware encodes on write, so what
 * is written has to be linear and this undoes the authoring. Where it is not, the
 * tonemap pass has already written encoded bytes and the value passes through to
 * sit alongside them.
 *
 * Decoding here rather than in the fragment shader, because the colour is a
 * per-vertex constant: for a flat quad the two are identical, and it turns a
 * per-fragment `pow` into a per-vertex one. A deliberate gradient would
 * interpolate in the wrong space by a hair, which is not a debug overlay's
 * problem.
 */
@vertex
fn vs_main(
    @location(0) position : vec2<f32>,
    @location(1) uv : vec2<f32>,
    @location(2) color : vec4<f32>,
) -> VertexOut {
    var out : VertexOut;
    out.position = vec4<f32>(position * ui.transform.xy + ui.transform.zw, 0.0, 1.0);
    out.uv = uv;
    out.color = vec4<f32>(
        select(color.rgb, decode_srgb(color.rgb), ui.flags.x > 0.5),
        color.a,
    );
    return out;
}

/**
 * Tint times atlas.
 *
 * The alpha channels multiply and the colour channels do not need to: the atlas
 * is white wherever a glyph covers a pixel, so `rgb` comes through as the tint
 * and coverage lands entirely in `a`. That is straight (non-premultiplied) alpha,
 * matching the blend state in `passes/ui.ts`.
 */
@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
    let texel = textureSample(atlas, atlas_sampler, in.uv);
    return vec4<f32>(in.color.rgb * texel.rgb, in.color.a * texel.a);
}
