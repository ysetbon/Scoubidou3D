# The compute farm, at /mxn/gpu/

The lab computes in the reader's browser. That is what lets it live on GitHub
Pages at all — no server, no database, no secrets, just Pyodide and eleven
thousand lines of Python — and it is also the whole of its cost. A 3×3 is
twenty seconds of blank page before the first card. Opening one level's widget
is a replay of that level plus two sweeps of it. Counting a 2×2's solutions to
the end is 10,189 ring replays, which the lab caps at 60,000 product cells
precisely so a tab is never held hostage, and so the card says `2+` instead of
saying the number.

None of that work depends on who is asking. `random.seed(0)`, one engine
commit, one set of parameters, one answer. So it only has to be done once,
anywhere, by anyone.

`/mxn/gpu/` is where it gets done: give it a range of sizes and a range of k,
leave it running, and it works through every parameter set in the range and
stores each answer on the Cloudflare Worker. `/mxn/` then reads them back.

<https://ysetbon.github.io/Scoubidou3D/mxn/gpu/>

This file is the design. The **how-to for the machine that runs it** — fresh
clone, Worker setup, what to keep awake, which checks to run after a change —
is [docs/gpu-runbook.md](gpu-runbook.md).

## What it stores

Two artifacts per parameter set, and they are exactly the two things a reader
waits for.

| artifact | what it is | who reads it |
| --- | --- | --- |
| **run** | `bridge.generate()`'s payload — every level's rows, stages and solution meta — with each level's count walked to *exact* rather than to the browser's ceiling | the cards, the moment `/mxn/` loads |
| **trace** | `bridge.trace_plan()` and `bridge.trace_census()` for one level and one band, the engine's own pick already woven into it | that level's widget, the moment it is opened |

A run and `2 × levels` censuses, so a three-level sequence is seven artifacts.

Measured on `2×2 [1,2,2]`, which is the oracle sequence `docs/mxn-lab.md` pins:

| | JSON | stored |
| --- | --- | --- |
| run | 238 kB | **9 kB** |
| each census | 195–240 kB | **7–9 kB** |
| the whole parameter set | 1.5 MB | **60 kB** |

and on `3×3 [1]`, the largest census the trace budget allows:

| | JSON | stored |
| --- | --- | --- |
| run | 135 kB | **4.6 kB** |
| each census (2.2 M evaluations) | 3.1 MB | **48 kB** |

A verdict census is one byte per `(combo, angle)` over a space that is two
thirds `WINDOW`, so it deflates to a couple of per cent of itself. This is why
the whole thing is affordable, and why D1 alone is enough to hold it: nothing
the lab will run comes near the 1.4 MB an artifact may be without R2.

Against that: the `2×2 [1,2,2]` above costs **27 seconds** of engine time to
produce — 2 s of search, 24 s of counting, 2.4 s of censuses — and lands in the
lab in **about 1.2 seconds**, without Pyodide being fetched at all.

## What a key is

Everything that decides the answer, spelled out:

```
run/v2/lh-cw/2x2/1_2_2/s1-eauto-b400000
trace/v2/lh-cw/2x2/1_2_2/s1-eauto-b400000/L3-v
     ↑   ↑     ↑   ↑     ↑                 ↑
     │   │     │   │     │                 level and band
     │   │     │   │     prefer_short_arms, ext step, combo budget
     │   │     │   the k sequence
     │   │     m × n
     │   hand and direction
     the cache version — bumped when the engine changes what it answers
```

Readable rather than hashed, so a key is something you can look for by hand
when a run and a lab disagree about whether something is cached. Two things
about its contents are deliberate:

- **The step is stored as it was given.** `eauto` and `e20` are different
  shelves even when auto resolves to 20, because the engine's ladder is per
  band: passing a resolved number where the page passed nothing is not the same
  search, and an entry that quietly answered a different question would be
  worse than a miss.
- **The vectorised angle scan is not in the key.** `/mxn/fast/` is measured
  row-for-row identical to `/mxn/`, and a census forces the fast path on
  whichever page asked for it. Keying on it would split one answer across two
  shelves.

`src/mxn-lab/cache.ts` builds keys; `worker-api/src/index.ts` validates them
with its own regexes and stores nothing that fails them. Nothing connects the
two but `npm run check:plan`, which reads the Worker's regexes out of its source
and runs the client's keys through them.

## The queue

A sweep runs for hours, so a page cannot be the thing that remembers where it
got to. The plan is pushed to the Worker as rows in `farm_jobs`, and runners
**claim** from it under a lease:

```sql
UPDATE farm_jobs SET state='running', runner=?, lease_until=?, attempts=attempts+1
 WHERE id = (SELECT id FROM farm_jobs
              WHERE state='pending' OR (state='running' AND lease_until < ?)
              ORDER BY weight ASC, levels ASC, created_at ASC LIMIT 1)
RETURNING *
```

One statement, so two runners racing cannot both win the same row. That single
query is most of the design:

- **A job's id is its own run cache key**, so pushing the same plan twice adds
  nothing (`INSERT OR IGNORE`) and resuming is simply pushing it again.
- **An expired lease is claimable.** A machine that went to sleep mid-census
  loses the job rather than stranding it. That is the whole recovery story and
  it is enough for one operator's machines.
- **Cheapest first**, by the run's worst-case combo count. An overnight sweep
  has the small sizes done in its first minutes instead of spending an hour on
  the one 4×4 in the plan, and stopping it early still leaves something useful.
- **Failures keep their row.** Requeueing sets the state back and keeps the
  error and the attempt count, so a job that has failed four times is visibly
  different from one nobody has tried.

Close the tab and reopen it, or point a second machine at the same batch: both
just claim the next job.

## The hands

Each hand is a Web Worker running `public/mxn/farm-worker.js` with its own
Pyodide and NumPy — about 150 MB as well as a core, which is why the default is
`cores − 1` capped at four rather than "all of them". A Pyodide runtime is
single-threaded and the search inside it is one long synchronous call, so this
is the only parallelism available; there is no shared state between hands and
two hands on one job would only duplicate it.

Three things the hands do that the lab does not:

- **No candidate frames.** `bridge.FRAME_MIN_INTERVAL` is raised so the
  engine's own gate rejects a preview *before* it deepcopies the working ring.
  A farm has no busy sheet to fill and the deepcopy is real money.
- **The vectorised scan, by default.** Same rows, roughly four times faster
  (see *The vectorised angle scan* in `docs/mxn-lab.md`). On a farm the default
  path is time spent for nothing.
- **They upload themselves.** A census is megabytes; posting it back to the page
  would structured-clone it onto the UI thread of a tab that has to stay
  responsive for hours, to do nothing with it but forward it. Keys are built on
  the page — `cache.ts` owns what a key *is* — and arrive at the hand as
  finished URLs, so nothing about the cache's naming is duplicated in the worker.

An upload gets four attempts with backoff. A sweep runs for hours over a
domestic connection, so a dropped request is the expected case, and losing an
answer that cost twenty minutes to a blip nobody saw would be the worst failure
this thing has.

### What is skipped, and what is not

Before computing, a hand asks the shelf what this job still owes. A run already
stored is still **computed** and only its upload is skipped — the generate is
what builds the session a census replays from, so there is no way to fill in a
missing band without it. The bands already stored are skipped whole, which is
where the hours are.

An *unavailable* band is a real answer and is stored like any other: "this level
solved its H band without a search" and "4×4 is over the trace ceiling" both
cost a level replay to discover, and a reader who opens that widget should be
told at once rather than made to find out.

## Which k each size gets

The band of k a size admits is not a constant of the sweep. It is −(m+n−1)…m+n
off the diagonal and narrows to −(m−1)…m on it, so the sizes in one plan want
genuinely different ks: `1×1` admits 0…1, `2×1` admits −2…3, `2×2` admits
−1…2, `4×4` admits −3…4.

So the k source is a choice, and the default is **the size's own band**: each
size draws from `kLimits(m, n)` and sweeps every k it has. That is what "every
k" means when the thing being swept is sizes — a single typed range can only
ever be right for one of them, and a range that fits `2×2` exactly is missing
four of `2×1`'s ks with nothing on screen to say so beyond a drop count.

**A range I type** is the other choice, for narrowing a sweep to one k or to a
few: every size draws from that range, and whatever falls outside its own band
is dropped and counted as before. `list` mode is always literal — typed
sequences are applied to every size and checked against each size's band.

The sizes' bands are printed under the field, because the whole reason for the
setting is that they differ.

In `words` mode this compounds: the sequence count is the size's band raised to
the depth, and the band is wider at the corners than on the diagonal, so `2×1`
at depth 2 is 36 sequences where `2×2` is 16. The plan's counts are shown before
anything is queued for exactly this reason.

## What the plan will not queue

- **k outside a size's own range.** With a typed range or a typed list, the
  valid band narrows as a size gets squarer — `1×2` admits −2…3, `2×2` admits
  −1…2 — so one range of k legitimately covers different ks at different sizes.
  Those are counted and reported, never dropped in silence. With the band
  following the size, nothing reaches this: no size is ever asked for a k it
  does not admit.
- **m or n outside 1…4, or more than 8 levels.** The lab clamps to both, and a
  cached answer nobody can reach from the lab is no answer.
- **Duplicates.** The same parameters can be reached twice; the queue keys on
  the id, so a duplicate would only be double-counted on screen.

`npm run check:plan` holds all of that to worked examples.

## Reading it back, at /mxn/

`Run` asks the shelf first. On a hit the cards are painted from the artifact and
the engine is never started; on a miss, or with no cache configured, or with a
cache that is unreachable or serving nonsense, the page computes locally exactly
as it always has. **The cache is never the reason the page stops working.**

What a hit does not bring with it is a *session*: the geometry is real and the
numbers are real, but Pyodide has never seen this size. So everything that reads
the session — the solution browser, the ⚑ near-miss sweeps, an uncached census —
warms one first, through `withSession`. The warm is an ordinary generate and
shows the ordinary busy sheet; what has changed is only *when* the wait happens.
It used to stand between a reader and the first picture. Now it stands between
them and the second question, and most readers never ask one.

Everything that may warm the engine is something a reader deliberately pressed.
The one exception proves it: the widget's woven preview of a traced cell is
requested as the cursor *moves*, so it checks for a session and declines rather
than starting a twenty-second generate nobody asked for. The engine's own pick
is woven into the census itself and is on screen regardless; the rest of the
grid says what it needs.

The warm deliberately does **not** replace what is on screen. It is the same
computation over the same inputs, so the geometry it produces is the geometry
already drawn; adopting it would only make every card flicker and would throw
away any traced cell a reader had pushed onto one. It adopts the solution meta,
and even there an exact count already on the card survives a warm whose own
in-run counting stopped at its ceiling.

A cached census is better than a computed one in one specific way: the payload
embeds the engine's pick already woven, so the widget's first weave preview is
on screen at the same moment its grid is — with no session, no replay and no
round trip.

### Turning it on

Three places, in order of precedence:

| where | for whom |
| --- | --- |
| `?cache=<url>` | testing. `?cache=` with nothing after it turns the cache **off**, which is how you check that the page still computes what it claims to be reading |
| the *dataset API* → *worker url* field in the lab sidebar | the operator, in their own browser |
| `data-cache` on `#lab` in `mxn/index.html` (and `#farm` in `mxn/gpu/index.html`) | everyone, including a reader who has configured nothing |

`data-cache` is empty in this repository on purpose: a deployment's address does
not belong in it. Fill it in and the fast path is on for every visitor. Leave it
empty and the lab behaves exactly as it did before any of this existed.

Reads are **open** by default (`CACHE_PUBLIC_READS`); writes always need the
token. An entry is derived from a published engine over published parameters,
and the entire point of it is that a reader who has configured nothing gets the
fast page. Set the var to `"0"` and reads go behind the token too — the lab then
falls back to computing locally.

### Publishing one run by hand

The lab's *dataset API* panel has a **Publish run** button: it stores the run on
screen and every census already open. Deliberately a button rather than
something `Run` does on its own — a write to someone's Cloudflare account should
be asked for.

## The transport

The client gzips, the client gunzips, and what travels is opaque bytes under
`x-mxn-codec`.

`Content-Encoding` would be the obvious way to do this and is the wrong one: it
is a hop-by-hop negotiation that a proxy, the Workers runtime and the browser
may each rewrite, so a body that arrives already decoded and a body that arrives
still gzipped are indistinguishable to the code reading it. A private header is
negotiated by nobody, which makes the round trip deterministic and — more to the
point — testable with `curl`.

Responses carry `Cache-Control: public, max-age=3600,
stale-while-revalidate=604800`. The key names every input, so the only thing
that can change a body is a recompute of the same parameters; an hour fresh
keeps a deliberate recompute from being invisible for a week, and the stale
window is what makes the second visit instant. `HEAD` — which the farm uses to
decide whether to spend an hour — is `no-store`, because that answer has to come
from the shelf and not from a copy the browser kept.

## Checking it

```bash
cd worker-api && npm test        # the Worker, off Cloudflare (Node 22+)
npm run check:plan               # the planner, and the keys against the Worker's validators
python3 scripts/cache-fixtures.py && npm run build && npm run qa:cache
```

`worker-api/npm test` runs the real `fetch` handler against real SQLite behind a
D1 shim and a Map behind an R2 shim: every route, both storage backends, the
atomic claim, the lease expiry, and every case that is supposed to be refused.
The dataset half of that Worker shipped as reviewed-but-never-run code; the
cache and the queue are a great deal more surface than that was, and not the
kind of thing to find out about from a browser console.

`qa:cache` is the end-to-end one. It seeds the Worker with artifacts the engine
actually produced, serves the real vite build, and drives Chromium. Its
assertions are the oracle numbers — `(40,10)`, `(50,60)`, `(60,50)`, every level
a weave, `1 / 10,189` — and the absence of any request to jsDelivr, which is the
only way Pyodide can arrive. A cache that quietly served something else would
pass a test that only checked that pictures appeared.

## Setting the Worker up

`worker-api/README.md` has the commands. In short: the same Worker, the same
token and the same URL as the ⭐ dataset already used, plus one migration
(`0002_cache.sql`) and, optionally, an R2 bucket.

## What is deliberately not here

- **No GPU.** The page is named for the machine you run it on, not for the
  arithmetic. The engine is Python over NumPy through Pyodide; there is no
  CUDA path and inventing one would be a rewrite of `ysetbon/mxn`, not a page.
- **No server-side compute.** A Cloudflare Worker has a CPU budget in
  milliseconds. The farm is a browser tab on a machine you own, which is the
  only free thing available that can run this engine for eight hours.
- **No automatic publishing from the lab.** See above.
- **No near-miss sweeps in the cache.** `⚑H` and `⚑V` cost seconds, not minutes,
  and they are asked for one level at a time. Caching them would double the
  artifact count to shorten a wait nobody complains about.
