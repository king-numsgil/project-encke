# encke

A clustered forward (Forward+) renderer on SDL3's GPU API, written in Goblin —
TypeScript syntax lowered to native code through LLVM.

Apache-2.0, except for the models under `assets/models/` — one of those carries a
non-commercial clause. See [Licence](#licence).

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
--model PATH         a .gltf or .glb to load beside the test scene
--model-scale N      uniform scale for --model, default 1
--frames N           stop after N frames
--bench N            run N frames and report frame timing
--debug VIEW         off (default), clusters, ao, cascades
--overlay on|off     debug HUD, on by default and off under --bench
--headless           run the console harness instead of opening a window
--run WHAT           tests (default), benches, list — implies --headless
--filter TEXT        only harness cases whose name contains TEXT
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

**Five maps per material, and they are glTF's own set** — base colour, normal,
metallic-roughness, occlusion, emissive. That is not a coincidence: a folder
under `assets/materials/` and a loaded `.glb` produce the same five textures, so
the forward pass cannot tell a procedural material from an imported one and there
is no second path to keep working.

Any of them may be absent: a missing map binds a 1x1 texture that is the identity
for its channel, so an untextured material takes exactly the same shader path
with no branch and no flag. Maps multiply the numeric parameters rather than
replacing them, which is the glTF convention and what makes that work.

Metalness and roughness share one texture — `g` roughness, `b` metallic — because
that is how glTF packs them and because the two vary together on a real surface:
a scratch through paint reveals metal and changes the gloss at the same texel.
The material folders author them as separate grayscale files and
`loadOrmTexture` combines them at load, which is the only place the two sources
disagree.

**Only the colour and emissive maps are sRGB.** The others carry data, not light,
and are uploaded as `UNORM` so no transfer curve is applied to them. Every map
gets a full mip chain and an anisotropic repeating sampler; without mips a 1K map
on a distant crate crawls as the camera moves.

Normal mapping needs a tangent basis, so vertices carry `tangent.xyzw` where `w`
is the bitangent's handedness. The procedural generators compute it — they know
their own UV layout exactly, where the fragment shader would have to recover it
from screen-space derivatives every frame — and `tools/gltf` generates one for
any imported primitive whose file did not carry `TANGENT`.

### Loading glTF

`--model` reads a `.gltf` or `.glb` through `tools/gltf`, a Rust cdylib around
the `gltf` crate. **All of the glTF is on that side**: accessors, the node tree,
triangulation, and tangent generation. What crosses the C ABI is already this
renderer's own vertex layout — twelve interleaved floats and 32-bit indices — one
world transform per instance, metallic-roughness factors, and every image *still
encoded*, so SDL3_image stays the one library in this program that knows a pixel
format.

glTF is Y-up, right-handed, `-Z` forward and counter-clockwise wound, which is
exactly what this renderer is, so there is no basis change anywhere in the path.
The one conversion that does happen is winding: a node whose global transform has
a negative determinant mirrors, and its triangles are re-wound on the loader side
because back faces are culled here and a mirrored instance would otherwise show
its inside.

**The loader has no allocator of its own.** It is a DLL and this is an
executable, so linking it the ordinary way would put two heaps in one process,
and the side that frees a block must be the side that allocated it.
`encke_gltf_set_allocator` hands it goblin-forge's own `mi_malloc_aligned`,
`mi_realloc_aligned` and `mi_free` before anything else is called, so every `Vec`
it builds is a block this process already owns and `GOBLIN_LEAK_CHECK` still
tells the truth. Allocating before that handshake aborts rather than guessing.

Not read: skins, morph targets, animation, alpha blending and masking, a second
UV set, and the sampler half of a glTF `texture` — this renderer has one sampler
configuration. Materials are collapsed onto *image* indices for that reason, so
an image cited by several textures is decoded once.

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

The test scene's boxes and spheres are generated; its **fifty helmets are loaded**
from one glTF file and scattered by rejection sampling against the props already
placed, from a seeded generator so that the scene is identical in every run. They
are the only geometry here nobody in this repository authored, which is the
point — real content has UV seams, no tangents, and fifteen thousand triangles
where a crate has twelve. They cost about 1.1 ms a frame at 1600x900, and they
are one mesh and one material between them.

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

### Headless

`--headless` branches immediately after `SDL_Init` into an ordinary console
program: no window, no GPU device, no `SDL_ttf`. SDL comes up with `EVENTS`
rather than `VIDEO` there, so a headless run works on a machine with no display
and no driver — `SDL_GetPerformanceCounter`, which is all the benchmarks want
from SDL, needs no subsystem at all.

```bash
bun test                             # every suite; exit status is the result
bun bench                            # the CPU benchmarks
./bin/encke --run list               # what is registered
./bin/encke --filter scene/          # one area
```

Both scripts run under `GOBLIN_LEAK_CHECK=1`, so **the trailing
`##goblin-live-allocations:` line is part of the result** and has to read zero.
It is not a formality: there are no destructors in this language, so anything
holding an allocation — a `Column`, a `File` — is released by a call somebody
wrote or by nothing at all, and that counter is the only thing that notices.

Suites are named `area/what` and `--filter` is a substring over the whole name.
A filter that matches nothing **fails** rather than passing vacuously, because a
filter that matches nothing is nearly always a typo and a green run is the worst
possible answer to one.

Registration is explicit, in `src/harness/suites.ts`. It has to be: there is no
top-level code in this language and no static initialiser, so nothing can add
itself by existing.

What is covered is the pure-CPU half — the command line, the mesh generators,
frustum extraction, and the cascade fit. That last one is the reason the harness
exists at all. Two properties this README claims about shadows — that the cascade
extent is a **bounding sphere** and so survives a camera rotation, and that the
projection origin is **snapped to whole texels** and so survives a translation —
are both invisible when they break. The shadows still render; they just boil, and
it gets blamed on the bias. `scene/cascades` asserts both as arithmetic: the same
texel-per-world extent after a 120-degree turn, and the world origin landing
within a fiftieth of a texel of a whole one in every cascade.

The benchmarks report nanoseconds per operation over batches, with the first
batch discarded — a cold path faults its pages in and makes mimalloc claim the
arenas every later batch reuses, and including that would put first-touch cost in
the minimum. They carry the CPU version of the caution `--bench` carries: a
number is comparable against another run of the same benchmark on the same
machine, and against nothing else.

## The ECS

`src/ecs/` is an archetype ECS with entity relationships. It imports nothing from
`app/`, `renderer/` or `bindings/` — only `std/` — and **nothing in the renderer
uses it yet**. It is developed entirely against the headless harness, and
replacing `renderer/scene/scene.ts` with it is a later change with its own risk;
doing both at once would make a renderer regression and an ECS bug look identical.

### Everything is one u64

An entity is an id, a component type is an id, and a relationship kind is an id.
All three are the same thing, which is what lets one query engine, one storage
layer and one cleanup pass serve them all.

```
  [63..48]  16 flag bits, all reserved
  [47..32]  generation, 16 bits
  [31..0]   index, 32 bits
```

4,294,967,295 entities, and 65,536 of them per index — because that is all the
generation field holds.

**No handle is ever reissued.** An index whose generations are spent is *retired*
rather than wrapped: the destroy that would have taken it back to zero takes it
out of circulation instead, and `create` allocates a fresh one. So a handle names
one entity for the life of the process, and once that entity is destroyed the
handle is dead forever — which is what makes it safe to keep one in a save file,
a UI widget, a script, or an undo stack.

That guarantee is four lines in `destroy`, and it is worth what it costs. The
free list can then be an ordinary stack, taken from the warm end, because the
number of retirements is `destroys / 65,536` whichever end you take from.

The cost is that **the record array never shrinks**, and two things grow it:

* the **high-water mark** of concurrent entities — peak at two million once and
  the 24 MB is held for the life of the process. Much the larger of the two.
* **retirement**, at twelve bytes per 65,536 entity lifetimes. A session killing
  a million entities a second for seven hours spends 4.6 MB on it.

Compaction for either is **not written**, and the hard part is not finding the
dead slots — it is that an index *is* the handle, so moving a live entity's slot
invalidates every handle anyone is holding, and those live in data structures the
ECS cannot see. `ecs/entities.ts` lays out the three shapes a fix could take; the
one a game actually wants is a `World.reset()` at a level boundary, where
everything is destroyed anyway and the whole index can go back to zero.

One entity costs **12 bytes** of index — `archetype: u32, row: u32,
generation: u16, flags: u16`, with no padding — plus whatever its components
weigh. `Entities.retiredCount` and `.freeCount` are the gauges.

The sixteen flag bits are reserved and nothing sets one. An earlier design spent
bit 63 marking an id as a **pair** — `(ChildOf, ship)` packed into a single id
that sat in the archetype signature, the way flecs does it — and that is gone.
See [Relationships](#relationships) for why, and for the measurement that decided
it. The bits stay reserved because the next thing to want one is a marker for a
relation holding several targets at once, and renumbering an id layout is not
something to do twice.

### Storage

An archetype is every entity holding exactly the same set of ids, one column per
id that carries data. An entity's components sit at the same row across those
columns, so a query walks contiguous arrays with no per-entity lookup and no
branch. The price is paid when an entity's *shape* changes: adding a component
moves its whole row to a different table. That trade is the right way round for a
simulation, where shape changes are rare and iteration happens every frame.

Signatures sort ascending, which makes membership a binary search.

Columns are **type-erased bytes with a hand-rolled vtable**: a size, an alignment,
and `init`/`copy`/`drop` generated per type by a generic function. That is not a
preference. A generic class cannot be heap-allocated in this language, and an
archetype needs columns of different types side by side, so the type has to
travel as function pointers rather than as a parameter.

**Components are plain data** — scalars, enums, `fvec3`, fixed arrays, and structs
of those. No `string`, no `T[]`, no classes. The hooks are written so an owning
component would be correct, but nothing tests that and column growth relocates
rows bitwise. A component that wants a name holds an interned handle.

Adding or removing an id follows a cached graph edge between tables, and both
directions are written when either is built, so an entity that is tagged and
untagged every frame hashes no signatures at all.

### Queries

```ts
const walk = new Query([has(position), has(velocity), not(frozen)]);

walk.each(world, (it) => {
    const p = it.column<Position>(0);
    const v = it.column<Velocity>(1);
    if (p === null || v === null) { return; }
    for (let i: usize = 0; i < it.count; i++) {
        p[i].x += v[i].dx * dt;
    }
});
```

The body is called once per **table**, not once per entity, so its inner loop is a
straight typed walk. That loop is the entire reason for the archetype layout, and
an API handing out one entity at a time would have thrown it away at the last
step.

Matching is incremental. Tables are only ever appended, so a query keeps a cursor
and each rematch looks only at what is new — which makes a settled world free to
re-query, and makes a query **built before the archetypes it matches** pick them
up the moment they exist.

There are no wildcards and nothing needs them. A relation is an ordinary id, so
`has(childOf)` is "everything with a parent" — one table, and `it.column<u64>(n)`
hands the body a contiguous run of parent handles.

"Everything parented to *this* ship" is deliberately **not** a query. It is
`world.related(childOf, ship, out)`, an index lookup costing the number of parts.

### Relationships

**A relation is a component whose value is an entity handle.** That is the whole
implementation: relating writes the target into a `u64` column on the holder, and
a map from `(relation, target)` answers the other direction.

```ts
const childOf = world.relation("ChildOf");
world.setOnDelete(childOf, deleteId());

world.relate(turret, childOf, ship);     // replaces any previous target
world.relate(ship, insideSystem, sol);
world.relate(ship, orbiting, luna);

world.targetOf(turret, childOf)          // -> ship, a full handle
world.related(childOf, ship, out)        // -> the 13 parts, one lookup

const parts = world.view(childOf, ship); // cached, self-maintaining
world.walk(parts, (part) => { … });

world.destroy(ship);                     // parts deleted with it
```

**One target per relation per entity.** Relating to a second replaces the first,
because a column holds one value. A relation holding several at once is not here;
the reserved flag bits exist to mark one later.

`setOnDelete` says what happens when a *target* dies: `Remove` — the default —
clears the relation and leaves the holder alone, and `Delete` destroys the holder
too. The cascade is **worklist-driven, not recursive**, so a hierarchy can be as
deep as the content makes it and a cycle terminates on the liveness check.

Two things fall out of the target being data:

* it is a **full handle, generation included**, so a turret whose ship has died
  reads as pointing at something dead all by itself. Cleanup is policy, not
  correctness — a distinction the older design could not make, because a target
  packed into an id had no room for a generation.
* every entity with a parent shares **one table**, however many parents exist.

#### Why the target is not in the signature

It was, in the shape flecs uses: `(ChildOf, ship)` as a single id sitting in the
archetype signature, so "children of ship #3" was a table lookup and those
children sat contiguously. That is genuinely the fastest layout — when a parent
has *hundreds* of children.

A ship has five doors, three turrets, four screens and a chair. Splitting on the
target then means one table per ship holding thirteen rows, and a query pays
per-table setup for thirteen entities at a time. Measured, same 10,000 entities
and same work, only the parent count changing:

| parents × children | in the signature | in a column |
|---|---|---|
| 1 × 10,000 | 0.70 ns | 0.47 ns |
| 100 × 100 | 2.19 ns | 0.47 ns |
| 1,000 × 10 | 11.53 ns | 0.47 ns |
| 2,000 × 5 | **15.33 ns** | **0.47 ns** |

Twenty-two times slower at 2,000 parents, and 2,000 tables that are never
reclaimed. `bun bench --filter fragmentation` is that measurement; it should stay
flat, and a future change that reintroduces per-target tables will bend it again.

What the signature layout bought — contiguous *data* for one parent's children —
is a real thing to give up, and the way to get it back is a view: pay memory to
cache the answer, which is what `world.view` is.

### What it costs

From `bun bench`, on one machine, with the usual caveat that these compare
against another run of themselves and nothing else:

| | |
|---|---|
| iterate 1M entities, two components | **1.9 ns** an entity |
| iterate everything with a parent, 50k over 4,000 parents | **0.47 ns** an entity |
| the same, reading each parent out of the column | 1.2 ns an entity |
| create + destroy | 71 ns |
| add + remove a tag (two archetype moves) | 162 ns |
| `related`, one parent of twelve | 86 ns |
| walking a settled `view` of twelve | 39 ns |

Those are the fastest batch of twenty, which is the statistic least polluted by
whatever else the machine was doing — the mean on a busy machine is two to three
times worse and says more about the scheduler than about this code.

The first line is the whole point of the layout. The fifth is what it costs, and
the reason a shape change is something to do at spawn rather than per frame. The
last two are the view earning its keep: about twice as fast as the lookup, for one
`u64` per member.

### Not in it

No systems and no scheduler — that is the next thing and it wants queries to
exist first. No serialisation, no reflection past size and alignment, no change
hooks or observers, and no archetype ever being destroyed once created.

**No compaction**, which is the one on this list with numbers attached to it.
Nothing here shrinks, in two places:

*The entity index.* Retired slots accumulate at twelve bytes per 65,536 entity
lifetimes, and a high-water mark of concurrent entities is held for the life of
the process. A seven-hour session at a million deaths a second retires 4.6 MB.

*The table list.* **Rows are reused — entity churn costs nothing.** 200,000
spawns through one archetype leave its column capacity where it started. But an
archetype, once created, is never destroyed: six allocations and a few hundred
bytes, kept empty forever. The count is the number of distinct *shapes* a program
has — a few dozen — and no longer grows with relationships now that the target is
data. Two thousand ships is one table.

Neither has an obvious fix, and for the same reason: an index *is* a handle, so
moving a slot invalidates handles in data structures the ECS cannot see. The note
at the top of `src/ecs/entities.ts` lays out the three shapes a fix could take;
`src/ecs/archetype.ts` covers the table side. The one a game actually wants is a
`World.reset()` at a level boundary, which solves both at once.

## Layout

```
build.ts                    shaders -> SPIR-V -> manifest, then the program
assets/
  fonts/                    the overlay's two faces, and their licences
  materials/                PBR maps, one folder per material
  models/                   one glTF sample, for --model
shaders/
  include/                  frame, cluster, light, pbr, shadow, fullscreen
  *.wgsl                    one file per pass
src/
  main.ts                   entry point, nothing else
  app/                      options, display, frame loop, test scene
  core/                     clock, input, sample statistics
  ecs/
    id.ts                   the u64 bit layout, pairs, wildcards
    entities.ts             liveness, generations, the free list
    component.ts            size, alignment, and the per-type hooks
    column.ts               one component's rows, type-erased
    archetype.ts            a table, its signature and its graph edges
    world.ts                the front door
    query.ts                terms, matching, iteration
    relation.ts             the reverse index, and cached views
  harness/
    run.ts                  the --headless entry point
    suites.ts               the registry, which is the whole list
    testing.ts              assertions and their tally
    bench.ts                batched CPU timing
    suites/                 one file per area, `*_test.ts` and `*_bench.ts`
  bindings/SDL3/            SDL3 bindings
  bindings/SDL3_image/      SDL3_image bindings
  bindings/SDL3_ttf/        SDL3_ttf bindings
  bindings/encke_gltf/      the glTF loader's C ABI
  renderer/
    config.ts               every tunable, mirrored against a shader
    renderer.ts             the frame graph
    assets/                 texture decode, material sets, glTF import
    cluster/                the cluster buffers
    frame/                  uniform layouts, render targets
    geometry/               mesh data, box, sphere, GPU upload
    gpu/                    buffer, texture, sampler, pipeline helpers
    passes/                 one file per pass
    scene/                  camera, lights, materials, cascade fitting
    ui/                     overlay atlas, draw list, debug HUD
tools/
  shadercc/                 WGSL -> SPIR-V, in SDL's binding layout
  gltf/                     glTF -> encke meshes, a Rust cdylib
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

`tools/gltf` is the fourth native library and the only one built rather than
fetched: `cargo build --release`, then the shared library beside the executable
and the link-time stub into `build/gltf/`. Two files rather than one because
cargo names a Windows cdylib's import library `encke_gltf.dll.lib` while
`systemLib` looks for `encke_gltf.lib`, so it is copied under the name the linker
would spell.

**`bin/encke_gltf.dll` and `bin/encke.exe` are one unit and must be rebuilt
together.** They share a struct layout that no compiler checks — there is no
header, only `tools/gltf/src/scene.rs` and `src/bindings/encke_gltf/types.ts`
saying the same thing twice — and a stale DLL reads the fields at the wrong
offsets rather than failing. `encke_gltf_abi_version` exists to turn that into a
line in the log, and is bumped whenever either side changes shape.

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

## Licence

Apache-2.0. Copyright 2026 Daniel "King Numsgil" Grondin; the full text is in
`LICENSE`.

Two exceptions, both under `assets/`:

* **`assets/models/`** — Khronos glTF sample assets, under their own terms.
  `MetalRoughSpheresNoTextures.glb` is CC0. **`DamagedHelmet.glb` derives from a
  CC BY-NC 4.0 model and may not be used commercially**, whatever the licence on
  the code around it. `assets/models/README.md` carries the attribution and
  Khronos' own licence file sits beside the model. Anyone shipping something
  built on this should delete it and put their own content in its place.
* **`assets/fonts/` and `assets/materials/`** — SIL OFL and CC0 respectively,
  each with its licence in the folder.

## Not in this phase

Transparency, moment shadow maps or any non-CSM technique, HBAO (tried, cost
more, looked worse), upscaling, and the parts of glTF listed above — skinning,
morph targets and animation chief among them.
