# Fonts

Two faces, one sans and one monospaced, both under the
[SIL Open Font License 1.1](https://openfontlicense.org). The OFL permits
bundling and redistribution inside a larger work; the licence text has to travel
with the font, which is what the `.txt` files beside them are for.

| file | family | version | upstream | licence |
|---|---|---|---|---|
| `Inter-Regular.ttf` | Inter | 4.1 | [rsms/inter](https://github.com/rsms/inter/releases/tag/v4.1) | `Inter-LICENSE.txt` |
| `JetBrainsMono-Regular.ttf` | JetBrains Mono | 2.304 | [JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono/releases/tag/v2.304) | `JetBrainsMono-OFL.txt` |

Copyright (c) 2016 The Inter Project Authors.
Copyright 2020 The JetBrains Mono Project Authors.

Neither licence requires attribution in a shipped binary, only that the licence
travels with the font and that the fonts are not sold on their own. Credited
here anyway, for the same reason `../materials/README.md` credits ambientCG.

## Why these two

Inter is drawn for screen text at small sizes — a tall x-height and open
apertures, which is what keeps a 12px label legible over a rendered scene rather
than merely present. JetBrains Mono is the monospaced counterpart, for anything
that has to line up in columns: frame timings, GPU counters, the debug overlay.

Both are the **static Regular** cut rather than the variable font. FreeType will
happily load a variable font, but it instantiates the default master and nothing
here asks for another weight, so the extra axis is bytes that never get used.
The other weights are in the upstream releases linked above if that changes.

## Notes

`.ttf`, not `.otf`: SDL_ttf hands both to FreeType and either would work, but
TrueType outlines are what its hinting modes (`TTF_HintingFlags`) were built
for, and hinting is what makes small text crisp.

Only these two files are committed out of each release — the archives also carry
italics, display cuts, web fonts and the no-ligature `JetBrainsMonoNL` variant,
none of which anything here loads.
