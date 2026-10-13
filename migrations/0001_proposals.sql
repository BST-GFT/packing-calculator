-- Saved propostas. Rows are only ever added: the trigger below refuses any
-- change, so a proposta stays exactly as it was saved.
CREATE TABLE proposals (
  id INTEGER PRIMARY KEY,
  -- The proposta number as typed, and in a form that makes it unique whatever
  -- its capitals or spacing.
  number TEXT NOT NULL,
  number_key TEXT NOT NULL UNIQUE,
  responsible TEXT NOT NULL,
  -- Product names and the plan's headline, for listing and searching.
  products TEXT NOT NULL,
  headline TEXT NOT NULL,
  -- JSON: what was typed, and what the calculator proposed.
  input TEXT NOT NULL,
  result TEXT NOT NULL,
  -- Version of the JSON layout, so older propostas can still be read.
  format INTEGER NOT NULL,
  saved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TRIGGER proposals_never_change BEFORE UPDATE ON proposals
BEGIN
  SELECT RAISE(ABORT, 'Propostas salvas não podem ser alteradas.');
END;
