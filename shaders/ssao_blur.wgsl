// Blur the occlusion buffer.
//
// A 4x4 box, and the size is not arbitrary: `ssao.wgsl` picks its tap rotation
// from a set of sixteen laid out on a 4x4 grid, so a box exactly that wide
// averages each rotation exactly once and the sampling pattern cancels
// completely. A Gaussian of similar cost would weight the rotations unevenly and
// leave a visible weave.
//
// The two sizes are one decision. Changing either without the other brings the
// pattern back.
//
// Not bilateral. Occlusion is low-frequency and the forward pass already
// multiplies it into an ambient term, so bleeding a little across a depth edge
// is invisible — and skipping the depth fetches makes this pass pure bandwidth.

//!include "fullscreen.wgsl"

// `textureLoad`, so no sampler is declared. SDL still reserves a combined
// texture-sampler slot for this texture — `num_samplers` counts textures, not
// sampler objects — so the CPU side binds it paired with a throwaway sampler.
@group(2) @binding(0) var occlusion : texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) index : u32) -> FullscreenOut {
    return fullscreen_vertex(index);
}

@fragment
fn fs_main(in : FullscreenOut) -> @location(0) vec4<f32> {
    let size = vec2<i32>(textureDimensions(occlusion, 0));
    let center = vec2<i32>(in.position.xy);

    var sum = 0.0;
    for (var y = -2; y <= 1; y = y + 1) {
        for (var x = -2; x <= 1; x = x + 1) {
            let coord = clamp(center + vec2<i32>(x, y), vec2<i32>(0), size - vec2<i32>(1));
            sum = sum + textureLoad(occlusion, coord, 0).r;
        }
    }

    return vec4<f32>(sum / 16.0, 0.0, 0.0, 1.0);
}
