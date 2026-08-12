# Running the compute farm from a fresh clone

The runbook for the machine that does the computing — the "GPU computer",
though nothing here touches a GPU: the engine is Python over NumPy through
Pyodide, and what the farm actually spends is **CPU cores and RAM**, roughly
one core and 150 MB per hand. This file is written to be read by whoever just
cloned the repo onto that machine, including a Claude Code or Cursor session
opened in it: everything an assistant needs to know is either here or one link
away, so start here before exploring.

The one-paragraph version: `/mxn/gpu/` is a web page that works through a
queue of (m, n, ks) parameter sets, runs the full MXN engine on each, and
stores every answer on a Cloudflare Worker so that the lab at `/mxn/` loads
them in one fetch instead of computing for twenty seconds. The queue lives on
the Worker, not in the page, so this machine can stop and resume, and a second
machine pointed at the same batch just takes the next job. Full design:
[docs/mxn-farm.md](mxn-farm.md).

## The fastest path needs no clone at all

The farm is a static page, already published:

```
https://ysetbon.github.io/Scoubidou3D/mxn/gpu/
```

1. Open it in Chrome (Chromium-family gets the most cores; any modern browser
   works).
2. Fill in **worker url** and **admin token** — the same two values the lab's
   sidebar uses. They are stored in that browser's `localStorage` only.
3. Set the ranges (m, n, k mode, depth), check the plan's numbers, press
   **Queue the plan**, then **Start**. The k band defaults to **the size's own
   band**, so each size sweeps every k it admits — `2×1` takes −2…3 while `2×2`
   takes −1…2 — and the chips under the field spell out what each size in the
   range will get. **A range I type** is there for narrowing to one k.
4. Leave the tab open and the machine awake. That is the whole job.

So clone the repo when you want to **change** the farm or run it against local
edits — not merely to run it.

## What you need before anything computes

| thing | where it comes from |
| --- | --- |
| Worker URL | printed by `npx wrangler deploy` in `worker-api/`, looks like `https://mxn-solutions-api.<subdomain>.workers.dev` |
| Admin token | the value given to `wrangler secret put ADMIN_TOKEN` — same token the lab's ⭐ dataset uses |

If the Worker has never been deployed, or the database predates the cache
tables, do that first — five commands, in
[worker-api/README.md](../worker-api/README.md#setup). On an **existing**
database also run the migration:

```bash
cd worker-api && npm install
npx wrangler d1 execute mxn-solutions --remote --file=./migrations/0002_cache.sql
npx wrangler deploy
```

Sanity check from any shell:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$WORKER_URL/health"
# → {"ok":true, "artifactStore":"d1", "publicCacheReads":true, ...}
```

A 500 here almost always means the schema was never applied `--remote`.

## Running from the clone instead

```bash
npm ci
npm run dev          # then open http://localhost:5173/Scoubidou3D/mxn/gpu/
```

Same page, served from your working tree, so edits to `src/mxn-farm/` are live.
The engine files the hands load are static under `public/mxn/`, served by the
same dev server; Pyodide and NumPy come from jsDelivr, so the machine needs
outbound internet.

## While it runs

- **Keep the machine awake.** A sleeping laptop stops its Workers. Jobs a
  sleeping machine held are not lost — their lease (1 hour) expires and the
  next claimer takes them — but nothing computes while it naps.
- **Hands** default to `cores − 1`, capped at 4. Each is its own Pyodide:
  ~150 MB RAM and one core. More hands than cores makes every job slower, not
  the sweep faster.
- **Cheapest first.** The queue is ordered by worst-case combo count, so the
  small sizes are done in the first minutes and stopping early still leaves
  something useful on the shelf.
- **Stop** two ways: *Finish and stop* lets each hand complete the job it
  holds; *Stop now* kills them and the leases return the jobs on their own.
- **Resume** by opening the page again with the same batch name and pressing
  Start. Pushing the same plan twice adds nothing (jobs are keyed by their
  cache key), and *skip what is already stored* makes re-runs cost only a
  HEAD request per artifact.
- **Failures** keep their row and their error message. *Requeue failed* puts
  them back; a hand that fails twice in a row rebuilds its own Pyodide before
  trying again.

Every finished job's row has an **open in the lab →** link; the lab loads that
parameter set from the cache, which is also the quickest way to verify the
sweep is producing what you think it is.

## For the AI assistant reading this on that machine

The farm and cache span four places; change them together or not at all:

| path | what it is |
| --- | --- |
| `src/mxn-farm/plan.ts` | ranges → parameter sets. Pure, React-free, checked by `npm run check:plan` |
| `src/mxn-farm/farm.tsx` | the console page: claim loop, hand lifecycle, queue view |
| `public/mxn/farm-worker.js` | one hand: Pyodide + the bridge sequence (generate → counts → censuses → upload) |
| `src/mxn-lab/cache.ts` | what a cache key IS, and the gzip transport. Both the lab and the farm import it |
| `worker-api/src/index.ts` | the Cloudflare Worker: `/cache/*`, `/farm/*`, `/solutions` |

Rules that are easy to break from one side:

- A **cache key** is built in `cache.ts` and *validated by regexes* in
  `worker-api/src/index.ts`. `npm run check:plan` reads those regexes out of
  the Worker's source and runs the client's keys through them — run it after
  touching either file.
- **`CACHE_VERSION`** (`cache.ts`) must be bumped when the engine changes what
  it answers; the `trace-plan-v17` engine-file key (five places — grep for it)
  is bumped when the engine *files* change. `docs/mxn-lab.md` § *Cache keys*
  explains the difference.
- The bridge calls in `farm-worker.js` must stay the ones `exact-worker.js`
  makes, or the farm fills the shelf with answers the lab disagrees with.

Checks, in the order of how much they need installed:

```bash
npm run build                    # tsc + vite; what CI requires
npm run check:plan               # planner + key shapes (node only)
cd worker-api && npm test        # the Worker off Cloudflare (Node 22+)
python3 scripts/cache-fixtures.py && npm run qa:cache   # end-to-end in a real
                                 # browser; needs numpy, a build, Playwright
```

The oracle for "is the engine still right" is in `docs/mxn-lab.md`: 2×2 with
`ks = [1,2,2]` must give extensions `(40,10)`, `(50,60)`, `(60,50)`, every
level 16 across / 8 masks and a weave. `qa:cache` asserts exactly that through
the whole stack.

Two cautions carried over from the rest of the repo: pin the engine's serial
path when driving it natively (`NX._lh._get_cpu_worker_count = lambda _t: 1`,
same as `bridge.py` does under Pyodide — the parallel path can pick different
combos), and never commit the token, a Worker URL in `data-cache` being the
one deliberate exception the operator makes on purpose
(`mxn/index.html`, `mxn/gpu/index.html`).
