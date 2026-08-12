-- Rated MXN continuation solutions.
--
-- One row per starred ring. parent_strands is the Lv-1 ring the solution was
-- built on: a rating is only meaningful against the base it continues from, so
-- the pair is stored together and never reconstructed later.
--
-- Geometry is kept as JSON text rather than normalised into tables. It is
-- opaque to every query this serves -- the searchable axes are (m, n, k, level)
-- and rating, and the strand lists are only ever read back whole, to draw.

CREATE TABLE IF NOT EXISTS solutions (
  id                TEXT PRIMARY KEY,
  created_at        TEXT NOT NULL,

  hand              TEXT NOT NULL,          -- 'lh' | 'rh'
  direction         TEXT NOT NULL,          -- 'cw' | 'ccw'
  m                 INTEGER NOT NULL,
  n                 INTEGER NOT NULL,
  level             INTEGER NOT NULL,       -- the level this ring is
  k                 INTEGER NOT NULL,       -- the rotation that produced it
  ks_prefix         TEXT NOT NULL,          -- JSON ks[0..level-1]

  parent_strands    TEXT NOT NULL,          -- JSON: the Lv-1 base ring
  solution_strands  TEXT NOT NULL,          -- JSON: this ring

  h_ext             TEXT NOT NULL,          -- JSON array
  v_ext             TEXT NOT NULL,          -- JSON array
  total_ext         INTEGER NOT NULL,       -- sum, so "shortest" is a plain ORDER BY
  audit             TEXT NOT NULL,          -- JSON: across/within/masks/stray/broken/healthy
  healthy           INTEGER NOT NULL,       -- 0|1, lifted out of audit for filtering
  solution_index    INTEGER NOT NULL,       -- position in the browser's search order

  -- Near-misses live in this table too. They are the same object -- a ring, its
  -- base, its extensions and its audit -- differing only in that the weave does
  -- not close. A second table would duplicate every column and every index to
  -- record one fact, and would make "everything for this size and k" two
  -- queries instead of one.
  kind              TEXT NOT NULL DEFAULT 'complete',  -- 'complete' | 'semi'
  -- For a near-miss, which band the shortfall is attributed to ('h' | 'v'). The
  -- other band was held at a value taken from a ring that DOES close, so the
  -- blame is one-sided by construction rather than by guess. NULL when closed.
  band              TEXT,
  -- expected - (across - within): 0 is a closed ring, small is a near miss.
  -- Lifted out of the audit JSON so the queue can serve nearest-first without
  -- scanning every row's geometry.
  deficit           INTEGER NOT NULL DEFAULT 0,
  -- How many distinct working partners this value failed against. 1 means it
  -- merely did not suit one partner, which is weak; 3 means the search really
  -- does throw it away. Stored because it qualifies the claim the row makes,
  -- and a rating is only as good as what the rater was told.
  refs              INTEGER NOT NULL DEFAULT 0,

  rating            INTEGER,                -- 0..100, NULL until rated
  rated_at          TEXT
);

-- The categoriser's main axis: "show me everything for this size and k".
CREATE INDEX IF NOT EXISTS idx_solutions_shape
  ON solutions (m, n, k, level);

-- "What still needs rating", and "what scored well" once they do.
CREATE INDEX IF NOT EXISTS idx_solutions_rating
  ON solutions (rating);

-- The near-miss queue: "unrated semi rings, nearest first".
CREATE INDEX IF NOT EXISTS idx_solutions_kind
  ON solutions (kind, rating, deficit);

-- This file only ever CREATEs, so running it against a database that already
-- has rows is a no-op -- including for the three columns above, which an
-- existing table will not grow. migrations/0001_semicomplete.sql is the part
-- that has to be run once by hand on a deployed database.


-- ---------------------------------------------------------------------------
-- Computed geometry, addressed by the parameters that produced it.
--
-- The lab's engine runs in the reader's browser, so a 3x3 costs twenty seconds
-- before the first card appears and a level widget costs a replay plus two
-- sweeps before it has anything to draw. None of that depends on who is asking:
-- one engine commit, one seed, one set of parameters, one answer. /mxn/gpu/
-- computes them ahead of time and puts them here; /mxn/ reads them back.
--
-- Artifacts are gzipped before they are sent, and a verdict census is two
-- thirds one repeated value, so they are far smaller than their shape suggests:
-- a 3x3 census measures 3.1 MB of JSON and 48 kB here. The Worker refuses
-- anything over 1.4 MB -- D1's own value ceiling, less base64's third -- naming
-- R2 as the fix, which is a better failure than a SQL error about an oversized
-- value. With an R2 bucket bound as CACHE this table is simply not read.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cache_entries (
  key          TEXT PRIMARY KEY,   -- run|trace / version / hand-dir / mxn / ks / flags [/ Lv-band]
  codec        TEXT NOT NULL,      -- 'gzip' | 'identity'; how body was encoded
  bytes        INTEGER NOT NULL,   -- length of the encoded body, before base64
  computed_at  TEXT NOT NULL,
  body         TEXT NOT NULL       -- base64 of the encoded artifact
);


-- ---------------------------------------------------------------------------
-- The queue /mxn/gpu/ works through.
--
-- A sweep over a range of sizes runs for hours, and a page cannot be the thing
-- that remembers where it got to: a closed tab, a reboot or a second machine
-- all have to pick up where the first left off. So the state of the work lives
-- here and runners claim jobs from it under a lease.
--
-- A job's id is its own run cache key, which makes pushing a plan idempotent:
-- the same sweep planned twice adds nothing, and a finished job is recognisable
-- without asking the artifact store what it produced.
-- ---------------------------------------------------------------------------
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
