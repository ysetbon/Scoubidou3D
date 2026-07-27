# Deriving the turn — a proposition

*Status: proposition. The algebra is proved and the construction is built and
checked in code; the physical claim in [§4](#4-the-snug-limit) has been tested
against one hand-built stitch only, and the 3×1 in [§7](#7-the-3×1-prediction)
is a prediction waiting to be built.*

---

## The question

The 26° in [the twist-stitch note](README.md) was **fitted**. It came out of a
Kabsch fit of one hand-built scene onto itself one level up — 24.6° and 26.0° —
and 26 was the number carried upward. That is a measurement, not an explanation.
It does not say why a 2×1 stitch turns about 26° rather than 5° or 50°, and it
gives nothing at all for a 3×1.

This note proposes that the turn is **not a free parameter**. It is fixed by two
things you can measure with a ruler: the shape of the woven face, and how far you
pull each fold through. Everything else — every reach, every arm length, the
whole column — follows.

---

## 1. The m×1 family

An **m×1** stitch is a rectangular column whose woven face is *m* times as long
as it is deep. Count the arms round the perimeter of an m×1 rectangle of cells
and you get `2m + 2`, so:

| | m×1 |
| --- | --- |
| laces | m + 1 |
| arms per level | 2m + 2 |
| warp arms (across the face) | 2m |
| weft arms (through it) | 2 |
| crossings per level | 4m |
| masks per level | 2m |
| strands, k twists | 3(m+1) + 2(m+1)·k |
| junctions, k twists | 2(m+1)·k |

m = 1 is the box stitch (2 laces, 4 arms). m = 2 is the stitch we built (3 laces,
6 arms, 8 crossings, 4 masks — which is exactly what `twist-stitch-10` has).
m = 3 is next.

Write `w` for the lace width, `G` for the gap between neighbouring warp lines and
`V` for the gap between the two weft lines. Laid snug, all three are equal. The
warp slots sit at

```
a_j = (m − ½ − j)·G        j = 0 … 2m−1
```

and the weft slots at `b = ±V/2`. Each lace owns an **adjacent pair** of slots —
`(0,1), (2,3), …` for the warp, `(V0,V1)` for the weft — so a fold always
migrates by exactly one gap, whatever m is.

---

## 2. The law

Here is the whole derivation. It is three lines.

An arm has to lie **along** its slot line, not at an angle to it. Its far end is
its own tip, which we place on the line by construction. Its near end is the tip
its lace left behind one level down — placed in the *previous* frame. So the
constraint is: **the tip an arm leaves must land on the line its lace folds onto
next.**

Take the weft. At level *n* the arm in `V0` lies on `b = −V/2` and its tip sits
`ρ` out from the centre — ρ is *how far the fold is pulled through*, the one
genuinely physical quantity here. Turning the frame by θ takes coordinates
`(a, b)` to `(a·cosθ + b·sinθ, −a·sinθ + b·cosθ)`, so that tip's new offset is

```
b′ = ρ·sinθ − (V/2)·cosθ
```

and it must equal `+V/2`, the other weft line. Solve:

```
ρ·sinθ = (V/2)·(1 + cosθ)
```

```
────────────────────────────────────────────
   ρ  =  (V/2)·cot(θ/2)        θ = 2·arctan( (V/2) / ρ )
────────────────────────────────────────────
```

**That is the law.** The turn and the pull are the same number seen twice. Pull
the fold tighter — smaller ρ — and the stitch twists *more*. Leave slack and it
twists less.

![the twist is the angle the two weft lines subtend](fig/law.svg)

Geometrically it is even simpler than the algebra. The tip and its image sit at
the same distance `r = √(ρ² + (V/2)²)` from the centre, one on each weft line, so
the turn is just **the angle those two lines subtend at the centre, seen from the
tip's distance**. Nothing else could it be.

---

## 3. What follows, for free

With θ fixed, no freedom is left anywhere. The same "tip lands on the next line"
condition, applied to a warp slot at offset `a` whose sibling is at `a′`, gives

```
R = | a′ − a·cosθ | / sinθ
```

and three things drop out of it:

- **Arm length = 2R.** The arm runs from `+R` to `−R` along its own line. (The
  incoming tip lands at exactly `+R`; that is not assumed, it falls out of the
  rotation.)
- **A lace's two reaches sum to `G·cot(θ/2)`** — the same `cot(θ/2)` as the weft,
  so a lace's two arms always sum to twice the face length.
- **The weft arms are each exactly the face length.**

So the ideal stitch is *uniform*: every fold the same, every tip on one circle.
Which is [the cylinder we started from](README.md#8-why-it-is-grown-and-not-derived)
— see [§6](#6-slack-is-what-makes-a-stitch-look-handmade).

---

## 4. The snug limit

ρ still has to come from somewhere. The one bound it cannot escape: a weft arm
must **cross its own face**. Its tip has to reach at least the far edge of the
outermost warp arm, at `(m − ½)·G + w/2`. So

```
ρ ≥ ρ_min = ( (2m−1)·G + w ) / 2
```

and since θ falls as ρ rises, the **tightest possible stitch** is `ρ = ρ_min`:

```
tan(θ/2)  =  V / ( (2m−1)·G + w )
```

Laid snug — `G = V = w`, laces touching — that collapses to

```
────────────────────────────────
     tan(θ/2)  =  1 / (2m)
────────────────────────────────
```

**The twist of a snug m×1 stitch depends on nothing but m.** Not on the lace
width, not on the scale — only on how many laces wide the face is.

And it is exact in a satisfying way: `(4m² − 1, 4m, 4m² + 1)` is a Pythagorean
triple, so cos θ and sin θ are rational for every whole m.

| m | θ | cos θ | sin θ | levels per full turn |
| --- | --- | --- | --- | --- |
| 1 | 53.130° | 3/5 | 4/5 | 6.8 |
| **2** | **28.072°** | 15/17 | 8/17 | 12.8 |
| **3** | **18.925°** | 35/37 | 12/37 | 19.0 |
| 4 | 14.250° | 63/65 | 16/65 | 25.3 |
| 5 | 11.421° | 99/101 | 20/101 | 31.5 |

A wider stitch turns less. That is the headline prediction, and it is easy to
check by eye on a real lanyard.

---

## 5. Does it reproduce the 2×1?

Building an m×1 from the formulas above and nothing else, for m = 2:

| | from the law | `twist-stitch-10` |
| --- | --- | --- |
| strands (10 twists) | 69 | 69 |
| masks | 44 | 44 |
| level breaks | 10 | 10 |
| junctions | 66 | 66 |
| warp parallel to | 0.0000° | 2.52° |
| weft parallel to | 0.0000° | 2.10° |
| weave | O,u,O,u on both weft arms, all 11 levels | same |
| θ | 28.07° snug | 26.0° fitted |

Every count matches. The generated stitch is *more* regular than the hand-built
one, which is the expected direction. And the angle is close but not equal:
28.07° snug against 26.0° measured.

That gap is exactly what ρ is for. Writing `s = ρ / ρ_min` for how much further
than snug the folds are pulled:

```
s = cot(13°) / 4  =  1.083
```

The hand-built stitch is **8% slacker than snug**. One number, and the law lands
on the measurement. (It is not a free fit in disguise — `s` is a single scalar
that must then predict *every* reach in the stitch, and it does.)

---

## 6. Slack is what makes a stitch look handmade

The ideal predicts every fold the same length. The real one has six folds of
461, 405, 211, 267, 303 and 272 units. There is no contradiction: **ρ is per
arm.** Every arm is pulled a slightly different amount, so each has its own
`ρ_k`, and each *would* imply its own `θ_k`.

But a level can only turn by one angle. The stitch resolves the disagreement by
letting the arms **lean** a little off their slot lines — which is exactly the
2.5° of warp spread the hand-built stitch carries, and exactly the thing an
idealised construction throws away. So:

> The law fixes the mean turn. The scatter of `ρ_k` about it is the hand of
> whoever tied it, and it shows up as lean.

That is testable too, and it is the sharpest form of the proposition: **the
spread of arm lengths within a level should predict the spread of arm angles.**

---

## 7. The 3×1 prediction

Everything needed to build one, with no measurement of a real 3×1 anywhere in it.
Snug, `w = G = V = 54`:

```
θ        = 2·arctan(1/6) = 18.9246°        cos θ = 35/37   sin θ = 12/37
face     = 324 × 108  (3 : 1)
ρ (weft) = 162
warp slots  a_j = (2.5 − j)·54  =  +135, +81, +27, −27, −81, −135
lace pairs  (0,1) (2,3) (4,5) warp,  (V0,V1) weft
```

Reaches, all forced:

| lace | slots | reach out | reach back | arm lengths |
| --- | --- | --- | --- | --- |
| weft | V0 / V1 | 162 | 162 | 324 / 324 |
| warp A | W0 / W1 | 144 | 180 | 288 / 360 |
| warp B | W2 / W3 | 162 | 162 | 324 / 324 |
| warp C | W4 / W5 | 180 | 144 | 360 / 288 |

Counts at ten twists: **92 strands, 66 masks, 10 level breaks, 88 junctions.**
Masks per level: `V0` over the even warp slots, `V1` over the odd ones.

Built straight from those numbers, this is what comes out:

<img src="fig/pred-3x1.png" width="420" alt="The predicted 3x1 column"> <img src="fig/pred-3x1-top.png" width="330" alt="The predicted 3x1 face from above">

Machine-checked on that build: 92 / 66 / 10 as predicted, 88 junctions with no
forks, every parent anchor exact, **132 crossings and not one more** (no warp
crossing warp), every weft arm reading `O,u,O,u,O,u` across all six warp arms on
all eleven levels, and warp and weft each parallel to **0.0000°**.

If instead the 3×1 is worked at the same 8% slack as the hand-built 2×1:

```
θ = 2·arctan( 1 / (6 × 1.083) ) = 17.49°
```

So the prediction to test is **θ(3×1) ≈ 17.5°–18.9°**, against 26° for the 2×1.

---

## 8. How to falsify it

Build a 3×1 by hand in the app the way the 2×1 was built — starting stitch plus
two twists — and fit the turn the same way (Kabsch on the level's crossing
points).

- **θ ≈ 17–19°** → the law holds; the turn really is set by the aspect ratio, and
  `twistStitch` can be replaced by an `m` parameter.
- **θ ≈ 26° again**, independent of m → the law is wrong. The turn would then be
  something about the *lace* rather than the face — thickness, or friction, or
  how far a thumb naturally pushes a fold.
- **θ between, drifting the wrong way with m** → the face shape matters but the
  1/(2m) form is wrong, and `ρ_min` is the suspect: perhaps a fold must clear the
  face by a fixed margin rather than reach exactly to its edge, which would put a
  constant inside the arctan.

The middle answer is the interesting one, and none of the three needs more than
one hand-built 3×1 to settle.

---

## 9. What this does not yet explain

- **Why the arms alternate travel direction** across the row (`W0` one way, `W1`
  the other, `W2` back again). It does not affect the weave, and the law is
  silent on it.
- **Where the base level's overhang `E` comes from.** The pinned run's poke past
  the face is treated as free here.
- **m × n for n > 1.** Everything above assumes exactly two weft arms. A 2×2
  stitch would have four, the face would be a square grid rather than a band, and
  the "two weft lines subtend θ" picture needs redoing.
- **Whether ρ_min is really the tightest a hand can pull.** It is the tightest
  that still *works*; a real thumb may stop short of it.
