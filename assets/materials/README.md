# Materials

PBR maps from [ambientCG](https://ambientcg.com), released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) — public domain,
no attribution required. Credited here anyway because knowing where an asset
came from is worth more than the licence requires.

| folder | source asset | maps |
|---|---|---|
| `bricks/` | [Bricks075A](https://ambientcg.com/view?id=Bricks075A) | color, normal, roughness, ao |
| `planks/` | [Planks020](https://ambientcg.com/view?id=Planks020) | color, normal, roughness, ao |
| `metal/` | [Metal046A](https://ambientcg.com/view?id=Metal046A) | color, normal, roughness |

1K, JPEG. The originals also carry displacement, metalness and a DirectX-convention
normal map; those are not used and are not committed.

## What the renderer expects

Filenames are fixed — `color.jpg`, `normal.jpg`, `roughness.jpg`, `metallic.jpg`,
`ao.jpg`, `emissive.jpg` — and a missing one is not an error.
`renderer/assets/material_set.ts` substitutes a 1x1 fallback that leaves the
surface exactly as the numeric material parameters describe it, which is why
`metal/` works without an `ao.jpg`.

**These folders are the glTF texture set, spelled as separate files.** The shader
binds five maps and they are glTF's own — base colour, normal,
metallic-roughness, occlusion, emissive — so that a folder here and a `.glb`
take one code path. The one place the two disagree is metalness and roughness:
glTF packs them into one image (`g` roughness, `b` metallic) and these folders
author them apart, so `loadOrmTexture` combines the two files into that layout at
load time. A folder with only a `roughness.jpg` gets `b = 1`, which leaves the
material's numeric metallic factor standing alone.

**`color.jpg` and `emissive.jpg` are sRGB; the rest are linear.** They are
uploaded with different texture formats for that reason — sampling an sRGB image
as linear data gives a washed-out surface, and sampling a roughness map as sRGB
gives a material that is far smoother than it should be. See `loadTexture` in
`renderer/assets/texture.ts`.

The normal maps are the **GL** convention (green points up). If a surface ever
looks inverted — bricks sunken rather than raised — that is the DX convention
sneaking in, and the fix is negating the sampled green channel, not changing
the lighting.
