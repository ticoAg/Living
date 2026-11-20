-- Attachments (附件): the videos, recordings and other files an entry holds, kept as they were uploaded (less the
-- location a video or recording may carry). Each is its author's, and once saved in an entry it is that entry's alone:
-- whoever may open the entry may play or download it, so it has no visibility of its own. Docs: /docs/data/attachments.md
--
-- An attachment arrives before its entry knows of it: the browser uploads the file in parts (an R2 multipart upload,
-- `upload_id` until it completes), then saves the entry with it. Until then, and once taken out of its entry, it is
-- loose (`entry_id` NULL; `loose_since` the upload began, completed, or the attachment left its entry): only its
-- author can reach it, and the hourly job deletes it, file and all, a day after an upload that never completed or a
-- week after it came loose.
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
  -- its place among the entry's attachments, from 0
  position INTEGER NOT NULL DEFAULT 0,
  caption TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'audio', 'file')),
  -- the file's name as uploaded, for downloads
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  -- bytes
  size INTEGER NOT NULL CHECK (size > 0),
  -- seconds, for a video or recording, when the browser could tell
  duration REAL,
  width INTEGER,
  height INTEGER,
  -- R2: the file, and a frame of a video the browser drew
  file_key TEXT NOT NULL,
  poster_key TEXT,
  upload_id TEXT,
  -- when it was added; an import keeps the export's
  created_at TEXT NOT NULL,
  -- null while uploading
  uploaded_at TEXT,
  loose_since TEXT
);
CREATE INDEX IF NOT EXISTS attachments_entry ON attachments(entry_id, position) WHERE entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attachments_owner ON attachments(owner_id, id);
CREATE INDEX IF NOT EXISTS attachments_loose ON attachments(loose_since) WHERE entry_id IS NULL;
