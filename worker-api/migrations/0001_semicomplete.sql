-- Widen an already-deployed dataset for near-misses. See schema.sql for what
-- the three columns mean.
--
-- schema.sql is CREATE TABLE IF NOT EXISTS, so re-running it against a database
-- that already has rows adds nothing. This file is the part that has to run
-- once, by hand:
--
--   npx wrangler d1 execute mxn-solutions --remote --file=./migrations/0001_semicomplete.sql
--
-- ALTER TABLE ... ADD COLUMN errors if the column is already there, so running
-- it twice fails loudly rather than half-applying. That is the intended
-- behaviour: there is one database and one operator.
ALTER TABLE solutions ADD COLUMN kind TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE solutions ADD COLUMN band TEXT;
ALTER TABLE solutions ADD COLUMN deficit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE solutions ADD COLUMN refs INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_solutions_kind
  ON solutions (kind, rating, deficit);
