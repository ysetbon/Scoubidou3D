# Prior art: where this problem already exists, and what is done about it

The `|m − n|` slack is not peculiar to this stitch. It is a known, named,
long-studied problem in two fields, and neither of them has a clean solution —
which is itself the useful finding, because it means the derivation is not what
is wrong.

## 1. Woven cloth: *jamming*, and why you cannot jam both ways at once

Peirce's 1937 geometry of plain-woven cloth is the origin of the whole subject.
It gives a fabric two separate limits:

- **warp-jammed** — the warp yarns are touching, no more can be packed in;
- **weft-jammed** — the same the other way.

A fabric can be one, or the other, and only in special cases both. The standard
statement is that **complete cover is not possible with square cloth** — pushing
one direction to its jam leaves the other loose, and the two conditions are only
simultaneously satisfiable for particular yarn/count combinations.

That is exactly the result we derived from scratch: at the snug turn the family
crossing the wider band is jammed, and the other is `|m − n|` widths loose. It
generalises the same way — the mismatch is the *difference* of the two setts, and
it vanishes only on the square.

Two details of that literature that matter here:

- **Peirce assumes round yarns.** Scoubidou lace is a flat strip, and the standard
  correction is **Kemp's racetrack section** — a rectangle capped with two
  semicircles — which lets the circular-thread relations be reused for flattened
  threads. If we ever model the lace cross-section rather than a centreline, that
  is the shape to use.
- Jamming is where a woven structure stops being a geometry problem and starts
  being a *mechanics* problem: past the jam, yarns flatten and compress rather
  than move. Our model has no compliance at all, so it can only ever report the
  mismatch, never absorb it.

## 2. Braiding over a non-circular mandrel — our problem, industrially

This is the closer analogue. A circular braiding machine has a **fixed** number of
carriers; the mandrel it braids over may be rectangular. The consequences reported
are the ones we are looking at:

- because the carrier count is fixed, any change in cross-section shows up as a
  change in yarn orientation, with braid angles differing **by up to 10°, or more
  than 30%, particularly at corners**;
- yarns curve near the edges of a flat face, so the measured angle varies *along*
  the face;
- yarn **slack**, yarn **slip over the corners**, and fibre **bridging** on concave
  regions.

Our numbers are the same order. A 2×4 face wants `sin θ = 1/2` from one family and
`1/4` from the other — 30° against 14°, a 16° disagreement that one turn has to
split. The 1×6 wants 90° against 9.5°.

### What the field actually does about it

| their fix | our equivalent |
| --- | --- |
| different tow size / yarn width per region | [the two-width variant](2026-07-two-width/) — rejected here, but it is what industry does |
| more yarns where the perimeter demands them (*"warps adjacent outer corners can have more fibers than warps adjacent inner corners"*) | change `m` and `n` themselves — i.e. only build shapes with small `|m − n|` |
| accept the variation and model it: equal-coverage trajectory models that let the angle vary along the part | let θ vary rather than forcing one rigid screw for the whole column |
| process control — take-up speed, convergence-zone length, guide-ring radius | no analogue; there is no machine here |

Nobody makes the mismatch go away. They measure it, model it, and design around it.

## 3. The one idea worth stealing: the minimum path condition

Braid pattern on an arbitrary mandrel is predicted with the **minimum path
condition** — the yarn is laid down at the point where the total length of yarn
hanging from the previous braid point to the carrier is *minimised*, with the free
span tangent to the surface. It is Fermat's principle, and it makes the yarn path a
geodesic where the surface is benign.

That is a **different governing law from ours**. We say:

> the tip must land on the line its lace folds onto next

which fixes `reach = w/sin θ` regardless of how wide the band under it is — and
that single fact is what produces the `|m − n|` slack. A minimum-path law would
instead say:

> the lace goes wherever its next run is shortest

which does not force a common reach on both families, and would naturally give the
narrow side short arms. It is the first candidate I have seen that attacks the
right assumption without touching the widths.

The caveat is stated in the same literature: the geodesic assumption holds only
where curvature is moderate and transverse slip is negligible — it breaks at
corners. A scoubidou cross-section is *all* corners.

### Tried it. It gives back the law we already have.

The run an arm makes is fixed once you say *which* line of its family it lands
on, so minimum path here is a choice over lines:

```
   x(o′) = (o′ − o·cos θ) / (±sin θ)     minimise |x| over the lattice of lines,
                                          excluding staying where you are
```

`|x|` is linear in `o′`, so it is smallest for the line nearest `o·cos θ` — and
that is a question about how far the turn carries a line inward against how far
apart the lines are. Across all 64 shapes and every slot:

```
   the turn carries a line inward by at most  0.16 widths
   the lines are                              1.00 width  apart
```

So the nearest line to `o·cos θ` is always `o` itself, and the nearest one an arm
is *allowed* to migrate to is always its neighbour — which is the pairing the
hand-built 2×1 already showed and the law already assumes. Minimum path does not
disagree with the landing law here; it **derives** it.

That is not a failure of the idea, it is a difference in the setting. A braiding
yarn touches down on a continuous surface, so minimising has somewhere to go. Our
landing points are quantised to a lattice one lace width apart, and on a lattice
that coarse the minimum is forced.

### What minimum path *would* have used, if it had it

Every arm climbs exactly **one storey**. That is the assumption doing the work,
and nothing has ever tested it. Let an arm climb `k` storeys and the face turns
`kθ` while it runs, so its reach is `≈ w/sin(kθ)` — and the loose family's slack
collapses:

| shape | family | band | reach at k=1 | best k | reach there |
| --- | --- | --- | --- | --- | --- |
| 1×6 | weft | 54 | 304 (+4.6w) | **5** | 57 (**+0.05w**) |
| 2×6 | weft | 108 | 304 (+3.6w) | **2** | 117 (**+0.17w**) |
| 3×7 | weft | 162 | 357 (+3.6w) | **8** | 164 (**+0.04w**) |
| 2×4 | weft | 108 | 199 (+1.7w) | **6** | 117 (**+0.16w**) |
| 3×3 | both | 162 | 149 | 1 | already tight |

The tight family stays at `k = 1` throughout; only the loose one climbs. Read
physically: **the laces on the long side fold once every k storeys instead of
every storey**, running as long diagonals that spiral up around the spine while
the short side folds every level.

It would fix the slack. It is also not a reparameterisation of this stitch — it is
a different stitch. An arm spanning five storeys crosses five storeys of the other
family, so `4mn` crossings per level, one arm per line per level, and the whole
`levelBreaks` model go with it. Worth knowing that it is the remaining degree of
freedom; not worth building on a guess.

## Sources

- [Braid angle — overview, ScienceDirect](https://www.sciencedirect.com/topics/engineering/braid-angle)
- [Prediction of the braid pattern on arbitrary-shaped mandrels using the minimum path condition](https://www.sciencedirect.com/science/article/abs/pii/S026635381300448X)
- [Mathematical modeling of braiding yarn trajectories for variable cross-section mandrels of equal coverage](https://www.sciencedirect.com/science/article/abs/pii/S0263822325005598)
- [Prediction of the yarn trajectories on complex braided preforms](https://www.sciencedirect.com/science/article/abs/pii/S1359835X02000751)
- [Automated braiding of a complex aircraft fuselage frame using a non-circular braiding model](https://www.sciencedirect.com/science/article/abs/pii/S1359835X17302725)
- [Prediction and optimization of yarn path in braiding of mandrels with flat faces](https://journals.sagepub.com/doi/10.1177/0021998317710812)
- [Modeling of woven fabrics geometry and properties (Peirce, Kemp, jamming)](https://cdn.intechopen.com/pdfs/36900/intech-modeling_of_woven_fabrics_geometry_and_properties.pdf)
- [Structural analysis of a two-dimensional braided fabric, J. Textile Institute](https://www.tandfonline.com/doi/abs/10.1080/00405009708658528)
- [Corner topology makes woven baskets into stiff, yet resilient metamaterials](https://arxiv.org/abs/2506.18197) — corners as the load-bearing feature, mechanics rather than geometry
