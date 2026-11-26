# Stretch — pull a level's knot tight

The **Functions** view is the fourth side of the switch at the top of the layer
panel, next to **Level**. It draws one section per level, and in each section the
things that level can be asked to do to itself. The first of them is **Stretch**.

Press it and the level is pulled tight, the way pulling its loose ends would do
it: every strand that can be straight becomes straight, each fold closes up to
the strand it wraps, arms lying side by side settle one gap apart, and the slack
comes out through the loose ends. Which strand crosses which does not change, so
every mask means afterwards what it meant before. It is one press of undo.

The code is `src/model/stretch.ts` (the algorithm), `src/model/levelFunctions.ts`
(the list the view draws) and `functionsList` in `src/ui/panel.ts` (the view).

## What "tight" means

Every lace is treated as a string under one unit of tension, so the quantity
being made small is **length**: a strand between two joints wants to be the
straight line between them, and a joint wants to slide toward its neighbours. A
loose end is pulled along the line its arm was drawn on, from infinitely far
away — the arm keeps its direction and only slides sideways.

Three clearances push back, and they are the family's own numbers:

| what | how far | where it comes from |
| --- | --- | --- |
| two strands that do not cross | a lace width + 10 between centre lines | `GAP = 56` in `twofan.ts` |
| a fold, past the strand it wraps | half a gap from that strand's centre line | where the built block puts its slants' ends |
| a loose end, past the last strand its arm crosses | half a width + 9 | `POKE = 32` in `twofan.ts` |

Plus one that only matters for real knots: three strands locked round each other
— a over b over c over a — cannot all cover one point, so the triangle between
them cannot shrink to nothing.

Because the rules are the families' rules, **the block the families build is
exactly what Stretch converges to**: `box-lh-1x1` level 0 comes back untouched,
and a 1×1 starting stitch drawn loose by hand comes out as that block, at the
angle it was drawn.

## How it is found

1. **Aim.** Each arm's pull direction is its drawn chord, tidied: the two ends
   of one lace are made exactly opposite when they are within 20° of it, and
   arms within 8° of parallel or square to each other are made exactly so. A
   hand draws "straight across" to a few degrees, and a stitch pulled along
   those few degrees comes out a rhombus. The arms are turned there in
   half-degree steps with the crossings checked at each.
2. **Straighten.** Every bent strand has its handles walked onto its chord, two
   pixels at a time, the weave checked at each step. A strand that gets there is
   handed back as an *untouched* strand — both control points on the start, the
   state a fresh one is born in. One that would have to pass through a crossing
   keeps its handles, and they become unknowns.
3. **Descend.** The unknowns are the joints, each arm's length, and the handles
   of whatever is still bent (measured along and across the strand's own chord,
   so a moving joint carries them). Length plus a quadratic penalty on every
   violated clearance is minimised with L-BFGS, the gradient taken by central
   differences through the app's real curve (`buildProfile`) — what is optimised
   is exactly what is drawn. Every step is capped at 8 px and refused if it would
   make or lose a crossing.
4. **Stiffen.** The penalty is multiplied by ten and the solve repeated from
   where it stopped: 1, 10, … 10⁵. A penalty leaves each clearance short by
   force ÷ stiffness, which is linear in 1/k, so the last two solves are
   extrapolated to an infinitely stiff one. On the test knot the clearances land
   within 10⁻⁹ px of 56 and 28.
5. **Let the slack out.** A lace does not get shorter when it is pulled. Each
   lace keeps its drawn length: what its middle gave up, its arms take.

Straightening comes *before* the descent for a reason. Left to the descent, a
bend is a way to cheat — an arm pulled along a fixed line can still shorten the
knot's middle by kinking sideways just outside it, and the "tightest" stitch
comes out sheared with S-shaped arms. That is what a string does, not what a
lace does.

## What it will and will not do

- **Crossings shed two at a time, or not at all.** An over/under is declared per
  pair, so a strand that passes over another and comes back over it is not held
  by it; pulling takes that loop out. Three crossings may become one, two may
  become none. An odd crossing is an interlock and never goes.
- **A strand drawn straight is never bent.** Where it cannot clear something —
  which happens when the things in its way are pinned by another level — it is
  left overlapping and the row says by how much.
- **One level at a time.** Strands on other storeys are not woven with this one
  and do not move; a joint shared with another storey is a pin. A level held at
  both ends by its neighbours has nothing free, and the row says so.
- **A drawing tighter than the rules opens.** A braid drawn with its runs closer
  than a width + 10 is pushed out to that, and the row reports the slack as
  negative.
- **It stops after 2.5 s** on a level too big to finish in that, and says so; a
  second press carries on from there. Every step along the way is a valid scene.

## Adding another function

`LEVEL_FUNCTIONS` in `src/model/levelFunctions.ts` is the whole of what the view
knows. A function is a label, a line saying what it does, and a
`run(scene, level, ctx)` that returns a **new** scene (never edits the one it was
given), optionally the in-between scenes to play as a motion, and one sentence
saying what happened. Add an entry and it gets a row on every level, an undo
step named after it, and a result line under its button.

## Checking it

    npm run check:stretch

runs the function on `scripts/stretch-knot.json` — the loose hand-drawn stitch it
was written against — and holds the result to its numbers: the nine crossings
are the nine drawn, all six strands come out straight and untouched, arms 56.000
apart, folds 28.000 past what they wrap, both laces the length they were drawn,
and a second press moves nothing. Then the built blocks (already tight, left
alone), a ten-level column (other levels do not move), a locked triangle, a loop
with and without something caught in it, and thirteen of the built-in samples for
the weave surviving. It runs in CI.
