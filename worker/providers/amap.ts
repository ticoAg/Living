// AMap (高德) Web Service: around search, text search and reverse geocoding.
// AMap speaks GCJ-02: queries are converted from WGS-84 and results converted back.

import { gcj02ToWgs84, wgs84ToGcj02 } from '../../shared/geo';
import { categoryFromAmap } from './category';
import { fetchJson, UpstreamError } from './http';
import type { ExternalPlace, Geocode } from './types';

const BASE = 'https://restapi.amap.com/v3';
/** 风景名胜 · 科教文化服务 · 地名地址信息 */
const AROUND_TYPES = '110000|140000|190000';

/** AMap returns `[]` instead of a string for empty fields. */
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export interface AmapPoi {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  location?: unknown;
  pname?: unknown;
  cityname?: unknown;
  adname?: unknown;
}
interface AmapPlaceResponse {
  status?: string;
  info?: string;
  pois?: AmapPoi[];
}

/** Normalises AMap POIs: GCJ-02 → WGS-84, type → category, junk (addresses, housing, schools) dropped. */
export function parseAmapPois(pois: AmapPoi[] | undefined): ExternalPlace[] {
  const out: ExternalPlace[] = [];
  for (const p of pois ?? []) {
    const id = s(p.id);
    const name = s(p.name);
    const loc = s(p.location);
    if (!id || !name || !loc) continue;
    const [lngStr, latStr] = loc.split(',');
    const gLat = Number(latStr);
    const gLng = Number(lngStr);
    if (!Number.isFinite(gLat) || !Number.isFinite(gLng)) continue;
    const category = categoryFromAmap(s(p.type) ?? '', name);
    if (!category) continue;
    const [lat, lng] = gcj02ToWgs84(gLat, gLng);
    const province = s(p.pname);
    out.push({
      source: 'amap',
      sourceId: id,
      name,
      category,
      lat,
      lng,
      city: s(p.cityname) ?? province, // 直辖市 have no city name: use the province
      district: s(p.adname)
    });
  }
  return out;
}

function check(data: AmapPlaceResponse, label: string): void {
  if (data.status !== '1') throw new UpstreamError(`${label}: ${data.info ?? 'status ' + String(data.status)}`);
}

/** Places within `radius` metres of a WGS-84 point, nearest first, at most 25. */
export async function amapAround(key: string, lat: number, lng: number, radius: number): Promise<ExternalPlace[]> {
  const [gLat, gLng] = wgs84ToGcj02(lat, lng);
  const qs = new URLSearchParams({
    key,
    location: `${gLng.toFixed(6)},${gLat.toFixed(6)}`,
    radius: String(Math.round(radius)),
    types: AROUND_TYPES,
    sortrule: 'distance',
    offset: '25',
    page: '1',
    extensions: 'base'
  });
  const data = await fetchJson<AmapPlaceResponse>(`${BASE}/place/around?${qs}`, 'amap around');
  check(data, 'amap around');
  return parseAmapPois(data.pois);
}

/** Keyword search (v3/place/text), at most 20 results. */
export async function amapText(key: string, keywords: string): Promise<ExternalPlace[]> {
  const qs = new URLSearchParams({ key, keywords, offset: '20', page: '1', extensions: 'base' });
  const data = await fetchJson<AmapPlaceResponse>(`${BASE}/place/text?${qs}`, 'amap text');
  check(data, 'amap text');
  return parseAmapPois(data.pois);
}

/** Reverse geocode to city and district (直辖市: the city is the province name). */
export async function amapRegeo(key: string, lat: number, lng: number): Promise<Geocode> {
  const [gLat, gLng] = wgs84ToGcj02(lat, lng);
  const qs = new URLSearchParams({ key, location: `${gLng.toFixed(6)},${gLat.toFixed(6)}`, extensions: 'base' });
  const data = await fetchJson<{ status?: string; info?: string; regeocode?: { addressComponent?: Record<string, unknown> } }>(
    `${BASE}/geocode/regeo?${qs}`,
    'amap regeo'
  );
  if (data.status !== '1') throw new UpstreamError(`amap regeo: ${data.info ?? 'status ' + String(data.status)}`);
  const a = data.regeocode?.addressComponent ?? {};
  return { city: s(a.city) ?? s(a.province), district: s(a.district) };
}
