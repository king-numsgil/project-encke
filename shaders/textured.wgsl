// A textured quad, authored to SDL_gpu's resource set layout.
//
// The `@group` numbers are not free choices. SDL binds by position, and the
// SPIR-V back end passes `@group` straight through as the descriptor set, so
// these have to be the sets SDL will look in:
//
//   vertex   — @group(0) textures/storage, @group(1) uniforms
//   fragment — @group(2) textures/storage, @group(3) uniforms
//
// `shadercc` checks this and warns if it does not hold.

struct Transform {
    mvp: mat4x4<f32>,
}

@group(1) @binding(0)
var<uniform> transform: Transform;

struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(
    @location(0) position: vec3<f32>,
    @location(1) uv: vec2<f32>,
) -> VertexOut {
    var out: VertexOut;
    out.position = transform.mvp * vec4<f32>(position, 1.0);
    out.uv = uv;
    return out;
}

@group(2) @binding(0)
var albedo: texture_2d<f32>;

@group(2) @binding(1)
var albedo_sampler: sampler;

struct Tint {
    color: vec4<f32>,
}

@group(3) @binding(0)
var<uniform> tint: Tint;

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    return textureSample(albedo, albedo_sampler, in.uv) * tint.color;
}
