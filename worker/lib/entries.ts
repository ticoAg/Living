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
import type { MediaField } from './entryInput';
import { invalid } from './http';
import { summariesByIds } from './photos';
import { prep, prepQ, Sql } from './sql';
import { entryById, photoById, projectList, themeList } from './visibility';

export interface EntryRow {
  id: string;
  owner_id: string;
  owner_handle: string;
  type: EntryType;
  title: string | null;
  /** the first ENTRY_EXCERPT_MAX + 1 code points of the body */
  body_head: string | null;
  /** code points in the body */
  chars: number;
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
  poi_id: string | null;
  poi_name: string | null;
  poi_category: string | null;
  poi_city: string | null;
  poi_district: string | null;
  poi_lat: number | null;
  poi_lng: number | null;
  body?: string | null;
  revision?: number;
}

/** The entry with its author and its place (alias `epo`). */
export const ENTRY_FROM = 'entries e JOIN users u ON u.id = e.owner_id LEFT JOIN pois epo ON epo.id = e.poi_id';

/**
 * Columns of a summary. The body comes as its head only, enough for the excerpt; photo ids only name the photos
 * `viewer` may open (public, unlisted, or their own; with a share link's `grant`, that owner's too), in the entry's
 * order; project ids only the projects `viewer` may see in lists, as a photo page lists only themes it may advertise.
 */
export function entryCols(q: Sql, viewer: string | null, grant: string | null = null): string {
  return `e.id, e.owner_id, u.handle AS owner_handle, e.type, e.title, substr(e.body, 1, ${ENTRY_EXCERPT_MAX + 1}) AS body_head,
    coalesce(length(e.body), 0) AS chars, e.occurred_at, e.visibility, e.status, e.created_at, e.updated_at,
    e.poi_id, epo.name AS poi_name, epo.category AS poi_category, epo.city AS poi_city, epo.district AS poi_district,
    epo.lat AS poi_lat, epo.lng AS poi_lng,
    (SELECT group_concat(photo_id) FROM (SELECT em.photo_id FROM entry_media em JOIN photos p ON p.id = em.photo_id
       WHERE em.entry_id = e.id AND ${photoById(q, viewer, 'p', grant)} ORDER BY em.position)) AS photo_ids,
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
    chars: r.chars,
    occurredAt: r.occurred_at,
    visibility: r.visibility,
    status: r.status,
    photoIds: ids(r.photo_ids),
    tagIds: ids(r.tag_ids),
    projectIds: ids(r.project_ids),
    // the join finds the place, or nothing at all (its row is gone): then the entry has none
    poi:
      r.poi_id && r.poi_name !== null && r.poi_lat !== null && r.poi_lng !== null
        ? {
            id: r.poi_id,
            name: r.poi_name,
            category: r.poi_category ?? '',
            city: r.poi_city,
            district: r.poi_district,
            lat: r.poi_lat,
            lng: r.poi_lng
          }
        : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

/**
 * The entry as `viewer` may open it (docs/api/entries.md), or null: missing, or not theirs and private or unfinished.
 * `grant`: the owner a share link reaching this entry opens it for (lib/shares.ts); its photos then show in full.
 */
export async function loadEntryDetail(
  db: D1Database,
  id: string,
  viewer: string | null,
  grant: string | null = null
): Promise<EntryDetail | null> {
  const q = new Sql();
  const row = await prepQ(
    db,
    `SELECT ${entryCols(q, viewer, grant)}, e.body, e.revision FROM ${ENTRY_FROM} WHERE e.id = ${q.p(id)} AND ${entryById(q, viewer, 'e', grant)}`,
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
    media.results.map((m) => m.photo_id),
    false,
    grant
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

// ---- writing ------------------------------------------------------------------------------------------------------

/** The entry's photos as one statement, positions in array order from 0; with `replace`, the old ones go first. */
export function writeMedia(db: D1Database, entryId: string, media: MediaField[], replace = false): D1PreparedStatement[] {
  const out = replace ? [prep(db, 'DELETE FROM entry_media WHERE entry_id = ?1', entryId)] : [];
  if (media.length) {
    out.push(
      prep(
        db,
        `INSERT INTO entry_media (entry_id, photo_id, position, caption)
         SELECT ?1, json_extract(value, '$.photoId'), key, json_extract(value, '$.caption') FROM json_each(?2)`,
        entryId,
        JSON.stringify(media)
      )
    );
  }
  return out;
}

export function writeProjects(db: D1Database, entryId: string, projectIds: string[], replace = false): D1PreparedStatement[] {
  const out = replace ? [prep(db, 'DELETE FROM entry_projects WHERE entry_id = ?1', entryId)] : [];
  if (projectIds.length) {
    out.push(
      prep(
        db,
        'INSERT OR IGNORE INTO entry_projects (entry_id, project_id) SELECT ?1, value FROM json_each(?2)',
        entryId,
        JSON.stringify(projectIds)
      )
    );
  }
  return out;
}

export function writeTags(db: D1Database, entryId: string, tagIds: string[], replace = false): D1PreparedStatement[] {
  const out = replace ? [prep(db, 'DELETE FROM entry_tags WHERE entry_id = ?1', entryId)] : [];
  if (tagIds.length) {
    out.push(
      prep(db, 'INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT ?1, value FROM json_each(?2)', entryId, JSON.stringify(tagIds))
    );
  }
  return out;
}
