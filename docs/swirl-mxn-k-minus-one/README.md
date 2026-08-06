# Swirl continuations at k = −1 — one law, two dials

[`artifact.html`](artifact.html) is the source of **Two dials between every exact
swirl**, a companion to the
[Swirl Bench](https://claude.ai/code/artifact/ac32f04d-1338-44d9-8d0d-0314fd0d27cc)
and cut to the same shape as
[The dial](https://claude.ai/code/artifact/66d24c15-d89a-4030-a745-2617f8ee2905):
an explorer, the law behind it, what the law costs, and what would change to ship
it.

The bench steers a swirl's two continuation groups by hand and checks the result.
This page does the opposite — it derives the whole configuration from the size
and two numbers, and uses the bench's test only to score what came out.

**The law** is the piecewise function `F(m, n)`, implemented in the page:

* **Case A** — 1 × 1, the exact 45° stitch, `g = √2(32 + E)`.
* **Case B** — a multi-pair group. Every extension telescopes out of the middle
  pair once θ and `g` are fixed; θ itself comes off the cone-edge equation
  `A cos θ + B sin θ = C`, where the shallow pair `r = min(2, p−1)` empties to
  zero.
* **Case C** — the one-pair boundary (`n = 1` and `m = 1`). The corner floor
  `M★` is an *input*: the uncorrected margin `M₀` comes from the transposed
  group and the arm extends by exactly what carries it to `M★`.

**The two dials** are what the palindrome of gap equations leaves free — `p`
distinct equations against `p + 2` unknowns:

* **`g`**, the one gap every lace in the stitch lands on.
* **`M★`**, the corner floor the boundary case is built to.

**What the page checks, live, at whatever setting the dials are on**: the
aligner's own gap test and corner measurement, re-implemented line for line and
run against the generator's own geometry for all 128 handed entries. At the
canonical setting (`g = 56.01 px`, `M★ = 16 px`) it reproduces the bench's
published Case C table to 5 × 10⁻⁷ °, puts every gap on target to 6 × 10⁻¹³ px,
and holds every corner at or above +16.0000 px — Case A alone at +39.60, the
multi-pair interior +16.63 … +32.94, the boundary +16.0000 across the board.

**What the dials cost.** The tightest corner anywhere is +16.00 px at `g = 56`,
+7.45 by 58, and crosses zero at 58.96; the aligner's own 200 px cap on a single
extension binds sooner, at **57.41 px** — the widest gap the whole family
survives. Past 66 px some sizes leave the feasible cone and have no exact member
at all. `M★` is the cheap dial and it saturates: past about 16.6 px the
multi-pair interior is the tightest thing in the family anyway.

Four of the sixty-four sizes have a group whose derived angle sits outside the
aligner's ±20° search window measured from the unextended arm — 1 × 7 by 0.80°,
1 × 8 by 2.31°, and their transposes. Ten sizes ship with their two groups on
different gaps.

The page is one self-contained file on a host that can fetch nothing, so it
carries the generator's geometry for all 128 handed entries and the reference
sheet's own strand table, and lays every drawing out on demand. Nothing in it is
a picture and nothing in it is searched.

## In the studio

[`src/model/swirl.ts`](../../src/model/swirl.ts) builds the k = −1 stitch — the
block and its one continuation — for all 63 sizes in both hands, as samples
`swirl-lh-2x1`, `swirl-rh-8x8` and the rest, beside the twist and box families.

The block is `twoFanStitch`'s block unchanged: same 56 px pitch, same 32 px poke,
same over/unders. What k = −1 changes is **which loose end joins which fan**. At
k = +1 a set's two ends both join its own family's fan, so every arm in a fan
leaves the block along the same axis; at k = −1 the ends split between the fans,
so one fan holds arms leaving along *both* axes. Reading each fan in the order
its gaps are measured:

```
horizontal   (n+m)_4,  then j_4, (j−1)_5 for j = 2…n,  then (n+1)_5      → 2n arms
vertical     1_4,      then (n+i+1)_5, (n+i)_4 for i = 1…m−1,  then n_5  → 2m arms
```

`npm run check:swirl` holds it to the reference: the block matches the twist's
exactly, every gap lands on 56.01 px to **4.5 × 10⁻¹³ px** over all 63 sizes in
both hands, and the tightest corner anywhere is **+16.0000 px** — the floor Case C
builds to, hit rather than cleared.

1 × 1 is not in the family. Its k only runs 0 … 1, so it has no k = −1 at all.

## What is not here: the column

A twist carries up ten levels by rotating the whole stitch a level at a time
(`twoFanColumn`), an arm's worked end being its sibling's start one storey up —
`worked_end_k(n) = start_σ(k)(n+1)`, with σ pairing the two ends of a lace by
physical continuity. That fold does **not** carry over to k = −1 as written.

For 2 × 1 there are six arms, so every correspondence can be tested against every
turn. Searching all 720 permutations at 0.05° resolution about the block centre
finds nothing that closes with all arms running forward — only two degenerate
cases, the identity (arms mapping to themselves, zero length) and −180° (the
stitch's own two-fold symmetry, also zero length). Three weaker readings were
tried and rejected too: landing on the partner's rotated *line* with σ free
(closes to 10⁻¹² px, but only by mapping arms to themselves), landing on the
partner's rotated *point* with the centre and turn both solved (530–2050 px off
at every face), and folding the raw block ends and letting the fan directions
emerge (two fans do appear, 90° apart, but 0.04–1.0° wide and at turns that do
not match the stitch's own).

So this module stops where the reference stops: the block, and one continuation.
