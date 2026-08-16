# The k boards, at /mxn/ks/-1/

[`/mxn/ks/`](https://ysetbon.github.io/Scoubidou3D/mxn/ks/) holds one **size**
still and asks what happens across k. The boards hold one **k** still and ask
what happens across size: the whole 8×8 plane on one screen, and in every tile
the ring that is currently the best known answer for that cell.

<https://ysetbon.github.io/Scoubidou3D/mxn/ks/-1/>

One page per k, `-14` through `+15`. The page never computes — everything drawn
was either judged by a person at [`/mxn/fit/`](mxn-fit.md) or swept by the farm
at [`/mxn/gpu/`](mxn-farm.md), and is being read back.

## The rule the page is built around

> **A person outranks the engine.**

A ★ best you judged at the fitter fills its tile even when the farm has since
swept the same parameters. No recency, no completeness and no source overturns
that. The engine's own answer stays visible on the cell rather than being
dropped, because *where did a hand improve on the machine* is most of what a
board like this is for — the tile carries a **`·↑`** where it happened, and the
sidebar counts them.

The whole ladder, in the order it wins:

| | fills the tile | from |
| --- | --- | --- |
| 1 | **★ best** | a `picks/v3/…` judgement, `verdict: best` |
| 2 | **✓ valid**, newest, when no ★ exists | the same |
| 3 | **▣ engine** — the farm's swept run | `run/v3/…` |
| 4 | **✗ rejected only** — flagged, and *not* drawn as an answer | `picks/v3/…` |
| 5 | **a hole** — nobody has been here | nothing |

Rank first and recency second, so a ★ best from 2024 beats a run from this
morning; within one rank the later answer wins. `rejected` sits **below**
`engine` deliberately — somebody having ruled one ring out says nothing about
the ring the farm found, so a ✗ must not blank a perfectly good run. What it
does do is colour the tile, because *tried and thrown out* is a different piece
of knowledge from *never tried*, and telling those apart is the point.

The ladder is by what an answer **is**, never by where it was read from. A ★
best in a file you dropped on the page outranks an engine run on Cloudflare
exactly as one on the shelf would.

## Three things it must not get wrong

All three are about **absence**, which is what a board of mostly-empty tiles is
actually made of.

**An inadmissible cell is not a hole.** `kLimits` is `−(m−1)…m` on the diagonal
and `−(m+n−1)…m+n` off it, so `1×1` admits `0…1` and cannot hold `k = −1` at
all. That tile is hatched, says which k it *does* admit, and — the part that
matters — **is not a link**. Sending somebody to fit a ring that cannot exist
would be the worst failure available to a page whose whole argument is *an empty
tile means nobody has been here*. It is the same lesson `docs/mxn-ks.md`
records about k rows the atlas could not draw.

**A cell is `ks = [k]` at level 1.** A fit judges one level at a time, and a
judgement at L2 is conditioned on the whole prefix that reached it — drawing it
as this cell's answer would caption one ring with another ring's parameters. A
**run** at `ks = [-1, 2]` is different: its L1 *is* the `ks = [-1]` search, so it
counts, and the cell says it came off a deeper sequence rather than implying a
sweep nobody ran.

**A fetch that failed is not an empty cell.** Every key the catalogue listed
whose body would not come back is reported on the page by name. A hole has to
mean nobody has been here, or the board says nothing at all.

## What it reads, and in what order

Judgements first and whole; runs listed first and fetched behind the board.

| artifact | what the board takes | when |
| --- | --- | --- |
| **picks** | the verdict, the chooser, the extensions and angles, the audit — and the ring, which a judgement carries | on load, bodies and all |
| **run** | that the farm swept this cell | on load, from the **key** alone |
| | the ext peak, whether it closed, and the ring | behind the board, one fetch per cell |
| **localStorage** | this browser's own judgements | free, and first |

The asymmetry is the artifact sizes. A picks artifact is a few kB even carrying
its whole ring, and there is one per parameter set rather than one per level —
waiting for them *is* the page loading. A run is up to **240 kB**, almost all of
it geometry, so its key paints the tile and its body fills it in afterwards from
a bounded pool of three, cells a person already won fetched last. Untick *draw
the engine's rings* and the run bodies are never asked for.

`localStorage` is read because `/mxn/fit/` writes a judgement **there first**,
before the shelf and before D1 (see [docs/picks-shelf.md](picks-shelf.md)). A
pick made two minutes ago on a page with no Worker configured exists only in the
browser, and a board that could not see it would be answering *did my ★ best
save?* with a confident no.

### The catalogue can lie about being complete

`/catalogue` clamps `limit` at 1,000 and its D1 branch answers
`truncated: false` unconditionally — including when it returned exactly the
limit. A prefix that comes back exactly full may be a slice presenting itself as
a shelf.

`src/mxn-ks/shelf.ts` pays 32 bounded requests to avoid this. A board over 64
sizes would pay 256, so it walks **four** — one per hand-direction — and
**subdivides** any that comes back full, per size, keeping nothing from the
suspicious page. Same guarantee, four requests in the ordinary case. Anything
still exactly full after subdividing is named on screen rather than trusted.

### One hand at a time

An `lh-cw` ring and an `rh-ccw` ring at the same size are different objects, not
two views of one, so a board that mixed them would be four boards drawn on top of
each other. The selector picks one; the sidebar reports which other
hand-directions hold anything and how much, so the filter cannot hide a shelf.

## Loading JSON off your own machine

Drop files anywhere on the page, or pick them in the sidebar. Five shapes are
accepted, because five shapes exist in the wild and telling somebody their own
export is the wrong file would be a page refusing to do the thing it is for:

| shape | what it is | what it gives a cell |
| --- | --- | --- |
| **picks artifact** | `kind: "picks"`, as the shelf stores it and as `Get-MxnArtifact` reads one back | verdicts, knobs and rings |
| **judgement rows** | `mxn-fit-judgements` out of the fitter's `localStorage` | the same — the **key** on each row supplies the parameters |
| **atlas dump** | `public/mxn/ks-atlas.json` | the engine's records |
| **fit report** | the fitter's `*.fit.json` | the knobs, with no ring |
| **ring export** | the fitter's bare strand array | the ring, placed **by its file name** |

A ring export carries no parameters at all, so the file name is the only thing
that can place it: `mxn-2x1-k1-lh-cw-L1-….json`, exactly as the fitter writes
it. A renamed one is **refused rather than guessed at** — putting a drawing on
the wrong tile would be an assertion about a parameter set that nobody made.

Everything at another k is counted and dropped, and the file list says how many:
a file of judgements is usually a whole shelf, and silently folding another k's
ring into this board is the failure this argument cannot survive.

Dropped files are kept in `localStorage` per k, up to 1.5 MB. Over that they are
held for the session only and the page says so.

## Filling a hole

Pressing an empty tile opens
`/mxn/fit/?m=3&n=2&ks=-1&hand=lh&direction=cw` in a new tab with every knob
already set, so starting to edit is one click and no typing. *Open the next hole
in the fitter* walks them in reading order.

This needed a change to the fitter, which **read no URL parameters at all**
before the boards existed. Every field is validated and a bad one is simply not
applied rather than coerced: a URL that half-parsed into a form the reader did
not ask for is worse than one that was ignored, and `2x1 k=1` silently becoming
`2x0` is the kind of thing nobody notices until the judgement is saved. `k` is
accepted as an alias for `ks`, because a board cell is the one-level case and
`k=-1` is what anybody would type first.

### The fitter now takes sizes up to 8

`MAX_SIDE = 4` is a **lab** clamp, not an engine one — `bridge.generate` takes
whatever m and n it is given. The lab caps at 4 because `/mxn/` is a browsing
tool over a shelf the farm filled, and a cached answer nobody can reach is no
answer.

The fitter is the page where a size on nobody's shelf gets made by hand, and the
boards' entire point is the empty tiles, which run to 8×8. So `/mxn/fit/` takes
8 — and says plainly, at the point of typing it, what is not known about the
sizes past 4:

> the engine accepts it, nothing has swept it, there is no cached run to compare
> against and no measurement of how long the search takes. At 4×4 the engine
> already picks `MAX_PAIR_EXTENSION` itself, so bigger may be slow, may hit the
> ceiling, or may not close at all.

Worth trying; not worth assuming. `/mxn/` and `/mxn/gpu/` are unchanged and
still stop at 4.

## One page per k, and why

`/mxn/ks/-1` is a URL somebody types, links to and bookmarks — and this site is
static files on GitHub Pages, so a URL that is not a file is a 404 no matter how
good the router. Thirty shells of about a kilobyte each, all sharing one hashed
bundle, buys real addresses.

The range is **not a literal**: it is every k any size up to 8×8 can legally
take, which is `-14…15` rather than the `-16…16` that reading `kLimits` quickly
suggests (`m+n` peaks at 15, on 8×7, and the diagonal is narrower still).
`scripts/ks-board-pages.mjs` derives it, writes the shells, and `vite.config.ts`
imports the same function to build its input map — so a shell with no vite input
(unpublished) and an input with no shell (a build that fails) are both
impossible. `npm run check:board` checks the pages on disk against the range as
well.

```sh
node scripts/ks-board-pages.mjs           # write the shells
node scripts/ks-board-pages.mjs --check   # fail if any is missing or stale
```

The shell states its own k in `data-k`; the path is the fallback. A page that
can determine neither refuses to draw rather than defaulting to k = 0 — a board
at the wrong k is a screen full of confident, wrong tiles, every one of them
linking somewhere wrong as well.

## The file map

| path | what it is |
| --- | --- |
| `src/mxn-ks/board-model.ts` | **pure, React-free.** The ladder, admissibility, the file adapters, the fit URL. Imported by the page and the check |
| `src/mxn-ks/board-shelf.ts` | the three reads: picks bodies, run keys, `localStorage` — and the adaptive catalogue narrowing |
| `src/mxn-ks/board.tsx` | the page |
| `src/mxn-ks/board.css` | the lab's tokens, copied as `atlas.css` copies them |
| `src/mxn-ks/board-main.tsx` | the entry, and where a page's k is decided |
| `scripts/ks-board-pages.mjs` | the k range, the shells, and `--check` |
| `scripts/check-board.ts` | `npm run check:board` |
| `scripts/qa-board.mjs` | `npm run qa:board` — the real page in a browser, against a stubbed shelf |

The ladder is in a pure module for the reason `model.ts` is: which of two
answers for one cell wins is the page's whole argument, and an argument that
lives inside a component is one nobody can check.

## Checking it

```sh
npm run check:board   # the ladder in both orders, admissibility, the level-1
                      # rule, the file adapters, the fit URL, and every k on
                      # disk against the derived range
npm run dev -- --port 5179 --strictPort
npm run qa:board      # the real page: that a ★ best reaches the screen as the
                      # drawn tile, that an inadmissible tile is not a link,
                      # and that following a hole opens the fitter on that cell
npm run build         # confirm dist/mxn/ks/-1/ exists — a missing vite input
                      # fails silently
```

`qa:board` serves its stub as **`identity`** bytes — plain JSON with no
`x-mxn-codec` header — which `decode()` accepts. Gzip is what the Worker does;
being able to read both is the point of that header existing
([docs/picks-shelf.md](picks-shelf.md)).

The end-to-end check is the one worth keeping: `/mxn/fit/` ignored URL
parameters entirely until these boards, so an href that looks right over a page
that ignores it would be a tile quietly sending everybody to `2×1 k=1`.
