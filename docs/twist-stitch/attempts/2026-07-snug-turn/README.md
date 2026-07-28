# Stashed: the snug-turn family, July 2026

**Status — superseded.** The turn law these 64 scenes rest on has since been
replaced by `θ = arctan(1/max(m,n))`
([§4b](../../deriving-the-turn.md#4b-the-turn-a-second-measurement-pins-it)),
which is pinned by the two angles anyone has measured — a 1×1's 45° and the
hand-built 2×1's 26° — where the snug limit below misses both, at 53.13° and
28.07°. It was solving a stricter version of the same idea: it made every arm
clear the far *edge* of its band, half a width past the last line's centre, and
that half width is the whole of the 1.5° it lands tight by.

Nothing here is deleted or quietly corrected — it is the record of what the snug
limit produces, kept so the correction has something exact to be a correction to.
The scenes in `scenes.tar.gz` are the old law and stay that way.

## What was tried

One turn for every face, derived rather than fitted
([the proposition](../../deriving-the-turn.md)):

```
θ = 2·arctan( 1 / (M + √(M² + 2(N−1))) )        M = max(m, n),  N = min(m, n)
```

with each arm's reach solved from the law that the tip a fold leaves must land on
the line its lace folds onto next:

```
x = (o′ − o·cos θ) / (±sin θ)        reach = |x|,  travel direction = sign(x)
```

and two constants: the loop clearance `E = w/2` and the top tail `1.5·max reach`.
Every scene in `scenes.tar.gz` is that and nothing else.

## What is in here

| file | what it is |
| --- | --- |
| `scenes.tar.gz` | all 64 scenes, `m,n` from 1×1 to 8×8, ten twists each, as loadable `.json` |
| `generator.ts` | frozen copy of `twistStitchMN` as it stood when they were built (`da2b71b`) |
| [`fig/family-built.png`](../../fig/family-built.png) | the 64 rendered from the app, orbit |
| [`fig/family-built-top.png`](../../fig/family-built-top.png) | the same 64 from above |

Unpack with `tar xzf scenes.tar.gz -C <dir>` and load any of them through **Paste a
scene** in the app, or rebuild them all from the generator — same output either
way, the tarball is only there so the results survive a change to the generator.

## What was verified

Every one of the 64, at ten twists:

| check | result |
| --- | --- |
| strands / masks / level breaks | `(m+n)(2k+3)` / `2mn(k+1)` / `k` — exact |
| crossings per level | exactly `4mn`, no extras |
| plain weave | every arm alternates `O,u,O,u…` on every level |
| warp / weft parallelism | 0° within 1e-13 |
| parent anchors | coincide within 1e-9 |
| loop clearance | 0.50 widths, uniform, all four sides |
| junction bridges | every arm bridged to the parent it declares |

So the objection is **not** that these are broken weaves. Structurally they are
exactly what the family counts say they should be. The objection is to the shape
the law gives them.

## Where the doubt is

Read down a row of [the orbit sheet](../../fig/family-built.png) and the columns
open into a skirt as `n` moves away from `m` — `8×1` most of all, a one-deep face
with arms as long as the face is wide, fanned almost flat. That falls straight out
of the law: θ is set by the *larger* dimension while the reach is set by the
*smaller* one, so the further from square a face is, the further past it the arms
run. It is self-consistent. Whether it is what a hand actually pulls is the open
question, and the honest answer is that nothing has tested it — the only hand-built
stitch in the repo is a 2×1.

**Followed up in [2026-07-two-width](../2026-07-two-width/)**: the overhang is
exactly `|m − n|` lace widths, no single turn can reduce it, and the assumption at
fault is that both families share one width — not the turn and not the pairing,
both of which the hand-built 2×1 confirms.

Two things would settle it, in this order:

1. **A hand-built 3×1** — the cheapest falsification. The law predicts ≈18.9° snug,
   ≈17.5° at the slack the 2×1 shows. A hand-built 3×1 that fits ≈26° again, the
   same as the 2×1, kills the law outright: the turn would not depend on the face
   at all.
2. **A hand-built off-diagonal face** — a 2×4 or 3×2 — to say whether the skirt is
   real or an artefact of assuming both families share one gap (`G = V = w`).

Two smaller things this attempt left open, both editor-only and both recorded in
[§7b](../../deriving-the-turn.md#7b-the-whole-family-built): in 39 of the 64,
two endpoints that are not the same joint come closer than the one-unit snap, so
dragging one moves the other and one junction dot is drawn for what look like two
joints.

## What is still live

The generator, the 64 sample-browser entries and both twist-stitch documents are
untouched in the app — this folder stashes the *results*, not the code. If the
next attempt replaces the law, this stays as the before.
