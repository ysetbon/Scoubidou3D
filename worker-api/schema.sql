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

  rating            INTEGER,                -- 0..100, NULL until rated
  rated_at          TEXT
);

-- The categoriser's main axis: "show me everything for this size and k".
CREATE INDEX IF NOT EXISTS idx_solutions_shape
  ON solutions (m, n, k, level);

-- "What still needs rating", and "what scored well" once they do.
CREATE INDEX IF NOT EXISTS idx_solutions_rating
  ON solutions (rating);
