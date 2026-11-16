-- Collections (合集) grow out of themes in place: the same tables, the same /t/:id, the same order and words, and now
-- an entry can be an item beside photos, text and day sections. Docs: /docs/data/theme-items.md,
-- /docs/data/evolution.md#合集
-- SQLite cannot change a CHECK, so theme_items is rebuilt and every row copied as it is (ids, positions, text). The
-- new table has no CHECK on kind: its list (THEME_ITEM_KINDS in shared/types.ts) may grow, and the Worker checks it.
CREATE TABLE theme_items_next (
  id TEXT PRIMARY KEY,
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'photo',
  photo_id TEXT REFERENCES photos(id) ON DELETE CASCADE,
  -- entry items: the entry, shown with its own photos; the item goes when the entry does
  entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
  text TEXT,
  day TEXT
);
INSERT INTO theme_items_next (id, theme_id, position, kind, photo_id, text, day)
  SELECT id, theme_id, position, kind, photo_id, text, day FROM theme_items;
DROP TABLE theme_items;
ALTER TABLE theme_items_next RENAME TO theme_items;
CREATE INDEX IF NOT EXISTS theme_items_theme ON theme_items(theme_id, position);
CREATE INDEX IF NOT EXISTS theme_items_photo ON theme_items(photo_id);
CREATE INDEX IF NOT EXISTS theme_items_entry ON theme_items(entry_id);

-- Who sees a new photo unless the uploader says otherwise. New accounts start private, like entries, projects and
-- collections; accounts that already exist keep uploading as they did (public) until they change it in settings.
-- No photo's own visibility changes here. Docs: /docs/data/users.md
ALTER TABLE users ADD COLUMN photo_visibility TEXT NOT NULL DEFAULT 'private' CHECK (photo_visibility IN ('public', 'unlisted', 'private'));
UPDATE users SET photo_visibility = 'public';
