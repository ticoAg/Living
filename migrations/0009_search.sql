-- Search (搜索) reads one person's photos that have words of their own, a title or a note. Most photos have neither,
-- so with this index a search visits only those; the search names the same condition so that SQLite can use it.
-- No full-text (FTS5) table: D1 cannot export a database with virtual tables in a form it can import again, and that
-- export is the backup (docs/runbooks/backup.md). Docs: /docs/api/search.md
CREATE INDEX IF NOT EXISTS photos_owner_text ON photos(owner_id, taken_at) WHERE title IS NOT NULL OR note IS NOT NULL;
