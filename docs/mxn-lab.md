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

### The dataset API

⭐ always writes to `localStorage`. If a Worker URL and admin token are set in
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

The `◑` button on a level's card sweeps for those. Rather than the full `H × V`
product, it holds one band at a value taken from a ring that **does** close and
varies the other, so a sweep costs `len(h) + len(v)` replays instead of
`len(h) × len(v)` — a second or two, not minutes.

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

`◑` again returns the card to rings that close. `⭐` in near-miss mode writes
`kind: "semi"` with the band, the deficit and `refs`, and `/mxn/semi/` is the
queue over those rows — the same component as the categoriser, tinted amber, so
a rating cannot be filed against the wrong question by accident. What a score
means there is different: it is about one band's numbers only, and 100 is a
claim that the search discarded extensions it should have kept.

`k = 0` has one configuration and nothing to sweep, so it gets no `◑`.

### What this machine brings, in the sidebar

`src/mxn-lab/machine.ts` detects the reader's hardware and the panel above the
Run button reports it: core count, GPU renderer string, WebGPU presence, and —
in red, because it is the number that matters — how much of that the search
actually uses. Today that is **one core, CPU only**, on every machine.

The panel exists because both limits are invisible and neither is obvious:

- **The GPU cannot be used.** The engine does carry a GPU path
  (`_check_cupy_available`, `_cupy_search_combo_chunks` in
  `mxn_lh_continuation.py:1518`), but it is CuPy, hence CUDA, hence NVIDIA. No
  Mac can run it and Pyodide cannot load it in any browser. It is unreachable
  here twice over, and a reader with a fast GPU should be told that rather than
  left to assume it is helping.
- **Only one core searches**, for the reason `bridge.py:29-32` gives.

The estimate row answers "what would the other cores be worth", from the sweep
below: 13 sizes run serial and at 2, 3 and 4 workers of the engine's own process
pool, native CPython. Speedup at 4 workers, serial as reference:

| case | serial | 4-core | speedup | | case | serial | 4-core | speedup |
|---|---|---|---|---|---|---|---|---|
| 2×2 `[0]` | 0.04s | 0.04s | 1.0× | | 2×3 `[1]` | 30.71s | 8.02s | 3.8× |
| 2×2 `[1]` | 0.22s | 0.23s | 1.0× | | 3×2 `[1]` | 30.25s | 8.34s | 3.6× |
| 1×1 `[1]` | 0.28s | 0.18s | 1.6× | | 3×3 `[1]` | 29.46s | 7.83s | 3.8× |
| 2×2 `[1,2,2]` | 3.28s | 2.06s | 1.6× | | 3×3 `[-1]` | 35.92s | 8.83s | 4.1× |
| 2×2 `[-1]` | 1.61s | 0.63s | 2.6× | | 1×3 `[1]` | 56.76s | 16.86s | 3.4× |
| 1×2 `[1]` | 3.08s | 1.13s | 2.7× | | 3×1 `[1]` | 58.17s | 15.35s | 3.8× |

Long runs sit at 3.4×–4.1× of four, i.e. 84–102% of linear: the sweep splits
almost perfectly once it is big enough to be worth splitting.

**Combo count does not predict which band a run lands in.** `2×2 [1]` and
`2×2 [-1]` sweep the same 441 combos and came out at 1.0× and 2.6×. `k` changes
the cost of each combo rather than how many there are, so the discriminator is
wall-clock run length, which is not known until the run has happened. The panel
therefore reports the measured band and says what separates the two, instead of
fitting a curve. An earlier version of `machine.ts` fitted parallel fraction to
`log(combos × levels)`; those two 441-combo rows are what retired it, and the
fit had predicted 1.3× for both.

Those are native CPython timings. Under Pyodide the same work is slower, so
treat the table as the shape of the speedup rather than the wall clock.

#### The parallel/serial divergence did not reproduce

The check above warns that the multiprocessing path can settle on a different
combo than the serial one, measured on `2×2 [1,2,2]` where it picked `(30,120)`
at L3 and stopped being a weave. Across all 39 parallel runs in the sweep — 13
sizes × {2,3,4} workers, `2×2 [1,2,2]` among them — **every result matched
serial exactly**. Zero divergences.

That is not a refutation. It is a different machine and a narrow range of worker
counts, and the failure mode is order-dependent: `consume_chunk` merges in
*completion* order (`wait(FIRST_COMPLETED)`, `mxn_lh_continuation.py:3268`) and
`best_fallback` is chosen with a strict `>`, so a tie resolves to whichever
worker happened to finish first. That is timing-dependent by construction and
can hide for many runs at a stretch.

It does mean the defect is narrower than "parallel is unsafe", and it points at
where a fix would go: buffer chunk results and consume them in `chunk_start`
order, which would make the parallel path bit-identical to serial by
construction rather than by luck. Until someone does that, keep the serial pin
in `bridge.py` and keep this warning.

#### Why the multi-core version is not simply built

The shard boundary looks ready — `_evaluate_cpu_combo_chunk`
(`mxn_lh_continuation.py:2876`) is module-level, pure, and takes an explicit
`(combo_start, combo_end)`, precisely so it can be pickled to a process pool. A
JS worker pool could drive it. Two things stop that being mechanical:

- The search is **synchronous Python called deep inside the level solve**.
  Handing chunks out to JS workers mid-search means either blocking the calling
  worker on `Atomics.wait` — which needs `SharedArrayBuffer`, which needs
  cross-origin isolation, which needs COOP/COEP headers **GitHub Pages cannot
  send** — or making the whole call chain `async` down from `bridge.generate`.
- That chain lives in the **vendored copy** of the engine. Per the top of this
  file, the lab is maintained upstream; an async rewrite of its search path
  would fork it in the one place a re-copy cannot survive.

Sharding across whole runs instead does not substitute: levels are sequential by
construction, since Lᵥ is built on the ring Lᵥ₋₁ chose.

So the reachable levers today are the ones in the sidebar — `step` and `budget`,
where cost is `(200/step + 1) ** pairs` — and the panel points at them.

### Cache keys

The `semi-rate-v7` cache key appears in both the worker URL
(`weave-studio.tsx`) and the Python fetch URL (`exact-worker.js`). Bump both
together when the engine files change, or returning readers run stale geometry.
