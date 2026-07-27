# The twist stitch — a 2×1 face that turns

Three laces instead of the box stitch's two, and a column that **turns** as it
climbs. One built-in sample:

| sample | levels | strands | masks | level breaks | junctions |
| --- | --- | --- | --- | --- | --- |
| **Twist stitch — 10 twists** (`twist-stitch-10`) | 11 | 69 | 44 | 10 | 66 |

Eleven levels, not ten: a **starting 2×1 stitch** at the bottom and **ten twist
stitches** worked on top of it. It comes out of `twistStitch(twists, name)` in
[`src/model/samples.ts`](../../src/model/samples.ts), and
`twistStitch(2, …)` reproduces — fold for fold, mask for mask, id for id — the
scene this was measured from, built by hand in the app.

![the column](../../site/art/twist-stitch-10.svg)

## The stitch, in three rules

**The face.** Seen from above, a stitch is one flat woven face: four arms lying
side by side **across** it (the *warp* — two from the gold lace, two from the
teal) and two arms lying **through** it (the *weft* — both from the orange
lace). Four arms one way and two the other is what makes the face twice as long
as it is deep, and that is the 2×1 the starting stitch is named for. The box
stitch is the 1×1 case: four arms round a square. Every stitch is therefore
4 × 2 = **eight crossings**, and warp never crosses warp.

**The weave.** A weft arm crosses all four warp arms in a row and goes **over,
under, over, under** along the way; the other weft arm runs the other direction
and so lands on the opposite phase. Plain weave. Half of it the layer order
already has right — every warp arm is laid above both weft arms — so it takes
exactly **four masks a stitch**:

| | over | under |
| --- | --- | --- |
| first weft arm | 1st and 3rd warp arm it meets | 2nd and 4th |
| second weft arm | 1st and 3rd (which are the other two) | 2nd and 4th |

**The twist.** Each arm folds back across the face, and the face it folds onto
is the same face **turned by 28°**. That is the whole stitch — nothing about the
weave changes from one level to the next, the frame it is woven in just keeps
rotating, and ten twists wind the column 280°, most of a full turn. One thing
falls out of the rotation rather than being asked for: a fold lands in its
lace's **other** slot, so the two arms of a lace trade places every level, which
is why an arm's direction reverses *and* swings by 28° each time.

## Every level, from above

Each level in colour with the levels below it in grey. Same face every time,
turned a little further.

![every level](levels.svg)

## Why the reach of a fold is not a free choice

This is the one thing the stitch will not forgive, and getting it wrong is what
the first attempt at this sample did.

A fold starts at the tip its arm left behind one level down — a point placed in
the **previous** frame. If that tip was not dropped exactly on the line the arm
is about to fold along, the arm starts off its own line, and a straight strand
from an off-line start to an on-line tip lies at an **angle** to the three arms
beside it. The face stops being a rectangle and the warp arms fan out by a few
degrees a level, which is plainly visible from above.

So every reach in the generator is **solved, not picked**. A turn of `TURN`
takes frame coordinates `(a, b)` to `(a·cos + b·sin, −a·sin + b·cos)`, so a
slot's offset one level up is `off·cos ± along·sin` — plus for a warp slot,
whose offset is the `a` of that pair, minus for a weft slot, whose offset is the
`b`. Set that equal to the offset of the slot the arm is folding into and there
is exactly one `along` left:

```ts
reach = (next.off − slot.off · cos TURN) / (±1 · slot.dir · sin TURN)
```

With that, all four warp arms of a level are **exactly** parallel, both weft
arms are exactly parallel, and the face stays a rigid rectangle for all eleven
levels. It also explains something that looks like a mistake and is not: an
arm's two folds are **different lengths** (211 and 271 source units here).
Crossing the face outward and crossing back inward are different distances when
the face has turned underneath you.

## Why the turn is 28° and not 26°

Solved reaches put every warp tip on **one circle** round the column, and every
weft tip on another — `(1.5G)² + reach_out² = (0.5G)² + reach_back²` falls
straight out of one point having coordinates in two frames that share an origin.
A tidy envelope, and a hazard:
junction detection ([`connections.ts`](../../src/model/connections.ts)) glues
endpoints purely by coincidence in the drawing plane, with a one-unit snap, and
cannot see the storeys that really keep two tips apart. On a single circle, two
tips five levels apart can land on the same spot and fuse four strand-ends into
a fork, breaking the column into pieces.

Fitting each of the two hand-built twists as a rigid turn of the starting
stitch's eight crossing points gives **24.6°** and **26.0°**. At 26° exactly,
tips five levels apart land **0.8 units** apart — inside the snap — and four
forks appear. 28° is the nearest turn that keeps every pair of distinct
endpoints about **5 units** apart over ten twists, and it sits inside the band
the hand-built scene actually measures: fit its warp arms and you get 32–37°,
fit its weft arms and you get 23°. Freehand, the two disagree; a generated
stitch has to pick one number and hold it.

The real cure is the same one the box stitch wants: make junction detection
level-aware, so endpoints glue only when their strands are on the same or
adjacent storeys. See [box-stitch-levels](../box-stitch-levels/README.md#fold-slots-and-why-the-tips-are-not-all-the-same-length).

## The numbers

| | |
| --- | --- |
| lace width | 54 |
| warp line spacing `G` | 60 — four lines at ±90 and ±30 |
| weft line spacing `V` | 70 — two lines at ±35 |
| face | 234 × 124 including the lace width, so 1.9 : 1 |
| turn per level `TURN` | 28° |
| fold reach | 105 outward, 135 back — solved, see above |
| pinned run overhang `E` | 44 past the far edge |
| loose tails `TAIL` | 130 past the far edge, top level only |

## Changing the twist count

`twistStitch` takes it as an argument; everything else follows.

```ts
// src/model/samples.ts
export const SAMPLES: Record<string, () => Scene3D> = {
  …
  'twist-stitch-10': () => twistStitch(10, 'Twist stitch — 10 twists'),
};
```

Add the matching entry to `SAMPLE_LABELS` and it appears in the Sample dropdown.
Past roughly fifteen twists the single-circle problem above starts to bind
again, and the turn would have to be re-picked.

## What was verified

Rebuilding the scene and walking every level confirms:

- 69 strands, 44 masks, 10 level breaks at 9, 15, 21 … 63
- every strand on its default control-point set (both control points on the
  start, no centre — OSS line mode)
- 66 junctions, every one a clean two-way glue: no forked endpoint, and every
  declared `parentId` / `parentSide` anchor sitting exactly on its parent's end
- closest pair of *distinct* endpoints 5.4 units apart, against a one-unit snap
- per level, the four warp arms parallel to **0.000°** and the two weft arms
  parallel to **0.000°**, the two families exactly 90° apart
- per level, eight crossings and no more — no warp crossing warp, no weft
  crossing weft
- every weft arm reading `over, under, over, under` across the four warp arms,
  on both arms, on all eleven levels
- the first three levels matching the hand-built scene strand for strand:
  same ids, same `parentId` / `parentSide`, same masks in the same order
