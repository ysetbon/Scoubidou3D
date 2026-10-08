# The 1×1 twist column

The 1×1 twist in the studio's samples — `twofan-col-lh-1x1-10`, `twofan-col-rh-1x1-10`, and the same
at 15 levels (`…-1x1-15`) — is **set level by level on the box's planes**, not derived from a law.
It replaces the two-fan 1×1 column (a constant 50.03° a level) under the same keys, so every older link
still opens a 1×1 twist. Levels 2 to 14 are also samples (`…-1x1-<levels>`), unlisted.

Code: `twist1x1`, `twist1x1Decisions` and `TWIST_1X1_TIPS` in
[`src/model/twistplaced.ts`](../src/model/twistplaced.ts).

## The planes

Read off the built ribbons of the 1×1 box, level by level: from level 2 up every arm **starts on +1,
rests on −1 and ends on −1**; at a crossing the arm on top is on +1 and the one underneath on −1; and the
next level's arms start on +1 (rungs of half a ribbon thickness; a storey is two thicknesses, so each level
rests exactly on the one below). The twist takes those planes as they are: every fold end on −1, every next
arm on +1, crossings ±1 (`boxPlacements`), level 1 the box from `box + strand`.

## The stretch

What is left open at each level is how far its folds sit from the centre — the **tip** — which fixes where
the next level's strands start and, through the landing law at the 56 px gap (`turn = 2·atan(28 / tip)`),
how far the next level is turned. It was set one level at a time on
[`artifacts/twist-1x1-ends`](../artifacts/twist-1x1-ends/) until the column was tight:

| level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 and up |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tip, px | 72.8 | 75.5 | 75.5 | 75.5 | 75.5 | 74.5 | 75.5 | 75 | 75.5 | 75.5 |
| turn into the next level | 42.1° | 40.7° | 40.7° | 40.7° | 40.7° | 41.2° | 40.7° | 40.9° | 40.7° | 40.7° |

Levels beyond the nine that were set carry on at 75.5 px, the value five of the nine were and the one the
rest sit within a pixel of. The grid quotes the mean, 41.0°.

## Why not the old numbers

- The first decided column had every fold end resting on +1, a height that came from a suggestion and is not
  the box's. On the built meshes its crossings were 8–10 px inside each other where the box's are not.
- With the box's heights and the tips first set (60–65 px) the same was true of the fold-end crossings of
  every level: 51 places deeper than 8 px against 5 in the box. That depth falls steadily as the tips grow;
  it is gone from about 66 px.
- At the stretch above, over ten levels: 4 places deeper than 8 px (the box has 5), the deepest 8.9 px (the
  box 9.9), every crossing with the right lace on top, and each fold end 22 px or more clear of the arm it
  crosses. Triangles of one ribbon cutting through another's were counted on the built meshes
  (`artifacts/lib/ribbon-check.js`). The one thing the centreline test still reports is a 6 px graze between
  level 2's arms and level 1's, which is the box's own level 1.

## Seeing it

| artifact | what it settles |
| --- | --- |
| [`twist-1x1-column`](../artifacts/twist-1x1-column/) | The column to 15 levels, one lace at a time, a camera on every fold. |
| [`twist-1x1-ends`](../artifacts/twist-1x1-ends/) | Each fold's end and start plane per arm, and each level's stretch, with the ribbons' cut-through count. |
| [`twist-1x1-planes`](../artifacts/twist-1x1-planes/) | Before and after being put on the box's planes, beside the box. |
| [`twist-1x1-steps`](../artifacts/twist-1x1-steps/) | The page the first tips were set on, level by level. |
