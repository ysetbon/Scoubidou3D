# Box stitches — every m × n face

Two things, and they are the same object seen twice.

**In the studio**, all 64 faces are samples in both hands — `box-lh-3x2`,
`box-rh-8x8` and the rest — built by
[`src/model/boxmn.ts`](../../src/model/boxmn.ts) and listed as a grid in
Browse samples…, beside the twist family. Orbit one:
[3×2 LH](https://ysetbon.github.io/Scoubidou3D/app/?sample=box-lh-3x2),
[8×8 LH](https://ysetbon.github.io/Scoubidou3D/app/?sample=box-lh-8x8).
Every link is in [links.md](../links.md#the-mn-faces-in-the-studio).

**Drawn flat**, [`artifact.html`](artifact.html) is the source of the published
**Box Stitches** sheet:
<https://claude.ai/code/artifact/a733e1f3-9ed4-490d-845d-c6090e89abb4>.

`npm run check:box` holds the two together. They cannot share code — the sheet is
one self-contained file on a host that can fetch nothing — so the check reads the
page's own drawing code out of the HTML and puts every strand of every scene
against the segment the sheet would draw for it.

It is a companion to [Twist Stitches](https://claude.ai/code/artifact/2a07b85f-3b94-4257-b201-d2d6ab74c0e1).
A box stitch is the same starting stitch as a twist at **k = 0**: every loose end
pairs with the end straight opposite, so each arm carries on along its own line
and back over the block, and the alignment pass has nothing to do.

The first version of the sheet drew four sizes — 1×1, 2×1, 3×2 and 3×3, in both
hands — as SVG baked into the page, straight out of the generator's JSON. This
version draws **all sixty-four faces, 1×1 through 8×8**, in both hands, which is
far too much SVG to bake: the page carries the construction instead and lays each
drawing out on demand.

```
docs/box-stitch-mxn/artifact.html    the page — no <html>/<head>/<body>, the
                                     Artifact host supplies those
```

## What the page holds

| section | what it is |
| --- | --- |
| Anatomy | 3 × 2 left hand, starting stitch and box, with every arm named |
| How one is made | the four passes, and why the fifth does nothing at k = 0 |
| The rules | sets, directions, bar lengths, strand counts |
| Every stitch | an 8 × 8 sheet of thumbnails; pick one to see it four ways |
| Every size | all 64 faces measured |

The sheet draws a cell when it comes near the viewport and gives the nodes back
when it leaves — sixty-four boxes at once is around 55 000 DOM nodes, and an 8 × 8
is 336 strands on its own.

## The construction

Straight out of `twoFanStitch` in [`src/model/twofan.ts`](../../src/model/twofan.ts),
with no twist on top. Rows and columns sit one `GAP` (56 px) apart, an arm runs
`POKE` (32 px) past the far edge of the band it crosses, and the continuation runs
from an arm's free end back the way it came for `112m + 60` (horizontal) or
`112n + 60` (vertical). [`src/model/boxmn.ts`](../../src/model/boxmn.ts) builds the
same thing as a scene, with `levelBreaks` splitting block from continuation so the
level control shows the starting stitch and then the box closed over it.

**The hand.** A twist mirrors the whole scene; a box only swaps which of a set's
two lines each arm takes. The two are the same object — reflect one and rename
`_2` to `_3` — but built this way the ids match in both hands, and so does the
mask list.

**The weave** is half masks and half stacking. Only `_2` over `_3` and `_3` over
`_2` are masked, at each layer; the other half of the crossings fall to the layer
stack, which is why a layer's warps go down before its wefts. `check:box` resolves
all 20 736 crossings the way the scene does and demands the alternation.

Set colours are the one thing the page chooses for itself. The original generator
randomises them past the second set, so the page fixes a palette instead —
horizontal sets by index, vertical sets along one indigo ramp — and keeps it the
same at every size.

## Checking the sheet

The drawing code was written against the eight stitches the first version was
generated from, and reproduces their SVG **byte for byte** — same coordinates,
same layer order, same mask ids, same labels. Two things were changed on purpose,
and only where the published four never reached:

- **The frame opens for the labels.** A label is sized off the drawing so it comes
  out the same size on screen whatever the face; at 4 × 4 and up that outgrew the
  48 / 56 px margin the first four were framed with, so the margin now opens far
  enough to hold it.
- **The label size is capped by the pitch.** The arms a label names are 112 px
  apart, so past a point the scaling would run one label into the next.

Neither binds below 4 × 4, which is why all sixteen published drawings still come
out unchanged.
