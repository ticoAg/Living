// Reading entries for the API: the columns of a summary, rows → EntrySummary / EntryDetail, and the photo check.
// A photo's own list of its entries is in photos.ts (entriesOfPhoto).
// Docs: /docs/api/entries.md, /docs/data/entries.md

import { excerptOf } from '../../shared/entries';
import {
  ENTRY_EXCERPT_MAX,
  type EntryDetail,
  type EntryMedia,
  type EntryStatus,
  type EntrySummary,
  type EntryType,
  type Visibility
} from '../../shared/types';
import { invalid } from './http';
import { summariesByIds } from './photos';
import { prepQ, Sql } from './sql';
import { entryById, photoById, projectList, themeList } from './visibility';

export interface EntryRow {
  id: string;
  owner_id: string;
  owner_handle: string;
  type: EntryType;
  title: string | null;
  /** the first ENTRY_EXCERPT_MAX + 1 code points of the body */
  body_head: string | null;
  occurred_at: string;
  visibility: Visibility;
  status: EntryStatus;
  created_at: string;
  updated_at: string;
  /** comma-separated, in order; only photos the viewer may open */
  photo_ids: string | null;
  tag_ids: string | null;
  /** comma-separated, in the order the projects were created; only projects the viewer may see in lists */
  project_ids: string | null;
  body?: string | null;
  revision?: number;
}

export const ENTRY_FROM = 'entries e JOIN users u ON u.id = e.owner_id';

/**
 * Columns of a summary. The body comes as its head only, enough for the excerpt; photo ids only name the photos
 * `viewer` may open (public, unlisted, or their own), in the entry's order; project ids only the projects `viewer`
 * may see in lists, as a photo page lists only themes it may advertise.
 */
export function entryCols(q: Sql, viewer: string | null): string {
  return `e.id, e.owner_id, u.handle AS owner_handle, e.type, e.title, substr(e.body, 1, ${ENTRY_EXCERPT_MAX + 1}) AS body_head,
    e.occurred_at, e.visibility, e.status, e.created_at, e.updated_at,
    (SELECT group_concat(photo_id) FROM (SELECT em.photo_id FROM entry_media em JOIN photos p ON p.id = em.photo_id
       WHERE em.entry_id = e.id AND ${photoById(q, viewer, 'p')} ORDER BY em.position)) AS photo_ids,
    (SELECT group_concat(et.tag_id) FROM entry_tags et WHERE et.entry_id = e.id) AS tag_ids,
    (SELECT group_concat(project_id) FROM (SELECT ep.project_id FROM entry_projects ep JOIN projects pj ON pj.id = ep.project_id
       WHERE ep.entry_id = e.id AND ${projectList(q, viewer, 'pj')} ORDER BY ep.project_id)) AS project_ids`;
}

const ids = (s: string | null): string[] => (s ? s.split(',') : []);

export function toEntrySummary(r: EntryRow): EntrySummary {
  const { excerpt, hasMore } = excerptOf(r.body_head, ENTRY_EXCERPT_MAX);
  return {
    id: r.id,
    ownerId: r.owner_id,
    ownerHandle: r.owner_handle,
    type: r.type,
    title: r.title,
    excerpt,
    hasMore,
    occurredAt: r.occurred_at,
    visibility: r.visibility,
    status: r.status,
    photoIds: ids(r.photo_ids),
    tagIds: ids(r.tag_ids),
    projectIds: ids(r.project_ids),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

/** The entry as `viewer` may open it (docs/api/entries.md), or null: missing, or not theirs and private or unfinished. */
export async function loadEntryDetail(db: D1Database, id: string, viewer: string | null): Promise<EntryDetail | null> {
  const q = new Sql();
  const row = await prepQ(
    db,
    `SELECT ${entryCols(q, viewer)}, e.body, e.revision FROM ${ENTRY_FROM} WHERE e.id = ${q.p(id)} AND ${entryById(q, viewer)}`,
    q
  ).first<EntryRow>();
  if (!row) return null;
  // Themes holding it, as a photo page lists its themes: those the viewer may see in lists, latest first. An unlisted
  // theme is not advertised from its entries.
  const qt = new Sql();
  const [media, themes] = await Promise.all([
    db
      .prepare('SELECT photo_id, caption FROM entry_media WHERE entry_id = ?1 ORDER BY position')
      .bind(id)
      .all<{ photo_id: string; caption: string | null }>(),
    prepQ(
      db,
      `SELECT DISTINCT th.id, th.title, th.updated_at FROM theme_items ti JOIN themes th ON th.id = ti.theme_id
       WHERE ti.entry_id = ${qt.p(id)} AND ${themeList(qt, viewer)} ORDER BY th.updated_at DESC, th.id DESC`,
      qt
    ).all<{ id: string; title: string }>()
  ]);
  const photos = await summariesByIds(
    db,
    viewer,
    media.results.map((m) => m.photo_id)
  );
  const shown: EntryMedia[] = [];
  for (const m of media.results) {
    const p = photos.get(m.photo_id);
    if (!p) continue; // a photo the viewer may not open is left out, not shown as a gap
    const { note: _note, ...photo } = p;
    shown.push({ photoId: m.photo_id, caption: m.caption, photo });
  }
  return {
    ...toEntrySummary(row),
    body: row.body ?? null,
    media: shown,
    revision: row.revision ?? 1,
    themes: themes.results.map((t) => ({ id: t.id, title: t.title }))
  };
}

/** The given photos must all belong to `ownerId` (400 otherwise): an entry only shows its author's photos. */
export async function assertOwnPhotos(db: D1Database, ownerId: string, photoIds: string[]): Promise<void> {
  if (!photoIds.length) return;
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM photos WHERE owner_id = ?1 AND id IN (SELECT value FROM json_each(?2))')
    .bind(ownerId, JSON.stringify(photoIds))
    .first<{ n: number }>();
  if ((row?.n ?? 0) !== new Set(photoIds).size) throw invalid('只能添加你自己的照片');
}
