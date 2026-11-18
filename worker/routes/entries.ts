// Entries (记录): the core of the archive. A text, a time and, if wanted, photos, tags and a type; private unless the
// author says otherwise. Contract: /docs/api/entries.md

import { Hono } from 'hono';
import { ENTRY_LIST_LIMIT, type EntryListResponse, type EntryStatus, type SessionUser, type Visibility } from '../../shared/types';
import type { AppEnv } from '../env';
import { assertOwnPhotos, ENTRY_FROM, entryCols, loadEntryDetail, toEntrySummary, type EntryRow } from '../lib/entries';
import { assertNotEmpty, parseEntryFields, type MediaField } from '../lib/entryInput';
import { conflict, forbidden, invalid, listCache, notFound, paramId, readJson, unauthenticated, type Ctx } from '../lib/http';
import { newId } from '../lib/ids';
import { requireUser, viewerId } from '../lib/session';
import { grantFor, sharedCache } from '../lib/shares';
import { capped, nowIso, prep, prepInsert, prepQ, Sql } from '../lib/sql';
import { usableTagIds } from '../lib/tags';
import { usableProjectIds } from '../lib/projects';
import { dayRange } from '../lib/validate';
import { entryById, entryList, projectById } from '../lib/visibility';

export const entries = new Hono<AppEnv>({ strict: false });

/** A long article in a script of three bytes a character, captions on many photos, and JSON escapes. */
const MAX_BODY_BYTES = 1024 * 1024;

// ---- reading ------------------------------------------------------------------------------------------------------

entries.get('/', async (c) => {
  const viewer = await viewerId(c);
  const db = c.env.DB;
  const ownerHandle = c.req.query('owner');
  const projectId = c.req.query('project');
  const poiId = c.req.query('poi');
  const mine = ['1', 'true'].includes(c.req.query('mine') ?? '');
  if (mine && !viewer) throw unauthenticated();
  const range = dayRange(c.req.query('from'), c.req.query('to'));

  let ownerId: string | null = null;
  if (ownerHandle) {
    const u = await db.prepare('SELECT id FROM users WHERE handle = ?1').bind(ownerHandle).first<{ id: string }>();
    if (!u) {
      listCache(c, viewer);
      return c.json({ entries: [], truncated: false } satisfies EntryListResponse);
    }
    ownerId = u.id;
  }

  // a share link to the project opens its owner's finished entries in it, whatever their visibility (lib/shares.ts)
  const grant = projectId ? await grantFor(c, 'project', projectId) : null;
  const cache = () => (grant ? sharedCache(c) : listCache(c, viewer));
  if (projectId) {
    // a project's entries are shown with the project: none at all unless the viewer may open it
    const pq = new Sql();
    const open = await prepQ(
      db,
      `SELECT 1 AS ok FROM projects pj WHERE pj.id = ${pq.p(projectId)} AND ${projectById(pq, viewer, 'pj', grant)}`,
      pq
    ).first();
    if (!open) {
      cache();
      return c.json({ entries: [], truncated: false } satisfies EntryListResponse);
    }
  }

  const q = new Sql();
  const cols = entryCols(q, viewer, grant);
  // Scoped lists show finished public entries plus all of the viewer's own; the unscoped list is everyone's public
  // ones. A project shows what the viewer could open by link, as a theme shows its unlisted photos.
  const where = [
    projectId
      ? entryById(q, viewer, 'e', grant)
      : ownerId || mine || poiId
        ? entryList(q, viewer)
        : `e.visibility = 'public' AND e.status = 'published'`
  ];
  if (mine) where.push(`e.owner_id = ${q.p(viewer)}`);
  if (poiId) where.push(`e.poi_id = ${q.p(poiId)}`);
  if (ownerId) where.push(`e.owner_id = ${q.p(ownerId)}`);
  if (projectId) where.push(`EXISTS (SELECT 1 FROM entry_projects ep WHERE ep.entry_id = e.id AND ep.project_id = ${q.p(projectId)})`);
  if (range.from) where.push(`e.occurred_at >= ${q.p(range.from)}`);
  if (range.until) where.push(`e.occurred_at < ${q.p(range.until)}`);
  const res = await prepQ(
    db,
    // Latest first. A day-only time ('2026-11-16') sorts after the timed entries of that day; ties by insertion order.
    `SELECT ${cols} FROM ${ENTRY_FROM} WHERE ${where.join(' AND ')}
     ORDER BY e.occurred_at DESC, e.rowid DESC LIMIT ${ENTRY_LIST_LIMIT + 1}`,
    q
  ).all<EntryRow>();
  const { rows, truncated } = capped(res.results, ENTRY_LIST_LIMIT);

  cache();
  return c.json({ entries: rows.map(toEntrySummary), truncated } satisfies EntryListResponse);
});

entries.get('/:id', async (c) => {
  const id = paramId(c);
  const grant = await grantFor(c, 'entry', id);
  const detail = await loadEntryDetail(c.env.DB, id, await viewerId(c), grant);
  if (!detail) throw notFound('记录不存在，或你没有权限查看');
  if (grant) sharedCache(c);
  return c.json(detail);
});

// ---- writing ------------------------------------------------------------------------------------------------------

/** The entry's photos as one statement, positions in array order from 0; with `replace`, the old ones go first. */
function writeMedia(db: D1Database, entryId: string, media: MediaField[], replace = false): D1PreparedStatement[] {
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

function writeProjects(db: D1Database, entryId: string, projectIds: string[], replace = false): D1PreparedStatement[] {
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

/** Any existing place will do, as for a photo (400 otherwise). */
async function assertPlace(db: D1Database, poiId: string): Promise<void> {
  if (!(await db.prepare('SELECT 1 AS ok FROM pois WHERE id = ?1').bind(poiId).first())) throw invalid('所选地点不存在');
}

function writeTags(db: D1Database, entryId: string, tagIds: string[], replace = false): D1PreparedStatement[] {
  const out = replace ? [prep(db, 'DELETE FROM entry_tags WHERE entry_id = ?1', entryId)] : [];
  if (tagIds.length) {
    out.push(
      prep(db, 'INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT ?1, value FROM json_each(?2)', entryId, JSON.stringify(tagIds))
    );
  }
  return out;
}

entries.post('/', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const f = parseEntryFields(await readJson(c, MAX_BODY_BYTES), true);
  const media = f.media ?? [];
  assertNotEmpty(f.title, f.body, media.length);
  await assertOwnPhotos(
    db,
    user.id,
    media.map((m) => m.photoId)
  );
  // like a photo's: presets and the author's own tags; others are dropped
  const tagIds = f.tagIds ? await usableTagIds(db, user.id, f.tagIds) : [];
  // the author's own projects; others (someone else's, deleted meanwhile) are dropped
  const projectIds = f.projectIds ? await usableProjectIds(db, user.id, f.projectIds) : [];
  if (f.poiId) await assertPlace(db, f.poiId);

  const id = newId.entry();
  const now = nowIso();
  await db.batch([
    prepInsert(db, 'entries', {
      id,
      owner_id: user.id,
      type: f.type ?? 'note',
      title: f.title ?? null,
      body: f.body ?? null,
      occurred_at: f.occurredAt,
      // private unless the author chooses otherwise
      visibility: f.visibility ?? 'private',
      status: f.status ?? 'published',
      poi_id: f.poiId ?? null,
      revision: 1,
      created_at: now,
      updated_at: now
    }),
    ...writeMedia(db, id, media),
    ...writeTags(db, id, tagIds),
    ...writeProjects(db, id, projectIds)
  ]);
  return c.json({ entry: await loadEntryDetail(db, id, user.id) }, 201);
});

interface OwnedEntry {
  id: string;
  owner_id: string;
  visibility: Visibility;
  status: EntryStatus;
  title: string | null;
  body: string | null;
  revision: number;
}

/** The entry if the user wrote it; 404 for others' entries they cannot open, 403 for ones they can. */
async function ownedEntry(c: Ctx, user: SessionUser, id: string): Promise<OwnedEntry> {
  const row = await c.env.DB.prepare('SELECT id, owner_id, visibility, status, title, body, revision FROM entries WHERE id = ?1')
    .bind(id)
    .first<OwnedEntry>();
  if (!row) throw notFound('记录不存在');
  if (row.owner_id !== user.id) {
    if (row.visibility === 'private' || row.status !== 'published') throw notFound('记录不存在');
    throw forbidden('只能修改自己的记录');
  }
  return row;
}

entries.patch('/:id', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const row = await ownedEntry(c, user, paramId(c));
  const f = parseEntryFields(await readJson(c, MAX_BODY_BYTES), false);
  // An editor that started from an older revision would overwrite what was saved since (another tab, another device).
  if (f.revision !== undefined && f.revision !== row.revision) {
    throw conflict('这条记录在别的窗口或设备上改过了，先载入最新的内容', { revision: row.revision });
  }
  const mediaCount =
    f.media?.length ??
    (await db.prepare('SELECT COUNT(*) AS n FROM entry_media WHERE entry_id = ?1').bind(row.id).first<{ n: number }>())?.n ??
    0;
  assertNotEmpty('title' in f ? f.title : row.title, 'body' in f ? f.body : row.body, mediaCount);
  if (f.media) {
    await assertOwnPhotos(
      db,
      user.id,
      f.media.map((m) => m.photoId)
    );
  }
  const tagIds = f.tagIds ? await usableTagIds(db, user.id, f.tagIds) : undefined;
  const projectIds = f.projectIds ? await usableProjectIds(db, user.id, f.projectIds) : undefined;
  if (f.poiId) await assertPlace(db, f.poiId);

  const q = new Sql();
  const sets: string[] = [];
  const set = (col: string, v: unknown) => sets.push(`${col} = ${q.p(v)}`);
  if (f.type) set('type', f.type);
  if ('title' in f) set('title', f.title ?? null);
  if ('body' in f) set('body', f.body ?? null);
  if (f.occurredAt) set('occurred_at', f.occurredAt);
  if (f.visibility) set('visibility', f.visibility);
  if (f.status) set('status', f.status);
  if ('poiId' in f) set('poi_id', f.poiId ?? null);

  const statements: D1PreparedStatement[] = [];
  if (sets.length || f.media || tagIds || projectIds) {
    set('updated_at', nowIso());
    statements.push(prepQ(db, `UPDATE entries SET ${sets.join(', ')}, revision = revision + 1 WHERE id = ${q.p(row.id)}`, q));
  }
  if (f.media) statements.push(...writeMedia(db, row.id, f.media, true));
  if (tagIds) statements.push(...writeTags(db, row.id, tagIds, true));
  if (projectIds) statements.push(...writeProjects(db, row.id, projectIds, true));
  if (statements.length) await db.batch(statements);
  return c.json({ entry: await loadEntryDetail(db, row.id, user.id) });
});

entries.delete('/:id', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const row = await ownedEntry(c, user, paramId(c));
  // the photos stay: an entry only points at them; the themes holding it lose that item and count as changed
  await db.batch([
    prep(db, 'UPDATE themes SET updated_at = ?1 WHERE id IN (SELECT theme_id FROM theme_items WHERE entry_id = ?2)', nowIso(), row.id),
    prep(db, 'DELETE FROM theme_items WHERE entry_id = ?1', row.id),
    prep(db, 'DELETE FROM entry_media WHERE entry_id = ?1', row.id),
    prep(db, 'DELETE FROM entry_tags WHERE entry_id = ?1', row.id),
    prep(db, 'DELETE FROM entry_projects WHERE entry_id = ?1', row.id),
    prep(db, 'DELETE FROM share_links WHERE entry_id = ?1', row.id),
    prep(db, 'DELETE FROM entries WHERE id = ?1', row.id)
  ]);
  return c.json({ ok: true });
});
