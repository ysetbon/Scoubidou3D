# Deriving the turn — a proposition

*Status: proposition. The algebra is proved and the construction is built and
machine-checked for every m×n up to 4×4; the physical claim in
[§4](#4-the-snug-limit) has been tested against one hand-built stitch only, and
the stitches in [§7](#7-what-it-predicts) are predictions waiting to be built.*

---

## The question

The 26° in [the twist-stitch note](README.md) was **fitted** — a Kabsch fit of
one hand-built scene onto itself one level up, 24.6° and 26.0°, and 26 carried
upward. That is a measurement, not an explanation. It does not say why a 2×1
stitch turns about 26° rather than 5° or 50°, and it gives nothing for any other
stitch.

This note proposes that the turn is **not a free parameter**: it is fixed by the
shape of the woven face and by how far each fold is pulled through. Everything
else — every reach, every arm length, which way each arm even runs — follows.

> **A first draft of this note only varied m, holding n = 1.** That was wrong,
> and it hid the interesting half of the answer. The face has two dimensions and
> the law has to treat them the same way. Everything below is symmetric in m and
> n, and n = 1 falls out as a special case.

---

## 1. The m×n family

An **m×n** stitch is a column whose woven face is an m-by-n rectangle of cells.
Count the arms round its perimeter and there are `2(m + n)`:

| | m×n |
| --- | --- |
| laces | m + n |
| arms per level | 2(m + n) |
| **warp** arms — across the face | 2m |
| **weft** arms — through it | 2n |
| crossings per level | 4mn |
| masks per level | 2mn |
| strands, k twists | 3(m+n) + 2(m+n)·k |
| junctions, k twists | 2(m+n)·(k+1) |

`1×1` is the box stitch (2 laces, 4 arms). `2×1` is what we built — 3 laces, 6
arms, 8 crossings, 4 masks, and at ten twists 69 strands / 44 masks / 66
junctions, which is exactly what `twist-stitch-10` has.

Write `w` for the lace width, `G` for the gap between neighbouring warp lines,
`V` for the gap between neighbouring weft lines. Laid snug, all three are equal.
The lines sit at

```
warp   a_j = (m − ½ − j)·G      j = 0 … 2m−1
weft   b_i = (n − ½ − i)·V      i = 0 … 2n−1
```

and each lace owns an **adjacent pair** — `(0,1), (2,3), …` in each family. So a
fold always migrates by exactly one gap, whatever m and n are. The two families
differ in nothing but which axis they run along.

---

## 2. The law

An arm has to lie **along** its own line, not at an angle to it. Its far end is
its tip, which we put on the line by construction. Its near end is the tip its
lace left behind one level down — a point placed in the *previous* frame. So:

> **The tip a fold leaves must land on the line its lace folds onto next.**

Turning the frame by θ takes an offset `o` and an along-coordinate `x` to
`o·cosθ ± x·sinθ` — plus for one family, minus for the other. Setting that equal
to the sibling line's offset `o′` and solving for `x` leaves exactly one answer:

```
────────────────────────────────────────────────────
     x  =  ( o′ − o·cosθ ) / ( ±sinθ )
────────────────────────────────────────────────────
```

Two things come out of that single equation, and neither is a choice.

**The reach** is `R = |x|` — how far past the middle the tip has to sit.

**The direction the arm travels** is `sign(x)`. An arm has no freedom about which
way it runs; the requirement that its tip land on the next line picks the
direction for it. (The first draft of this note hard-coded an alternating
pattern and got the weft backwards for n ≥ 2. Deriving the sign removed both the
guess and the bug.)

### The one physical quantity

For the **outermost** slot of a family the reach comes out smallest, and that arm
is the one that has to work hardest. Call its reach `ρ` — *how far the fold is
pulled through*. Rearranged for the simplest case, n = 1, where the two weft
lines sit symmetrically at `±V/2`:

```
ρ  =  (V/2)·cot(θ/2)          θ = 2·arctan( (V/2) / ρ )
```

**The turn and the pull are the same number seen twice.** Pull tighter — smaller
ρ — and the stitch twists *more*. Leave slack and it twists less.

![the turn carries a fold tip onto its sibling's line](fig/law.svg)

On the left, `2×1`: the two weft lines are symmetric about the middle, so θ is
simply the angle they subtend at the centre from the tip's distance. On the
right, `2×2`: the binding slot is the outer weft line and its sibling is one gap
in, so the wedge is lopsided — but it is the same statement. **θ is whatever
carries the tip from its own line onto its sibling's.**

---

## 3. What follows, for free

With θ fixed, nothing is left to choose:

- **Arm length = 2R.** The arm runs from `+R` to `−R` along its own line. The
  incoming tip landing at exactly `+R` is not assumed — it falls out of the
  rotation.
- **A lace's two reaches sum to `g·cot(θ/2)`**, where `g` is that family's gap.
- **Every arm of a snug m×1 is the same length as the face is long.**

So the ideal stitch is *uniform*. Which is
[the cylinder we started from](README.md#8-why-it-is-grown-and-not-derived) — see
[§6](#6-slack-is-what-makes-a-stitch-look-handmade).

---

## 4. The snug limit

ρ still has to come from somewhere, and there are now **two** bounds, one per
family, each saying an arm must cross the band it is woven through:

```
weft crosses the warp band:   R_weft,min  ≥  (m − ½)·G + w/2
warp crosses the weft band:   R_warp,min  ≥  (n − ½)·V + w/2
```

Both matter, and which one binds depends on the shape. Laid snug (`G = V = w`)
and writing `t = tan(θ/2)`, the two conditions become two quadratics:

```
2(n−1)·t² + 2m·t − 1  ≤  0
2(m−1)·t² + 2n·t − 1  ≤  0
```

The tightest stitch takes the smaller of the two positive roots, and it
rationalises to one closed form. With `M = max(m, n)` and `N = min(m, n)`:

```
────────────────────────────────────────────
   tan(θ/2)  =  1 / ( M + √( M² + 2(N−1) ) )
────────────────────────────────────────────
```

(Checked against solving the quadratics directly for every m, n up to 8: max
error 2·10⁻¹⁶.)

Two sanity checks fall straight out. For **n = 1** the square root collapses to M
and it becomes `1/(2m)` — the clean form the first draft found. For **1×1** it
gives `1/2`, θ = 53.130°, the box stitch.

|  | n=1 | n=2 | n=3 | n=4 | n=5 |
| --- | --- | --- | --- | --- | --- |
| **m=1** | 53.130° | 28.072° | 18.925° | 14.250° | 11.421° |
| **m=2** | 28.072° | 25.333° | 17.992° | 13.835° | 11.203° |
| **m=3** | 18.925° | 17.992° | 17.217° | 13.463° | 11.000° |
| **m=4** | 14.250° | 13.835° | 13.463° | 13.128° | 10.811° |
| **m=5** | 11.421° | 11.203° | 11.000° | 10.811° | 10.634° |

Symmetric, as it must be — an m×n stitch is an n×m stitch looked at sideways.

The shape of the table is the interesting part. **The turn is set mostly by the
larger dimension**; the smaller one only nudges it. A 3×1, a 3×2 and a 3×3 turn
18.9°, 18.0° and 17.2° — all "about eighteen" — while going from 2 to 3 in the
long direction drops the turn by a third. Whatever the stitch's aspect ratio, the
long way across is what the fold has to reach, and reach is what sets the turn.

For n = 1 the numbers are rational in a way that looks like a coincidence and is
not: `(4m² − 1, 4m, 4m² + 1)` is a Pythagorean triple, so `cos θ` and `sin θ` are
rational for every whole m — 15/17 and 8/17 for the 2×1, 35/37 and 12/37 for the
3×1.

---

## 5. Does it reproduce the 2×1?

Building an m×n from the formulas above and nothing else, then measuring it:

| | from the law | `twist-stitch-10` |
| --- | --- | --- |
| strands (10 twists) | 69 | 69 |
| masks | 44 | 44 |
| level breaks | 10 | 10 |
| junctions | 66 | 66 |
| warp parallel to | 0.0000° | 2.52° |
| weft parallel to | 0.0000° | 2.10° |
| weave | O,u,O,u on both weft arms, every level | same |
| θ | 28.07° snug | 26.0° fitted |

Every count matches, and the generated stitch is *more* regular than the
hand-built one — the expected direction. The angle is close but not equal: 28.07°
snug against 26.0° measured.

That gap is what ρ is for. Writing `s = ρ / ρ_min` for how much further than snug
the folds are pulled, `s = cot(13°)/4 = 1.083`: the hand-built stitch is **8%
slacker than snug**. One scalar, and it then has to predict *every* reach in the
stitch — which it does, so it is not a free fit in disguise.

---

## 6. Slack is what makes a stitch look handmade

The ideal predicts every fold the same length. The real one has six folds of 461,
405, 211, 267, 303 and 272 units. No contradiction: **ρ is per arm.** Each is
pulled a slightly different amount, so each has its own `ρ_k` and would imply its
own `θ_k`.

But a level can only turn by one angle. The stitch settles the disagreement by
letting arms **lean** slightly off their lines — which is exactly the 2.5° of
warp spread the hand-built one carries, and exactly what an idealised
construction throws away.

> The law fixes the mean turn. The scatter of `ρ_k` about it is the hand of
> whoever tied it, and it comes out as lean.

Sharper form, and testable: **the spread of arm lengths within a level should
predict the spread of arm angles.**

---

## 7. What it predicts

Built straight from the law, no measurement of a real stitch anywhere in them:

| | 3×1 | 2×2 | 3×2 |
| --- | --- | --- | --- |
| θ | 18.925° | 25.333° | 17.992° |
| laces | 4 | 4 | 5 |
| arms per level | 8 | 8 | 10 |
| crossings per level | 12 | 16 | 24 |
| masks per level | 6 | 8 | 12 |
| | <img src="fig/pred-3x1.png" width="250" alt="predicted 3x1"> | <img src="fig/pred-2x2.png" width="250" alt="predicted 2x2"> | <img src="fig/pred-3x2.png" width="250" alt="predicted 3x2"> |
| from above | <img src="fig/pred-3x1-top.png" width="250" alt="predicted 3x1 face"> | <img src="fig/pred-2x2-top.png" width="250" alt="predicted 2x2 face"> | <img src="fig/pred-3x2-top.png" width="250" alt="predicted 3x2 face"> |

Machine-checked on every build, for 1×1, 2×1, 3×1, 4×1, 2×2, 3×2 and 3×3: strand,
mask and junction counts as predicted; every parent anchor exact; **exactly 4mn
crossings per level and not one more** (no warp crossing warp, no weft crossing
weft); every weft arm reading `O,u,O,u…` across all 2m warp arms on every level;
and warp and weft each parallel to **0.0000°**.

The 3×1's reaches, all forced, at `w = G = V = 54`:

| lace | slots | reach out | reach back | arm lengths |
| --- | --- | --- | --- | --- |
| weft | V0 / V1 | 162 | 162 | 324 / 324 |
| warp A | W0 / W1 | 144 | 180 | 288 / 360 |
| warp B | W2 / W3 | 162 | 162 | 324 / 324 |
| warp C | W4 / W5 | 180 | 144 | 360 / 288 |

If a stitch is worked at the same 8% slack as the hand-built 2×1, every angle in
the table drops by about the same factor — for the 3×1, 18.92° → **17.49°**.

---

## 8. How to falsify it

Build a 3×1 by hand in the app the way the 2×1 was built — starting stitch plus
two twists — and fit the turn the same way.

- **θ ≈ 17–19°** → the law holds, and `twistStitch` can take `m` and `n` instead
  of a fitted constant.
- **θ ≈ 26° again, independent of the shape** → the law is wrong. The turn would
  be something about the *lace* rather than the face — thickness, friction, how
  far a thumb naturally pushes a fold.
- **In between, or moving the wrong way with m** → the face shape matters but
  this form is wrong, and the clearance bound is the suspect: perhaps a fold must
  clear the face by a fixed margin rather than reach exactly to its edge, which
  would put a constant inside the arctan.

A 2×2 would settle a second question at the same time, since it is the first
shape where the two clearance bounds compete rather than one simply dominating.

---

## 9. What this still does not explain

- **Where the base level's overhang comes from.** The pinned run's poke past the
  face is free here.
- **Whether the snug bound is really the tightest a hand can pull.** It is the
  tightest that still *works*; a real thumb may stop short of it.
- **Why the two families should share one gap.** `G = V = w` is assumed for the
  snug case; a lace that is wider than it is thick might not pack that way, and
  the general law keeps G and V separate for exactly that reason.
- **Non-rectangular cross-sections** — a triangular or hexagonal column has a
  different perimeter count and the two-family split stops making sense.
