// A compute shader, exercising SDL_gpu's compute resource layout.
//
// SDL's compute sets are:
//
//   @group(0) — sampled textures, read-only storage textures, read-only storage buffers
//   @group(1) — read-write storage textures, read-write storage buffers
//   @group(2) — uniform buffers
//
// `shadercc` places resources into those sets itself, so these numbers are a
// convention rather than a requirement; what it takes from the shader is the
// relative order of resources of the same kind.

struct Params {
    radius: u32,
    width: u32,
    height: u32,
    _pad: u32,
}

@group(2) @binding(0)
var<uniform> params: Params;

@group(0) @binding(0)
var<storage, read> source: array<vec4<f32>>;

@group(1) @binding(0)
var<storage, read_write> destination: array<vec4<f32>>;

@compute @workgroup_size(8, 8, 1)
fn blur_main(@builtin(global_invocation_id) id: vec3<u32>) {
    if id.x >= params.width || id.y >= params.height {
        return;
    }

    let center = id.y * params.width + id.x;
    var accum = vec4<f32>(0.0);
    var taken = 0u;

    let r = i32(params.radius);
    for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
            let sx = i32(id.x) + dx;
            let sy = i32(id.y) + dy;
            if sx < 0 || sy < 0 || sx >= i32(params.width) || sy >= i32(params.height) {
                continue;
            }
            accum += source[u32(sy) * params.width + u32(sx)];
            taken += 1u;
        }
    }

    destination[center] = accum / f32(max(taken, 1u));
}
