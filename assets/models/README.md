# Models

glTF assets, so that the test scene and `--model` have real content to work with.
**Neither of these is under the repository's Apache-2.0 licence** — see below.

| file | source | licence |
|---|---|---|
| `DamagedHelmet.glb` | [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/DamagedHelmet) | CC BY 4.0 **and** CC BY-NC 4.0 — see `DamagedHelmet-LICENSE.md` |
| `MetalRoughSpheresNoTextures.glb` | [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/MetalRoughSpheresNoTextures) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) — public domain, no attribution required |

## Attribution

**Damaged Helmet**

> © 2018, ctxwing — [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode).
> Rebuild and conversion to glTF.
>
> © 2016, theblueturtle\_ — [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/legalcode).
> Earlier version of the model.

**The non-commercial clause is real and it is not the repository's licence.** The
earlier version this model derives from is CC BY-NC 4.0, so this one file may not
be used commercially even though the code around it is Apache-2.0. Anyone
shipping something built on encke should delete `DamagedHelmet.glb`, drop the
call in `app/testscene.ts`, and put their own content in its place — which is
what that call is there to demonstrate anyway.

`DamagedHelmet-LICENSE.md` is Khronos' own licence file for the model, committed
unedited beside it.

## What each one is for

**`DamagedHelmet.glb` is the test scene's content**, fifty of it, scattered by
`scatterHelmets` in `app/testscene.ts`. It earns that place by being awkward in
all the ways authored content is and procedural geometry is not: fifteen thousand
triangles, UV seams, a normal map that disagrees with the geometry at the
silhouette, an emissive map, occlusion and metallic-roughness packed into one
image, **no `TANGENT` attribute at all** so the basis has to be generated, and a
node rotation standing a Z-up mesh upright. Every one of those is a separate way
the loader could be wrong, and all of them are visible at a glance.

Fifty of them cost about 1.1 ms a frame at 1600x900 on top of the procedural
scene's 2.3 — and they are one mesh, one material and five textures, because the
file is read once and every helmet is another entry in `Scene.instances`.

**`MetalRoughSpheresNoTextures.glb` is a renderer test** rather than a pretty
picture: a grid sweeping metalness against roughness, with no textures at all, so
every sphere reads its two numbers from the material factors alone. That is
precisely the path the metallic-roughness packing goes through, and a swapped
channel shows up here as a row that does not vary where on a textured model it
would hide in the detail. It also brings 119 nodes and 99 materials through the
flattening in `tools/gltf`.

```bash
bin/encke --model assets/models/MetalRoughSpheresNoTextures.glb --model-scale 900
```

**The scale is not a mistake.** The spheres are spaced a thousandth of a unit
apart in the file, so at its authored size the whole grid is a tenth of a
millimetre across and renders as nothing at all. That is exactly the case
`--model-scale` exists for, and it is worth meeting once: glTF's unit is the
metre and a great many assets in the wild do not honour it, so a model that
loaded perfectly and shows nothing is the most common way this goes wrong.
