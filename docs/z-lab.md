# The Z band lab, and the Auto it settled on

`/zlab/` is one storey turn on its own, away from a weave: two straight runs meeting
at a **separation** angle, and the band that carries the lace from the lower storey
to the upper one between them. Turn the separation from 0° to 180° and you sweep
every turn the studio will ever have to build, one at a time, with nothing else in
the frame to hide behind.

Source: [`src/zlab/main.ts`](../src/zlab/main.ts) (the panel and its state),
[`src/zlab/bands.ts`](../src/zlab/bands.ts) (the three builders),
[`src/zlab/autoview.ts`](../src/zlab/autoview.ts) (Auto's model and its three drawings).

## The four buttons

**Fold · Square · Auto · Carry on.** Fold and Square are not separate builders — they
are the two ends of one number, the **lean**, and the buttons are presets for it:

| Lean | What the crease does | What the turn looks like |
| --- | --- | --- |
| 0 (Fold) | crease on the bisector | the tip does the whole turn; the legs stay straight; exact and developable end to end |
| 1 (Square) | crease square to the strap | a clean **⊂** tip; the legs bend in plan to give back the half turn the runs didn't ask for |

Everything between is a real crease angle with a real developable tip. **Carry on**
is the other builder entirely: the heading swings in plan on an arc and the storey
rises on a smoothstep, no fold at all. **Auto** picks between them per separation.

The rule underneath all of it: wrapping a strip a half turn about a crease reverses
the heading across the crease and keeps it along the crease, so **a crease at θ to
the strap turns the heading by 2θ**. The crease position is the entire design
parameter.

## Auto's settled numbers

These are the defaults in [`src/zlab/main.ts`](../src/zlab/main.ts) and they are the
ones confirmed by eye, not a placeholder:

```ts
mode: 'auto',
auto: { lo: 48, hi: 61, carry: 126, cap: 0.25 },
autoView: 'curve',
```

Read out loud, that is:

| Setting | Value | What it means |
| --- | --- | --- |
| Square window opens (`lo`) | **48°** | below this the lean ramps up from a pure fold |
| Square window closes (`hi`) | **61°** | the plateau between `lo` and `hi` runs at full influence |
| Carries on from (`carry`) | **126°** | at and above this the fold builder hands over to Carry on entirely |
| Square influence (`cap`) | **0.25** | the tallest the lean ever gets — a quarter of the way to a square crease, never a full **⊂** |
| Opening view | **Curve** | of Bar · Curve · Dial; all three edit the same object, so the drawing is a view and nothing more |

The lean this produces across the sweep, at the gauge below:

| Separation | 0° | 24° | 48° | 55° | 61° | 70° | 90° | 125° | 126°+ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Lean | 0.000 | 0.125 | 0.250 | 0.250 | 0.250 | 0.237 | 0.145 | 0.000 | carries on |

## The two readouts that are computed, not set

Neither of these is draggable — they follow from the gauge, and the only ways to move
them are to move a shoulder or to change the lace.

**Shell threshold** — `2·asin(step / width)`, where an exact fold's tip outgrows its
own storey. At the lab's gauge (step 0.50, width 1.10) that is **54.07°**.

**Flare band** — the separations where the tip's vertical span still overruns the
storey after the lean has been taken into account:
`(1 − lean(sep)) · sep > 2·asin(step / width)`. At the defaults above the caption
reads **flares 71–125°, in red**. That is the corrected check: the earlier version
tested only where the square window opened and never how much influence it had, so
it called these very defaults clean.

Two ways out of a flare, both legitimate: drag the left shoulder further left so the
lean is up before the band starts, or raise the **Storey step** so the threshold
itself moves right.

## The gauge those numbers assume

| Control | Default | Notes |
| --- | --- | --- |
| Lace width | 1.10 | `LACE_WIDTH`, fixed in the source |
| Thickness | 0.26 | |
| Storey step | 0.50 | moves the shell threshold and so the flare band |
| Ramp length | 2.40 | |
| Leg length | 0.95 | the straight, turning-free depth that makes the bight deep rather than a knuckle — **setting it to 0 removes it** |
| Round | 0.80 | |
| Separation | 0° | the sweep's starting point |

A plane curve that turns exactly half a turn and rises exactly one storey cannot be
much deeper than half that storey at a steady turning rate. Depth has to be bought
with turning that does not rise, and the straight legs are that turning-free depth:
leg out at the lower storey, half-turn tip of radius `step/2`, leg back at the upper
storey. That is why Leg length is not cosmetic.
