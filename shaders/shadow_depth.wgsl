// Depth-only rasterisation into a shadow atlas tile.
//
// Serves both emitters: a sun cascade and a spotlight differ only in the matrix
// pushed to slot 0, so there is one pipeline and one shader for eight possible
// tiles. Which tile is chosen by the viewport and scissor set on the render
// pass, not by anything in here — a scissor is what keeps a cascade from
// rasterising over its neighbour in the atlas.
//
// Back faces are culled by the pipeline, so the map records the surface the
// light actually strikes. That is the ordinary choice and it is worth saying why
// the other one was tried and abandoned: culling *front* faces records the far
// side of each object instead, which makes self-shadowing impossible — and moves
// every shadow a whole object-thickness downrange, so it visibly detaches from
// its object at the floor.
//
// The acne that back-face culling reintroduces is handled by the two biases that
// scale with obliquity rather than by a constant: slope-scaled depth bias here,
// during rasterisation, and a normal offset on the receiver in `shadow.wgsl`.

struct ShadowView {
    /** World -> light clip for the tile being rendered. */
    view_proj : mat4x4<f32>,
    model : mat4x4<f32>,
}

@group(1) @binding(0) var<uniform> view : ShadowView;

@vertex
fn vs_main(@location(0) position : vec3<f32>) -> @builtin(position) vec4<f32> {
    return view.view_proj * (view.model * vec4<f32>(position, 1.0));
}

@fragment
fn fs_main() {
}
