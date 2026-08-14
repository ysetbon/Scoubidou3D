-- Human verdicts on stored rings, mirrored from the picks/v3 cache artifact
-- (docs/mxn-fit.md § Saving a judgement). Run once, by hand, on a deployed
-- database, as 0001 and 0002 were; schema.sql already carries the columns for
-- a database created fresh.
--
--   npx wrangler d1 execute mxn-solutions --remote --file=./migrations/0003_verdict.sql
--
-- Like 0001, the ALTERs fail loudly on a second run rather than half-applying;
-- that is intended.

ALTER TABLE solutions ADD COLUMN verdict TEXT;      -- 'valid' | 'best' | 'rejected' | NULL
ALTER TABLE solutions ADD COLUMN verdict_by TEXT;   -- who; never NULL when verdict is not
ALTER TABLE solutions ADD COLUMN verdict_at TEXT;
ALTER TABLE solutions ADD COLUMN source TEXT;       -- 'fitter' | 'engine' | 'grid' | 'hand'

CREATE INDEX IF NOT EXISTS idx_solutions_verdict
  ON solutions (verdict, m, n, k, level);
