import { Hono } from 'hono';
import { PHOTO_LIMITS } from '../../shared/limits';
import { distance } from '../../shared/geo';
import {
  PHOTO_LIST_LIMIT,
  type GeoPrivacy,
  type PhotoListResponse,
  type PoiMethod,
  type Variants,
  type Visibility
} from '../../shared/types';
import type { AppEnv } from '../env';
import { forbidden, invalid, listCache, notFound, paramId, readJson, unauthenticated, type Ctx } from '../lib/http';
import { newId } from '../lib/ids';
import { purgeVariantCache } from '../lib/mediaCache';
import { GEO_PRIVACIES, POI_METHODS, VISIBILITIES } from '../lib/photoInput';
import { loadPhotoDetail, loadPhotoRow, PHOTO_FROM, SUMMARY_COLS, toSummary, type PhotoRow } from '../lib/photos';
import { findOrCreatePoi, getPoiRow, parseNewPoi, type PoiRow } from '../lib/poi';
import { requireUser, viewerId } from '../lib/session';
import { capped, nowIso, parseJson, prep, prepQ, Sql } from '../lib/sql';
import { usableTagIds } from '../lib/tags';
import { readUploadForm, resolveUpload, savePhoto, storeFiles, uploadFiles, type Upload } from '../lib/upload';
import { has, optBool, optEnum, optFocus, optTakenAt, optText, strArray } from '../lib/validate';
import { photoById, photoList, photoLocation } from '../lib/visibility';
import type { SessionUser } from '../../shared/types';

export const photos = new Hono<AppEnv>({ strict: false });

const IDS_LIMIT = 200;
const round1 = (n: number) => Math.round(n * 10) / 10;

// ---- list -----------------------------------------------------------------------------------------------------

photos.get('/', async (c) => {
  const viewer = await viewerId(c);
  const db = c.env.DB;
  const ownerHandle = c.req.query('owner');
  const poi = c.req.query('poi');
  const idsParam = c.req.query('ids');
  const wantMine = ['1', 'true'].includes(c.req.query('mine') ?? '');
  if (wantMine && !viewer) throw unauthenticated();

  let ids: string[] | null = null;
  if (idsParam !== undefined) {
    ids = [
      ...new Set(
        idsParam
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      )
    ];
    if (ids.length > IDS_LIMIT) throw invalid(`一次最多指定 ${IDS_LIMIT} 张照片`);
  }

  let ownerId: string | null = null;
  if (ownerHandle) {
    const u = await db.prepare('SELECT id FROM users WHERE handle = ?1').bind(ownerHandle).first<{ id: string }>();
    if (!u) {
      listCache(c, viewer);
      return c.json({ photos: [], truncated: false } satisfies PhotoListResponse);
    }
    ownerId = u.id;
  }

  const q = new Sql();
  // Who may see what: explicit ids open by link (public + unlisted); scoped lists show public plus the viewer's own;
  // the unscoped list is the public gallery.
  const where: string[] = [ids ? photoById(q, viewer) : ownerId || wantMine || poi ? photoList(q, viewer) : `p.visibility = 'public'`];
  if (wantMine) where.push(`p.owner_id = ${q.p(viewer)}`);
  if (ownerId) where.push(`p.owner_id = ${q.p(ownerId)}`);
  if (poi) where.push(`p.poi_id = ${q.p(poi)}`, photoLocation(q, viewer));
  if (ids) where.push(`p.id IN (SELECT value FROM json_each(${q.p(JSON.stringify(ids))}))`);

  const res = await prepQ(
    db,
    // Newest capture first; photos without a capture time (NULL sorts last when descending) fall back to upload order.
    // rowid is insertion order, so ties follow upload time and the (visibility|owner_id, taken_at) indexes serve the
    // ordering without a sort, stopping at the limit. One row past the limit tells that the list was cut short.
    `SELECT ${SUMMARY_COLS} FROM ${PHOTO_FROM} WHERE ${where.join(' AND ')}
     ORDER BY p.taken_at DESC, p.rowid DESC LIMIT ${PHOTO_LIST_LIMIT + 1}`,
    q
  ).all<PhotoRow>();
  const { rows, truncated } = capped(res.results, PHOTO_LIST_LIMIT);

  listCache(c, viewer);
  return c.json({ photos: rows.map((r) => toSummary(r, viewer)), truncated } satisfies PhotoListResponse);
});

// ---- detail ---------------------------------------------------------------------------------------------------

photos.get('/:id', async (c) => {
  const detail = await loadPhotoDetail(c.env.DB, paramId(c), await viewerId(c));
  if (!detail) throw notFound('照片不存在，或你没有权限查看');
  return c.json(detail);
});

// ---- upload ---------------------------------------------------------------------------------------------------

photos.post('/', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const form = await readUploadForm(c.req.raw);
  const refs = await resolveUpload(db, user.id, form.meta);
  const photoId = newId.photo();
  const upload: Upload = { photoId, ownerId: user.id, form, refs, files: uploadFiles(user.id, photoId, form) };
  // R2 first: if storage fails nothing is written to D1; if D1 fails the files are deleted again.
  await storeFiles(c.env.MEDIA, upload);
  await savePhoto(db, c.env.MEDIA, upload);
  const photo = await loadPhotoDetail(db, photoId, user.id);
  return c.json({ photo }, 201);
});

// ---- update ---------------------------------------------------------------------------------------------------

/** The photo row if the user owns it; 404 for others' private photos, 403 for others' visible ones. */
async function ownedPhoto(c: Ctx, user: SessionUser, id: string): Promise<PhotoRow> {
  const row = await loadPhotoRow(c.env.DB, id);
  if (!row) throw notFound('照片不存在');
  if (row.owner_id !== user.id) {
    if (row.visibility === 'private') throw notFound('照片不存在');
    throw forbidden('只能修改自己的照片');
  }
  return row;
}

photos.patch('/:id', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const row = await ownedPhoto(c, user, paramId(c));
  const body = await readJson(c);

  const q = new Sql();
  const sets: string[] = [];
  const set = (col: string, v: unknown) => sets.push(`${col} = ${q.p(v)}`);

  if (has(body, 'title')) set('title', optText(body.title, '标题', PHOTO_LIMITS.titleMax));
  if (has(body, 'note')) set('note', optText(body.note, '笔记', PHOTO_LIMITS.noteMax));
  if (has(body, 'takenAt')) set('taken_at', optTakenAt(body.takenAt));
  const geoPrivacy = optEnum<GeoPrivacy>(body.geoPrivacy, '位置精度', GEO_PRIVACIES);
  if (geoPrivacy) set('geo_privacy', geoPrivacy);
  const visibility = optEnum<Visibility>(body.visibility, '公开范围', VISIBILITIES);
  if (visibility) set('visibility', visibility);
  const inLiving = optBool(body.inLiving, 'inLiving');
  if (inLiving !== undefined) set('in_living', inLiving);
  const favorite = optBool(body.favorite, 'favorite');
  if (favorite !== undefined) set('favorite', favorite);
  if (has(body, 'focus')) {
    const f = optFocus(body.focus);
    set('focus_x', f?.[0] ?? null);
    set('focus_y', f?.[1] ?? null);
  }

  // Place: `poiId` (existing) wins over `newPoi`; `poiId: null` alone clears it.
  const method = body.poiMethod === null ? undefined : optEnum<PoiMethod>(body.poiMethod, '地点匹配方式', POI_METHODS);
  let poi: PoiRow | null | undefined;
  if (typeof body.poiId === 'string') {
    poi = await getPoiRow(db, body.poiId);
    if (!poi) throw invalid('所选地点不存在');
  } else if (has(body, 'newPoi') && body.newPoi !== null) {
    poi = await findOrCreatePoi(db, parseNewPoi(body.newPoi), user.id);
  } else if (body.poiId === null) {
    poi = null;
  } else if (has(body, 'poiId')) {
    throw invalid('poiId 需要是地点 id 或 null');
  }
  if (poi === null) {
    set('poi_id', null);
    set('poi_distance', null);
    set('poi_method', null);
  } else if (poi) {
    const d = row.lat !== null && row.lng !== null ? round1(distance(row.lat, row.lng, poi.lat, poi.lng)) : null;
    set('poi_id', poi.id);
    set('poi_distance', d);
    set('poi_method', method ?? 'manual');
  } else if (method && row.poi_id) {
    set('poi_method', method);
  }

  let tagIds: string[] | undefined;
  if (has(body, 'tagIds')) {
    if (!Array.isArray(body.tagIds)) throw invalid('标签需要是数组');
    tagIds = await usableTagIds(db, user.id, strArray(body.tagIds, '标签', PHOTO_LIMITS.tagCount));
  }

  const statements: D1PreparedStatement[] = [];
  if (sets.length || tagIds !== undefined) {
    set('updated_at', nowIso());
    statements.push(prepQ(db, `UPDATE photos SET ${sets.join(', ')} WHERE id = ${q.p(row.id)}`, q));
  }
  if (tagIds !== undefined) {
    statements.push(prep(db, 'DELETE FROM photo_tags WHERE photo_id = ?1', row.id));
    if (tagIds.length) {
      statements.push(
        prep(
          db,
          `INSERT OR IGNORE INTO photo_tags (photo_id, tag_id, source) SELECT ?1, value, 'manual' FROM json_each(?2)`,
          row.id,
          JSON.stringify(tagIds)
        )
      );
    }
  }
  if (statements.length) await db.batch(statements);

  // Going private: drop the edge copies we can reach right away.
  if (visibility === 'private' && row.visibility !== 'private') {
    await purgeVariantCache(new URL(c.req.url).origin, parseJson<Variants>(row.variants));
  }
  return c.json({ photo: await loadPhotoDetail(db, row.id, user.id) });
});

// ---- delete ---------------------------------------------------------------------------------------------------

photos.delete('/:id', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const row = await ownedPhoto(c, user, paramId(c));
  const variants = parseJson<Variants>(row.variants);
  const keys = [row.file_key, ...(variants ? Object.values(variants).map((v) => v.key) : [])].filter((k): k is string => Boolean(k));
  const now = nowIso();

  // Rows first: once they are gone the files are unreachable, so a failed R2 delete only leaks storage.
  await db.batch([
    prep(db, 'UPDATE themes SET updated_at = ?1 WHERE id IN (SELECT theme_id FROM theme_items WHERE photo_id = ?2)', now, row.id),
    prep(db, 'UPDATE themes SET cover_photo_id = NULL WHERE cover_photo_id = ?1', row.id),
    prep(db, 'UPDATE users SET avatar_photo_id = NULL WHERE avatar_photo_id = ?1', row.id),
    prep(db, 'DELETE FROM theme_items WHERE photo_id = ?1', row.id),
    prep(db, 'DELETE FROM photo_tags WHERE photo_id = ?1', row.id),
    prep(db, 'DELETE FROM photos WHERE id = ?1', row.id)
  ]);
  try {
    await c.env.MEDIA.delete(keys);
  } catch (e) {
    console.error('delete: R2 delete failed', row.id, e instanceof Error ? e.message : e);
  }
  await purgeVariantCache(new URL(c.req.url).origin, variants);
  return c.json({ ok: true });
});
