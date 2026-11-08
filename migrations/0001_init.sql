-- Living schema. Docs: /docs/data/
-- IDs are prefixed ULIDs (u_, ph_, poi_, th_, it_, t_, pz_) except preset tags, which use readable slugs.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  bio TEXT,
  avatar_photo_id TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  note TEXT,
  used_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  used_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Hierarchical tags. owner_id NULL = system preset shared by everyone; users add their own nodes
-- anywhere in the tree (under presets or as new roots).
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES tags(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS tags_parent ON tags(parent_id);
CREATE INDEX IF NOT EXISTS tags_owner ON tags(owner_id);

CREATE TABLE IF NOT EXISTS pois (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT,
  category TEXT NOT NULL DEFAULT '景',
  city TEXT,
  district TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  radius REAL NOT NULL DEFAULT 120,
  source TEXT NOT NULL DEFAULT 'custom' CHECK (source IN ('custom', 'amap', 'osm')),
  source_id TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS pois_source ON pois(source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pois_latlng ON pois(lat, lng);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  note TEXT,
  taken_at TEXT,
  tz TEXT,
  lat REAL,
  lng REAL,
  alt REAL,
  heading REAL,
  geo_privacy TEXT NOT NULL DEFAULT 'exact' CHECK (geo_privacy IN ('exact', 'fuzzy', 'hidden')),
  city TEXT,
  district TEXT,
  poi_id TEXT REFERENCES pois(id) ON DELETE SET NULL,
  poi_distance REAL,
  poi_method TEXT CHECK (poi_method IN ('auto', 'confirmed', 'inferred', 'manual')),
  camera TEXT,
  lens TEXT,
  focal REAL,
  focal35 REAL,
  aperture REAL,
  shutter TEXT,
  iso INTEGER,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  file_key TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  variants TEXT NOT NULL,
  thumbhash TEXT,
  palette TEXT,
  focus_x REAL,
  focus_y REAL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted', 'private')),
  in_living INTEGER NOT NULL DEFAULT 1,
  favorite INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS photos_owner_sha ON photos(owner_id, sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS photos_owner_taken ON photos(owner_id, taken_at);
CREATE INDEX IF NOT EXISTS photos_visibility_taken ON photos(visibility, taken_at);
CREATE INDEX IF NOT EXISTS photos_poi ON photos(poi_id);

CREATE TABLE IF NOT EXISTS photo_tags (
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'suggested')),
  PRIMARY KEY (photo_id, tag_id)
);
CREATE INDEX IF NOT EXISTS photo_tags_tag ON photo_tags(tag_id);

-- Themes: a trip (旅程, dated, has a route) or a topic (专题, curated). Rendered as a travelogue.
CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'trip' CHECK (kind IN ('trip', 'topic')),
  title TEXT NOT NULL,
  subtitle TEXT,
  intro TEXT,
  cover_photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
  start_date TEXT,
  end_date TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'unlisted', 'private')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS themes_owner ON themes(owner_id, updated_at);

CREATE TABLE IF NOT EXISTS theme_items (
  id TEXT PRIMARY KEY,
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo', 'text', 'day')),
  photo_id TEXT REFERENCES photos(id) ON DELETE CASCADE,
  text TEXT,
  day TEXT
);
CREATE INDEX IF NOT EXISTS theme_items_theme ON theme_items(theme_id, position);
CREATE INDEX IF NOT EXISTS theme_items_photo ON theme_items(photo_id);

CREATE TABLE IF NOT EXISTS privacy_zones (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  radius REAL NOT NULL DEFAULT 300,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS privacy_zones_owner ON privacy_zones(owner_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('registration', 'invite');
