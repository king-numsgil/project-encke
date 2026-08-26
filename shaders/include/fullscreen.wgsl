// The fullscreen triangle, for every pass that reads a texture and writes a
// texture.
//
// One triangle rather than two, and it is not a micro-optimisation: a quad has
// a diagonal seam along which the GPU rasterises partial quads twice, and the
// cost shows up in exactly the passes — SSAO, blur, tonemap — that are already
// bandwidth-bound. The triangle is oversized and clipped, so there is no seam.
//
//     vertex 0 -> (-1, -1), uv (0, 1)
//     vertex 1 -> ( 3, -1), uv (2, 1)
//     vertex 2 -> (-1,  3), uv (0, -1)
//
// No vertex buffer: `@builtin(vertex_index)` is the whole input, and the draw is
// `SDL_DrawGPUPrimitives(pass, 3, 1, 0, 0)`.

struct FullscreenOut {
    @builtin(position) position : vec4<f32>,
    @location(0) uv : vec2<f32>,
}

fn fullscreen_vertex(index: u32) -> FullscreenOut {
    let x = f32((index << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(index & 2u) * 2.0 - 1.0;

    var out : FullscreenOut;
    out.position = vec4<f32>(x, y, 0.0, 1.0);
    // `v = 0` at the top of the image, matching every other UV in this renderer
    // and the row the rasteriser writes first. Clip `+Y` is up on screen because
    // SDL_gpu's Vulkan backend flips its own viewport.
    out.uv = vec2<f32>(x * 0.5 + 0.5, 0.5 - y * 0.5);
    return out;
}
