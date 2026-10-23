-- One row per event the game sends: a round as it's answered, or a game when the player saves it.
-- No IP addresses or names: player is a random id kept in the player's browser.
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  kind        TEXT    NOT NULL,  -- round | game
  player      TEXT    NOT NULL,
  game        TEXT    NOT NULL,
  mode        TEXT    NOT NULL,  -- classic | match
  round       INTEGER,           -- null for game events
  payload     TEXT    NOT NULL   -- the record as JSON (web/log-core.js format)
);
CREATE INDEX IF NOT EXISTS events_game ON events (game);
CREATE INDEX IF NOT EXISTS events_kind_mode ON events (kind, mode);
