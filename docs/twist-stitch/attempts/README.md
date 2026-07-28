# The twist stitch: what is settled, what is rejected, what is open

The [twist-stitch note](../README.md) describes the stitch and
[deriving-the-turn](../deriving-the-turn.md) derives it. This folder is the
working record behind them — the attempts that did not survive, kept because a
result you cannot see being wrong is not a result.

Read in order, it is one argument: the turn is settled, the slack on a lopsided
face is not, and three separate ideas for fixing the slack have each been ruled
out by a measurement rather than by taste.

---

## Settled

**The turn is `θ = arctan( 1 / max(m, n) )`.**
Over the run of the face, a fold migrates exactly one lace width. It is not
fitted: it is the only form tried that hits both angles anyone has measured — a
1×1's **45.00°** and the hand-built 2×1's **≈26°**, against `arctan(1/2)`'s
26.57°. `90/(m+n)` and `arctan(2/(m+n))` also give 45° at a 1×1 and are killed by
the 2×1, at 30° and 33.69°.
→ [§4b](../deriving-the-turn.md#4b-the-turn-a-second-measurement-pins-it)

**Two structural rules, read off the hand-built 2×1 rather than assumed.**
An arm's successor stays in its own family — every level-0 arm's axis turns by the
level turn, 22°–38°, never by ~90°. And a tip lands on the rotated line of its
lace's other arm, measured 0.10–0.39 widths off on all six arms.
→ [`sigma-check.py`](2026-07-two-width/sigma-check.py)

**The loop clearance is a constant, `E = w/2`.**
Not a length that scales with the face. Measured off the hand-built 2×1's three
pinned runs: 133 / 85 / 78 against 135 / 81 / 81.
→ [§3](../deriving-the-turn.md#the-one-length-that-is-a-clearance-not-a-reach)

**A declared parent beats a coincidence.**
In a twisting column two endpoints that are not the same joint can land closer
than the one-unit snap, so 784 arms across 39 shapes were bridged to the wrong
strand. Level-awareness cannot fix it — 760 of the ambiguous pairs are one storey
apart and so is every genuine link — but `parentId` already says which.
→ [`connections.ts`](../../../src/model/connections.ts)

---

## The open problem

**On a lopsided face the long side is slack by `|m − n|` lace widths.** Under one
width on the diagonal, 5.5 at 1×6, 7.5 at 8×1. It has a second face: the smaller
family carries the binding alone — at 1×6 the single lace is in **all 24**
crossings a level against four for each of the other six, and only 18% of one of
those arms is inside the weave at all. That is not a woven column; it is six
ribbons round a spine.

Why it happens, in one line: every arm gets the same reach, `w/sin θ`, but the two
families cross bands `m` and `n` widths deep, and one turn cannot serve both.

The sample browser now says so per shape rather than presenting the 64 as equals.

---

## Ruled out, each by a measurement

| idea | what killed it |
| --- | --- |
| **A different turn.** | The turn is already against a hard ceiling: at the shipped angle every crossing physically happens, and 2° tighter loses 24 in a 1×6, 48 in a 2×6, 72 in a 3×7. Tighter does not mean tighter — the weave comes apart. → [2026-07-two-width](2026-07-two-width/) |
| **Two lace widths, in the ratio `√(m/n)`.** | Makes both sides snug for any m, n — and is what industry does — but a stitch is made from one gauge of lace, so it is a different object, not a fix. Rejected on those grounds, kept for the measurement. → [2026-07-two-width](2026-07-two-width/) |
| **Advance each arm one position around the perimeter** (the round-stitch rule). | The hand-built 2×1: no arm turns the corner, on all six. |
| **Minimum path** (the braiding literature's rule). | Predicts that every arm *should* turn the corner — 576 of 576, by 7× to 1344× — which the same measurement contradicts. My first reading of it was circular; the correction is in [prior-art](prior-art.md). |

---

## Prior art: it is a known problem, and nobody solves it

[prior-art.md](prior-art.md) — the same mismatch is textile **jamming** (Peirce,
1937: a plain weave can be warp-jammed or weft-jammed, and *complete cover is not
possible with square cloth*), and it is the standard difficulty of **braiding over
a non-circular mandrel**, where a fixed carrier count over a rectangular section
gives braid angles differing by 10°+ at corners, with slack, slip and bridging.
The industry's fixes are the two found here independently — vary the yarn width,
or vary the count. None of them makes the mismatch vanish.

That is the useful part: the derivation is not what is wrong.

---

## What would move it next

1. **A hand-built 3×1.** Four laces. The law commits to **18.43°** with nothing
   left to fit. A 2×2 is *also* 26.57°, the same as the 2×1 — so only a change in
   `max(m,n)` separates "the face sets the turn" from "the lace does", and the
   3×1 is the cheapest shape that does it.
2. **Look at a real lopsided stitch and count folds.** Every arm here climbs
   exactly one storey, and nothing has tested that. Let an arm climb `k` and the
   reach goes as `w/sin(kθ)`: a 1×6 at `k = 5` drops from +4.6 widths of slack to
   **+0.05**, a 3×7 at `k = 8` to **+0.04**, with the tight family staying at
   `k = 1`. It would fix the slack — but it is a different stitch, taking `4mn`
   crossings a level and the whole level model with it. Whether the long side of a
   real lopsided stitch folds every level or wraps over several is a five-second
   observation, and it decides whether that rebuild is worth doing.

---

## The folders

| | |
| --- | --- |
| [2026-07-snug-turn](2026-07-snug-turn/) | superseded. All 64 scenes built under the old snug-limit turn, with the generator that made them |
| [2026-07-two-width](2026-07-two-width/) | rejected. The `\|m − n\|` measurement, the proof the turn cannot be blamed, and the two-width variant that would fix it |
| [prior-art.md](prior-art.md) | jamming, non-circular-mandrel braiding, and minimum path applied and falsified |
| [minpath.py](minpath.py) | the minimum-path computation, both candidate sets |
