import { Hono } from 'hono';
import type { Poi, ThemeDetail, ThemeItem, ThemeKind, ThemeSummary, Visibility } from '../../shared/types';
import type { AppEnv } from '../env';
import { forbidden, invalid, listCache, notFound, paramId, readJson, unauthenticated, type Ctx } from '../lib/http';
import { newId } from '../lib/ids';
import { VISIBILITIES } from '../lib/photoInput';
import { summariesByIds } from '../lib/photos';
import { poiCols, toPoi, type PoiRow } from '../lib/poi';
import { requireUser, viewerId } from '../lib/session';
import { nowIso, prep, prepQ, Sql } from '../lib/sql';
import { has, isDate, isPlainObject, optDate, optEnum, optText, reqStr, strArray, type Body } from '../lib/validate';
import { photoById, photoLocation, themeList } from '../lib/visibility';
import type { SessionUser } from '../../shared/types';

export const themes = new Hono<AppEnv>({ strict: false });

const KINDS = ['trip', 'topic'] as const;
const MAX_ITEMS = 1000;
const LIST_LIMIT = 500;

interface ThemeRow {
  id: string;
  owner_id: string;
  owner_handle: string;
  kind: ThemeKind;
  title: string;
  subtitle: string | null;
  intro: string | null;
  cover_photo_id: string | null;
  start_date: string | null;
  end_date: string | null;
  visibility: Visibility;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  photo_count: number;
  cover_id: string | null;
  first_id: string | null;
}

// ---- reading ----------------------------------------------------------------------------------------------------

/** Theme summaries matching `where` (already bound on `q`). Counts and covers only involve photos `viewer` can open. */
async function selectThemes(
  db: D1Database,
  viewer: string | null,
  q: Sql,
  where: string,
  limit = LIST_LIMIT
): Promise<{ row: ThemeRow; summary: ThemeSummary }[]> {
  const vis = photoById(q, viewer, 'p');
  const res = await prepQ(
    db,
    `SELECT th.id, th.owner_id, u.handle AS owner_handle, th.kind, th.title, th.subtitle, th.intro, th.cover_photo_id, th.start_date,
        th.end_date, th.visibility, th.created_at, th.updated_at, th.published_at,
        (SELECT COUNT(*) FROM theme_items ti JOIN photos p ON p.id = ti.photo_id WHERE ti.theme_id = th.id AND ${vis}) AS photo_count,
        (SELECT p.id FROM photos p WHERE p.id = th.cover_photo_id AND ${vis}) AS cover_id,
        (SELECT p.id FROM theme_items ti JOIN photos p ON p.id = ti.photo_id WHERE ti.theme_id = th.id AND ${vis}
           ORDER BY ti.position LIMIT 1) AS first_id
     FROM themes th JOIN users u ON u.id = th.owner_id
     WHERE ${where} ORDER BY th.updated_at DESC, th.id DESC LIMIT ${limit}`,
    q
  ).all<ThemeRow>();

  // Cover = the chosen photo when the viewer can see it, else the first photo they can see.
  const covers = await summariesByIds(
    db,
    viewer,
    res.results.map((r) => r.cover_id ?? r.first_id).filter((x): x is string => Boolean(x))
  );
  return res.results.map((row) => {
    const cover = covers.get(row.cover_id ?? row.first_id ?? '');
    const summary: ThemeSummary = {
      id: row.id,
      ownerId: row.owner_id,
      ownerHandle: row.owner_handle,
      kind: row.kind,
      title: row.title,
      subtitle: row.subtitle,
      coverPhotoId: row.cover_id,
      cover: cover ? stripNote(cover) : null,
      startDate: row.start_date,
      endDate: row.end_date,
      visibility: row.visibility,
      photoCount: row.photo_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedAt: row.published_at
    };
    return { row, summary };
  });
}

function stripNote<T extends { note: string | null }>(p: T): Omit<T, 'note'> {
  const { note: _note, ...rest } = p;
  return rest;
}

interface ItemRow {
  id: string;
  kind: 'photo' | 'text' | 'day';
  photo_id: string | null;
  text: string | null;
  day: string | null;
}

/** Full theme for `viewer`, or null when missing or private and not theirs. */
export async function loadThemeDetail(db: D1Database, id: string, viewer: string | null): Promise<ThemeDetail | null> {
  const q = new Sql();
  const found = (await selectThemes(db, viewer, q, `th.id = ${q.p(id)}`, 1))[0];
  if (!found || (found.row.visibility === 'private' && found.row.owner_id !== viewer)) return null;

  const qp = new Sql();
  const poiVis = photoById(qp, viewer, 'p');
  const poiLoc = photoLocation(qp, viewer, 'p');
  const [itemsRes, poisRes] = await Promise.all([
    db.prepare('SELECT id, kind, photo_id, text, day FROM theme_items WHERE theme_id = ?1 ORDER BY position, id').bind(id).all<ItemRow>(),
    prepQ(
      db,
      `SELECT ${poiCols('po')}, MIN(ti.position) AS pos FROM theme_items ti
         JOIN photos p ON p.id = ti.photo_id JOIN pois po ON po.id = p.poi_id
       WHERE ti.theme_id = ${qp.p(id)} AND ${poiVis} AND ${poiLoc}
       GROUP BY po.id ORDER BY pos`,
      qp
    ).all<PoiRow>()
  ]);

  const photos = await summariesByIds(
    db,
    viewer,
    itemsRes.results.map((i) => i.photo_id).filter((x): x is string => Boolean(x)),
    true
  );
  const items: ThemeItem[] = itemsRes.results.map((i): ThemeItem => {
    if (i.kind === 'photo')
      return { id: i.id, kind: 'photo', photoId: i.photo_id as string, text: i.text, photo: photos.get(i.photo_id as string) ?? null };
    if (i.kind === 'day') return { id: i.id, kind: 'day', day: i.day ?? '', text: i.text };
    return { id: i.id, kind: 'text', text: i.text ?? '' };
  });
  const pois: Poi[] = poisRes.results.map((r) => toPoi(r));
  return { ...found.summary, intro: found.row.intro, items, pois };
}

themes.get('/', async (c) => {
  const viewer = await viewerId(c);
  const db = c.env.DB;
  const ownerHandle = c.req.query('owner');
  const mine = ['1', 'true'].includes(c.req.query('mine') ?? '');
  if (mine && !viewer) throw unauthenticated();

  const q = new Sql();
  const where: string[] = [ownerHandle || mine ? themeList(q, viewer) : `th.visibility = 'public'`];
  if (mine) where.push(`th.owner_id = ${q.p(viewer)}`);
  if (ownerHandle) {
    const u = await db.prepare('SELECT id FROM users WHERE handle = ?1').bind(ownerHandle).first<{ id: string }>();
    if (!u) {
      listCache(c, viewer);
      return c.json({ themes: [] });
    }
    where.push(`th.owner_id = ${q.p(u.id)}`);
  }
  const list = await selectThemes(db, viewer, q, where.join(' AND '));
  listCache(c, viewer);
  return c.json({ themes: list.map((t) => t.summary) });
});

themes.get('/:id', async (c) => {
  const detail = await loadThemeDetail(c.env.DB, paramId(c), await viewerId(c));
  if (!detail) throw notFound('主题不存在，或你没有权限查看');
  return c.json(detail);
});

// ---- writing ----------------------------------------------------------------------------------------------------

interface ThemeFields {
  kind?: ThemeKind;
  title?: string;
  subtitle?: string | null;
  intro?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  visibility?: Visibility;
  coverPhotoId?: string | null;
  photoIds?: string[];
}

function parseThemeFields(body: Body, create: boolean): ThemeFields {
  const f: ThemeFields = {};
  const kind = optEnum<ThemeKind>(body.kind, '主题类型', KINDS);
  if (create && !kind) throw invalid('请选择主题类型：trip（旅程）或 topic（专题）');
  if (kind) f.kind = kind;
  if (create || has(body, 'title')) f.title = reqStr(body, 'title', '标题', 1, 100);
  if (has(body, 'subtitle')) f.subtitle = optText(body.subtitle, '副标题', 200);
  if (has(body, 'intro')) f.intro = optText(body.intro, '导语', 20000);
  if (has(body, 'startDate')) f.startDate = optDate(body.startDate, '开始日期');
  if (has(body, 'endDate')) f.endDate = optDate(body.endDate, '结束日期');
  if (f.startDate && f.endDate && f.startDate > f.endDate) throw invalid('开始日期不能晚于结束日期');
  const visibility = optEnum<Visibility>(body.visibility, '公开范围', VISIBILITIES);
  if (visibility) f.visibility = visibility;
  if (has(body, 'coverPhotoId')) {
    if (body.coverPhotoId !== null && typeof body.coverPhotoId !== 'string') throw invalid('封面需要是照片 id 或 null');
    f.coverPhotoId = body.coverPhotoId as string | null;
  }
  if (create && has(body, 'photoIds')) {
    if (!Array.isArray(body.photoIds)) throw invalid('photoIds 需要是数组');
    f.photoIds = strArray(body.photoIds, '照片', MAX_ITEMS);
  }
  return f;
}

interface PhotoInfo {
  id: string;
  taken_at: string | null;
}

/** The given photos, all of which must belong to `ownerId` (400 otherwise). */
async function ownPhotos(db: D1Database, ownerId: string, ids: string[]): Promise<Map<string, PhotoInfo>> {
  const out = new Map<string, PhotoInfo>();
  if (!ids.length) return out;
  const res = await db
    .prepare('SELECT id, taken_at FROM photos WHERE owner_id = ?1 AND id IN (SELECT value FROM json_each(?2))')
    .bind(ownerId, JSON.stringify(ids))
    .all<PhotoInfo>();
  for (const r of res.results) out.set(r.id, r);
  if (out.size !== new Set(ids).size) throw invalid('照片必须是你自己的照片');
  return out;
}

interface NewItem {
  kind: 'photo' | 'text' | 'day';
  photoId?: string | null;
  text?: string | null;
  day?: string | null;
}

/** One statement inserting all items; positions follow array order from 0. */
function insertItems(db: D1Database, themeId: string, items: NewItem[]): D1PreparedStatement {
  const rows = items.map((it, i) => ({
    id: newId.item(),
    pos: i,
    kind: it.kind,
    photoId: it.photoId ?? null,
    text: it.text ?? null,
    day: it.day ?? null
  }));
  return prep(
    db,
    `INSERT INTO theme_items (id, theme_id, position, kind, photo_id, text, day)
     SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.pos'), json_extract(value, '$.kind'),
            json_extract(value, '$.photoId'), json_extract(value, '$.text'), json_extract(value, '$.day')
     FROM json_each(?2)`,
    themeId,
    JSON.stringify(rows)
  );
}

/** Trip seeding: photos by capture time, with a `day` item before the first photo of each date. Undated photos go last. */
function seedTrip(ids: string[], info: Map<string, PhotoInfo>): { items: NewItem[]; first: string | null; last: string | null } {
  const dated = ids.filter((id) => info.get(id)?.taken_at);
  const undated = ids.filter((id) => !info.get(id)?.taken_at);
  dated.sort((a, b) => (info.get(a)!.taken_at as string).localeCompare(info.get(b)!.taken_at as string));
  const items: NewItem[] = [];
  let currentDay = '';
  for (const id of dated) {
    const day = (info.get(id)!.taken_at as string).slice(0, 10);
    if (day !== currentDay) {
      items.push({ kind: 'day', day });
      currentDay = day;
    }
    items.push({ kind: 'photo', photoId: id });
  }
  for (const id of undated) items.push({ kind: 'photo', photoId: id });
  return {
    items,
    first: dated.length ? (info.get(dated[0])!.taken_at as string).slice(0, 10) : null,
    last: dated.length ? (info.get(dated[dated.length - 1])!.taken_at as string).slice(0, 10) : null
  };
}

themes.post('/', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const f = parseThemeFields(await readJson(c, 512 * 1024), true);
  const kind = f.kind as ThemeKind;
  const photoIds = f.photoIds ?? [];
  const info = await ownPhotos(db, user.id, photoIds);
  if (f.coverPhotoId) await ownPhotos(db, user.id, [f.coverPhotoId]);

  let items: NewItem[];
  let startDate = f.startDate ?? null;
  let endDate = f.endDate ?? null;
  if (kind === 'trip' && photoIds.length) {
    const seeded = seedTrip(photoIds, info);
    items = seeded.items;
    startDate = startDate ?? seeded.first;
    endDate = endDate ?? seeded.last;
  } else {
    items = photoIds.map((photoId) => ({ kind: 'photo' as const, photoId }));
  }

  const id = newId.theme();
  const now = nowIso();
  const visibility = f.visibility ?? 'private';
  const statements = [
    prep(
      db,
      `INSERT INTO themes (id, owner_id, kind, title, subtitle, intro, cover_photo_id, start_date, end_date, visibility, created_at, updated_at, published_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12)`,
      id,
      user.id,
      kind,
      f.title,
      f.subtitle ?? null,
      f.intro ?? null,
      f.coverPhotoId ?? null,
      startDate,
      endDate,
      visibility,
      now,
      visibility === 'public' ? now : null
    )
  ];
  if (items.length) statements.push(insertItems(db, id, items));
  await db.batch(statements);
  return c.json({ theme: await loadThemeDetail(db, id, user.id) }, 201);
});

interface OwnedTheme {
  id: string;
  owner_id: string;
  visibility: Visibility;
  published_at: string | null;
}

async function ownedTheme(c: Ctx, user: SessionUser, id: string): Promise<OwnedTheme> {
  const row = await c.env.DB.prepare('SELECT id, owner_id, visibility, published_at FROM themes WHERE id = ?1')
    .bind(id)
    .first<OwnedTheme>();
  if (!row) throw notFound('主题不存在');
  if (row.owner_id !== user.id) {
    if (row.visibility === 'private') throw notFound('主题不存在');
    throw forbidden('只能修改自己的主题');
  }
  return row;
}

themes.patch('/:id', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const row = await ownedTheme(c, user, paramId(c));
  const f = parseThemeFields(await readJson(c), false);
  if (f.coverPhotoId) await ownPhotos(db, user.id, [f.coverPhotoId]);

  const q = new Sql();
  const sets: string[] = [];
  const set = (col: string, v: unknown) => sets.push(`${col} = ${q.p(v)}`);
  if (f.kind) set('kind', f.kind);
  if (f.title !== undefined) set('title', f.title);
  if ('subtitle' in f) set('subtitle', f.subtitle ?? null);
  if ('intro' in f) set('intro', f.intro ?? null);
  if ('startDate' in f) set('start_date', f.startDate ?? null);
  if ('endDate' in f) set('end_date', f.endDate ?? null);
  if ('coverPhotoId' in f) set('cover_photo_id', f.coverPhotoId ?? null);
  if (f.visibility) {
    set('visibility', f.visibility);
    // The first time a theme goes public is its publication date; it stays through later changes.
    if (f.visibility === 'public' && !row.published_at) set('published_at', nowIso());
  }
  const now = nowIso();
  set('updated_at', now);
  await prepQ(db, `UPDATE themes SET ${sets.join(', ')} WHERE id = ${q.p(row.id)}`, q).run();
  return c.json({ theme: await loadThemeDetail(db, row.id, user.id) });
});

themes.put('/:id/items', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const row = await ownedTheme(c, user, paramId(c));
  const body = await readJson(c, 1024 * 1024);
  if (!Array.isArray(body.items)) throw invalid('items 需要是数组');
  if (body.items.length > MAX_ITEMS) throw invalid(`一个主题最多 ${MAX_ITEMS} 个条目`);

  const items: NewItem[] = [];
  const photoIds: string[] = [];
  body.items.forEach((raw: unknown, i: number) => {
    const at = `第 ${i + 1} 个条目`;
    if (!isPlainObject(raw)) throw invalid(`${at}格式不对`);
    if (raw.kind === 'photo') {
      if (typeof raw.photoId !== 'string' || !raw.photoId) throw invalid(`${at}缺少 photoId`);
      photoIds.push(raw.photoId);
      items.push({ kind: 'photo', photoId: raw.photoId, text: optText(raw.text, `${at}的说明`, 5000) });
    } else if (raw.kind === 'text') {
      const text = optText(raw.text, `${at}的文字`, 20000);
      if (!text) throw invalid(`${at}的文字不能为空`);
      items.push({ kind: 'text', text });
    } else if (raw.kind === 'day') {
      if (typeof raw.day !== 'string' || !isDate(raw.day)) throw invalid(`${at}的日期格式应为 YYYY-MM-DD`);
      items.push({ kind: 'day', day: raw.day, text: optText(raw.text, `${at}的说明`, 5000) });
    } else {
      throw invalid(`${at}的类型需要是 photo、text 或 day`);
    }
  });
  await ownPhotos(db, row.owner_id, photoIds); // photos must belong to the theme's owner

  const statements = [prep(db, 'DELETE FROM theme_items WHERE theme_id = ?1', row.id)];
  if (items.length) statements.push(insertItems(db, row.id, items));
  statements.push(prep(db, 'UPDATE themes SET updated_at = ?1 WHERE id = ?2', nowIso(), row.id));
  await db.batch(statements);
  return c.json({ theme: await loadThemeDetail(db, row.id, user.id) });
});

themes.delete('/:id', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const row = await ownedTheme(c, user, paramId(c));
  await db.batch([prep(db, 'DELETE FROM theme_items WHERE theme_id = ?1', row.id), prep(db, 'DELETE FROM themes WHERE id = ?1', row.id)]);
  return c.json({ ok: true });
});
