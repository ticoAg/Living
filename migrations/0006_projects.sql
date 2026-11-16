-- Projects (项目): a goal, a stretch of learning or a long piece of work, carried on over weeks or years: learning
-- calligraphy, a year of reading. Entries join a project when the author says so; none has to. Docs: /docs/data/projects.md
-- New projects are private. `type` has no CHECK, like entries.type: its list (PROJECT_TYPES in shared/types.ts) may grow.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL,
  -- Markdown: what it is for, the plan
  description TEXT,
  -- 'YYYY-MM-DD', the author's local days
  start_date TEXT NOT NULL,
  -- the planned or actual last day; null when open-ended
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'unlisted', 'private')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id);

-- Entries of a project. An entry may be in several projects; a project only takes its owner's entries, and showing
-- it never shows an entry the reader may not open. Docs: /docs/data/entry-projects.md
CREATE TABLE IF NOT EXISTS entry_projects (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, project_id)
);
CREATE INDEX IF NOT EXISTS entry_projects_project ON entry_projects(project_id);

-- Milestones of a project: a named day, reached or planned, with a summary of the stage it closes.
-- Docs: /docs/data/milestones.md
CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  -- Markdown
  body TEXT,
  -- 'YYYY-MM-DD': the day it was reached, or the day aimed at while still ahead
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS milestones_project ON milestones(project_id, date);
