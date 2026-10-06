# The over/under default on one plane

What the studio does at a crossing when nobody has masked or placed it, and the
**contact weave** that replaces it for new scenes. The live comparison, on the
real renderer, is `artifacts/over-under-default/` (`npm run artifact --
over-under-default`).

## Before

With no mask the higher layer rides over (`weaveCenterlines`,
`over = masked ?? j`). Away from a crossing a lace rests at its layer rank times
the layer lift (default 10 px), and at a crossing the over lace is lifted **Depth**
(26 px) above the plane the two share while the under lace is lowered by the
same. For two strands on one storey that is:

| | |
| --- | --- |
| over lace | +31 px against the storey middle (yellow rests 10 px up) |
| under lace | −21 px |
| centre to centre | 52 px |
| air between | 26 px, a full strand thickness |

## The contact weave

`Scene3D.contact`. Off or absent is the behaviour above, exactly.

On:

- a lace rests on the **middle** of its storey (rung 0) wherever nothing crosses it
- at an unplaced crossing the lace that rides over sits half a thickness above
  the middle and the one that ducks under half a thickness below, so the surfaces
  touch: 26 px centre to centre, 0 px of air
- Depth only opens air beyond a full thickness, so the default of 26 changes nothing further
- placed planes (`planes`, `crossPlanes`) still outrank it

Measured on the engine, two strands at 90° on one storey: over +13, under −13,
free ends 0 and 0. With one strand attached (`two-crossing-attached`), all three
crossings come out 26 px apart and every free end rests at 0.

## Where it is on

- **The empty scene the app opens on.** Every strand you draw, add with **+ New**
  or grow with **Attach** lands in that scene, so it follows the contact weave.
  Checked in the running app: two new strands meet at +13 / −13 with 0 px of air,
  a strand attached to one of them and dragged back across the other meets it the
  same way, and every free end rests at 0.
- The `two-crossing` and `two-crossing-attached` samples.

Not switched on: the stitch samples, which were built and checked against the old
heights, and loaded files (a saved scene keeps its own setting, an OpenStrand
import comes in with it off).

## Open

- Strands that overlap without crossing lose the layer lift in this mode.
- The glued joint between two members of one lace is counted as a crossing
  (`1_2 over 1_1`), before and after. The contact weave halves the step it asks for
  there (26 px, from 52) but does not remove it.
- With no margin, thick or curved laces may flicker where surfaces meet.
