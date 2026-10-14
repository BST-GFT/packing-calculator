-- A proposta's freight: carrier, quoted and charged prices, day of the quote,
-- tracking code, and the carrier's quote as a file kept in R2. The proposta
-- itself never changes, so freight lives here: each update adds a version,
-- the newest is the one in use, and no version is ever changed.
CREATE TABLE freight (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id INTEGER NOT NULL REFERENCES proposals (id) ON DELETE CASCADE,
  carrier TEXT NOT NULL,
  -- 1 when the carrier gives a tracking code (Sedex), 0 otherwise.
  tracking_needed INTEGER NOT NULL,
  quoted_brl REAL NOT NULL,
  -- The ideal charge is quoted_brl times this, the factor in use when saved.
  factor REAL NOT NULL,
  charged_brl REAL NOT NULL,
  -- YYYY-MM-DD
  quote_date TEXT NOT NULL,
  tracking TEXT NOT NULL DEFAULT '',
  -- The quote's file in the R2 bucket, if any; a version may keep the file of
  -- the one before.
  file_key TEXT,
  file_name TEXT,
  file_type TEXT,
  file_size INTEGER,
  saved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX freight_by_proposal ON freight (proposal_id, id);

CREATE TRIGGER freight_never_changes BEFORE UPDATE ON freight
BEGIN
  SELECT RAISE(ABORT, 'Versões do frete não podem ser alteradas.');
END;
