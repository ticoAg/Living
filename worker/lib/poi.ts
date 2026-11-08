import { CATEGORY_RADIUS } from '../../shared/geo';
import { POI_CATEGORIES, POI_LIMITS, type NewPoi, type Poi, type PoiDetail, type PoiSource, type SessionUser } from '../../shared/types';
import { newId } from './ids';
import { invalid } from './http';
import { isStaff } from './session';
import { isPlainObject, optEnum, optNum, optText, reqStr } from './validate';
import { nowIso, prep } from './sql';

export interface PoiRow {
  id: string;
  name: string;
  aliases: string | null;
  category: string;
  city: string | null;
  district: string | null;
  lat: number;
  lng: number;
  radius: number;
  source: PoiSource;
  source_id: string | null;
  created_by: string | null;
  created_at: string;
}

export const POI_COLS = 'id, name, aliases, category, city, district, lat, lng, radius, source, source_id, created_by, created_at';
/** `POI_COLS` qualified with a table alias, for joins. */
export const poiCols = (alias: string): string =>
  POI_COLS.split(', ')
    .map((c) => `${alias}.${c}`)
    .join(', ');

export function toPoi(r: PoiRow, count?: number): Poi {
  const poi: Poi = {
    id: r.id,
    name: r.name,
    category: r.category,
    city: r.city,
    district: r.district,
    lat: r.lat,
    lng: r.lng,
    radius: r.radius,
    source: r.source,
    sourceId: r.source_id
  };
  if (count !== undefined) poi.count = count;
  return poi;
}

/** `pois.aliases` holds a JSON array of strings, or NULL. Anything else reads as no aliases. */
export function parseAliases(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((a): a is string => typeof a === 'string' && a !== '') : [];
  } catch {
    return [];
  }
}

/** Only the place's creator and staff (owner, admin) may change it. */
export const canEditPoi = (user: SessionUser | null, row: Pick<PoiRow, 'created_by'>): boolean =>
  user !== null && (row.created_by === user.id || isStaff(user));

/**
 * `toPoi` plus what the edit form needs. The creator's id stays on the server (it would tie a person to a place they
 * created, even from a photo they keep private); the requester only learns whether they may edit, and the aliases with it.
 */
export function toPoiDetail(r: PoiRow, canEdit: boolean, count?: number): PoiDetail {
  const poi: PoiDetail = { ...toPoi(r, count), canEdit };
  if (canEdit) poi.aliases = parseAliases(r.aliases);
  return poi;
}

export const defaultRadius = (category: string): number => CATEGORY_RADIUS[category] ?? 120;

export async function getPoiRow(db: D1Database, id: string): Promise<PoiRow | null> {
  return db.prepare(`SELECT ${POI_COLS} FROM pois WHERE id = ?1`).bind(id).first<PoiRow>();
}

/** Validates a `NewPoi` payload. */
export function parseNewPoi(v: unknown): NewPoi {
  if (!isPlainObject(v)) throw invalid('地点信息格式不对');
  const name = reqStr(v, 'name', '地点名称', 1, POI_LIMITS.nameMax);
  const category = v.category;
  if (typeof category !== 'string' || !(POI_CATEGORIES as readonly string[]).includes(category)) {
    throw invalid(`地点类别需要是：${POI_CATEGORIES.join('、')}`);
  }
  const lat = optNum(v.lat, '地点纬度', { min: -90, max: 90 });
  const lng = optNum(v.lng, '地点经度', { min: -180, max: 180 });
  if (lat === null || lng === null) throw invalid('请提供地点的经纬度');
  const source = optEnum<PoiSource>(v.source, '地点来源', ['custom', 'amap', 'osm']) ?? 'custom';
  const sourceId = optText(v.sourceId, '地点来源编号', 120);
  return { name, category, lat, lng, city: optText(v.city, '城市', 60), district: optText(v.district, '区县', 60), source, sourceId };
}

/**
 * Returns the existing POI for `(source, sourceId)` or creates a new one (`created_by` = user,
 * radius from the category default). Custom POIs without a sourceId are always new.
 */
export async function findOrCreatePoi(db: D1Database, input: NewPoi, userId: string): Promise<PoiRow> {
  const source = input.source ?? 'custom';
  const sourceId = input.sourceId ?? null;
  if (sourceId) {
    const existing = await db
      .prepare(`SELECT ${POI_COLS} FROM pois WHERE source = ?1 AND source_id = ?2`)
      .bind(source, sourceId)
      .first<PoiRow>();
    if (existing) return existing;
  }
  const id = newId.poi();
  await prep(
    db,
    `INSERT OR IGNORE INTO pois (id, name, category, city, district, lat, lng, radius, source, source_id, created_by, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    id,
    input.name,
    input.category,
    input.city ?? null,
    input.district ?? null,
    input.lat,
    input.lng,
    defaultRadius(input.category),
    source,
    sourceId,
    userId,
    nowIso()
  ).run();
  // A concurrent request may have created the same (source, sourceId) first: read back by key.
  const row = sourceId
    ? await db.prepare(`SELECT ${POI_COLS} FROM pois WHERE source = ?1 AND source_id = ?2`).bind(source, sourceId).first<PoiRow>()
    : await getPoiRow(db, id);
  if (!row) throw new Error('poi insert failed');
  return row;
}
