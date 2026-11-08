import { fuzz } from '../../shared/geo';
import type { GeoPrivacy, PhotoDetail, PhotoSummary, PoiMethod, Variants, Visibility } from '../../shared/types';
import { getPoiRow, toPoi } from './poi';
import { parseJson, prepQ, Sql } from './sql';
import { photoById } from './visibility';

export interface PhotoRow {
  id: string;
  owner_id: string;
  owner_handle: string;
  title: string | null;
  note?: string | null;
  has_note?: number;
  taken_at: string | null;
  tz?: string | null;
  lat: number | null;
  lng: number | null;
  alt?: number | null;
  heading: number | null;
  geo_privacy: GeoPrivacy;
  city: string | null;
  district?: string | null;
  poi_id: string | null;
  poi_distance?: number | null;
  poi_method?: PoiMethod | null;
  camera?: string | null;
  lens?: string | null;
  focal?: number | null;
  focal35?: number | null;
  aperture?: number | null;
  shutter?: string | null;
  iso?: number | null;
  width: number;
  height: number;
  file_key?: string;
  thumbhash: string | null;
  variants: string;
  palette: string | null;
  focus_x: number | null;
  focus_y: number | null;
  visibility: Visibility;
  in_living: number;
  favorite: number;
  uploaded_at?: string;
  updated_at?: string | null;
  tag_ids: string | null;
}

const TAG_IDS = `(SELECT group_concat(pt.tag_id) FROM photo_tags pt WHERE pt.photo_id = p.id) AS tag_ids`;

/** Columns for list payloads. The note text itself is left out; only whether one exists. */
export const SUMMARY_COLS = `p.id, p.owner_id, u.handle AS owner_handle, p.title, p.taken_at, p.width, p.height, p.thumbhash, p.variants, p.palette,
  p.poi_id, p.city, p.visibility, p.geo_privacy, p.lat, p.lng, p.heading, p.in_living, p.favorite, p.focus_x, p.focus_y,
  (p.note IS NOT NULL AND p.note != '') AS has_note, ${TAG_IDS}`;

/** Summary plus everything the detail view and the edit page need. */
export const DETAIL_COLS = `${SUMMARY_COLS}, p.note, p.tz, p.alt, p.district, p.poi_distance, p.poi_method, p.camera, p.lens, p.focal,
  p.focal35, p.aperture, p.shutter, p.iso, p.file_key, p.uploaded_at, p.updated_at`;

export const PHOTO_FROM = `photos p JOIN users u ON u.id = p.owner_id`;

/** Geo-privacy view of a photo for `viewer` (docs/api/conventions.md#位置精度对非所有者). */
function geoFor(r: PhotoRow, viewer: string | null) {
  const level: GeoPrivacy = viewer === r.owner_id ? 'exact' : r.geo_privacy;
  const hasPoint = r.lat !== null && r.lng !== null;
  return {
    level,
    lat: level === 'hidden' || !hasPoint ? null : level === 'fuzzy' ? fuzz(r.lat as number) : r.lat,
    lng: level === 'hidden' || !hasPoint ? null : level === 'fuzzy' ? fuzz(r.lng as number) : r.lng,
    heading: level === 'exact' ? r.heading : null
  };
}

export function toSummary(r: PhotoRow, viewer: string | null): PhotoSummary {
  const g = geoFor(r, viewer);
  return {
    id: r.id,
    ownerId: r.owner_id,
    ownerHandle: r.owner_handle,
    title: r.title,
    takenAt: r.taken_at,
    width: r.width,
    height: r.height,
    thumbhash: r.thumbhash,
    variants: parseJson<Variants>(r.variants) as Variants,
    palette: parseJson<string[]>(r.palette),
    poiId: g.level === 'hidden' ? null : r.poi_id,
    city: r.city,
    tagIds: r.tag_ids ? r.tag_ids.split(',') : [],
    visibility: r.visibility,
    geoPrivacy: r.geo_privacy,
    lat: g.lat,
    lng: g.lng,
    heading: g.heading,
    inLiving: r.in_living === 1,
    favorite: r.favorite === 1,
    hasNote: r.has_note === 1,
    focus: r.focus_x !== null && r.focus_y !== null ? [r.focus_x, r.focus_y] : null
  };
}

export async function toDetail(db: D1Database, r: PhotoRow, viewer: string | null): Promise<PhotoDetail> {
  const g = geoFor(r, viewer);
  const hidden = g.level === 'hidden';
  const mine = viewer === r.owner_id;
  const [poiRow, themes] = await Promise.all([
    r.poi_id && !hidden ? getPoiRow(db, r.poi_id) : Promise.resolve(null),
    // Themes the viewer may see; unlisted themes are not advertised from a photo page.
    db
      .prepare(
        `SELECT DISTINCT th.id, th.title, th.updated_at FROM theme_items ti JOIN themes th ON th.id = ti.theme_id
         WHERE ti.photo_id = ?1 AND (th.visibility = 'public' OR th.owner_id = ?2) ORDER BY th.updated_at DESC`
      )
      .bind(r.id, viewer ?? '')
      .all<{ id: string; title: string }>()
  ]);
  return {
    ...toSummary(r, viewer),
    note: r.note ?? null,
    tz: r.tz ?? null,
    alt: g.level === 'exact' ? (r.alt ?? null) : null,
    district: hidden ? null : (r.district ?? null),
    poi: poiRow ? toPoi(poiRow) : null,
    poiDistance: hidden ? null : (r.poi_distance ?? null),
    poiMethod: hidden && !mine ? null : (r.poi_method ?? null),
    camera: r.camera ?? null,
    lens: r.lens ?? null,
    focal: r.focal ?? null,
    focal35: r.focal35 ?? null,
    aperture: r.aperture ?? null,
    shutter: r.shutter ?? null,
    iso: r.iso ?? null,
    themes: themes.results.map((t) => ({ id: t.id, title: t.title })),
    uploadedAt: r.uploaded_at as string,
    updatedAt: r.updated_at ?? null
  };
}

/** Raw detail row by id, no visibility applied. */
export async function loadPhotoRow(db: D1Database, id: string): Promise<PhotoRow | null> {
  return db.prepare(`SELECT ${DETAIL_COLS} FROM ${PHOTO_FROM} WHERE p.id = ?1`).bind(id).first<PhotoRow>();
}

/** Detail for `viewer`, or null when missing or `private` and not theirs. */
export async function loadPhotoDetail(db: D1Database, id: string, viewer: string | null): Promise<PhotoDetail | null> {
  const row = await loadPhotoRow(db, id);
  if (!row || (row.visibility === 'private' && row.owner_id !== viewer)) return null;
  return toDetail(db, row, viewer);
}

/** Summaries for explicit ids that `viewer` can open by id (public, unlisted, or their own). Order is unspecified. */
export async function summariesByIds(
  db: D1Database,
  viewer: string | null,
  ids: string[],
  withNote = false
): Promise<Map<string, PhotoSummary & { note: string | null }>> {
  const out = new Map<string, PhotoSummary & { note: string | null }>();
  const unique = [...new Set(ids)];
  if (!unique.length) return out;
  const q = new Sql();
  const list = q.p(JSON.stringify(unique));
  const vis = photoById(q, viewer);
  const cols = withNote ? `${SUMMARY_COLS}, p.note` : SUMMARY_COLS;
  const res = await prepQ(db, `SELECT ${cols} FROM ${PHOTO_FROM} WHERE p.id IN (SELECT value FROM json_each(${list})) AND ${vis}`, q).all<PhotoRow>();
  for (const r of res.results) out.set(r.id, { ...toSummary(r, viewer), note: r.note ?? null });
  return out;
}
