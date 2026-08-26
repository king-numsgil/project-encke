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

Filenames are fixed — `color.jpg`, `normal.jpg`, `roughness.jpg`, `ao.jpg` — and
a missing one is not an error. `renderer/assets/material_set.ts` substitutes a
1x1 fallback that leaves the surface exactly as the numeric material parameters
describe it, which is why `metal/` works without an `ao.jpg`.

**`color.jpg` is sRGB; the other three are linear.** They are uploaded with
different texture formats for that reason — sampling an sRGB image as linear
data gives a washed-out surface, and sampling a roughness map as sRGB gives a
material that is far smoother than it should be. See `loadTexture` in
`renderer/assets/texture.ts`.

The normal maps are the **GL** convention (green points up). If a surface ever
looks inverted — bricks sunken rather than raised — that is the DX convention
sneaking in, and the fix is negating the sampled green channel, not changing
the lighting.
