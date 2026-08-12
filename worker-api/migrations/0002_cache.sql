-- The result cache and the farm queue.
--
-- Run once, by hand, against a database that already has rows:
--   npx wrangler d1 execute mxn-solutions --remote --file=./migrations/0002_cache.sql
--
-- A database created fresh from schema.sql today already has both tables and
-- needs none of this. Everything here is CREATE ... IF NOT EXISTS rather than
-- ALTER, so unlike 0001 a second run is a no-op instead of a loud failure --
-- there is no existing column to collide with.

-- Computed geometry, addressed by the parameters that produced it.
--
-- Artifacts are gzipped before they are sent, and a verdict census is two
-- thirds one repeated value, so they are far smaller than their shape suggests:
-- a 3x3 census measures 3.1 MB of JSON and 48 kB here. The Worker refuses
-- anything over 1.4 MB -- D1's own value ceiling, less base64's third -- with
-- the fix in the message. With an R2 bucket bound as CACHE this table is not
-- read at all.
CREATE TABLE IF NOT EXISTS cache_entries (
  key          TEXT PRIMARY KEY,   -- run|trace / version / hand-dir / mxn / ks / flags [/ Lv-band]
  codec        TEXT NOT NULL,      -- 'gzip' | 'identity'; how body was encoded
  bytes        INTEGER NOT NULL,   -- length of the encoded body, before base64
  computed_at  TEXT NOT NULL,
  body         TEXT NOT NULL       -- base64 of the encoded artifact
);

-- The queue /mxn/gpu/ works through.
--
-- A job's id is its own run cache key, which is what makes pushing a plan
-- idempotent: the same sweep planned twice adds nothing, and a finished job is
-- recognisable without asking the artifact store what it produced.
CREATE TABLE IF NOT EXISTS farm_jobs (
  id            TEXT PRIMARY KEY,
  batch         TEXT NOT NULL,         -- which plan enqueued it
  created_at    TEXT NOT NULL,

  m             INTEGER NOT NULL,
  n             INTEGER NOT NULL,
  ks            TEXT NOT NULL,         -- JSON array
  hand          TEXT NOT NULL,
  direction     TEXT NOT NULL,
  short_arms    INTEGER NOT NULL,
  ext_step      TEXT NOT NULL,         -- 'auto' or the number, as given
  combo_budget  INTEGER NOT NULL,
  levels        INTEGER NOT NULL,      -- len(ks)
  -- The run's worst-case combo count. Cheapest first, so an overnight sweep has
  -- something to show in its first minutes instead of spending an hour on the
  -- one 4x4 in the plan.
  weight        REAL NOT NULL,
  want_traces   INTEGER NOT NULL DEFAULT 1,

  state         TEXT NOT NULL,         -- 'pending' | 'running' | 'done' | 'failed'
  -- When a claim expires. A runner that went to sleep mid-census loses the job
  -- to the next claimer rather than stranding it; this is the whole of the
  -- recovery story, and it is enough for one operator's machines.
  lease_until   TEXT,
  runner        TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,

  seconds       REAL,
  bytes         INTEGER,
  artifacts     INTEGER,
  error         TEXT,
  started_at    TEXT,
  finished_at   TEXT
);

-- The claim's own query: pending or expired, cheapest first.
CREATE INDEX IF NOT EXISTS idx_farm_claim
  ON farm_jobs (state, weight, created_at);

-- "How is this batch getting on", which is the page's whole status line.
CREATE INDEX IF NOT EXISTS idx_farm_batch
  ON farm_jobs (batch, state);
