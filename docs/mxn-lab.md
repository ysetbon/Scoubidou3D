# The MXN Continuation Lab, at /mxn/

The lab takes `m`, `n` and one `k` per level and draws every Lᵥ continuation
ring, with the audit numbers beside each one. It is published here at
<https://ysetbon.github.io/Scoubidou3D/mxn/>, and it is a copy: it is built and
maintained on ChatGPT Sites at
<https://mxn-continuation-lab.topspin-tech-0568.chatgpt.site/>, from source
snapshot `ad64595`, over the `ysetbon/mxn` engine at commit `984d9ed`.

Being a copy is the thing to remember. Change the lab upstream and this does not
follow; re-export and re-apply the steps below.

## Why it needed anything doing to it

Upstream it is a Next app on Cloudflare — `app/layout.tsx` renders the document,
`app/page.tsx` renders `<ContinuationLab />`, and `worker/index.ts` serves the
result. GitHub Pages cannot run a Worker, so at first glance the lab could not
come here at all.

It can, because none of that server is load-bearing. `ContinuationLab` is a
`"use client"` component; the engine is the real `ysetbon/mxn` Python, compiled
to WebAssembly by Pyodide and run in a Web Worker **in the reader's browser**.
Its only network calls are the worker pulling Pyodide and NumPy from jsDelivr
and then fetching its own `.py` modules — both of which a static host serves
just as well. No API, no database, no auth, no secrets: `.openai/hosting.json`
has `d1` and `r2` both `null`.

So the calculation is identical here, because the calculation was never on a
server. What is lost is the server-rendered first paint: upstream the chrome
arrives in the HTML, here React draws it, which is a few hundred milliseconds of
the page's own paper colour on first load. `mxn/index.html` sets that colour so
the wait is not a white flash.

## What is copied, and what was changed

Copied verbatim from the export:

| here | from |
| --- | --- |
| `src/mxn-lab/weave-studio.tsx` | `app/weave-studio.tsx` — UI, worker protocol, canvas renderer |
| `src/mxn-lab/lab.css` | `app/globals.css` |
| `public/mxn/exact-worker.js` | `public/exact-worker.js` |
| `public/mxn/py/*.py` | `public/py/*.py` — the engine, ~9,300 lines |
| `public/mxn/extension-origin-l0.svg`, `public/mxn/og.png` | same |

Changed, all of it hosting rather than behaviour:

- **Three paths.** Upstream the lab owns its domain root, so it asked for
  `/exact-worker.js`, `/extension-origin-l0.svg` and `/py/*.py`. Under
  `/Scoubidou3D/mxn/` those resolve against `ysetbon.github.io` and miss. The
  first two now hang off `import.meta.env.BASE_URL`, so they follow whatever
  `--base` the build used; the third resolves against the worker's own
  `import.meta.url`.
- **A way back.** `.brand` in the masthead is an `<a>` to `..`, and the footer
  carries a `← Scoubidou3D` link. A page that is part of a site needs them; a
  page that was the whole site did not.
- **The wrapper.** `app/layout.tsx` + `app/page.tsx` + the Cloudflare Worker are
  replaced by `mxn/index.html` and `src/mxn-lab/main.tsx`, which mount the
  component on a div. The metadata the layout computed from the request host —
  `og:image` — is stated absolutely in the HTML instead.
- **Tailwind.** `lab.css` began `@import "tailwindcss"`, and all it wanted was
  preflight. That output is vendored in `src/mxn-lab/preflight.css` rather than
  putting a PostCSS pipeline in a repo with no other use for one.

## How it is built

`mxn/index.html` is the fifth entry in `vite.config.ts`. It is the only React in
the repo, which is why `@vitejs/plugin-react` is scoped to `**/mxn-lab/**` — the
rest of the build has no JSX and should not pay for the transform. It carries
its own stylesheet instead of `site.css`, and has no theme toggle: it is
drafting paper and black rule, one palette, with no dark counterpart to switch
to.

Its runtime files live in `public/mxn/`, copied to the output untouched, which
is what the worker and the Python modules need.

## Checking a re-copy

The engine is plain Python, so it can be run without a browser:

```bash
cd public/mxn/py
python3 -c "import bridge, json; print(json.loads(bridge.generate(2,2,[1,2,2],'lh','cw'))['rows'])"
```

`2×2` with `ks = [1,2,2]` must give extensions `(40,10)`, `(50,60)`, `(60,50)`,
every level 16 across, 0 within, 8 masks, 0 stray, 0 broken. Those are the
numbers the production page shows; if a re-copy disagrees, the copy is wrong.

Run it the way the browser does. Pyodide has no subprocesses, so `bridge` pins
the serial chunk path there; natively the multiprocessing path can settle on a
*different* combo for the same input — measured on this very sequence, where
the parallel path picked `(30,120)` at L3 and stopped being a weave. Pin it:

```python
import mxn_continuation_next as NX
NX._lh._get_cpu_worker_count = lambda _total: 1
```

That divergence is a real defect in the engine and not something this page
works around; it is recorded here so a check does not chase it by accident.

### Shorter arms

`prefer_short_arms` (default on, and a sidebar checkbox) makes the per-band
selection prefer the smallest total extension among configurations whose gap
variance is within `SHORT_ARM_VARIANCE_TOLERANCE` of the best, instead of
taking lowest variance outright. Whether the ring closes is a *joint* property
of both bands and is only tested after both have chosen, so the preference is
re-checked against `_ring_crossings`: if shorter arms cost crossings, the level
silently re-runs on lowest variance and keeps that. Shorter is a preference,
never a trade against the weave.

Measured over 24 sizes (26 levels), flag off → on:

| size · ks | before | after |
|---|---|---|
| 2×2 `[1,2,2]` L3 | `(40,90)` 260 | `(60,50)` **220** |
| 2×2 `[-1]` | `(30,110)` 280 | `(40,70)` **220** |
| 3×3 `[1]` | `(90,50,70)` 420 | `(60,20,40)` **240** |
| 3×3 `[-1]` | `(30,200,180)` 820 | `(40,120,90)` **500** |
| 2×3 `[1]` | 560 | **480** |
| 3×2 `[1]` | 620 | **340** |

6 levels shorter, 20 unchanged, none longer, all 26 still healthy weaves. Total
extension across the matrix falls 4640 → 3680.

The non-square `k=1` sizes (`1×2`, `2×1`, `1×3`, `3×1`) are deliberately
**unchanged**: their shorter candidates do not close the ring, so the
crossing re-check reverts them. Finding a shorter *complete* ring for those
needs the joint search over both bands, not a per-band preference.

`[1,2,2]` is worth using as the check precisely because it is a max-k sequence,
which the lab's own sidebar warns is an open research edge — the handoff notes
it comes out clean only because the browser engine carries the even-k
orientation exchange from one level into the next. A copy that loses that will
still render; it will just quietly stop weaving, which is why the check is on
the numbers and not on whether a picture appeared.

### Learning each level's reach from the ones below it

A level past the first ordinarily walks its extension ceiling **up to 200px**.
`escalate_extension` defaults to on for `level >= 2` on the stated grounds that
"every ring past the first sits further out and needs longer arms than the
sheet's 200px ceiling allows" — which is true of the ceiling a deeper ring
*might* need, and measurably not true of the one it *uses*.

The sidebar checkbox **learn each level's reach from the ones below it** caps
each level past the first at the longest arm any level below it actually
reached, and turns the escalation off. Measured on `3×1 ks = [-1, -1]`, where
level 1 reaches 80:

| level 2's search | seconds | arms | crossings |
| --- | --- | --- | --- |
| escalating to 200 (what ships) | **54.0** | `(190, 190, 70)` | 10/12 |
| ceiling 200, no escalation | 61.1 | `(190, 190, 70)` | 10/12 |
| ceiling 110 — reach + 30 | 11.4 | `(50, 0, 0)` | 10/12 |
| **capped at level 1's reach, 80** | **4.9** | `(50, 0, 0)` | 10/12 |

The 120px of ceiling above what level 1 needed bought **no extra crossings** —
it bought fifty seconds and arms nine times longer. Whole runs through
`bridge.generate`, both levels, cap off → on:

| size · ks | seconds | level 2's arms | level 2's crossings |
| --- | --- | --- | --- |
| `2×1 [-1,-1]` | 6.8 → **3.9** | 220 → **30** | 6/8 → **8/8** |
| `1×2 [-1,-1]` | 6.5 → **3.9** | 220 → **30** | 6/8 → **8/8** |
| `1×3 [-1,-1]` | 116.2 → **64.6** | 450 → **50** | 10/12, unchanged |
| `3×1 [-1,-1]` | 115.4 → **63.4** | 450 → **50** | 10/12, unchanged |
| `2×2 [-1,-1]` | 2.2 → 2.1 | 220, unchanged | 16/16, a weave either way |
| `1×1 [1,1]`, `1×2 [1,1]`, `1×3 [1,1]` | unchanged | unchanged | unchanged |

Crossings never fall in any case measured, and rise in two.

#### Why the cases it does nothing for are the closing ones

`2×2 [-1,-1]` and every `[1,1]` row above are untouched, and that is not luck.
`align_continuation_level` already warm-starts a level from the combos the
levels below settled on — but it accepts a seeded attempt **only when the ring
it produces is complete**, so that "seeding can speed a level up but never
change what is reachable". Where a ring closes, the seed wins, the escalation
never runs, and there is nothing left for a cap to save.

Where a ring *cannot* close — `k = -1` on `2×1`, `1×2`, `1×3`, `3×1`, which is
the whole family the boards at `/mxn/ks/-1/` are about — the seed is tried,
rejected for being incomplete, and the full escalation runs anyway. Measured on
`3×1`: seeding costs **+8.9s** there and never once wins. The cap is what turns
that dead warm-start into a live one.

`scripts/reach-matrix.py` is what produced the table, and running each case
twice is the only honest way to offer this: crossings are the thing that must
not fall, while seconds and arm length are what the cap is meant to buy. It goes
to sides of 3 by default because a `1×4` pair is many minutes; `--max-side=4`
is the overnight version.

**It is off by default, and it is in the cache key.** It changes which ring a
level settles on, not merely how long the search takes to find it, so a run
stored under it is addressed as `…/s1-eauto-b400000-r1` and can never be
confused with the ordinary search's answer for the same parameters. The segment
is appended *only when the cap is on*, so every key the farm and the fitter have
ever written stays exactly where it is — `npm run check:reach` pins that, along
with the Worker's own validator agreeing about the shape.

`?reach=1` turns it on in a deep link. The farm has the same checkbox, so a
sweep can fill a shelf under it.

**It is also the one flag `findShelfVariant` may not cross.** That fallback
exists so a reader who types m, n and ks and misses on the exact step still gets
a stored answer — the size is what they asked about, not the step. The cap is
not like that: it decides which ring a level settles on, and adopting across it
would both answer a question nobody asked and make ticking the box appear to do
nothing, since the uncapped run is always sitting there to be adopted instead.
Tick it with nothing capped on the shelf and the page computes, and says so.

#### It does nothing for level 1

A cap is learned from the levels below, and level 1 has none. That is what the
next section is for.

### Level 1, replayed off the shelf instead of searched

The shelf is keyed by the **whole sequence**: `run/v3/lh-cw/3x1/-1` and
`run/v3/lh-cw/3x1/-1_-1_-1` are unrelated artifacts, and the farm's *skip what
is already stored* asks about the whole key. So every sequence beginning with
`-1` used to re-search the identical level 1, from scratch, every time — the
largest single waste in a deep run.

It need not. **Level 1 depends on nothing but `m`, `n`, `ks[0]`, the hand, the
direction and the search flags** — the same fact `bridge.generate`'s own
`level1_for_k` already relies on within a single run. So the L1 of `[-1,-1,-1]`
*is* the L1 of the stored `[-1]`, and it can be replayed rather than searched
for again.

Both pages do it automatically when the single-k run is on the shelf. Verified
strand-for-strand rather than argued:

| 3×1 `[-1,-1,-1]` | seconds | L1 ring | every level | L1 browser |
| --- | --- | --- | --- | --- |
| searched | 170.5 | `bd033df7…` | `(80,70,20)`, `(190,190,70)`, `(160,110,10)` | full |
| **replayed** | **134.7** | `bd033df7…` **same** | **identical** | none |

`2×1 [-1,-1,-1]` is 8.7s → 6.7s and `2×2` 1.8s → 1.0s, both bit-for-bit
identical. `npm run check:l1` asserts it: the strand hash of every level, every
audit number, and the two things that are *allowed* to move.

#### The two things that move

**`enumerated` goes to `none` on L1.** A pinned attempt evaluates the one combo
it was told to use, so there is no candidate list — that level's solution
browser and exact count are gone *from this artifact*. They are not gone from
the shelf: the single-k run it was replayed from has them in full, and the
sidebar says so and links to it. Duplicating the enumeration into every deeper
sequence was what the seconds were being spent on.

**`applied` reads `seeded` on L1.** That is the audit trail recording how the
ring was found, which is the one thing that genuinely changed. Every audit
*number* is identical.

#### Where it deliberately does not happen

- **A warm.** After a cache hit the lab warms a session so the browser, the ⚑
  sweeps and an uncached census work. Warming into a replayed L1 would be
  warming into exactly the thing the reader pressed an arrow to get, so a warm
  always searches.
- **A single-level run.** There is no earlier run to replay from.
- **The farm, if you untick it.** *Replay level 1 off a stored single-k run* is
  on by default and next to *skip what is already stored*.

No new cache key: the artifact holds the same geometry it always did, so a
replayed run and a searched one are the same answer and belong at the same
address. `level1Replayed` in the artifact says which it was.

### Browsing every solution

Each level's card carries `‹ index / count ›` and a ⭐. The engine already
enumerates every valid configuration per band and hands them over through
`on_config_callback`, so the candidate lists cost no extra search; stepping a
solution overlays one H and one V candidate onto a fresh virtual view
(`NX.apply_solution`) and keeps it only if the joint `_ring_crossings` score is
complete. Roughly 1 ms per ring, so an arrow click is instant.

Order is lexicographic, H outer, V inner — the same shape `attempt()` uses.
Nothing is re-ranked, and the engine's own answer sits at its natural position.

The count is exact, up front, and it happens inside the run: the worker counts
every level before the result posts, so the cards land with `1 / total` already
on them, and while it counts the busy area carries a **counting strip** — a bar
per level with the walk's position in the pair product and the count growing.
Where the browser allows it the counting is parallel: a small pool of sibling
workers ("counting hands", `count-worker.js`) each walks one contiguous slice
of the H × V product — the walk's order is lexicographic, so `[0, cells)`
splits into ranges whose concatenation IS the serial walk's found-list
(`export_count_job` / `count_slice` / `adopt_count` in the bridge). Each hand
holds its own Pyodide, warmed while the engine itself loads; if the pool
cannot spawn or a slice fails, the level falls back to the serial walk with
nothing adopted. In-run counting is capped (60,000 pairs a run) so a huge
product cannot hold the cards hostage — a level left inexact says so and is
finished by the background chain below.

The background chain is the fallback and the over-ceiling path. The walk that firms it is budget-bounded in the
engine (`RING_SCAN_BUDGET` cells per call, resumable through `scan_cursor`), and
the page drives it as soon as a run lands: one `count` request in flight at a
time, the same level again until `countExact`, then the next level — so a click
of anything slots in between rounds rather than behind all of them, and the
label never has to read `2+`. With a real end known, the `›` arrow stops at it.
The reply carries both totals — every closed ring, and the weaves among them —
so the nav shows the split beside the count, and the healthy-only filter swaps
the denominator to the weave total rather than paging under the wrong one.
The cache the walk builds is deliberately light — candidate indexes and the
audit row, never strands, which read as harmless and measured half a gigabyte
for a 2×2 counted to the end (10,189 rings). `select_solution` re-materialises
the one ring it returns instead, one replay, the price a cache miss always
cost. The cache holds every closed ring whatever the healthy-only filter says,
and the filter is applied when picking, so a healthy-only browse cannot poison
the list an unfiltered browse then indexes into.

Two kinds of level have no list to start from and enumerate when the count
chain reaches them — right after the run, no longer on the first click — which
runs one extra search:

- a **seeded or pinned** level only ever saw the combo it was told to use
  (`LEVEL_ONE_DEFAULT_SOLUTIONS` makes `2×2 k=1` one of these);
- a **square level 1** pins V to H through `share_square_extensions`, so V never
  really searched. Enumeration re-solves with `mirror_sides=False`.

`k = 0` is the one case with genuinely one solution, and says so.

What this buys, measured:

| size · k | engine pick | shortest complete ring while browsing |
|---|---|---|
| 1×3 `k=1` | `(170,130,150)(0)` 450 | `(100,0,50)(50)` **200** |
| 2×2 `k=1` | `(40,10)(40,10)` 100 | `(40,0)(40,0)` **80** |

Both browsed rings audit clean — 12/12 and 16/16 across, 0 within/stray/broken.
This is the joint search the per-band `prefer_short_arms` tie-break cannot do.

⭐ writes to `localStorage` under `mxn-lab-solutions`, in the shape the eventual
database table takes — including `parent_strands`, the Lᵥ₋₁ ring it was built
on, so a later rating always knows what it was rating. Download exports the set.

### The busy state

A run shows `LiveCandidateFigure` in the results column — a contact sheet of the
candidates the engine is producing, not a spinner. Frames arrive up to ~28 a
second (`FRAME_MIN_INTERVAL`, capped at `FRAME_MAX_DUTY` of the worker's time),
so they are held in a `FrameStore` outside React state and only that figure
subscribes; a frame costs one small canvas draw rather than a re-render of every
diagram on the page. The rate the sheet fills at *is* the search rate.

The `thinking …` plaque over it carries the run's scale:

- **the group's own bar**, `completed / total` straight off the frame — `total`
  is the extension grid the engine is walking for that band;
- **the run's bar** behind it, groups finished plus the fraction of this one,
  over `levels × 2` groups. Kept to a high-water mark: the group number is read
  off the frame's phase, and the engine may take a level's two bands in either
  order, but work already done does not become undone;
- **the ceiling**, `≤ N combos` — `worstCase()`, which is the same formula
  `pick_extension_step()` sizes a run with, summed over both groups of every
  level. It is what the run can cost at worst, not a forecast: a group that has
  what it needs stops early, so the run finishes at or before it. That is the
  point of showing a number that can be beaten.

The dots keep their own beat rather than the engine's: when a search stalls the
tiles freeze and the dots carry on, which is the difference between a slow band
and a hung worker.

### The level widget

Each card carries a drawer at its foot, opened and closed per level rather than
once for the page: two Lᵥ can be held open side by side, which a single shared
panel could not do — it would only ever describe the last card clicked. Open
state lives in `openWidgets`, a `Set` of level numbers, beside `fullSizeLevels`
which does the same job for the card's `+`/`−` size toggle.

The drawer holds the trace panel (see *The trace census* below): opening a
level's widget sends the worker a `trace` for the band it was last shown at
(V by default), and the H/V buttons in the panel's head swap the question.
Traces are cached per level and band in `traces`, so reopening a widget never
re-runs a census.

While the census computes, the drawer shows `TraceSweep` — **the band itself**,
swept here as it is swept there. It used to be a schematic: three strands from
a hash, a heading rocking back and forth, verdicts drawn from a weighted table.
It looked like work without being any, and it could not say how much was left.
It now runs on the plan (below), which is the band search's own arguments.
Geometry is affine in the extensions, so the widget walks the real combo grid,
places the real arms, and applies the real tests at the real angles: every cell
it paints is a verdict the census will paint the same colour, and the strip is
the same picture the finished grid shows. Once it has previewed every combo it
keeps stepping through them rather than freezing.

Two clocks, deliberately kept apart:

- the **combo strip** is this preview's own position, which is local and says so;
- the **bar under it** is the worker's, reported from inside the sweep by
  `emitTrace`, and is the one that answers how much is left. Beside it sits the
  size of the whole job — `combos × angles` — because a bar with no denominator
  is not an answer to "how long".

Before the plan lands there is still no dead box. Two things fill that stretch,
and both are real:

- **the replay's own candidates.** The replay is a full search, so it installs
  the same `NX._progress_frame_callback` relay a run does, tagged with the band
  being traced. The widget draws those rings as they arrive and reports the
  replay's own `completed / total`. The tag is what keeps them out of the run's
  busy sheet, and the sheet's out of the widget.
- **the level's ring as it stands**, drawn from the page's own strands until the
  first frame lands, so there is no moment with nothing true to show.

The plan itself comes earlier than "after the replay": it is emitted from inside
the search hook, which fires *before* the band's search runs, not after the
replay finishes. Only when nothing has reported a position yet — the seconds
before the first frame — is the bar an indeterminate shuttle, and it says so
rather than implying a fraction.

Beside the census the panel shows a **weave pattern (this combo)** box: the
cell being looked at, woven. It is engine geometry, not a sketch —
`bridge.trace_weave` replays the level from its checkpoint with the traced
band's arms placed at that combo and angle and the other band held at the
engine's own pick, then audits the result, so the caption carries the same
`ok/ok · WEAVE` verdict and crossing count the level card prints. Requests are
debounced 250 ms, suppressed while the panel is playing or recording, and
cached per cell (`TRACE_WEAVE_CACHE` entries per level and band, oldest out).
The engine's own pick costs no request at all: the trace payload embeds it
already woven (`payload["weave"]`), the studio seeds the cache from it on
`trace-ready`, and since the panel lands on that cell at that angle, the
default preview is on screen the moment the census is.

### Show on main diagram

The weave preview is 300 px square beside a census; the card's diagram is the
drawing everything else on the page is read against. **Show on main diagram**,
at the end of the stepper row, sends the cell there. It costs nothing extra —
`TraceWeave` already carries the strands and the audit row, which is exactly
what the `solution` and `semi-solution` messages carry, so it takes the same
path they do and the card's metrics, gaps and `WEAVE / NOT A WEAVE` corner all
describe the traced ring.

Two things keep the card honest about which ring it is drawing:

- **The engine's own pick is not an override.** It is the one cell that is also
  a numbered solution, so showing it walks the browser to `enginePick` instead
  of replacing anything: the number and the drawing then agree, and they agree
  on the engine's answer. Every other cell is not a solution at all.
- **A traced cell says so.** The card head carries a `TRACED ext (…) · angle`
  chip with its own *back*, which restores the ring the run produced — kept once,
  on the first override, so *back* returns to the run's ring rather than to the
  previous override. While the chip is up the solution browser is set back and
  drops its *engine pick* tag, because neither describes what is on screen. A
  `solution` or `semi-solution` reply clears the override on arrival: the
  browser has just put its own ring on the card, so the override is over.

### Loading a run instead of computing it

Everything above is computed in the reader's browser, and everything above is
the same for every reader: one engine commit, `random.seed(0)`, one set of
parameters, one answer. So it need only be computed once, anywhere.

[`/mxn/gpu/`](mxn-farm.md) does that ahead of time over a whole range of sizes
and stores each answer on the same Cloudflare Worker the ⭐ dataset uses. When a
Worker URL is configured, `Run` asks the shelf before it starts the engine, and
opening a level widget asks for that level's census before it asks for a replay.
Measured on `2×2 [1,2,2]`: 27 seconds of engine time becomes about 1.2 seconds
of fetch, with Pyodide never loaded — and the cards land with `1 / 10,189`
rather than `1 / 2+`, because the farm finishes a count this page caps.

A cache hit brings no *session* with it: the geometry is real but Pyodide has
never seen this size, so the solution browser, the ⚑ sweeps and an uncached
census all warm one first (`withSession`). The warm is an ordinary generate with
the ordinary busy sheet; what changed is that the wait now sits between a reader
and their second question rather than between them and the first picture. It
adopts the solution meta and deliberately leaves the drawing alone — it is the
same computation, so replacing identical geometry would only make every card
flicker. Nothing warms the engine that a reader did not press: the widget's
woven preview of a traced cell is asked for as the *cursor* moves, so it
declines instead, and says so.

With no cache configured, or one that is unreachable, or `?cache=` with nothing
after it, the page computes exactly as it always has. That is the point of the
fallback and it is worth keeping true: `npm run qa:cache` asserts both halves.

`docs/mxn-farm.md` has the key layout, the queue, the transport and the checks.

### A person's ★ best, in place of the engine's pick

The run is what the engine said. The other shelf — `picks/v3/…`, written by
[`/mxn/fit/`](mxn-fit.md) — is what a **person** said, and the rule the k boards
are built around ([docs/mxn-ks-board.md](mxn-ks-board.md)) applies here too:

> **A person outranks the engine.**

So when a run lands, from the cache or from the engine, the lab asks that shelf
too. A ★ best goes onto the level it was judged for, the card says **human
pick** and who pressed it, and the sidebar names where it was read from. This is
why a ring starred at `/mxn/fit/`, or drawn on a k board, now appears here
without anybody loading a file: the judgement was always on the shelf and this
page was the one that never asked.

A judgement carries its whole ring, so drawing it costs no Pyodide, no
`generate` and no fit — one public GET, no token, and the fast path stays as
fast as it was.

Four things it is careful about, and each is a way the card could look right
while lying about which ring is on it:

- **Only a ★ best is adopted.** Never the newest ✓ valid, never a ✗ rejected.
  Either a person chose or the engine did; there is no middle tier, and a page
  that promoted the newest valid on its own would be inventing a verdict nobody
  pressed.
- **The engine's own ring is one press away and never hidden.** The chip toggles
  in both directions, and the solution browser greys its `‹ index / count ›`
  while a judged ring is up, exactly as it does for a traced cell — the number
  describes a ring that is not on screen and says so.
- **The numbers under a judged ring are the judgement's.** A run's audit row is
  not reused: it measured a different ring. A judgement carries crossings,
  expected, stray, broken and the extensions it was fitted at, and carries
  nothing about gaps, `within` or masks — so those print `—`. A zero nobody
  measured reads exactly like a zero somebody did.
- **The ⭐ will not bank it.** The rating dataset is a queue of *this run's*
  solutions, and a judged ring is neither — it has its own geometry, none of the
  audit row beside it, and a home already (`picks/v3/…`). The star is disabled
  while one is up and says why.
- **A judgement with no ring is reported, not drawn.** Judgements saved before
  rings were stored in a pick (`hasRing = False` in
  [docs/picks-shelf.md](picks-shelf.md)) genuinely need the engine. The sidebar
  says so and names the fix, rather than showing the engine's ring under a
  "human pick" chip.

**The search flags are allowed to differ.** The farm sweeps at
`s1-e5-b100000000` and the fitter always writes `s1-eauto-b400000`, so requiring
the run's key and the judgement's key to match would mean a ★ best that is
plainly visible at `/mxn/ks/-1/` could never appear at `/mxn/` — which is
exactly what used to happen. A judgement is not a search: it is a ring somebody
placed and a verdict they pressed, and the flags in its key say only which run
was on screen at the time. The lookup asks the run's own key first, then the
fitter's canonical flags, then any other flags-variant of the *same size, hand,
direction and ks* that the shelf or this browser lists — so an exact match is
never passed over for a looser one. Nothing else is ever substituted.

`src/mxn-lab/picks-shelf.ts` is pure and React-free so `npm run check:picks` can
pin all of the above without a browser; `npm run qa:cache` drives the same rules
through the real page, against a real Worker, and asserts the engine stayed
asleep throughout.

The size clamp still applies: the lab takes m and n up to 4, so a ★ best judged
at `5×1` is on the shelf and on its k board but has no lab card to land on.

### The dataset API

⭐ and 🚩 always write to `localStorage`. If a Worker URL and admin token are set in
the sidebar's *dataset API* panel, it **also** POSTs to
`worker-api/` — a Cloudflare Worker over D1, deployed separately and entirely
optional. The local copy is never replaced by the remote one: a bad token or a
dropped connection must not lose a solution the star just claimed to save.

That same panel's URL is what the result cache reads from, and its **Publish
run** button stores the run on screen plus every census already open. One
Worker, one token, one field.

The token lives in that browser's `localStorage` and nowhere else. It is a
Worker secret on the other end (`wrangler secret put ADMIN_TOKEN`), never in
this repository.

`worker-api/README.md` has the five setup commands. The dataset half of that Worker was written where Cloudflare was unreachable and
shipped as reviewed rather than exercised code. It is exercised now:
`cd worker-api && npm test` runs the real `fetch` handler against real SQLite
behind a D1 shim, covering every route including the ones that predate the cache.
What is still untested is Cloudflare itself — the first `wrangler deploy` remains
the first time D1 and R2 answer rather than a shim.

### Rating what you saved, at /mxn/rate/

A separate page over the same dataset. It pulls unrated rows, draws each
solution **beside the Lᵥ₋₁ ring it was built on** — a rating is of the step from
one ring to the next, so the base has to be visible at the same time — and
PATCHes a 0–100 score.

It reads the worker URL and token from the same `localStorage` keys the lab
writes, so the token is entered once, in one place.

The list endpoint omits geometry on purpose (it would be megabytes across 500
rows); the page fetches the full row only for the solution actually on screen.
Rating advances to the next row automatically, because this is a queue rather
than something to browse.

`noindex` in the head: it is a private tool over a token-gated dataset.

### Near-misses, at /mxn/semi/

The browse above keeps only pairs whose joint crossing count reaches `expected`
and throws the rest away, which is too strict to learn from. The two bands are
searched independently, so a good set of H extensions can be lost on account of
the V it happened to be tested against — and what decides a borderline pair is
the corner detection, which is not yet exact for every `k` and every `m × n`.

The `⚑H` and `⚑V` buttons on a level's card sweep for those, one band each.
Rather than the full `H × V` product, a sweep holds the *other* band at a value
taken from a ring that **does** close and varies the flagged one, so it costs
`len(band)` replays instead of `len(h) × len(v)` — a second or two, not minutes.

Two buttons rather than one toggle, because a near-miss is always blamed on one
band and "which H values did the search throw away?" is a different question
from the V one. `scan_semicomplete(level, band)` sweeps only the band asked for,
so pressing one flag costs half of what the old both-bands scan did and the list
it fills needs no reading of a per-row band label. Pressing the lit flag returns
the card to rings that close; pressing the other swaps the question, which is a
fresh sweep — the session holds one band's list at a time.

One reference partner is not enough. A candidate that fails against one partner
may close against another, and that kind is already reachable by browsing, so
calling it a near-miss would send a rater to judge something the search never
lost. Each band is therefore swept against up to **three distinct** partners and
a candidate is kept only if it closed against none of them. On `3×1 k=1` that
prunes 224 apparent near-misses to 165; on `2×2 k=1`, 6 to 3. It is still not a
proof — some further partner might close it — so `refs`, the number of partners
tried, is stored on every row and shown on every card rather than being rounded
up to "never".

Collecting those partners has one trap. Complete rings enumerate H-outer and
V-inner, so the first dozen share one H between them; taking partners from a
fixed number of rings left the V sweep — the side that carries nearly all the
near-misses on a non-square — with a single partner. The walk now continues
until *both* sides are diverse, or the product is exhausted and however few
exist is all there are.

Attribution rests on naming the bands correctly, and that is not a geometric
question. `2×1` puts one pair in the engine's H group and two in V, while the
direction-family split cuts the other way, so `band_report` takes the H
membership from the candidate's own `moves` list instead of guessing from the
arm angles. Reporting a fold against the wrong band would be worse than not
reporting it.

Near-miss mode swaps the save
button from `⭐` to `🚩`, because the two write to different queues and a shared
glyph made a mis-press invisible: the near-miss appeared not to save when what
had actually happened was that the closed-ring star was pressed. `🚩` writes
`kind: "semi"` with the band, the deficit and `refs`, and `/mxn/semi/` is the
queue over those rows — the same component as the categoriser, tinted amber, so
a rating cannot be filed against the wrong question by accident. What a score
means there is different: it is about one band's numbers only, and 100 is a
claim that the search discarded extensions it should have kept.

`k = 0` has one configuration and nothing to sweep, so it gets no flags.

### Reading the list in a useful order

`SORT` offers four named orders, one lit — the one the list is actually in, and
disabled because pressing it would ask for the sort it already has. They are
`bridge.SEMI_KEYS`, and the comparators live in `_semi_order` beside the list:

| button | orders by | the question it answers |
| --- | --- | --- |
| `NEAR` | `deficit`, then `total` | which ring came closest to closing |
| `H` | H total, then H's worst pair, then `deficit` | which H answer is best |
| `V` | V total, then V's worst pair, then `deficit` | which V answer is best |
| `BEST` | `peak`, then `total`, then `deficit` | which ring is best-formed |

`H` and `V` rank one band by *its own* string. That is what the previous pair of
orders could not do: `SORT EXT` sorted on `total`, which adds the swept band's
extension to the held one's, so an H list came out ordered partly by the number
the sweep was holding still — and on these lists `deficit` is very often
constant, which left `SORT NEAR` and `SORT EXT` printing near-identical lists
and neither of them answering "which H did the search throw away, and which of
those was the tidiest H".

`BEST` is minimax over the pairs, and it is the one order whose leading term is
never a constant. `peak` — stamped on every row by `scan_semicomplete` — is the
ring's *longest single pair extension*. A `total` can hide one pair stretched to
`MAX_PAIR_EXTENSION` behind several short ones, and that pair is the one that
fails first, so of the rings that fell short the one whose worst pair is mildest
is the best-formed. On `3×1 k=1` it visibly reorders a 165-row list that `NEAR`,
`H` and `V` all leave in the same order.

Every key is a *total* order — band and index close it — so a reorder is
reproducible, and `sort_semicomplete` can find the row that is on screen again
afterwards. No ordering re-runs the sweep: it reorders a list already in the
session and returns the head of it, and the ring on screen keeps its place by
identity rather than by index, so a reorder never silently swaps what is being
looked at — or what `🚩` would bank. The comparators live in Python beside the
list, because only its head (`SEMI_RETURN_CAP`) ever crosses the worker
boundary — sorting in the page would silently work on a prefix.

There are no `H− H+` / `V− V+` steppers. They walked the swept band with the
other band's candidate held, which is the shape the sweep has, but it is not a
question about the list: it asked to see one more failing extension when what
the strip is for is putting the failures in an order and reading down them. The
numbers they carried in their tooltips — this band's px, the held band's px —
are on the near-miss badge's own tooltip instead, next to the worst pair, so the
quantities the four orders sort on are readable from the row being looked at.

`npm run qa:semi` drives the strip through the real UI against payloads captured
from the real bridge (`python3 scripts/semi-fixtures.py`), in the same
fake-worker arrangement as `qa:trace`.

### Checking the page's copy of the tests

`src/mxn-lab/trace-census.ts` is a port of `mxn_trace.sweep_combo`, and a port
that quietly disagrees with the engine would be a widget that lies confidently.
`npm run check:census` holds the two to the same answers over every combo of
both L1 bands at every in-window angle — 37,422 verdicts — against references
from `python3 scripts/census-fixtures.py`. Both sides run over one fixed angle
grid (the probe's, the one `trace_plan` sends) rather than the census's
per-combo windows: what is checked is the arithmetic of the tests, not where the
window sits.

`npm run qa:widgets` drives both busy states through `mocks/widgets.html`, which
mounts the real components against real engine payloads with only the worker
standing in. See `mocks/README.md`.

### Cache keys

There are two of them, and they are bumped for the same reason and never
together.

**`trace-plan-v23`**, the engine-file key, appears in six places: the worker URL
(`weave-studio.tsx`), the Python fetch URL and the counting-hand URL
(`exact-worker.js`), the counting hand's own fetch (`count-worker.js`), the farm
hand's fetch (`farm-worker.js`) and the URL the farm page spawns it with
(`farm.tsx`). Bump them together when the engine files change, or returning
readers run stale geometry — and a farm that quietly ran an older copy would fill
the shelf with answers the lab then disagrees with.

**`CACHE_VERSION`** in `src/mxn-lab/cache.ts` is the shelf the precomputed
answers sit on. Bump it when the engine changes what it *answers*, which is not
the same event: a fix to the counting walk changes both, a change to a docstring
changes neither, and a page holding last month's geometry under this month's key
is worse off than one that computed it. Nothing on the old shelf is deleted; it
simply stops being looked at.

## The vectorised angle scan, at /mxn/fast/

`_numpy_try_all_angles` measures as roughly three quarters of a run's time.
Despite the name it batches only its *setup* across angles: the scoring is a
Python `for ai in valid_angle_indices` loop doing small numpy calls on arrays of
a handful of elements, where dispatch overhead dwarfs the arithmetic. A 3×3
`k=1` run made 773,975 `np.any` calls — about one per angle per combo.

`_rank_angles_vectorised` does that loop's work over the angle axis in one pass
and hands the loop its angles already ordered by the key the loop minimises,
`(first_last_distance, gap_variance)`, earliest angle first on a tie. The loop
then takes the winner on its first iteration and rejects everything after, so
the selected angle and the result dict built from it are unchanged; only the
rejected angles stop being visited one at a time. When a ranked winner's
configuration fails to build, the scan replays unaccelerated rather than answer
differently.

It is off by default. `/mxn/fast/` is the same component, the same engine files
and the same build as `/mxn/`, with `data-engine="fast"` on `#lab`; that rides
to Pyodide on the worker URL as `engine=fast` and sets `FAST_ANGLE_SCAN`. Two
links off one build, so an A/B compares the scan and nothing else.

Measured serial — the path Pyodide takes — every row byte-identical:

| size · ks | default | fast |
|---|---|---|
| 2×2 `[1,2,2]` | 2.47 s | **0.60 s** |
| 2×2 `[-1]` | 1.25 s | **0.24 s** |
| 2×3 `[1]` | 22.69 s | **3.26 s** |
| 3×3 `[1]` | 21.16 s | **3.32 s** |
| 3×3 `[2]` | 20.91 s | **2.89 s** |

12 sequences over 5 sizes, 118.6 s → 18.4 s, and the `2×2 [1,2,2]` oracle above
still gives `(40,10)`, `(50,60)`, `(60,50)` at 16/0/8/0/0 per level.

## The trace census

`bridge.trace_census` answers what the band search ruled out and on which test.
The census lives in `public/mxn/py/mxn_trace.py`: the same tests in the same
order, but it records a verdict for every `(combo, angle)` instead of stopping
at the first failure, and sweeps ±40° so the angles production never reaches are
marked `WINDOW` rather than left out. In-window verdicts use the engine's own
per-combo grid, so the `BEST` count equals the number of valid configurations
the real search reports.

On the lab it lives in the level widget (see *The level widget* above); the
worker carries it as the `trace` message, and answers in two parts:

- **`trace-plan-ready`**, carrying the band search's own arguments — the
  extension grid, the angle window and step, the gap bounds, and the geometry
  (`origins`, `directions`, `pairIndices`, `targets`) every configuration is
  affine in — plus `combos` and `evaluations`, the size of the job. The pending
  widget is drawn from this. It is emitted twice over, harmlessly: once from
  inside the search hook the moment the inputs exist, which is before the band's
  own search runs, and again as `bridge.trace_plan`'s return value.
- **`trace-ready`**, from `bridge.trace_census`, with `trace-progress` messages
  arriving from inside the sweep on the way (`mxn_trace.PROGRESS_STEPS` of
  them at most). This is the census itself.

Both read band inputs cached on the session by `_trace_band_inputs`, so the
split costs no second replay. `bridge.trace_level` is still there as
plan-then-census in one call, for the offline callers that have nothing to
report progress to.

`src/mxn-lab/trace-census.ts` is the page's copy of `sweep_combo`, one combo at
a time: the pending sweep runs it over the plan, and the finished panel draws a
cell with it rather than having the census carry geometry it can recompute.

### Reading the grid: two questions, one picture

The census is a `(combo, angle)` matrix and the panel shows two cuts of it, kept
in step with each other:

- the **grid** is every combo, coloured either **over its whole sweep** — the
  angle it settled on if it found one, else the test that ended most of its
  in-window angles — or **at one angle step**, which is a column of the matrix.
- the **strip** is every angle of the combo under the cursor.

Clicking a cell moves the strip to that combo; clicking the strip puts the grid
on that step, because a reader who has just picked an angle is asking about that
angle. The head's *Whole sweep* / *At this angle* button says which is on and
switches back. On a slice the step is the axis every cell shares, so clicking a
cell holds it rather than jumping to that combo's own pick — and `Play` holds it
too, so the walk compares combos at one step instead of reshading the grid 24
times a second. Note what a step is not: each combo's window sits at its own
`angle0`, so step *j* is the same *position* in each combo's sweep and a
different number of degrees for each. The heading says the step, never a degree.

Under the drawing, two steppers walk it by hand: **ext** ↑ ← → ↓ moves one cell
of the grid, which for P ≤ 2 is one extension of one pair and above that the
lowest digit the layout puts on that axis (a step walks over the gutters of a
wrapped layout rather than stopping at one), and **angle** ‹ › moves one step
along the strip. The cursor's own verdict is named at the end of the row, so a
step that changes it says so without a hunt for the caption.

One consequence of how the census records itself is worth stating, because it
looked like a bug: **`BEST` is the valid angle a combo's ranking picked**, so any
combo with a valid angle is drawn `BEST` on the summary and no summary cell is
ever `VALID`. A literal `VALID` filter there would dim the whole grid, so on the
summary it reads through to those cells. At an angle step the two are the
distinct things the census recorded and neither is redirected.

**A filter also travels.** Dimming alone is no help when the cells it keeps are
at an angle step that is not on screen — the `VALID` entry counts its cells and
the reader was left looking at a map with none of them. Pressing a legend entry
goes to the angle step holding the most of that verdict and to the nearest cell
that has it there, which is what drags the red box, the strand view and the
weave preview along. `BEST` is the exception: it is the engine's own answer
rather than a population, so it goes to the combo this level adopted at the
angle it chose — the ringed cell.

`src/mxn-lab/trace-layout.ts` holds
the combo grid as arithmetic — the combo index is a base-E number with one
digit per extension pair, so the grid is that number de-interleaved, even
place-value exponents on x and odd on y, with `npm run check:trace` holding
`place` and `unplace` to being inverses — and the offline scripts below render
the same census. Two things worth knowing:

- **It forces the vectorised scan on**, whichever page it runs from. The replay
  is a full search and the census is roughly two more on top; without the
  vectorised path a 3×3 trace is tens of seconds.
- **`TRACE_BUDGET` caps it at 4M evaluations.** 3×3 sits near 2.2M. 4×4 would be
  ~46M, and is refused with the real numbers rather than handed back silently
  subsampled — a picture that quietly dropped angles would be worse than none.

Like `enumerate_level`, the replay passes `mirror_sides=False`, so a square
level 1 traces the search its V band *would* have run rather than the pinned one
it actually used.

The replay keeps the grabbed band inputs in the session, and
`bridge.trace_weave(level, band, ext, angle)` reads them to materialise one
cell: the traced band's arms placed at those extensions and that heading — the
same affine placement `mxn_trace.place` sweeps — applied through
`apply_solution` with the other band held at the engine's pick. It costs one
checkpoint replay, returns the woven strands plus the standard audit row, and
is applied whether or not the cell passed its tests: what a failing combo looks
like woven is exactly what the panel's weave preview is for.

`scripts/mxn_trace.py` is the offline half — it pulls band inputs out of a real
generate and keeps the per-combo geometry — and `scripts/mxn_trace_video.py`
renders the census to a webm (ffmpeg here is Playwright's build: JPEG in over
`pipe:0`, VP8 out — no H.264, so no mp4).

`2×1 k=1`, both bands, 110,880 evaluations:

| verdict | share | |
|---|---|---|
| `WINDOW` | 66.2% | outside ±20°, never tried |
| `ORDER` | 17.4% | gaps disagree in sign — strands out of order |
| `TOOFAR` | 11.5% | a gap above `max_gap` |
| `OVERLAP` | 4.5% | a gap below `min_gap` |
| `VALID` | 0.3% | every test passed |

`REACH` never fires at this size. Two thirds of the space is ruled out by the
angle window before any geometry is computed, and of what the engine does test,
order is the dominant rejection.
