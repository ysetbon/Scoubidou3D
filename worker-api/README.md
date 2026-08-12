# mxn-solutions-api

The Cloudflare Worker behind the MXN lab. It holds three things:

| what | who writes it | who reads it |
|---|---|---|
| **the rated dataset** — starred rings and flagged near-misses | the lab's ⭐ and 🚩 | `/mxn/rate/`, `/mxn/semi/` |
| **the result cache** — whole runs, and one level's one band censused | [`/mxn/gpu/`](../docs/mxn-farm.md), and the lab's *Publish run* button | `/mxn/`, on every Run and every widget opened |
| **the farm queue** — the parameter sets a sweep still owes | `/mxn/gpu/` | `/mxn/gpu/`, on any machine |

One token, one URL, one deploy. The lab keeps working with none of it.

## Why the cache exists

The lab's engine runs in the reader's browser, which is what lets it live on a
static host and is also its whole cost: a 3×3 is twenty seconds of blank page, a
level widget is a replay plus two sweeps, and counting a 2×2's solutions to the
end is 10,189 ring replays the browser caps at 60,000 product cells.

None of that depends on who is asking. `random.seed(0)`, one engine commit, one
set of parameters, one answer — so it need only be computed once, anywhere, and
this is where the answer is kept. Measured: `2×2 [1,2,2]` costs 27 seconds of
engine time and lands in the lab in about 1.2 seconds, at 60 kB across its seven
artifacts. See `docs/mxn-farm.md`.

## Setup

Five steps, all of them yours: they authenticate against your Cloudflare account.

```bash
cd worker-api
npm install

# 1. Log in. Opens a browser for OAuth.
npx wrangler login

# 2. Create the database. Prints a database_id.
npx wrangler d1 create mxn-solutions

# 3. Paste that id into wrangler.toml -> [[d1_databases]] -> database_id
#    (it is already filled in for this deployment).

# 4. Create the tables, remotely (not just in the local emulator).
npx wrangler d1 execute mxn-solutions --remote --file=./schema.sql

# 5. Set the admin token. Invent a long random string and keep it -- you paste
#    the same value into the lab's "admin token" field and the farm's.
npx wrangler secret put ADMIN_TOKEN

npx wrangler deploy
```

`deploy` prints the Worker URL. Paste that, and the token, into the lab sidebar's
*dataset API* panel — the farm reads the same two values from the same browser
storage.

**On a database that already has rows**, `schema.sql` will not grow it new
tables. Run the migrations instead (below).

### Optional: R2

Artifacts are gzipped before they are sent and a verdict census is two thirds one
repeated value, so they are far smaller than their shape suggests — a 3×3 census
is 3.1 MB of JSON and 48 kB stored. D1 holds anything up to 1.4 MB, which is
every size the lab will run, and the Worker refuses more than that with the fix
in the message rather than failing as a SQL error.

R2 is the belt-and-braces, worth having once the shelf is large enough that
10 GB of database looks like a limit:

```bash
npx wrangler r2 bucket create mxn-cache
# then uncomment [[r2_buckets]] in wrangler.toml and redeploy
```

Nothing already in D1 moves; it is simply no longer read, and the next run that
computes those parameters writes them to the bucket.

### Checking it

```bash
TOKEN=...        # the same value you gave to `wrangler secret put`
API=https://mxn-solutions-api.<your-subdomain>.workers.dev

curl -s "$API/health"                                   # -> 401, no token
curl -s -H "Authorization: Bearer $TOKEN" "$API/health"
# -> {"ok":true,"solutions":0,"artifactStore":"d1","publicCacheReads":true,"farm":[]}
```

A 500 from `/health` almost always means step 4 was skipped or was run without
`--remote`: the Worker is up but the table is not there. `artifactStore` tells
you whether the R2 binding took.

## Running it without Cloudflare

```bash
npm test          # needs Node 22+ for node:sqlite
```

The real `fetch` handler, against real SQLite behind a D1 shim and a Map behind
an R2 shim, driven with real `Request` objects: every route, both storage
backends, the atomic claim, the lease expiry, the CORS policy — which is
deliberately different for reads and writes — and every case that is supposed to
be refused.

The dataset half of this Worker shipped as reviewed rather than exercised code,
and the cache and queue are a great deal more surface than that was. What the
test does **not** prove is that D1 and R2 behave exactly as the shims do; the SQL
is real and runs against real SQLite, which is the part with teeth, and the shims
are thin on purpose so what they stand in for stays obvious.

`npm run qa:cache` in the repository root is the other half: this Worker, the
real vite build and a real browser, asserting that a page reading a stored answer
shows what a page that computed it would have shown, without fetching Pyodide.

## API

`Authorization: Bearer <ADMIN_TOKEN>` on everything, with one exception: reads of
`/cache/*` and `/catalogue` are open unless `CACHE_PUBLIC_READS` is `"0"`. An
entry there is derived from a published engine over published parameters, and
the point of it is that a reader who has configured nothing gets the fast page.
Writes always need the token.

### The dataset

| method | path | does |
|---|---|---|
| `GET` | `/health` | counts rows and names the artifact store, so it proves the bindings rather than the Worker |
| `POST` | `/solutions` | stores one starred solution |
| `GET` | `/solutions?m=&n=&k=&level=&kind=&band=&unrated=1&healthy=1&limit=` | lists |
| `GET` | `/solutions/:id` | one row, geometry included |
| `PATCH` | `/solutions/:id` | `{"rating": 0..100}` |

`total_ext` is stored on write so "shortest first" is an indexed sort rather than
a scan through JSON. `healthy` and `deficit` are lifted out of the audit blob for
the same reason.

`kind` selects which queue you are reading. `complete` rings sort shortest first;
`semi` rings — near-misses, where one band was held at a value taken from a ring
that closes and the other was swept — sort by `deficit`, nearest first, because a
ring one crossing short is the one most worth looking at. `band` narrows those to
the side being blamed. Omit `kind` and you get everything, in `total_ext` order.

### The cache

| method | path | does |
|---|---|---|
| `GET`/`HEAD` | `/cache/run/<key>` | one stored run. `HEAD` is `no-store`; `GET` is cacheable for an hour |
| `PUT` | `/cache/run/<key>` | stores one, body as `X-Mxn-Codec: gzip\|identity` bytes |
| `GET`/`HEAD` | `/cache/trace/<key>/L<v>-<band>` | one level's one band censused |
| `PUT` | `/cache/trace/<key>/L<v>-<band>` | stores one |
| `GET` | `/catalogue?prefix=&limit=` | what is on the shelf |

`<key>` is `<version>/<hand>-<direction>/<m>x<n>/<ks>/s<0\|1>-e<step>-b<budget>`,
e.g. `v2/lh-cw/2x2/1_2_2/s1-eauto-b400000`. Every segment is validated against
the shape `src/mxn-lab/cache.ts` builds, so a typo in a client is a 400 rather
than an entry nothing will ever look for. `npm run check:plan` in the repository
root reads these regexes out of this source and runs the client's keys through
them, which is the only thing holding the two sides together.

A miss is a `404`, not an error: it is the ordinary state of a parameter set
nobody has computed yet.

### The farm queue

| method | path | does |
|---|---|---|
| `POST` | `/farm/jobs` | `{batch, jobs:[…]}` — up to 250, `INSERT OR IGNORE` |
| `GET` | `/farm/jobs?batch=&state=&limit=` | the table |
| `PATCH` | `/farm/jobs` | `{id, state, seconds, bytes, artifacts, error}` |
| `POST` | `/farm/claim` | `{runner, lease, batch}` → the cheapest claimable job, atomically |
| `GET` | `/farm/summary?batch=` | counts and totals by state |
| `POST` | `/farm/requeue` | `{batch, which: failed\|running\|all}` |

A job's id **is** its run cache key, so pushing a plan twice adds nothing and
resuming a sweep is simply pushing it again. The claim is one `UPDATE … WHERE id
= (SELECT … LIMIT 1) RETURNING *`, so two runners racing cannot both win the same
row, and a `running` job whose lease has expired is claimable again — which is
the whole of what happens when a machine goes to sleep mid-census.

`PATCH /farm/jobs` takes the id in the body rather than the path because the id
*is* a path, and one percent-encoded into a URL is at the mercy of every hop that
might normalise `%2F` back into a separator.

## CORS

An allowlisted origin (`ALLOWED_ORIGINS`) is echoed and may use every method. An
unknown origin gets `*` for cache **reads** only — `GET,HEAD,OPTIONS`, with no
`Authorization` in the allowed headers, so a cross-origin write cannot even be
preflighted from there. A blanket wildcard would let any page a browser happens
to load read the dataset with a token it stole from elsewhere.

`X-Mxn-Codec` is in `Access-Control-Expose-Headers`: without it a cross-origin
reader cannot tell a gzipped body from a plain one, and every read fails to parse.

## Cost

Well inside the free tier. Workers give 100k requests/day; D1 gives 10 GB and 5 M
row reads/day; R2, if bound, gives 10 GB. A whole parameter set is ~60 kB of
artifacts, so the entire 1…4 × 1…4 matrix at one k per size is a few megabytes.
Stars are a human-rate event, and a cache read is one request that the browser
then holds for an hour.

## What is deliberately not here

- **No login.** One writer, one token. If more than one person ever needs access,
  this wants replacing with real auth rather than extending.
- **No delete for solutions.** Ratings are the point; removing rows is a
  `wrangler d1 execute` away and does not need an endpoint that could be called
  by accident. The farm queue *can* be requeued, because that is operational
  state rather than data — and even then the row and its attempt count survive,
  so a job that has failed four times stays visibly different from a fresh one.
- **No migration framework.** `schema.sql` is `CREATE TABLE IF NOT EXISTS`, so
  re-running it is safe — and therefore does nothing to a table that already
  exists. Column changes go in `migrations/` and are run by hand, once, in order.

## Migrations

Run each of these once, in order, against a database that already has rows. A
database created fresh from `schema.sql` today already has everything and needs
none of them.

```bash
npx wrangler d1 execute mxn-solutions --remote --file=./migrations/0001_semicomplete.sql
npx wrangler d1 execute mxn-solutions --remote --file=./migrations/0002_cache.sql
```

| file | adds |
|---|---|
| `0001_semicomplete.sql` | `kind`, `band`, `deficit` and the near-miss index |
| `0002_cache.sql` | `cache_entries` and `farm_jobs` |

`ALTER TABLE … ADD COLUMN` errors if the column is already there, so a second run
of `0001` fails loudly rather than half-applying. That is intended. `0002` is all
`CREATE … IF NOT EXISTS`, so a second run of it is a no-op.
