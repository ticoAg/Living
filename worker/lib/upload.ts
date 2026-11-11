// POST /api/photos in steps: read and check the form, look up what the meta refers to, store the files in R2, then
// write the rows in one D1 batch. docs/api/photos.md#post-apiphotos登录

import { distance } from '../../shared/geo';
import type { GeoPrivacy, PoiMethod, Variants } from '../../shared/types';
import { duplicate, invalid, tooLarge, upstream } from './http';
import {
  isFile,
  MAX_ORIGINAL_BYTES,
  MAX_REQUEST_BYTES,
  MAX_VARIANT_BYTES,
  originalKind,
  parseCreateMeta,
  variantKind,
  type ParsedMeta
} from './photoInput';
import { findOrCreatePoi, getPoiRow, type PoiRow } from './poi';
import { zoneAt } from './privacy';
import { isUniqueViolation, nowIso, prep, prepInsert } from './sql';
import { usableTagIds } from './tags';
import { newId } from './ids';

export const VARIANT_SIZES = ['s', 'm', 'l'] as const;
export type VariantSize = (typeof VARIANT_SIZES)[number];

/** A file part with the content type and extension it is stored under. */
export interface UploadFile {
  file: File;
  ext: string;
  type: string;
}

/** The checked multipart form. */
export interface UploadForm {
  meta: ParsedMeta;
  original: UploadFile;
  variants: Record<VariantSize, UploadFile>;
}

/** What the meta refers to, as found in D1 before anything is stored. */
export interface UploadRefs {
  /** the existing place given as `poiId`; a `newPoi` is only created once the files are stored */
  poi: PoiRow | null;
  /** `hidden` when the point lies in one of the uploader's privacy zones, else as requested */
  geoPrivacy: GeoPrivacy;
  manualTags: string[];
  /** usable suggested tags that are not manual ones too */
  suggestedTags: string[];
  /** the uploader's own themes among `themeIds` */
  themeIds: string[];
}

/** Where the files go in R2. */
export interface UploadFiles {
  originalKey: string;
  variants: Variants;
  objects: { key: string; body: Blob; contentType: string }[];
}

/** One upload as it passes from step to step. */
export interface Upload {
  photoId: string;
  ownerId: string;
  form: UploadForm;
  refs: UploadRefs;
  files: UploadFiles;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---- form -----------------------------------------------------------------------------------------------------

/** Checks the request headers (size, multipart) and reads the form. */
export async function readUploadForm(req: Request): Promise<UploadForm> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_REQUEST_BYTES) throw tooLarge('上传内容太大：原图不能超过 50 MB');
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data'))
    throw invalid('上传需要使用 multipart/form-data');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw invalid('无法解析上传内容，请重试');
  }
  return parseUploadForm(form);
}

/** The `meta` JSON, the original and the three sizes, each checked in that order. */
export async function parseUploadForm(form: FormData): Promise<UploadForm> {
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

  const original = form.get('original');
  if (!isFile(original) || original.size === 0) throw invalid('缺少原图（original）');
  if (original.size > MAX_ORIGINAL_BYTES) throw tooLarge('原图超过 50 MB，请先压缩或缩小后再上传');
  const originalType = originalKind(original);

  const variants = {} as Record<VariantSize, UploadFile>;
  for (const k of VARIANT_SIZES) {
    const part = form.get(k);
    if (!isFile(part) || part.size === 0) throw invalid(`缺少尺寸图「${k}」`);
    if (part.size > MAX_VARIANT_BYTES) throw tooLarge(`尺寸图「${k}」太大`);
    variants[k] = { file: part, ...(await variantKind(part, `尺寸图「${k}」`)) };
  }
  return { meta, original: { file: original, ...originalType }, variants };
}

// ---- lookups --------------------------------------------------------------------------------------------------

/** The user's photo with these bytes, if any. */
export async function findDuplicate(db: D1Database, userId: string, sha256: string): Promise<string | null> {
  const dup = await db.prepare('SELECT id FROM photos WHERE owner_id = ?1 AND sha256 = ?2').bind(userId, sha256).first<{ id: string }>();
  return dup?.id ?? null;
}

const duplicateError = (photoId: string) => duplicate('这张照片已经上传过了', { photoId });

/**
 * Everything that can be checked before touching storage: the same owner and bytes (409 with the existing photo), the
 * place given as `poiId`, privacy zones, usable tags and the uploader's own themes.
 */
export async function resolveUpload(db: D1Database, userId: string, meta: ParsedMeta): Promise<UploadRefs> {
  if (meta.sha256) {
    const dup = await findDuplicate(db, userId, meta.sha256);
    if (dup) throw duplicateError(dup);
  }

  let poi: PoiRow | null = null;
  if (meta.poiId) {
    poi = await getPoiRow(db, meta.poiId);
    if (!poi) throw invalid('所选地点不存在');
  }
  let geoPrivacy: GeoPrivacy = meta.geoPrivacy;
  if (meta.lat !== null && meta.lng !== null && (await zoneAt(db, userId, meta.lat, meta.lng))) geoPrivacy = 'hidden';
  const manualTags = await usableTagIds(db, userId, meta.tagIds);
  const suggestedTags = (await usableTagIds(db, userId, meta.suggestedTagIds)).filter((id) => !manualTags.includes(id));
  const themeIds = meta.themeIds.length
    ? (
        await db
          .prepare('SELECT id FROM themes WHERE owner_id = ?1 AND id IN (SELECT value FROM json_each(?2))')
          .bind(userId, JSON.stringify(meta.themeIds))
          .all<{ id: string }>()
      ).results.map((r) => r.id)
    : [];
  return { poi, geoPrivacy, manualTags, suggestedTags, themeIds };
}

// ---- storage --------------------------------------------------------------------------------------------------

/** R2 keys: the original under its owner (`o/`), the public sizes under the photo (`v/`). */
export function uploadFiles(ownerId: string, photoId: string, form: UploadForm): UploadFiles {
  const { meta, original, variants: v } = form;
  const originalKey = `o/${ownerId}/${photoId}.${original.ext}`;
  const variants: Variants = {
    s: { key: `v/${photoId}/s.${v.s.ext}`, w: meta.sizes.s[0], h: meta.sizes.s[1] },
    m: { key: `v/${photoId}/m.${v.m.ext}`, w: meta.sizes.m[0], h: meta.sizes.m[1] },
    l: { key: `v/${photoId}/l.${v.l.ext}`, w: meta.sizes.l[0], h: meta.sizes.l[1] }
  };
  const objects = [
    { key: originalKey, body: original.file, contentType: original.type },
    ...VARIANT_SIZES.map((k) => ({ key: variants[k].key, body: v[k].file, contentType: v[k].type }))
  ];
  return { originalKey, variants, objects };
}

const keysOf = (files: UploadFiles) => files.objects.map((o) => o.key);

/** Puts all four files. If any put fails, the ones that made it are deleted again and the upload answers 502. */
export async function storeFiles(bucket: R2Bucket, upload: Upload): Promise<void> {
  const { ownerId, photoId } = upload;
  const stored = await Promise.allSettled(
    upload.files.objects.map(({ key, body, contentType }) =>
      bucket.put(key, body, { httpMetadata: { contentType }, customMetadata: { ownerId, photoId } })
    )
  );
  const failed = stored.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) {
    console.error('upload: R2 put failed', failed.reason instanceof Error ? failed.reason.message : failed.reason);
    await bucket.delete(keysOf(upload.files)).catch(() => {});
    throw upstream('图片存储暂时不可用，请稍后重试');
  }
}

// ---- rows -----------------------------------------------------------------------------------------------------

/** The `photos` row, column by column. `poi` is the final place (`poiId` or the created `newPoi`). */
export function photoRecord(upload: Upload, poi: PoiRow | null, now: string): Record<string, unknown> {
  const { meta, original } = upload.form;
  // The server owns the distance whenever it can compute it.
  const poiDistance = poi
    ? meta.lat !== null && meta.lng !== null
      ? round1(distance(meta.lat, meta.lng, poi.lat, poi.lng))
      : meta.poiDistance
    : null;
  const poiMethod: PoiMethod | null = poi ? (meta.poiMethod ?? 'manual') : null;
  return {
    id: upload.photoId,
    owner_id: upload.ownerId,
    title: meta.title,
    note: meta.note,
    taken_at: meta.takenAt,
    tz: meta.tz,
    lat: meta.lat,
    lng: meta.lng,
    alt: meta.alt,
    heading: meta.heading,
    geo_privacy: upload.refs.geoPrivacy,
    province: meta.province,
    city: meta.city,
    district: meta.district,
    poi_id: poi?.id ?? null,
    poi_distance: poiDistance,
    poi_method: poiMethod,
    camera: meta.camera,
    lens: meta.lens,
    focal: meta.focal,
    focal35: meta.focal35,
    aperture: meta.aperture,
    shutter: meta.shutter,
    iso: meta.iso,
    width: meta.width,
    height: meta.height,
    file_key: upload.files.originalKey,
    file_type: original.type,
    file_size: original.file.size,
    variants: JSON.stringify(upload.files.variants),
    thumbhash: meta.thumbhash,
    palette: meta.palette ? JSON.stringify(meta.palette) : null,
    focus_x: meta.focus?.[0] ?? null,
    focus_y: meta.focus?.[1] ?? null,
    visibility: meta.visibility,
    in_living: meta.inLiving,
    favorite: meta.favorite,
    sha256: meta.sha256,
    uploaded_at: now
  };
}

/** The photo row, its tags and an item at the end of each of its themes (whose `updated_at` moves on). */
export function photoStatements(db: D1Database, upload: Upload, poi: PoiRow | null, now: string): D1PreparedStatement[] {
  const { photoId, refs } = upload;
  const statements = [prepInsert(db, 'photos', photoRecord(upload, poi, now))];
  for (const [source, ids] of [
    ['manual', refs.manualTags],
    ['suggested', refs.suggestedTags]
  ] as const) {
    if (!ids.length) continue;
    statements.push(
      prep(
        db,
        `INSERT OR IGNORE INTO photo_tags (photo_id, tag_id, source) SELECT ?1, value, '${source}' FROM json_each(?2)`,
        photoId,
        JSON.stringify(ids)
      )
    );
  }
  for (const themeId of refs.themeIds) {
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
  return statements;
}

/**
 * Creates the `newPoi` place if needed and writes the rows in one batch. On any failure the stored files are deleted;
 * a unique-constraint failure on the same bytes means an identical upload won the race, and answers 409 with it.
 */
export async function savePhoto(db: D1Database, bucket: R2Bucket, upload: Upload): Promise<void> {
  const { meta } = upload.form;
  try {
    let poi = upload.refs.poi;
    if (!poi && meta.newPoi) poi = await findOrCreatePoi(db, meta.newPoi, upload.ownerId);
    await db.batch(photoStatements(db, upload, poi, nowIso()));
  } catch (e) {
    await bucket.delete(keysOf(upload.files)).catch(() => {});
    if (isUniqueViolation(e) && meta.sha256) {
      const dup = await findDuplicate(db, upload.ownerId, meta.sha256);
      if (dup) throw duplicateError(dup);
    }
    throw e;
  }
}
