# The k atlas, at /mxn/ks/

`/mxn/gpu/` fills a shelf and `/mxn/` spends it, one parameter set at a time.
Nothing read it whole, so the question the shelf is best placed to answer was
the one nobody could ask: **for a given k, what happens as m and n grow?**

<https://ysetbon.github.io/Scoubidou3D/mxn/ks/>

The page never computes. There is no Pyodide on it and no engine — everything on
screen was computed by the farm on someone's machine and is being read back. An
empty cell means nobody has swept those parameters yet, and says so with a link
to the page that would.

## Why it exists

The engine sizes its search with two constants that are guesses:

- `MAX_PAIR_EXTENSION = 200`. The extension grid runs `0…200` per pair, for
  every size, at every k.
- the angle window, `±20°` around a reference heading, recomputed per combo.

Both are provisioned for a worst case, and the shelf is the only thing that can
say what the worst case actually is. Measured on the real engine at L1:

| size · k | chosen extensions | smallest ceiling still holding a valid ring | valid angle span |
| --- | --- | --- | --- |
| 1×1 k=1 | `[10]` | 10 | 58.9° |
| 2×1 k=1 | `[0]` / `[100, 70]` | 60 | 37.6° |
| 2×2 k=1 | `[40, 10]` | 40 | 19.0° |
| 2×2 k=2 | `[50, 60]` | 60 | 38.9° |
| 3×2 k=1 | `[60, 40]` / `[100, 60, 80]` | 70 | — |
| 3×3 k=1 | `[60, 20, 40]` | 60 | 9.1° |
| 3×3 k=−2 | `[140, 20, 110]` | 70 | — |
| 3×4 k=1 | `[60, 0, 40, 20]` / `[70, 30, 50]` | — | — |
| **4×4 k=1** | `[200, 170, 190, 180]` | — | — |

Two opposite readings, and both are true. Up to 3×4 nothing valid needs a pair
extension past about 70 while every search walks to 200. At 3×3 the auto step is
10, so the grid is 21 values a pair and `21³ = 9,261` combos where a 70px ceiling
would be `8³ = 512` — **eighteen times less searching for the same answer**. And
then **4×4 picks the ceiling itself**, so at the top of the range the grid is not
generous but binding, and a 5×5 would want more than it offers.
(`EXTENSION_CEILING_CAP = 1200` exists because the engine knows this.)

Which of those a 5×5 is cannot be read off either end. It needs the measured
points laid against m, n and k, and a curve through them.

The angle side has the same shape. The valid range is **not** the ±20° window:
each combo carries its own, so the union across a band runs wider than any one
of them (2×2 k=2 is valid across `22.8…61.7°` against a probe window of
`18.7…58.7°`) or uses a quarter of one (3×3 k=1, 9.1° of 40°). And **4×4 traces
do not exist and cannot** — 194,481 combos is over `TRACE_BUDGET`, so the census
refuses. Every angle number at 4×4 and above is necessarily predicted, and the
page says so rather than implying it measured something.

## What it reads

Runs first, censuses on demand, because the two carry different things:

| artifact | what the atlas takes from it | when |
| --- | --- | --- |
| **run** | one record per level: `k`, the chosen H and V extensions, the gaps, whether the ring closed | on load, the whole shelf |
| **trace** | the angle range, the needed ceiling, the per-pair envelope, the verdict histogram | per cell, or in bulk on request |

A run carries no heading at all — `rows[i]` has `ext`, `gap`, `across`,
`healthy` and nothing angular — which is the whole reason the loading is in two
tiers rather than one.

**A record is one level, not one run.** `ks = [1,2,2]` is three observations of
k. They are not equivalent observations either: a k at level 3 is conditioned on
the whole prefix that reached it, which is why the page defaults to L1 only and
says why in the sidebar.

### It reads once, and then remembers

Reading the shelf is the expensive thing the page does — against the live Worker
it is 32 catalogue requests and then one fetch per run, and even the bundled dump
is 76 kB before a single cell can be drawn — and none of it changes between two
visits to the same source. So the read is kept in `localStorage`
(`src/mxn-ks/snapshot.ts`) and a revisit draws the whole grid on the first paint
having asked nobody anything. Not a cookie: a cookie is capped near 4 kB and is
re-sent to the server on every request for the site, and what is stored is a
shelf.

**One slot, keyed by where it was read from.** That key is the design. Ticking
*read the bundled dump instead* puts the same question to a different source, the
key stops matching, and the page reads for real. So exactly two things cost a
fetch: that tick, and the **reload** button — which forgets the slot first, and on
the bundled source drops the dump so it is fetched again rather than re-folded.

What that buys is also what to watch for: after sweeping new runs at `/mxn/gpu/`,
the atlas keeps showing the read it already had until reload is pressed. It says
so rather than implying otherwise — the sidebar chip carries `kept in this browser
· saved <when> — reload to read again`, and the header says `saved earlier`.

Four things are deliberately *not* kept:

- **an empty read**, which is usually an unreachable Worker or a URL not typed
  yet. Both are answered by asking again, not by remembering the nothing.
- **a read over 2 MB of JSON**, so one enormous shelf cannot crowd the lab's own
  settings out of a 5 MB origin. Today's dump is 76 kB.
- **the geometry dump**, at 2 MB the wrong size for storage — and the browser's
  own HTTP cache already serves the repeat.
- **anything at all, in a single-file build**, which carries its shelf inlined in
  the page and has no business reading a snapshot taken off a different dump.

A snapshot whose `CACHE_VERSION`, key or shape does not match is treated as
absent. The failure mode of one that cannot be trusted is to spend the fetch it
was there to save.

## The grid's rows, and the step, come from the shelf

Both of these were constants once, and a real shelf caught both.

**The k rows are derived, not fixed.** They were hard-coded `−4…+5`, justified
from `4×4` (admits −3…4) and `1×4` (admits −4…5) — both true, and the conclusion
wrong: `kLimits` is `−(m+n−1)…m+n` off the diagonal and `m+n` peaks at **7** for
`3×4`, so the union over sizes 1…4 is `−6…+7`. Twelve legitimate cells had no row
to be drawn on, `4x2 k=−5` among them, and that one was on the shelf at the time.
For a page whose whole argument is *an empty cell means nobody swept it*, a cell
it cannot draw at all is the worst failure available.

Now `kRowsFor()` unions every k present on the shelf with every k admitted by a
size that has any record, always including 0. Rows nobody could fill do not
appear, and the grid grows on its own as `/mxn/gpu/` sweeps wider.

**The step is read as swept.** The prediction panel called
`autoStep(pairs, budget)` unconditionally. But `eauto` and `e5` are different
shelves precisely because a resolved step is not the same search as an
unresolved one, and a real sweep at `s1-e5-b100000000` walks **41** values a
pair where `autoStep(4, 1e8)` answers 10 — **21** values. Every combo figure
derived from it was out by `41⁴/21⁴ ≈ 14.5×`. `sweptGridStep()` now takes an
explicit step verbatim and only resolves `auto`, and says on screen which it did.

**The flags filter starts on the shelf's majority**, not on `any`. The sidebar
warns that mixing variants "compares two questions"; defaulting to `any` did
exactly that. `any` is still there, and now says plainly what it is mixing.

## Two things that are easy to get backwards

**The bands are crossed relative to the lab's labels.** The lab's sidebar reads
`m — H pairs` and `n — V pairs`. The engine gives the **H band n pairs and the V
band m**: `m=3, n=2` traces to `P=2` horizontal and `P=3` vertical, and
`m=1, n=3` to `P=3` and `P=1`. Nothing existing is wrong because of it —
`worstPairs` is `max(m, n)` and `worstCase` sums the two, so every current caller
is symmetric under the swap and none would notice — but this page files every
number under a band *and* a size, so the swap would transpose the whole thing.
`bandPairs()` is the one place that decides, and `npm run check:atlas` pins it
against real `trace_plan` output.

**The catalogue can lie about being complete.** `/catalogue` clamps `limit` at
1,000, and its D1 branch answers `truncated: false` unconditionally — including
when it returned exactly the limit. A single `run/v3/` prefix over a full shelf
would therefore report the first thousand keys as the whole shelf, and every
number on the page would be quietly computed over a slice. Both the page and the
dump script walk **narrow prefixes** instead — one per hand-direction per size,
32 bounded requests — and report any prefix that comes back exactly full.

## The drawings

Two panels show the rings themselves, because a grid of numbers is an
abstraction of something that has a shape, and the shape is what "how a k
behaves as m and n grow" was always about.

**B · one k, drawn at every size.** The ring the engine settled on, at the
selected k, across every size that has been swept — 1×1 beside 2×2 beside 4×4.
Each tile is framed to *itself*: a 4×4 spans four times a 1×1 and a shared scale
would leave the small ones as dots, so what to read along the row is the shape,
with the size and the metric underneath. Clicking a tile selects that cell.

**D · every level of this sequence.** Inside the cell panel: L0 upwards, each
labelled with its own k, all on **one** frame so the growth is to scale. This is
the thing the sidebar can only assert in prose — that a k at level 2 or above is
conditioned on the whole prefix that reached it. On a `ks = [1, 2, 2]` you can
see L3 being what it is *because* of the two levels to its left.

Neither recomputes anything. `drawExactStage()` is the lab's own renderer, lifted
out of `weave-studio.tsx` so more than one panel could draw a ring — this is the
third — and the geometry is `result.stages`, the rings the engine settled on,
stored with the run and read back.

### Where the geometry comes from

A run's stages are the bulk of it: **28 kB** for a 1×1, **231 kB** for a
three-level 2×2, against **1 kB** for the same run once they are gone. Most
readers never open a drawing. So they are fetched separately and late:

- **Live**, `geometry()` re-fetches the run the record came from. The Worker
  answers with `max-age=3600`, so the browser usually serves the repeat out of
  its own cache and the round trip is not one.
- **Offline**, they are in `public/mxn/ks-atlas-geometry.json` — a *second* file,
  fetched once on the first drawing anyone opens. The 72 kB atlas stays instant.

The snapshot carries drawings for a **sample**, not for everything: the whole
shelf's strands are tens of megabytes and do not belong in a repository. The
sample is chosen by `--geometry-only`, default `ks=1` — every size at k = 1, which
is exactly one full row for panel B, plus any sequence starting there for panel
D. A cell outside the sample says *no geometry on this shelf* rather than
spinning. Against the live Worker every cell has them.

```sh
python3 scripts/ks-fixtures.py --geometry --only "ks=1"   # engine → geom__*.json
npm run dump:ks -- --from node_modules/.cache/ks-raw      # → both files
```

`--geometry` is resumable on its own terms: a sweep run without it can be topped
up with drawings later, and only the jobs that owe a `geom__` file are recomputed.

## The search envelope, as a file

The page shows, per cell, the smallest ceiling a band still works at and the
angular width worth searching. Read across the shelf that is the size of the box
the engine currently searches against the box it needs — and it is what would let
a larger sweep be configured rather than guessed at. Two ways out:

```sh
npm run dump:ks -- --url https://…workers.dev   # → public/mxn/ks-envelope.json
```

and an **export the search envelope** button in panel E, which writes what is on
screen honouring the current filters. It loads the censuses first: they are lazy,
and an export taken straight after a page load would be almost entirely
`unmeasured`, which is a file that looks like an answer and is not one.

Both go through `searchEnvelope()` in `model.ts`, so the file and the screen
cannot disagree — the page's button and the CLI produce identical totals over
the same shelf.

Measured over the bundled snapshot: **24 of 29 cells fully measured, 168,924 →
13,315 combos, a 12.7× reduction**, with per-cell savings from 7× to 49×.

### H and V are separate searches

`needs.h` and `needs.v` are reported apart, each over **its own pair count** —
the H band holds `n` pairs and the V band holds `m`. At a rectangle that is not
a detail:

| 2×3 k=1 | pairs | needs | grid | saving |
| --- | --- | --- | --- | --- |
| H | 3 | 70px, 15.6° | 9,261 | 18.1× |
| V | 2 | 30px, 10.9° | 441 | 27.6× |

A single combined figure would report 70px and 9,261 and hide that one of the two
bands is twenty-one times cheaper and needs less than half the ceiling.
`needs.combined` still takes the larger of the two, because both bands share one
`MAX_PAIR_EXTENSION` and one window — but it is the per-band rows that say where
the cost actually is.

### What the file may not claim

Four bounds, carried in the file's own `caveats` array so the argument travels
with the numbers:

- **The ceiling is not a per-run parameter.** `bridge.generate()` takes
  `ext_step` and `combo_budget` and nothing else; `MAX_PAIR_EXTENSION` is a
  module constant (`mxn_continuation_next.py:117`). Acting on these numbers needs
  an engine change — and the ceiling would have to enter the cache key the way
  the step already does, or capped and uncapped answers collide under one key.
- **The angle window is not even a kwarg.** It is `initial ± 20.0` as literals in
  `_compute_pair_angle_range`, so `angleSpan` is information and nothing else.
  (The cheapest real angle saving would be coarsening `ANGLE_STEP_DEGREES`, which
  halves the angle axis and is a one-line pass-through.)
- **These are level-1 ceilings and understate a deep run.** For level ≥ 2 the
  engine escalates: `_search_group` grows the ceiling ×1.5 up to
  `EXTENSION_CEILING_CAP = 1200` while the winner is pinned.
- **A `lowerBound` cell has an unknown requirement, not a small one.** One band
  was over the trace ceiling. `4x2 k=1`'s measurable H band needs 20px and
  computes to a 49× saving; its V band has four pairs and was never censused.
  `needs.combined` is `null` there — the per-band rows survive, because what was
  measured is still true, but the combination cannot be had.

## The model

Ordinary least squares on `[1, pairs, m+n, |k|, kRel]`, solved by Gaussian
elimination on the normal equations. No dependency, about forty lines, and
deliberately the smallest thing that answers the question: the whole shelf is
dozens of points, not thousands.

- `pairs` is `worstPairs(m, n) = max(m, n)` — what the extension grid is raised
  to, so it is the axis the cost actually moves along.
- `m+n` is there because the shelf said so rather than because it sounded right.
  Over the 27 cells of the bundled snapshot, adding it moves R² from 0.46 to
  **0.51** on the chosen extension, 0.22 to **0.29** on the needed ceiling and
  0.60 to **0.72** on the angle span. It separates 3×3 from 1×3, which `max`
  alone cannot — and 1×3 and 3×1 do measure identically, so the pair `max`
  conflates really is one point. (`min(m, n)` fits identically to the last
  decimal, since `max + min = m + n` spans the same space. `m·n` edges it on the
  ceiling and loses on the other two, which is not enough to prefer a product
  nobody can read.)
- `kRel` is k placed in its own size's band. The only way k values compare across
  sizes at all: `2×1` admits −2…3 and `2×2` admits −1…2, so a raw `k = 2` is the
  top of one band and two thirds up the other, and regressing on the raw value
  would fit two different things to one coefficient. Both k terms earn their
  place — dropping either loses R² on every target.

One consequence worth knowing: where `m === n`, `m+n` is exactly `2·pairs`, so a
shelf holding **only square sizes cannot be fitted at all**. The design matrix is
singular and `fitPoints` answers null rather than whichever of the infinitely
many solutions the arithmetic happened to land on. Sweeping a few rectangles is
what unlocks the model.

A cell whose bands the trace ceiling refused reads **`?` — unmeasurable**, not
`·` — unloaded, and is left out of the fits entirely. Both bands share one
`MAX_PAIR_EXTENSION`, so a cell's requirement is the larger of the two; with one
band unmeasurable, the other is a *lower bound* and quoting it would report a
floor as a measurement. At 4×n that is precisely where the model is being asked
to extrapolate from, which is the last place to let a lower bound in. (A band
that solved *without* a search is different: it genuinely asks for nothing, so
the other band's answer stands as the cell's.)

**The window's centre is deliberately not fitted.** It is an angle near ±180°,
so it wraps, and a straight line through a circular quantity is wrong by
construction rather than merely inaccurate — measured, it fits at R² 0.37 with
an 80° residual, which is the arithmetic complaining. The page shows where the
window sits per cell and leaves it at that.

A fit over a dozen points is a sketch and the page looks like one: every residual
is tabulated beside the line, the interval widens by half again for every pair
count past the data, and anything beyond the largest size measured carries an
*extrapolated* chip. With fewer than five usable points there is no fit at all —
"not enough on the shelf yet" is both true and actionable, since the fix is to
sweep more at `/mxn/gpu/`.

Where a prediction exceeds `MAX_PAIR_EXTENSION`, the page says that the grid
rather than the guess is the binding constraint. That is the 4×4 case, and it is
the more interesting half of the answer.

## The offline mock

`mocks/ks-atlas.html` is the **real page** against a committed snapshot, with the
live shelf switched off before it can be reached — the same arrangement
`mocks/widgets.html` makes for the busy widgets. Not a vite input, so nothing
there is published.

```sh
npm run dev
# http://localhost:5173/Scoubidou3D/mocks/ks-atlas.html
```

The snapshot is `public/mxn/ks-atlas.json`, so one file serves both the mock and
the live page's `?data=mock` — which also means the published page still has
something to show if the Worker is ever unreachable.

Refresh it from a real Worker:

```sh
npm run dump:ks -- --url https://mxn-solutions-api.ysetbon.workers.dev
```

Cache reads are public, so **no token is needed**. It probes `/catalogue` first —
a wrong URL says so in one line rather than after 64 prefixes of the same answer
— then walks the shelf with three tries per read,
because over a domestic connection a dropped request is the expected case, not
the exception. Anything still missing at the end is listed rather than swallowed:
a dump quietly short of a size looks exactly like a shelf that never had it, and
this page argues from absence as much as from what is there. Nothing read at all
means nothing written, so a bad run cannot clobber a good snapshot.

Or, on a machine with no Worker at all, from the engine itself:

```sh
python3 scripts/ks-fixtures.py                          # needs numpy
npm run dump:ks -- --from node_modules/.cache/ks-raw
```

That sweep is **interruptible**. Everything up to 3×3 is done in the first few
minutes; anything involving a 4 is minutes each, because the run alone is a
minute and a half and every band the trace ceiling does not refuse costs a level
replay on top. The dump reads whatever raw files are on disk, so stopping half
way leaves a smaller but perfectly good fixture — the same bargain `/mxn/gpu/`
makes by ordering its queue cheapest first.

Both routes end in the same place on purpose. `scripts/ks-fixtures.py` writes
**raw** artifacts and derives nothing; every number in the snapshot is produced
by `src/mxn-ks/model.ts`, which is the module the live page uses. A fixture
derived by a second implementation would make the mock a lie about the page,
which is the one thing a mock must never be.

What the dump prunes, and why it can:

| dropped | size | why it is safe |
| --- | --- | --- |
| `result.stages` | ~238 kB of a 240 kB run | the strand geometry. The atlas reads `rows` and nothing else |
| the censuses themselves | megabytes each | their derived `BandStat` is a few hundred bytes and is what the grid, the charts and the fit all read |

So a shelf of hundreds of runs lands in a file measured in tens of kB.

## The file map

| path | what it is |
| --- | --- |
| `src/mxn-ks/model.ts` | **pure, React-free.** Records, the census derivation, the fit. Imported by the page, the dump script and the check |
| `src/mxn-ks/shelf.ts` | the `Shelf` interface, with a live and a fixture implementation. The page never learns which it has |
| `src/mxn-ks/atlas.tsx` | the page |
| `src/mxn-ks/snapshot.ts` | the kept read: one `localStorage` slot, keyed by the source it came from |
| `src/mxn-ks/atlas.css` | the lab's tokens, copied as `farm.css` copies them |
| `src/mxn-ks/mock-atlas.tsx` | the same page, forced onto the fixture |
| `scripts/ks-dump.ts` | Worker or directory → `public/mxn/ks-atlas.json` and `…-geometry.json` |
| `scripts/ks-fixtures.py` | the engine → raw artifacts, for a machine with no Worker |
| `scripts/check-atlas.ts` | `npm run check:atlas` |
| `scripts/ks-census-expect.py` | the census numbers again, with numpy, sharing no code with `model.ts` |

`src/mxn-lab/cache.ts` gained `parseRunKey` and `parseTraceKey`, the inverses of
`descriptorPath`. They live there because that module already owns *what a key
is*, and a parser anywhere else would be a second opinion on one grammar —
`findShelfVariant` in `weave-studio.tsx` was already forming one and now uses
these instead.

## Checking it

```sh
npm run check:atlas   # keys round-trip, bandPairs pinned to a real census,
                      # the derivation against measured numbers, the fit
                      # recovering coefficients it was given
npm run check:plan    # unchanged, but it covers the key grammar the parsers
                      # now share
npm run build         # tsc --noEmit && vite build. Confirm dist/mxn/ks/ exists:
                      # a missing vite input fails silently
```

`npm run check:atlas` needs `mocks/fixtures/ks-census.json`, which
`scripts/ks-fixtures.py` produces and which is committed — the check has to run
on a machine that has never run the engine.

The numbers it compares against are **not** in that fixture. They are written
into `EXPECTED_CENSUS` at the top of `scripts/check-atlas.ts`, and they come from
`scripts/ks-census-expect.py`, which walks the same base64 with numpy and shares
no code with `src/mxn-ks/model.ts`. Two implementations over the same bytes, on
purpose: a fixture generated by the module under test would make the check a
tautology, and this derivation is exactly the kind that is plausible and wrong —
the angle axis is ragged, `WINDOW` is an over-sweep rather than a result, and
`BEST` is a valid cell. If those numbers ever move without the engine moving,
that is the news.
