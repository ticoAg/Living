-- Share links (分享链接): a private address for one entry, collection (theme) or project that its author can take
-- back at any time and may let run out. Whoever opens it sees that item and what is shown in it (its photos, and for a
-- collection or project its finished entries), whatever their own visibility, until the link is deleted or expires.
-- Docs: /docs/data/share-links.md
-- Exactly one of entry_id, theme_id, project_id names the item; each cascades, so a deleted item takes its links along.
CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  -- the secret in the address /s/<token>: 24 characters of base64url, 144 random bits
  token TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
  theme_id TEXT REFERENCES themes(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- UTC; null: until deleted
  expires_at TEXT,
  CHECK ((entry_id IS NOT NULL) + (theme_id IS NOT NULL) + (project_id IS NOT NULL) = 1)
);
CREATE INDEX IF NOT EXISTS share_links_owner ON share_links(owner_id, created_at);
CREATE INDEX IF NOT EXISTS share_links_entry ON share_links(entry_id) WHERE entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS share_links_theme ON share_links(theme_id) WHERE theme_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS share_links_project ON share_links(project_id) WHERE project_id IS NOT NULL;

-- An entry's place (地点), chosen by its author; optional. It shows wherever the entry shows. Places are not deleted
-- today; should one ever be, the entry keeps its text and loses only the place. Docs: /docs/data/entries.md
ALTER TABLE entries ADD COLUMN poi_id TEXT REFERENCES pois(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS entries_poi ON entries(poi_id) WHERE poi_id IS NOT NULL;
