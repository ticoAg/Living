-- Entries (记录): something that happened at a time, a thought, a stretch of learning or making. They are the core of
-- the archive; photos are media an entry can show, and an entry needs none. Docs: /docs/data/entries.md
-- New entries are private. `type` has no CHECK: its list (ENTRY_TYPES in shared/types.ts) is meant to grow, and SQLite
-- can only change a CHECK by rebuilding the table. The Worker checks it.
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'note',
  title TEXT,
  -- Markdown, stored as written
  body TEXT,
  -- Local wall-clock time it happened, like photos.taken_at: 'YYYY-MM-DD' when only the day is known, else
  -- 'YYYY-MM-DDTHH:mm:ss'. Not when it was written down: that is created_at.
  occurred_at TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'unlisted', 'private')),
  -- draft: not finished, the author's only; published: finished, in the timeline; archived: put away
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  -- one more with every change, so an editor that is behind can be told (409) instead of overwriting
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
-- The timeline: one person's entries by when they happened.
CREATE INDEX IF NOT EXISTS entries_owner_occurred ON entries(owner_id, occurred_at);
-- Everyone's finished public entries, newest first.
CREATE INDEX IF NOT EXISTS entries_public_occurred ON entries(occurred_at) WHERE visibility = 'public' AND status = 'published';

-- The photos an entry shows, in order, each with an optional caption. A photo shows once per entry and may be in any
-- number of entries; its own visibility still decides who sees it. Docs: /docs/data/entry-media.md
CREATE TABLE IF NOT EXISTS entry_media (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  caption TEXT,
  PRIMARY KEY (entry_id, photo_id)
);
CREATE INDEX IF NOT EXISTS entry_media_photo ON entry_media(photo_id);

-- Tags of an entry, from the same tree as photo tags. They describe the entry, not its photos: neither inherits the
-- other's. Docs: /docs/data/entry-tags.md
CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);
CREATE INDEX IF NOT EXISTS entry_tags_tag ON entry_tags(tag_id);
