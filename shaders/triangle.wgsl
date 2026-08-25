// The triangle, for SDL_gpu on Vulkan — now sampling a compute-generated
// texture, which is the point of the exercise.
//
// Three bindings, in three different SDL descriptor sets:
//
//   * `tex` and `tex_sampler` — fragment-stage sampled texture, set 2. This is
//     the pair under test. SDL's SPIR-V layout enumerates sampled textures,
//     storage textures and storage buffers and never mentions samplers, while
//     its DXIL and MSL layouts both give samplers an index of their own — which
//     reads as a *combined* image sampler, the way
//     `SDL_GPUTextureSamplerBinding` pairs the two in one struct. WGSL's model
//     is separate, and Naga emits two descriptors. Whether SDL's Vulkan backend
//     accepts that is what the screenshot answers.
//   * `tint` — fragment-stage uniform, set 3. Already known to work.
//
// No vertex buffer: the corners come from `@builtin(vertex_index)`, and the UVs
// come from the corner positions.

struct Tint {
    color: vec4<f32>,
}

@group(2) @binding(0)
var tex: texture_2d<f32>;

@group(2) @binding(1)
var tex_sampler: sampler;

@group(3) @binding(0)
var<uniform> tint: Tint;

struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOut {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(0.0, 0.8),
        vec2<f32>(-0.8, -0.7),
        vec2<f32>(0.8, -0.7),
    );

    let p = positions[index];

    var out: VertexOut;
    out.position = vec4<f32>(p, 0.0, 1.0);
    // NDC to [0, 1], with v flipped so that v = 0 is the top of the image —
    // the row the compute shader wrote at `id.y == 0`.
    out.uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    return textureSample(tex, tex_sampler, in.uv) * tint.color;
}
