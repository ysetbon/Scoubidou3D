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

`◑` again returns the card to rings that close. Near-miss mode swaps the save
button from `⭐` to `🚩`, because the two write to different queues and a shared
glyph made a mis-press invisible: the near-miss appeared not to save when what
had actually happened was that the closed-ring star was pressed. `🚩` writes
`kind: "semi"` with the band, the deficit and `refs`, and `/mxn/semi/` is the
queue over those rows — the same component as the categoriser, tinted amber, so
a rating cannot be filed against the wrong question by accident. What a score
means there is different: it is about one band's numbers only, and 100 is a
claim that the search discarded extensions it should have kept.

`k = 0` has one configuration and nothing to sweep, so it gets no `◑`.

### Reading the list in a useful order

The scan keeps nearest-first — `deficit`, then `total`. `SORT EXT` flips it to
shortest-extensions-first, which answers the other question worth asking: of
the rings that fail, which one fails on the least string. Neither ordering
re-runs the sweep. `sort_semicomplete` reorders a list that is already in the
session and returns the head of it, and the ring on screen keeps its place by
identity rather than by index, so a reorder never silently swaps what is being
looked at — or what `🚩` would bank.

`H− H+ V− V+` walk one band with the other held. `‹ ›` cannot ask that: they
step the sorted list, which mixes both bands and every extension together,
while these hold the other band's *candidate* — not merely its extension value,
since two candidates can share a value and still be different rings — and move
to the nearest extension in the direction asked for. That is the shape the
sweep itself has: every near-miss is one band varied against a partner that
stayed put, so stepping that way walks the sweep instead of walking the sort.
Both live in Python beside the list, because only the head of it
(`SEMI_RETURN_CAP`) ever crosses the worker boundary — sorting or stepping in
the page would silently work on a prefix.

### Cache keys

The `semi-sort-v8` cache key appears in both the worker URL
(`weave-studio.tsx`) and the Python fetch URL (`exact-worker.js`). Bump both
together when the engine files change, or returning readers run stale geometry.
