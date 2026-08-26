# encke

A clustered forward (Forward+) renderer on SDL3's GPU API, written in Goblin —
TypeScript syntax lowered to native code through LLVM.

```bash
bun install
bun run compile      # shaders, then the program
bun run execute      # bin/encke
```

`bun start` does both.

## Running it

```
--width N            render width, default 1600
--height N           render height, default 900
--present MODE       mailbox (default, falls back to vsync), vsync, immediate
--screenshot PATH    write a PNG once the scene has settled, then exit
--lights N           point lights in the test scene, default 160 (cap 380)
--frames N           stop after N frames
--bench N            run N frames and report frame timing
--debug VIEW         off (default), clusters, ao, cascades
--overlay on|off     debug HUD, on by default and off under --bench
```

WASD to fly, right mouse to look, shift to hurry, space and control for height.
F1 toggles the overlay.

**A benchmark must run in the present mode the build ships in.** `present()`
costs wildly different amounts under VSYNC, IMMEDIATE and MAILBOX; a VSYNC
measurement is mostly the wait for vblank and will hide every regression
underneath it. `--bench` prints the mode it ran in for that reason.

## The frame

| # | pass | target |
|---|---|---|
| 1 | upload lights and overlay vertices | copy pass |
| 2 | sun cascades | depth, 6144x2048 atlas |
| 3 | spot shadows | depth, 2048x2048 atlas |
| 4 | opaque depth pre-pass | depth, full res |
| 5 | cluster clear / mark / cull | compute |
| 6 | SSAO + blur | colour, half res |
| 7 | forward shading | colour, HDR, depth tested `EQUAL` |
| 8 | tonemap | colour, swapchain |
| 9 | overlay | colour, blended over the swapchain |

The orderings that matter are documented at the top of `src/renderer/renderer.ts`.

### Clustering

16 x 9 x 24 froxels, exponential in z so slices are dense near the camera where
the depth complexity is. Culling is per froxel, one workgroup each, capped at 96
lights per cluster out of at most 384 in the scene. Point lights and spotlights
are culled identically, by bounding sphere; the cone test happens at shading
time, where it runs only for the clusters that kept the light.

**The depth pre-pass is mandatory, not an optimisation.** A compute pass reads
the depth buffer and flags the froxels a visible fragment actually landed in, and
culling skips the rest — so the cost tracks the scene's real depth complexity
rather than the full 3456-froxel volume.

Each cluster's list is sorted **furthest light first**. Shading accumulates one
`vec3` across up to 96 lights, and summing floats smallest-first keeps a running
total from swallowing the small terms; without it, adjacent clusters holding the
same lights in different orders accumulate to visibly different values and the
grid prints itself on the image as squares. Overflow uses the same ordering —
a cluster with more than 96 candidates keeps the nearest 96.

`--debug clusters` draws per-froxel occupancy as a heatmap. It is the only
practical way to see culling working: a light assigned to the wrong froxel is a
slightly differently lit pixel, not a visible failure.

At the full 384-light cap the busiest froxels in the test scene reach the
per-cluster cap of 96 and start discarding, which is exactly the case the
furthest-first ordering exists to make survivable — it stays free of the square
banding a saturated grid otherwise produces.

Cost at 384 lights scales cleanly with resolution: roughly **1.24 ms per
megapixel** of screen-space work plus **0.57 ms** that does not depend on
resolution at all (draw submission, the fixed-size shadow atlases, and the 3456
culling workgroups).

### Shading

Cook-Torrance, metallic-roughness, direct lighting only. No ray tracing, no SSR,
no IBL — indirect light is one flat ambient constant, which is the largest single
cheat in the model and a deliberate one. That constant feeds `diffuse + f0`
rather than `diffuse` alone, because a metal has no diffuse lobe and would
otherwise be solid black everywhere a punctual highlight does not land.

### Materials

Four maps per material — colour, normal, roughness, occlusion — in a folder
under `assets/materials/`, loaded by filename. Any of them may be absent: a
missing map binds a 1x1 texture that is the identity for its channel, so an
untextured material takes exactly the same shader path with no branch and no
flag. Maps multiply the numeric parameters rather than replacing them, which is
the glTF convention and what makes that work.

**Only the colour map is sRGB.** The other three carry data, not light, and are
uploaded as `UNORM` so no transfer curve is applied to them. Every map gets a
full mip chain and an anisotropic repeating sampler; without mips a 1K map on a
distant crate crawls as the camera moves.

Normal mapping needs a tangent basis, so vertices carry `tangent.xyzw` where `w`
is the bitangent's handedness. The generators compute it — they know their own
UV layout exactly, where the fragment shader would have to recover it from
screen-space derivatives every frame.

### Shadows

The sun is the single global shadow emitter: 4 cascades, PCF, in one atlas rather
than a texture array so the near two can be 2048 and the far two 1024. A far
cascade covers an enormous area at a density nobody can resolve, and rasterising
it at a quarter the cost is free quality.

Cascades are fitted to a **bounding sphere** of each frustum slice, not a box, so
rotating the camera does not change their extent; and the projection origin is
**snapped to whole texels**, so translating it does not either. Without both,
shadow edges crawl.

Up to 4 spotlights cast at once, into a 2x2 atlas, no cascades. Which 4 is decided
per frame by distance to the camera.

Shadow rasterisation culls **back** faces, so the map records the surface the
light actually strikes. Culling front faces instead avoids acne outright, and was
tried — but it records the far side of every object, which puts each shadow a
whole object-thickness downrange and visibly detaches it from its object at the
floor. The acne is dealt with instead by two biases that both scale with how
obliquely the light meets the surface: slope-scaled depth bias during
rasterisation, and a normal offset on the receiver multiplied by
`sin(angle to light)` so a floor lit from above is offset by nothing at all.

The sun's constant bias is stated in **world units** and divided by each cascade's
own depth range. A single clip-depth number means a few centimetres in cascade 0
and better than half a metre in cascade 3, which is its own source of panning.

### Geometry

**Every mesh must have real thickness. No infinitely thin walls or planes.** A
punctual light shades a surface by its normal, so a plane lights identically from
behind, and there is no shading-stage trick that recovers the occlusion — the
geometry never carried it. Front-face-culled shadow rendering makes it worse, not
better, since a plane has no inside to rasterise.

This is a content rule the renderer cannot enforce, only report:
`warnIfPaperThin` logs any mesh thinner than a threshold on any axis. A floor is
a very flat box and never a quad; there is deliberately no plane primitive.

### Overlay

An immediate-mode debug HUD — rectangles, circles, lines and text — in
`src/renderer/ui/`. There is no widget tree and no retained state: the list is
cleared and rebuilt every frame from whatever the numbers currently are, which is
all a debug readout ever needs.

**The whole overlay is one draw call.** Every primitive is a quad sampling one
atlas: shapes point at a block of solid white texels, text at its glyph's cell,
and a circle at a pre-rasterised antialiased disc. So there is a single pipeline,
no state changes between primitives, and the fragment shader is a multiply.

The glyphs are **baked once at startup** by SDL_ttf rather than streamed through
its GPU text engine. That engine is the right tool for text that is not known
ahead of time; a debug overlay's text is printable ASCII in two faces, decided at
build time, and baking it means no retained `TTF_Text` per string, no second
texture to break the batch on, and layout the draw list controls. `Inter` sets
the labels, `JetBrains Mono` everything numeric — a proportional `1` is narrower
than a `0`, so a readout counting up in one would reflow on every frame.

It draws **after** the tonemap, not before: a filmic curve applied to a colour
somebody chose by eye does not give back that colour. Colours are therefore
authored sRGB-encoded and decoded in the vertex shader only where the swapchain
format encodes on write.

Cost is within measurement noise of not drawing it at 1600x900 — the vertex and
index buffers, and the CPU block the draw list builds into, are all allocated
once at the ceilings in `config.ts` rather than grown per frame. It is still off
by default under `--bench`, because a benchmark that measures something other
than the renderer is a benchmark with an argument in it.

### Profiling

**SDL_gpu has no timestamp query API** — it is an open issue upstream, not a gap
in these bindings — so per-pass GPU timing does not exist and no amount of
instrumenting will produce it. What is available is a fence: submit, wait, and
take one whole-frame number on the CPU. That serialises the pipeline, so the
fence is only taken under `--bench`; an ordinary frame submits and moves on.

The overlay's own frame-time graph is a different measurement and deliberately
so: it is the wall clock between two `Clock.tick` calls — the interval the window
is actually being repainted at — which costs nothing to collect and is the number
a HUD should show.

## Layout

```
build.ts                    shaders -> SPIR-V -> manifest, then the program
assets/
  fonts/                    the overlay's two faces, and their licences
  materials/                PBR maps, one folder per material
shaders/
  include/                  frame, cluster, light, pbr, shadow, fullscreen
  *.wgsl                    one file per pass
src/
  main.ts                   entry point, nothing else
  app/                      options, display, frame loop, test scene
  core/                     clock, input
  bindings/SDL3/            SDL3 bindings
  bindings/SDL3_image/      SDL3_image bindings
  bindings/SDL3_ttf/        SDL3_ttf bindings
  renderer/
    config.ts               every tunable, mirrored against a shader
    renderer.ts             the frame graph
    cluster/                the cluster buffers
    frame/                  uniform layouts, render targets
    geometry/               mesh data, box, sphere, GPU upload
    gpu/                    buffer, texture, sampler, pipeline helpers
    passes/                 one file per pass
    scene/                  camera, lights, materials, cascade fitting
    ui/                     overlay atlas, draw list, debug HUD
tools/
  shadercc/                 WGSL -> SPIR-V, in SDL's binding layout
  goblin-forge/             the compiler
```

### Native dependencies

On Windows `build.ts` fetches the prebuilt `-VC` packages from libsdl-org's
releases into `build/sdl3/` and copies their DLLs beside the executable. Adding
SDL3_mixer later is one line in `DEPENDENCIES`. Elsewhere the same list resolves
through pkg-config instead.

SDL3_image's `optional/` folder is **not** optional here: it holds the codec
DLLs, including `libpng16-16.dll`, and none of them are linked statically.
Without them the library still loads and `IMG_Load` still runs — every PNG just
fails at run time with a message about an unsupported format. The whole folder
is copied.

SDL3_image has no `IMG_Init`; decoders come up on first use. SDL3_ttf does have
`TTF_Init`, and nothing in it works before that call succeeds.

The `SDL_Renderer` entry points are deliberately unbound in both —
`IMG_LoadTexture*` in one, `TTF_*RendererTextEngine` and `TTF_DrawRendererText`
in the other. They belong to SDL's 2D renderer, which is a different and
incompatible API from SDL_gpu. `IMG_LoadGPUTexture*` and
`TTF_CreateGPUTextEngine` are the equivalents this project uses.
`SDL3_ttf/SDL_textengine.h` is unbound too, for a different reason: it declares
no functions, only the vtable and draw-operation union needed to implement a
text engine of your own.

### Shaders are compiled, reflected and generated

WGSL has no `#include`, so `build.ts` expands `//!include "name.wgsl"` against
`shaders/include` before `shadercc` sees the file.

More importantly: **SDL takes shader resource counts on trust and cannot check
them.** A shader declaring a sampler its create-info does not mention gets no
descriptor for it and samples zeroes, with no error raised anywhere. So the build
parses those counts back out of shadercc's own report and generates
`src/renderer/shaders.generated.ts` — one function per entry point that creates
the SDL object with the numbers baked in. There is no second place for them to be
wrong.

## Not in this phase

Mesh and glTF loading (geometry is procedural), transparency, moment shadow maps
or any non-CSM technique, HBAO (tried, cost more, looked worse), upscaling.
