# /foldlab — the 1_2 / 2_3 band, handed over

The fold on two of the four arms still does not read right to the author. Four
rounds of fixes have gone in and each one was real, but the thing they were
chasing is not finished. This is what is known, what is already ruled out, and
how to measure — so the next pass starts from the evidence rather than from
scratch.

Branch `claude/vigilant-dirac-mgmulc`, PR #170 (draft, CI green).
Current head at time of writing: `45cf189`.

## The scene, and how to see it

`/foldlab/` opens on `src/foldlab/two-crossing.json` — six strands, two laces of
three arms each, one level:

    lace 0:  2_3 · 2_1 · 2_2
    lace 1:  1_2 · 1_1 · 1_3

`npm run dev` opens the page. The opening plane sheet (`OPENING` in
`src/foldlab/main.ts`) rests the two cores on `bottom` and the four arms on
`top`, so every fold climbs two thicknesses and every C is the same C.

## Which arms, and why those

`1_2` and `2_3` are the ones the author calls wrong. They are exactly the arms
with `parentSide: 0` — glued to their parent's START — and that is the same
thing as being the HEAD of their merged lace:

| arm | parentSide | its stretch of the merged lace |
| --- | --- | --- |
| `1_2`, `2_3` | 0 | 0–31 (head) |
| `1_3`, `2_2` | 1 | 78–111 (tail) |

The merge has to traverse a head arm backwards to build the lace. That is the
structural difference and it has been confirmed twice, on two different scenes.

## What is already fixed — do not redo these

Each was measured before and after. The measurements are in the commit bodies.

- **`aa03804`** — a crossing anchored both runs at `storey ± t/2`, absolute about
  the storey, which overruled the declared planes wherever crossings covered the
  run. Runs rested at `±0.258` against a thickness of `0.52`; every fold climbed
  half what the sheet said. A crossing now swings about the two runs' own
  declared heights, and does not swing at all when those already clear each
  other the right way up.
- **`c5aa8a1`** — every turn's entry landed exactly on its run and every exit
  missed by `0.29–0.37` (run step `~0.19`). Where the next thing along was the
  next turn's entry the two met in a 73°/58° kink.
- **`e654209`** — the real cause of that miss: the lab's **crease walk** had not
  been ported. An oblique crease must advance the strip along itself as it rolls;
  only a dead-0° fold-back rolls in place. Without it the turn lands short by
  `πh/tan(tipTurn/2)`, which is exactly the number above. Ported whole, with the
  lab's cap. `turnMode` also relabelled: the lab's published window is square
  48–61°, so a 24° separation is a **fold**, not a square.
- **`45cf189`** — `zTurn`'s legs leave flat, so a vertical thickness axis suits
  them; they do not STAY flat, because `restore` gives them back the weave's
  dips. Measured gradient `0.68` on a leg whose axis still stood straight up —
  47° off square, `|up × tan|` down to `0.72` — so the across-axis was skew and
  the bight funnelled to a point. The frame is now squared to the path before
  use. Also took the lab's sampling (20 per leg, 56 round the tip) and moved the
  landing residual onto the outgoing leg alone so nothing touches the tip.

## Where it stands now, measured

Same probe on `159e210` (before all four) and `45cf189` (after):

| | before | after |
| --- | --- | --- |
| worst plan corner | 180° | 17° |
| worst 2nd difference, lace 0 | 0.2257 | 0.0396 |
| worst 2nd difference, lace 1 | 0.3579 | 0.0533 |
| ledger reads the fold as | `square, sep 24–25°` | `fold, sep 24–25°` |

## What is still open

1. **The author still reports `1_2` / `2_3`'s band as wrong.** The specific
   visual symptom has not been isolated. Ask for it before theorising — which
   view, and whether it is the bight itself, the run going in, or the run
   leaving. Two rounds were burned guessing.
2. **A cosmetic regression I introduced.** `cullFoldThrough` (`ribbon.ts`, set
   only by the outline build in `StrandScene`) drops quads that fold through
   themselves inside a turn. It removes the black star that used to flood the
   bight, but it also drops some quads that were carrying the silhouette rim —
   small white notches along the top edge of the fold. Tighten it to keep
   silhouette-carrying quads.

## Ruled out — measured, not guessed

Do not spend rounds on these again.

- **The two C's are not different geometry.** Put in a local frame at each tip
  they match to 3 decimals through the whole turn, position and frame both.
- **Band roll.** Widest-chord tilt out of level is 0–1° along both laces. Neither
  band is twisted or on edge.
- **Winding.** The vertex-0 edge flips at the same rings on both laces; it tracks
  the roll, not a numbering flip.
- **Stray geometry.** No vertex sits further than `0.540` from the centreline,
  against a half-width of `0.540`.
- **Bowties.** No ring pair walks backwards along the path.
- **Ring collapse.** Every body ring is full width; the only rings that taper to
  zero are the dome end caps, which is correct.
- **The elevation panel.** It draws `1_2` and `1_3` identically. The only
  head/tail difference there is cosmetic: the layer label is placed at the lower
  merged index, which is the C end for a tail and the free end for a head.

## Measuring

The page exposes `window.__foldlab = { view, scene, plane }` in dev. Everything
above was measured through Playwright against a local dev server, reading
`view.laceCenterlines[i].line` (the merged centreline, post-`zFolds`, each point
optionally carrying `up`) and `view.strandGroup.children[i].children[0]` (the
swept body; `children[1]` is the outline shell). Rings are 16 vertices, in
centreline order.

The checks worth keeping: worst plan corner; worst second difference in z;
`up · tan` per point (must be 0 — but note the STORED frame is the raw one,
since the squaring in `ribbon.ts` never writes back, so this only diagnoses
input); ring width and ring-plane squareness off the mesh; and the ledger's
Copy text for modes, separations and climbs.

## The design it is meant to match

`docs/z-lab.md` on `claude/scouiboud3d-z-connection-87cxcn` is the source of
truth for the turn. Its build is `src/zlab/bands.ts` on that branch. `zturn.ts`
is our own construction against the studio's centrelines, but the angle rule,
the walk, the cap and the sampling are all the lab's and should stay that way —
where the two disagree, the lab is right.
