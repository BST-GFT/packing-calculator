-- The admin may correct a saved proposta's number and responsible, and delete
-- a proposta for good (only the server's admin routes do either). What was
-- proposed never changes: the trigger refuses updates to everything else.
--
-- The table is rebuilt with AUTOINCREMENT so an id is never used twice.
-- Without it, a proposta saved after the newest one was deleted would take
-- that id, and an old link to the deleted proposta would open the new one.
CREATE TABLE proposals_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL,
  number_key TEXT NOT NULL UNIQUE,
  responsible TEXT NOT NULL,
  products TEXT NOT NULL,
  headline TEXT NOT NULL,
  input TEXT NOT NULL,
  result TEXT NOT NULL,
  format INTEGER NOT NULL,
  saved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- When the admin last corrected the number or responsible, if ever.
  corrected_at TEXT
);

INSERT INTO proposals_new
  (id, number, number_key, responsible, products, headline, input, result, format, saved_at)
SELECT id, number, number_key, responsible, products, headline, input, result, format, saved_at
FROM proposals;

-- Also drops the old trigger, which refused every change.
DROP TABLE proposals;

ALTER TABLE proposals_new RENAME TO proposals;

CREATE TRIGGER proposals_never_change
BEFORE UPDATE OF id, products, headline, input, result, format, saved_at ON proposals
BEGIN
  SELECT RAISE(ABORT, 'Propostas salvas não podem ser alteradas.');
END;
