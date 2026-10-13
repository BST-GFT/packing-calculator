-- Settings shared by everyone (boxes, weight limits, cubed-weight rules and
-- the like), changed by the admin. Each save adds a version; the newest one
-- applies, and older ones stay as history. Versions never change.
CREATE TABLE settings (
  id INTEGER PRIMARY KEY,
  -- JSON, checked by readSettings in src/settings/format.ts.
  value TEXT NOT NULL,
  saved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TRIGGER settings_never_change BEFORE UPDATE ON settings
BEGIN
  SELECT RAISE(ABORT, 'Versões de configuração não podem ser alteradas.');
END;
