// Entries (记录): the core of the archive. A text, a time and, if wanted, photos, tags and a type; private unless the
// author says otherwise. Contract: /docs/api/entries.md

import { Hono } from 'hono';
import { ENTRY_LIST_LIMIT, type EntryListResponse, type EntryStatus, type SessionUser, type Visibility } from '../../shared/types';
import type { AppEnv } from '../env';
import { assertOwnPhotos, ENTRY_FROM, entryCols, loadEntryDetail, toEntrySummary, type EntryRow } from '../lib/entries';
import { assertNotEmpty, parseEntryFields, type MediaField } from '../lib/entryInput';
import { conflict, forbidden, listCache, notFound, paramId, readJson, unauthenticated, type Ctx } from '../lib/http';
import { newId } from '../lib/ids';
import { requireUser, viewerId } from '../lib/session';
import { capped, nowIso, prep, prepInsert, prepQ, Sql } from '../lib/sql';
import { usableTagIds } from '../lib/tags';
import { entryList } from '../lib/visibility';

export const entries = new Hono<AppEnv>({ strict: false });

/** A long article in a script of three bytes a character, captions on many photos, and JSON escapes. */
const MAX_BODY_BYTES = 1024 * 1024;

// ---- reading ------------------------------------------------------------------------------------------------------

entries.get('/', async (c) => {
  const viewer = await viewerId(c);
  const db = c.env.DB;
  const ownerHandle = c.req.query('owner');
  const mine = ['1', 'true'].includes(c.req.query('mine') ?? '');
  if (mine && !viewer) throw unauthenticated();

  let ownerId: string | null = null;
  if (ownerHandle) {
    const u = await db.prepare('SELECT id FROM users WHERE handle = ?1').bind(ownerHandle).first<{ id: string }>();
    if (!u) {
      listCache(c, viewer);
      return c.json({ entries: [], truncated: false } satisfies EntryListResponse);
    }
    ownerId = u.id;
  }

  const q = new Sql();
  const cols = entryCols(q, viewer);
  // scoped lists show finished public entries plus all of the viewer's own; the unscoped list is everyone's public ones
  const where = [ownerId || mine ? entryList(q, viewer) : `e.visibility = 'public' AND e.status = 'published'`];
  if (mine) where.push(`e.owner_id = ${q.p(viewer)}`);
  if (ownerId) where.push(`e.owner_id = ${q.p(ownerId)}`);
  const res = await prepQ(
    db,
    // Latest first. A day-only time ('2026-11-16') sorts after the timed entries of that day; ties by insertion order.
    `SELECT ${cols} FROM ${ENTRY_FROM} WHERE ${where.join(' AND ')}
     ORDER BY e.occurred_at DESC, e.rowid DESC LIMIT ${ENTRY_LIST_LIMIT + 1}`,
    q
  ).all<EntryRow>();
  const { rows, truncated } = capped(res.results, ENTRY_LIST_LIMIT);

  listCache(c, viewer);
  return c.json({ entries: rows.map(toEntrySummary), truncated } satisfies EntryListResponse);
});

entries.get('/:id', async (c) => {
  const detail = await loadEntryDetail(c.env.DB, paramId(c), await viewerId(c));
  if (!detail) throw notFound('记录不存在，或你没有权限查看');
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
      revision: 1,
      created_at: now,
      updated_at: now
    }),
    ...writeMedia(db, id, media),
    ...writeTags(db, id, tagIds)
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

  const q = new Sql();
  const sets: string[] = [];
  const set = (col: string, v: unknown) => sets.push(`${col} = ${q.p(v)}`);
  if (f.type) set('type', f.type);
  if ('title' in f) set('title', f.title ?? null);
  if ('body' in f) set('body', f.body ?? null);
  if (f.occurredAt) set('occurred_at', f.occurredAt);
  if (f.visibility) set('visibility', f.visibility);
  if (f.status) set('status', f.status);

  const statements: D1PreparedStatement[] = [];
  if (sets.length || f.media || tagIds) {
    set('updated_at', nowIso());
    statements.push(prepQ(db, `UPDATE entries SET ${sets.join(', ')}, revision = revision + 1 WHERE id = ${q.p(row.id)}`, q));
  }
  if (f.media) statements.push(...writeMedia(db, row.id, f.media, true));
  if (tagIds) statements.push(...writeTags(db, row.id, tagIds, true));
  if (statements.length) await db.batch(statements);
  return c.json({ entry: await loadEntryDetail(db, row.id, user.id) });
});

entries.delete('/:id', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const row = await ownedEntry(c, user, paramId(c));
  // the photos stay: an entry only points at them
  await db.batch([
    prep(db, 'DELETE FROM entry_media WHERE entry_id = ?1', row.id),
    prep(db, 'DELETE FROM entry_tags WHERE entry_id = ?1', row.id),
    prep(db, 'DELETE FROM entries WHERE id = ?1', row.id)
  ]);
  return c.json({ ok: true });
});
