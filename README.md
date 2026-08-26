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
```

WASD to fly, right mouse to look, shift to hurry, space and control for height.

**A benchmark must run in the present mode the build ships in.** `present()`
costs wildly different amounts under VSYNC, IMMEDIATE and MAILBOX; a VSYNC
measurement is mostly the wait for vblank and will hide every regression
underneath it. `--bench` prints the mode it ran in for that reason.

## The frame

| # | pass | target |
|---|---|---|
| 1 | upload lights | copy pass |
| 2 | sun cascades | depth, 6144x2048 atlas |
| 3 | spot shadows | depth, 2048x2048 atlas |
| 4 | opaque depth pre-pass | depth, full res |
| 5 | cluster clear / mark / cull | compute |
| 6 | SSAO + blur | colour, half res |
| 7 | forward shading | colour, HDR, depth tested `EQUAL` |
| 8 | tonemap | colour, swapchain |

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
cheat in the model and a deliberate one.

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

### Profiling

**SDL_gpu has no timestamp query API** — it is an open issue upstream, not a gap
in these bindings — so per-pass GPU timing does not exist and no amount of
instrumenting will produce it. What is available is a fence: submit, wait, and
take one whole-frame number on the CPU. That serialises the pipeline, so the
fence is only taken under `--bench`; an ordinary frame submits and moves on.

## Layout

```
build.ts                    shaders -> SPIR-V -> manifest, then the program
shaders/
  include/                  frame, cluster, light, pbr, shadow, fullscreen
  *.wgsl                    one file per pass
src/
  main.ts                   entry point, nothing else
  app/                      options, display, frame loop, test scene
  core/                     clock, input
  graphics/sdl/             SDL3 bindings
  renderer/
    config.ts               every tunable, mirrored against a shader
    renderer.ts             the frame graph
    cluster/                the cluster buffers
    frame/                  uniform layouts, render targets
    geometry/               mesh data, box, sphere, GPU upload
    gpu/                    buffer, texture, sampler, pipeline helpers
    passes/                 one file per pass
    scene/                  camera, lights, materials, cascade fitting
tools/
  shadercc/                 WGSL -> SPIR-V, in SDL's binding layout
  goblin-forge/             the compiler
```

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
