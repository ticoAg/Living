-- Answers of the place providers (nearby places, name searches, reverse geocodes), cached by worker/providers/cache.ts.
-- Docs: /docs/data/place-cache.md
-- They used to live in KV, whose free plan allows 1000 writes a day shared with sessions: a large upload could use
-- them all up, and then nobody could sign in until midnight UTC. D1 allows 100,000 row writes a day.
-- Nothing else refers to this table; any row can be dropped at any time.
CREATE TABLE IF NOT EXISTS place_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
-- The hourly job deletes expired rows by this index.
CREATE INDEX IF NOT EXISTS place_cache_expires ON place_cache(expires_at);
