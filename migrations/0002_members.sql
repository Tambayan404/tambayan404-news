-- Last known server membership per Discord user, so sessions and RSS only ask Discord every few days.
CREATE TABLE IF NOT EXISTS members (
  user_id      TEXT PRIMARY KEY,
  is_member    INTEGER NOT NULL,
  checked_at   INTEGER NOT NULL,  -- epoch ms of the last answer from Discord (0 = never)
  attempted_at INTEGER NOT NULL   -- epoch ms of the last call to Discord, used to throttle retries
);
