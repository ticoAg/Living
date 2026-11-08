import { Hono } from 'hono';
import { distance } from '../../shared/geo';
import type { GeoPrivacy, PoiMethod, Variants, Visibility } from '../../shared/types';
import type { AppEnv } from '../env';
import {
  duplicate,
  forbidden,
  invalid,
  listCache,
  notFound,
  paramId,
  readJson,
  tooLarge,
  unauthenticated,
  upstream,
  type Ctx
} from '../lib/http';
import { newId } from '../lib/ids';
import { purgeVariantCache } from '../lib/mediaCache';
import {
  GEO_PRIVACIES,
  isFile,
  MAX_ORIGINAL_BYTES,
  MAX_REQUEST_BYTES,
  MAX_VARIANT_BYTES,
  originalKind,
  parseCreateMeta,
  POI_METHODS,
  variantKind,
  VISIBILITIES
} from '../lib/photoInput';
import { loadPhotoDetail, loadPhotoRow, PHOTO_FROM, SUMMARY_COLS, toSummary, type PhotoRow } from '../lib/photos';
import { findOrCreatePoi, getPoiRow, parseNewPoi, type PoiRow } from '../lib/poi';
import { zoneAt } from '../lib/privacy';
import { requireUser, viewerId } from '../lib/session';
import { isUniqueViolation, nowIso, parseJson, prep, prepQ, Sql } from '../lib/sql';
import { usableTagIds } from '../lib/tags';
import { has, optBool, optEnum, optFocus, optTakenAt, optText, strArray } from '../lib/validate';
import { photoById, photoList, photoLocation } from '../lib/visibility';
import type { SessionUser } from '../../shared/types';

export const photos = new Hono<AppEnv>({ strict: false });

const LIST_LIMIT = 5000;
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
      return c.json({ photos: [] });
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
    // ordering without a sort, stopping at the limit.
    `SELECT ${SUMMARY_COLS} FROM ${PHOTO_FROM} WHERE ${where.join(' AND ')}
     ORDER BY p.taken_at DESC, p.rowid DESC LIMIT ${LIST_LIMIT}`,
    q
  ).all<PhotoRow>();

  listCache(c, viewer);
  return c.json({ photos: res.results.map((r) => toSummary(r, viewer)) });
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

  if (Number(c.req.header('content-length') ?? 0) > MAX_REQUEST_BYTES) throw tooLarge('上传内容太大：原图不能超过 50 MB');
  if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('multipart/form-data'))
    throw invalid('上传需要使用 multipart/form-data');

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw invalid('无法解析上传内容，请重试');
  }

  // meta
  const metaPart = form.get('meta');
  const metaText = typeof metaPart === 'string' ? metaPart : isFile(metaPart) ? await metaPart.text() : null;
  if (metaText === null) throw invalid('缺少 meta（JSON）');
  if (metaText.length > 200_000) throw tooLarge('meta 太大');
  let metaJson: unknown;
  try {
    metaJson = JSON.parse(metaText);
  } catch {
    throw invalid('meta 不是有效的 JSON');
  }
  const meta = parseCreateMeta(metaJson);

  // files
  const original = form.get('original');
  if (!isFile(original) || original.size === 0) throw invalid('缺少原图（original）');
  if (original.size > MAX_ORIGINAL_BYTES) throw tooLarge('原图超过 50 MB，请先压缩或缩小后再上传');
  const originalType = originalKind(original);

  const sizes = ['s', 'm', 'l'] as const;
  const files = {} as Record<(typeof sizes)[number], File>;
  const kinds = {} as Record<(typeof sizes)[number], { ext: 'webp' | 'jpg'; type: string }>;
  for (const k of sizes) {
    const part = form.get(k);
    if (!isFile(part) || part.size === 0) throw invalid(`缺少尺寸图「${k}」`);
    if (part.size > MAX_VARIANT_BYTES) throw tooLarge(`尺寸图「${k}」太大`);
    files[k] = part;
    kinds[k] = await variantKind(part, `尺寸图「${k}」`);
  }

  // Same owner + same bytes → 409 with the existing photo.
  if (meta.sha256) {
    const dup = await db
      .prepare('SELECT id FROM photos WHERE owner_id = ?1 AND sha256 = ?2')
      .bind(user.id, meta.sha256)
      .first<{ id: string }>();
    if (dup) throw duplicate('这张照片已经上传过了', { photoId: dup.id });
  }

  // Everything that can be checked before touching storage.
  let poi: PoiRow | null = null;
  if (meta.poiId) {
    poi = await getPoiRow(db, meta.poiId);
    if (!poi) throw invalid('所选地点不存在');
  }
  let geoPrivacy: GeoPrivacy = meta.geoPrivacy;
  if (meta.lat !== null && meta.lng !== null && (await zoneAt(db, user.id, meta.lat, meta.lng))) geoPrivacy = 'hidden';
  const manualTags = await usableTagIds(db, user.id, meta.tagIds);
  const suggestedTags = (await usableTagIds(db, user.id, meta.suggestedTagIds)).filter((id) => !manualTags.includes(id));
  const themeIds = meta.themeIds.length
    ? (
        await db
          .prepare('SELECT id FROM themes WHERE owner_id = ?1 AND id IN (SELECT value FROM json_each(?2))')
          .bind(user.id, JSON.stringify(meta.themeIds))
          .all<{ id: string }>()
      ).results.map((r) => r.id)
    : [];

  const photoId = newId.photo();
  const originalKey = `o/${user.id}/${photoId}.${originalType.ext}`;
  const variants: Variants = {
    s: { key: `v/${photoId}/s.${kinds.s.ext}`, w: meta.sizes.s[0], h: meta.sizes.s[1] },
    m: { key: `v/${photoId}/m.${kinds.m.ext}`, w: meta.sizes.m[0], h: meta.sizes.m[1] },
    l: { key: `v/${photoId}/l.${kinds.l.ext}`, w: meta.sizes.l[0], h: meta.sizes.l[1] }
  };

  // R2 first: if storage fails nothing is written to D1.
  const objects: [string, Blob, string][] = [
    [originalKey, original, originalType.type],
    [variants.s.key, files.s, kinds.s.type],
    [variants.m.key, files.m, kinds.m.type],
    [variants.l.key, files.l, kinds.l.type]
  ];
  const keys = objects.map(([k]) => k);
  const stored = await Promise.allSettled(
    objects.map(([key, blob, contentType]) =>
      c.env.MEDIA.put(key, blob, { httpMetadata: { contentType }, customMetadata: { ownerId: user.id, photoId } })
    )
  );
  const failed = stored.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) {
    console.error('upload: R2 put failed', failed.reason instanceof Error ? failed.reason.message : failed.reason);
    await c.env.MEDIA.delete(keys).catch(() => {});
    throw upstream('图片存储暂时不可用，请稍后重试');
  }

  try {
    if (!poi && meta.newPoi) poi = await findOrCreatePoi(db, meta.newPoi, user.id);
    const hasPoint = meta.lat !== null && meta.lng !== null;
    // The server owns the distance whenever it can compute it.
    const poiDistance = poi
      ? hasPoint
        ? round1(distance(meta.lat as number, meta.lng as number, poi.lat, poi.lng))
        : meta.poiDistance
      : null;
    const poiMethod: PoiMethod | null = poi ? (meta.poiMethod ?? 'manual') : null;
    const now = nowIso();

    const statements = [
      prep(
        db,
        `INSERT INTO photos (id, owner_id, title, note, taken_at, tz, lat, lng, alt, heading, geo_privacy, city, district,
           poi_id, poi_distance, poi_method, camera, lens, focal, focal35, aperture, shutter, iso, width, height,
           file_key, file_type, file_size, variants, thumbhash, palette, focus_x, focus_y, visibility, in_living, favorite,
           sha256, uploaded_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23,
           ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38)`,
        photoId,
        user.id,
        meta.title,
        meta.note,
        meta.takenAt,
        meta.tz,
        meta.lat,
        meta.lng,
        meta.alt,
        meta.heading,
        geoPrivacy,
        meta.city,
        meta.district,
        poi?.id ?? null,
        poiDistance,
        poiMethod,
        meta.camera,
        meta.lens,
        meta.focal,
        meta.focal35,
        meta.aperture,
        meta.shutter,
        meta.iso,
        meta.width,
        meta.height,
        originalKey,
        originalType.type,
        original.size,
        JSON.stringify(variants),
        meta.thumbhash,
        meta.palette ? JSON.stringify(meta.palette) : null,
        meta.focus?.[0] ?? null,
        meta.focus?.[1] ?? null,
        meta.visibility,
        meta.inLiving,
        meta.favorite,
        meta.sha256,
        now
      )
    ];
    if (manualTags.length) {
      statements.push(
        prep(
          db,
          `INSERT OR IGNORE INTO photo_tags (photo_id, tag_id, source) SELECT ?1, value, 'manual' FROM json_each(?2)`,
          photoId,
          JSON.stringify(manualTags)
        )
      );
    }
    if (suggestedTags.length) {
      statements.push(
        prep(
          db,
          `INSERT OR IGNORE INTO photo_tags (photo_id, tag_id, source) SELECT ?1, value, 'suggested' FROM json_each(?2)`,
          photoId,
          JSON.stringify(suggestedTags)
        )
      );
    }
    for (const themeId of themeIds) {
      statements.push(
        prep(
          db,
          `INSERT INTO theme_items (id, theme_id, position, kind, photo_id)
           VALUES (?1, ?2, (SELECT COALESCE(MAX(position), -1) + 1 FROM theme_items WHERE theme_id = ?2), 'photo', ?3)`,
          newId.item(),
          themeId,
          photoId
        ),
        prep(db, 'UPDATE themes SET updated_at = ?1 WHERE id = ?2', now, themeId)
      );
    }
    await db.batch(statements);
  } catch (e) {
    await c.env.MEDIA.delete(keys).catch(() => {});
    if (isUniqueViolation(e) && meta.sha256) {
      // Lost a race with an identical upload.
      const dup = await db
        .prepare('SELECT id FROM photos WHERE owner_id = ?1 AND sha256 = ?2')
        .bind(user.id, meta.sha256)
        .first<{ id: string }>();
      if (dup) throw duplicate('这张照片已经上传过了', { photoId: dup.id });
    }
    throw e;
  }

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

  if (has(body, 'title')) set('title', optText(body.title, '标题', 200));
  if (has(body, 'note')) set('note', optText(body.note, '笔记', 5000));
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
    tagIds = await usableTagIds(db, user.id, strArray(body.tagIds, '标签', 200));
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
