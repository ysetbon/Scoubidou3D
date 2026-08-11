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

### Browsing every solution

Each level's card carries `‹ index / count ›` and a ⭐. The engine already
enumerates every valid configuration per band and hands them over through
`on_config_callback`, so the candidate lists cost no extra search; stepping a
solution overlays one H and one V candidate onto a fresh virtual view
(`NX.apply_solution`) and keeps it only if the joint `_ring_crossings` score is
complete. Roughly 1 ms per ring, so an arrow click is instant.

Order is lexicographic, H outer, V inner — the same shape `attempt()` uses.
Nothing is re-ranked, and the engine's own answer sits at its natural position.

Two kinds of level have no list to start from and enumerate on the first click,
which runs one extra search:

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

Before the plan lands there is nothing yet to sweep, and the widget says so:
the replay is named, and the bar is an indeterminate shuttle rather than a fill
of an unknown fraction.

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

### The dataset API

⭐ and 🚩 always write to `localStorage`. If a Worker URL and admin token are set in
the sidebar's *dataset API* panel, it **also** POSTs to
`worker-api/` — a Cloudflare Worker over D1, deployed separately and entirely
optional. The local copy is never replaced by the remote one: a bad token or a
dropped connection must not lose a solution the star just claimed to save.

The token lives in that browser's `localStorage` and nowhere else. It is a
Worker secret on the other end (`wrangler secret put ADMIN_TOKEN`), never in
this repository.

`worker-api/README.md` has the five setup commands. **That Worker has never been
run** — it was written where Cloudflare was unreachable, so it is reviewed code
and its first deploy is also its first test.

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

The `trace-plan-v15` cache key appears in both the worker URL
(`weave-studio.tsx`) and the Python fetch URL (`exact-worker.js`). Bump both
together when the engine files change, or returning readers run stale geometry.

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

- **`trace-plan-ready`**, from `bridge.trace_plan`. Costs the level replay and
  one probe placement, and carries the band search's own arguments — the
  extension grid, the angle window and step, the gap bounds, and the geometry
  (`origins`, `directions`, `pairIndices`, `targets`) every configuration is
  affine in — plus `combos` and `evaluations`, the size of the job. The pending
  widget is drawn from this.
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
