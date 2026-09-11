CREATE TABLE IF NOT EXISTS links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  url           TEXT NOT NULL,
  url_norm      TEXT NOT NULL,
  domain        TEXT NOT NULL,
  title         TEXT,
  title_checked INTEGER NOT NULL DEFAULT 0,
  guild_id      TEXT NOT NULL,
  channel_id    TEXT NOT NULL,
  channel_name  TEXT NOT NULL,
  message_id    TEXT NOT NULL,
  author_id     TEXT NOT NULL,
  author_name   TEXT NOT NULL,
  posted_at     TEXT NOT NULL,   -- ISO 8601 UTC
  day           TEXT NOT NULL,   -- YYYY-MM-DD in SITE_TZ
  reactions     INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL,
  UNIQUE (message_id, url_norm)
);

CREATE INDEX IF NOT EXISTS links_day_idx ON links (day, reactions DESC, posted_at);
CREATE INDEX IF NOT EXISTS links_title_idx ON links (title_checked) WHERE title_checked = 0;

-- Small key/value table for ingest bookkeeping (channel round-robin cursor, etc.)
CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
