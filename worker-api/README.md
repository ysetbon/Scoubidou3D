# mxn-solutions-api

The dataset behind the lab's ⭐ button. A Cloudflare Worker over a D1 database,
deployed separately from the GitHub Pages site.

**This has never been run.** It was written in an environment with no network
route to Cloudflare — `api`, `dash` and `developers.cloudflare.com` are all
unreachable there — so it is reviewed code, not exercised code. The first
`wrangler deploy` is also its first test. Expect to fix something.

## Why it exists

The lab is static: no server, no database. ⭐ therefore saves to `localStorage`,
which is per-browser, easy to lose, and impossible to query. This Worker gives
the starred rings somewhere durable to live so a later categoriser can page
through them, score each one 0–100, and feed the good ones back as search seeds.

## Setup

Five steps. Steps 1–4 are yours; nothing here can be done for you, because they
all authenticate against your Cloudflare account.

```bash
cd worker-api
npm install

# 1. Log in. Opens a browser for OAuth.
npx wrangler login

# 2. Create the database. Prints a database_id.
npx wrangler d1 create mxn-solutions

# 3. Paste that id into wrangler.toml -> [[d1_databases]] -> database_id
#    It is deliberately blank, so a deploy without it fails loudly.

# 4. Create the tables, remotely (not just in the local emulator).
npx wrangler d1 execute mxn-solutions --remote --file=./schema.sql

# 5. Set the admin token. Invent a long random string and keep it -- you paste
#    the same value into the lab's "admin token" field.
npx wrangler secret put ADMIN_TOKEN

npx wrangler deploy
```

`deploy` prints the Worker URL. Paste that, and the token, into the lab sidebar.

### Checking it

```bash
TOKEN=...        # the same value you gave to `wrangler secret put`
API=https://mxn-solutions-api.<your-subdomain>.workers.dev

curl -s "$API/health"                                  # -> 401, no token
curl -s -H "Authorization: Bearer $TOKEN" "$API/health" # -> {"ok":true,"solutions":0}
```

A 500 from `/health` almost always means step 4 was skipped or was run without
`--remote`: the Worker is up but the table is not there.

## API

Every route requires `Authorization: Bearer <ADMIN_TOKEN>`, reads included —
the dataset is not public.

| method | path | does |
|---|---|---|
| `GET` | `/health` | counts rows, so it proves the D1 binding, not just the Worker |
| `POST` | `/solutions` | stores one starred solution |
| `GET` | `/solutions?m=&n=&k=&level=&kind=&band=&unrated=1&healthy=1&limit=` | lists |
| `GET` | `/solutions/:id` | one row, geometry included |
| `PATCH` | `/solutions/:id` | `{"rating": 0..100}` |

`total_ext` is stored on write so "shortest first" is an indexed sort rather
than a scan through JSON. `healthy` and `deficit` are lifted out of the audit
blob for the same reason.

`kind` selects which queue you are reading. `complete` rings sort shortest
first; `semi` rings — near-misses, where one band was held at a value taken
from a ring that closes and the other was swept — sort by `deficit`, nearest
first, because a ring one crossing short is the one most worth looking at.
`band` narrows those to the side being blamed. Omit `kind` and you get
everything, in `total_ext` order.

CORS echoes the caller's origin only when it is in `ALLOWED_ORIGINS`. A wildcard
would let any page a browser loads read the dataset with a token taken from
somewhere else.

## Cost

Well inside the free tier: Workers give 100k requests/day, D1 gives 5 GB and
5 M row reads/day. A starred solution is a few hundred KB of strand JSON at
worst, and stars are a human-rate event.

## What is deliberately not here

- **No login.** One writer, one token. If more than one person ever needs
  access, this wants replacing with real auth rather than extending.
- **No delete.** Ratings are the point; removing rows is a `wrangler d1
  execute` away and does not need an endpoint that could be called by accident.
- **No migration framework.** `schema.sql` is `CREATE TABLE IF NOT EXISTS`, so
  re-running it is safe — and therefore does nothing to a table that already
  exists. Column changes go in `migrations/` and are run by hand, once, in
  order. There is one database and one operator; anything more is machinery
  with nothing to manage.

## Migrations

Run each of these once, in order, against a database that already has rows. A
database created fresh from `schema.sql` today already has everything and needs
none of them.

```bash
npx wrangler d1 execute mxn-solutions --remote --file=./migrations/0001_semicomplete.sql
```

| file | adds |
|---|---|
| `0001_semicomplete.sql` | `kind`, `band`, `deficit` and the near-miss index |

`ALTER TABLE ... ADD COLUMN` errors if the column is already there, so a second
run fails loudly rather than half-applying. That is intended.
