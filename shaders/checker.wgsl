// Fills a texture from a compute shader, for the fragment stage to sample.
//
// The pattern is deliberately not a flat colour and not symmetric: an 8x8
// checkerboard over a red/green gradient, so a screenshot shows at a glance
// whether the texture arrived at all, whether it is the right way up, and
// whether the UVs run in the direction they should.
//
// `write` access makes this a read-write storage texture as far as SDL is
// concerned, which puts it in compute descriptor set 1. `shadercc` places it
// there regardless of the `@group` written here.

@group(1) @binding(0)
var output: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn generate(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = textureDimensions(output);
    if id.x >= size.x || id.y >= size.y {
        return;
    }

    let uv = vec2<f32>(f32(id.x) / f32(size.x), f32(id.y) / f32(size.y));

    // 32-pixel cells. Dark cells stay legible rather than going black, so a
    // texture that failed to bind (all zero) is distinguishable from one that
    // bound correctly.
    let cell = (id.x / 32u) + (id.y / 32u);
    var shade = 1.0;
    if cell % 2u == 1u {
        shade = 0.45;
    }

    textureStore(
        output,
        vec2<i32>(i32(id.x), i32(id.y)),
        vec4<f32>(uv.x * shade, uv.y * shade, (1.0 - uv.x) * shade, 1.0),
    );
}
