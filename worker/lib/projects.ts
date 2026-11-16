// Reading projects for the API: summaries with their counts and cover, the detail with milestones and photos, and
// the check of an entry's project ids. Docs: /docs/api/projects.md, /docs/data/projects.md

import type { Milestone, PhotoSummary, ProjectDetail, ProjectStatus, ProjectSummary, ProjectType, Visibility } from '../../shared/types';
import { summariesByIds } from './photos';
import { prepQ, Sql } from './sql';
import { entryById, photoById, projectById } from './visibility';

export interface ProjectRow {
  id: string;
  owner_id: string;
  owner_handle: string;
  type: ProjectType;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  status: ProjectStatus;
  visibility: Visibility;
  created_at: string;
  updated_at: string;
  entry_count: number;
  day_count: number;
  photo_count: number;
  last_occurred_at: string | null;
  cover_id: string | null;
}

export interface MilestoneRow {
  id: string;
  project_id: string;
  title: string;
  body: string | null;
  date: string;
  created_at: string;
  updated_at: string;
}

export const toMilestone = (r: MilestoneRow): Milestone => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  body: r.body,
  date: r.date,
  createdAt: r.created_at,
  updatedAt: r.updated_at
});

/**
 * Summaries of the projects matching `where` (bound on `q`, alias `pj`). Counts and the cover only involve finished
 * entries `viewer` may open and, of their photos, those `viewer` may open: a project never shows more than its parts.
 */
export async function selectProjects(db: D1Database, viewer: string | null, q: Sql, where: string, limit = 500): Promise<ProjectSummary[]> {
  // finished entries of the project the viewer may open
  const kept = `FROM entry_projects ep JOIN entries e ON e.id = ep.entry_id WHERE ep.project_id = pj.id AND e.status = 'published' AND ${entryById(q, viewer, 'e')}`;
  const photos = `FROM entry_projects ep JOIN entries e ON e.id = ep.entry_id JOIN entry_media em ON em.entry_id = e.id JOIN photos p ON p.id = em.photo_id
    WHERE ep.project_id = pj.id AND e.status = 'published' AND ${entryById(q, viewer, 'e')} AND ${photoById(q, viewer, 'p')}`;
  const res = await prepQ(
    db,
    `SELECT pj.id, pj.owner_id, u.handle AS owner_handle, pj.type, pj.title, pj.description, pj.start_date, pj.end_date, pj.status,
        pj.visibility, pj.created_at, pj.updated_at,
        (SELECT COUNT(*) ${kept}) AS entry_count,
        (SELECT COUNT(DISTINCT substr(e.occurred_at, 1, 10)) ${kept}) AS day_count,
        (SELECT MAX(e.occurred_at) ${kept}) AS last_occurred_at,
        (SELECT COUNT(DISTINCT em.photo_id) ${photos}) AS photo_count,
        (SELECT em.photo_id ${photos} ORDER BY e.occurred_at DESC, e.rowid DESC, em.position LIMIT 1) AS cover_id
     FROM projects pj JOIN users u ON u.id = pj.owner_id
     WHERE ${where} ORDER BY pj.updated_at DESC, pj.id DESC LIMIT ${limit}`,
    q
  ).all<ProjectRow>();

  const covers = await summariesByIds(
    db,
    viewer,
    res.results.map((r) => r.cover_id).filter((x): x is string => Boolean(x))
  );
  return res.results.map((r) => {
    const cover = r.cover_id ? covers.get(r.cover_id) : undefined;
    return {
      id: r.id,
      ownerId: r.owner_id,
      ownerHandle: r.owner_handle,
      type: r.type,
      title: r.title,
      description: r.description,
      startDate: r.start_date,
      endDate: r.end_date,
      status: r.status,
      visibility: r.visibility,
      entryCount: r.entry_count,
      dayCount: r.day_count,
      photoCount: r.photo_count,
      lastOccurredAt: r.last_occurred_at,
      cover: cover ? withoutNote(cover) : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  });
}

function withoutNote(p: PhotoSummary & { note: string | null }): PhotoSummary {
  const { note: _note, ...photo } = p;
  return photo;
}

/**
 * The project as `viewer` may open it, or null: missing, or private and not theirs. `photos` are the photos of its
 * entries that `viewer` may open, in entries `viewer` may open (the author: every entry of theirs in it, drafts too),
 * so a page can show the entries without asking for the author's whole library.
 */
export async function loadProjectDetail(db: D1Database, id: string, viewer: string | null): Promise<ProjectDetail | null> {
  const q = new Sql();
  const summary = (await selectProjects(db, viewer, q, `pj.id = ${q.p(id)} AND ${projectById(q, viewer, 'pj')}`, 1))[0];
  if (!summary) return null;

  const qp = new Sql();
  const [milestones, photoIds] = await Promise.all([
    db.prepare('SELECT * FROM milestones WHERE project_id = ?1 ORDER BY date, created_at, id').bind(id).all<MilestoneRow>(),
    prepQ(
      db,
      `SELECT em.photo_id FROM entry_projects ep JOIN entries e ON e.id = ep.entry_id JOIN entry_media em ON em.entry_id = e.id
       WHERE ep.project_id = ${qp.p(id)} AND ${entryById(qp, viewer, 'e')}
       ORDER BY e.occurred_at DESC, e.rowid DESC, em.position`,
      qp
    ).all<{ photo_id: string }>()
  ]);
  const photos = await summariesByIds(
    db,
    viewer,
    photoIds.results.map((r) => r.photo_id)
  );
  return { ...summary, milestones: milestones.results.map(toMilestone), photos: [...photos.values()].map(withoutNote) };
}

/** The given ids that name projects of `ownerId`, in the order given; others (someone else's, deleted) are dropped. */
export async function usableProjectIds(db: D1Database, ownerId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const res = await db
    .prepare('SELECT id FROM projects WHERE owner_id = ?1 AND id IN (SELECT value FROM json_each(?2))')
    .bind(ownerId, JSON.stringify(ids))
    .all<{ id: string }>();
  const ok = new Set(res.results.map((r) => r.id));
  return ids.filter((x) => ok.has(x));
}
