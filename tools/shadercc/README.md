# shadercc

Compiles one WGSL entry point to SPIR-V for SDL_gpu, using
[Naga](https://docs.rs/naga) — wgpu's shader translator — as the front and back
end.

SPIR-V and nothing else. For DXIL, DXBC, MSL or metallib, feed this tool's
output to [SDL_shadercross](https://github.com/libsdl-org/SDL_shadercross);
[why](#why-not-dxil-and-msl-too) is at the bottom.

It exists for the half of `SDL_GPUShaderCreateInfo` that is not the bytecode:
SDL does not reflect on the shader it is given. It assumes the resources were
*authored* into a fixed layout and it trusts the counts you hand it, and getting
either wrong is a driver fault rather than an SDL error. So this tool places the
resources where SDL will look and prints the counts to copy across.

```
$ shadercc shaders/triangle.wgsl -e fs_main -o shaders/out
entry point `fs_main` (fragment)
  resources, in SDL's binding order:
    @group(2) @binding(0)  sampled texture              tex
    @group(2) @binding(1)  sampler                      tex_sampler
    @group(3) @binding(0)  uniform buffer               tint

  SDL_GPUShaderCreateInfo:
    num_samplers         = 1
    num_storage_textures = 0
    num_storage_buffers  = 0
    num_uniform_buffers  = 1

wrote shaders/out/triangle.fs_main.spv (1092 bytes)
```

Copy those four numbers into the create-info. A shader that declares a sampler
the create-info does not mention gets no descriptor for it and samples zeroes,
with no error anywhere — which is a morning gone if you have not seen it before.

## Building and running

```sh
cargo build --release --manifest-path tools/shadercc/Cargo.toml
./tools/shadercc/target/release/shadercc shaders/triangle.wgsl -e vs_main -o shaders/out
```

Or `npm run shaders` from the project root, which rebuilds all three of this
project's entry points.

It is its own cargo workspace, deliberately — the same reason
`.goblin/runtime-crate` is. Nothing about it should end up in the Goblin
program's build.

## Options

| flag | meaning |
|---|---|
| `-e`, `--entry` | Entry point to compile. Required when the file has more than one. |
| `-o`, `--out-dir` | Where to write. Defaults to the input's directory. |
| `--stem` | Output basename. Defaults to `<input stem>.<entry point>`. |
| `--flip-y` | Negate `@builtin(position).y`. Off by default — see below. |
| `--debug` | Keep Naga's debug annotations in the SPIR-V. |
| `--dry-run` | Report the layout without writing anything. |

**One entry point per run**, like shadercross. SDL's descriptor sets depend on
the stage — a vertex shader's uniforms are set 1, a fragment shader's are set 3
— so a file holding both cannot have one correct numbering, and the tool
compiles the one you name.

## Binding layout

You do not have to number `@group`/`@binding` to match SDL. The tool classifies
each bound global the way SDL does, sorts them into SDL's order, and hands the
back end an explicit binding map — so `@group(9) @binding(1)` on a fragment
texture becomes `set 2, binding 1`.

What the shader *does* control is the order of resources of the same kind: two
sampled textures are bound in ascending `@binding` order, so those numbers still
decide which is which.

The layouts implemented are the ones documented on `SDL_CreateGPUShader` and
`SDL_CreateGPUComputePipeline`:

```
graphics, vertex     set 0 : textures, storage textures, storage buffers
                     set 1 : uniform buffers
graphics, fragment   set 2 : textures, storage textures, storage buffers
                     set 3 : uniform buffers
compute              set 0 : textures, read-only storage
                     set 1 : read-write storage
                     set 2 : uniform buffers
```

**A sampler shares its texture's binding.** SDL's SPIR-V section never mentions
samplers, and the reason is that it has no sampler descriptor to mention: the
Vulkan backend declares each texture slot as one
`VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER` holding both halves, then counts
storage textures and storage buffers up from `num_samplers`. WGSL's model is
separate — a `texture_2d<f32>` and a `sampler` are two globals — and Vulkan
allows exactly that against a combined descriptor on one condition: both
variables must name the same descriptor set *and the same binding number*. So
the i-th sampler, by ascending `@binding`, is placed on the i-th sampled
texture's slot.

That makes `num_samplers` a count of **pairs**, so every sampled texture needs
exactly one sampler even if the shader only ever calls `textureLoad` on it —
an unsampled texture would otherwise shift every storage binding in the set down
by one. Binding more samplers than textures is refused rather than misplaced.

This is a corrected reading. Earlier versions gave samplers a descriptor of
their own after the enumerated resources, and cited the checkerboard test in
`triangle.wgsl` as confirmation. That test cannot confirm it: one texture, one
sampler and no storage resources put the *texture* at binding 0 under either
layout, so the image sampled correctly while the sampler read a descriptor
outside SDL's set — undefined, and tolerated by the driver it was tried on. Two
textures in one stage, or one texture beside a storage buffer, is where it
shows.

## The Y flip

WGSL's clip space is Y-up and Vulkan's framebuffer space is Y-down, so something
has to flip. Naga offers to do it in the shader —
`WriterFlags::ADJUST_COORDINATE_SPACE`, which is in its *default* options.

SDL_gpu also flips, in the Vulkan backend's viewport, because it presents one
coordinate system across D3D12, Vulkan and Metal. Two flips compose back into
none, and the image arrives upside down.

So this tool leaves the flag **off**, which was settled by rendering a triangle
with a red apex at `y = +0.8` and seeing where the red corner landed, rather
than by reasoning about it. `--flip-y` puts it back for SPIR-V bound somewhere
that does not flip its own viewport.

## Why not DXIL and MSL too?

Naga can emit HLSL and MSL, and this crate used to. Neither reached SDL in a
usable shape, and the reasons are structural rather than fixable here:

**HLSL samplers.** Naga 30 emits wgpu's bindless D3D12 form — one
`SamplerState nagaSamplerHeap[2048]` plus a `StructuredBuffer<uint>` of indices
per bind group — rather than `SamplerState s : register(s0, space2)`. That is a
deliberate design: D3D12 keeps samplers in a separate, size-limited heap, and
wgpu wants bind group contents to vary without rebuilding a root signature. SDL
goes the other way, taking `num_samplers` up front and building a fixed sampler
descriptor table, so it creates neither the heap nor the index buffer. Naga 24
was the last release to emit the direct form.

**HLSL storage textures.** Same root cause, quieter: Naga picks the register
letter from the variable's type, not the resource's role — "all storage textures
are UAV, unconditionally", says its source — so a read-only storage texture
lands in `u`. SDL puts read-only storage textures in `t` with the sampled ones
and keeps `u` for a compute shader's read-write set.

**MSL runtime-sized arrays.** Metal has no `arrayLength`, so Naga wants a side
buffer of `u32` lengths bound next to the real ones, whenever a used global's
*type* contains a runtime array — whatever the bounds-check policy. SDL has no
slot to bind such a thing.

None of that touches SPIR-V, which is why it is what remains. `SDL_shadercross`
is built for the rest and takes SPIR-V as input, so the pipeline is:

```
WGSL --shadercc--> SPIR-V --SDL_shadercross--> DXIL / DXBC / MSL / metallib
```

## Layout

| file | contents |
|---|---|
| `src/sdl.rs` | SDL's conventions: classifying globals, ordering them, counting them |
| `src/backends.rs` | Naga's SPIR-V back end, given an SDL-shaped binding map |
| `src/main.rs` | CLI, entry-point selection, and the report |
