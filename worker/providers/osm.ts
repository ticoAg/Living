// OpenStreetMap, through free public services: Photon (komoot) for nearby places and name search, Nominatim for reverse
// geocoding and name search, Overpass as a fallback for nearby places (its public servers are often overloaded).
// All are WGS-84, so no coordinate conversion is needed.

import { categoryFromOsm, categoryFromOsmAny } from './category';
import { fetchJson, UpstreamError } from './http';
import type { ExternalPlace, Geocode, Region } from './types';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const PHOTON = 'https://photon.komoot.io';

/** How far a name search reaches around the photo, in degrees each way (about 6 km). */
export const NEAR_SEARCH_DEGREES = 0.06;
/** Photon answers at most about 50 features per request. */
const PHOTON_LIMIT = 50;
/**
 * The second nearby query keeps only these OSM tags (any one), so landmarks still show up where shops and offices fill
 * the nearest 50.
 */
export const SCENIC_TAGS = [
  'tourism',
  'historic',
  'leisure',
  'natural',
  'man_made:bridge',
  'man_made:tower',
  'man_made:pier',
  'amenity:place_of_worship',
  'waterway',
  'place:square',
  'place:island',
  'place:village'
];

type LatLng = { lat: number; lng: number };

/** A `minLon,minLat,maxLon,maxLat` box around a point (Photon's bbox and Nominatim's viewbox both take this order). */
export const bboxAround = (at: LatLng, d = NEAR_SEARCH_DEGREES) =>
  [at.lng - d, at.lat - d, at.lng + d, at.lat + d].map((v) => v.toFixed(4)).join(',');

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const LODGING = 'hotel|hostel|motel|guest_house|apartment|chalet|information|camp_site|caravan_site|alpine_hut|wilderness_hut';

function overpassQuery(lat: number, lng: number, radius: number): string {
  const around = `(around:${Math.round(radius)},${lat.toFixed(5)},${lng.toFixed(5)})`;
  return `[out:json][timeout:8];
(
  nwr${around}["name"]["tourism"]["tourism"!~"^(${LODGING})$"];
  nwr${around}["name"]["historic"];
  nwr${around}["name"]["leisure"~"^(park|garden)$"];
  nwr${around}["name"]["natural"];
  nwr${around}["name"]["man_made"~"^(bridge|tower|pier)$"];
  nwr${around}["name"]["bridge"];
  nwr${around}["name"]["amenity"~"^(place_of_worship|cafe|restaurant|library|arts_centre|theatre)$"];
  nwr${around}["name"]["place"~"^(square|village|neighbourhood|island)$"];
);
out center tags 150;`;
}

/** Named places of interest within `radius` metres. */
export async function overpassAround(lat: number, lng: number, radius: number): Promise<ExternalPlace[]> {
  const data = await fetchJson<{ elements?: OverpassElement[]; remark?: string }>(OVERPASS, 'overpass', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery(lat, lng, radius))}`
  });
  if (!Array.isArray(data.elements)) throw new UpstreamError('overpass: unexpected response');
  // An overloaded server answers 200 with a "runtime error" remark and a partial or empty result: not worth caching.
  if (typeof data.remark === 'string' && /runtime error|timed out|out of memory/i.test(data.remark))
    throw new UpstreamError('overpass: query did not complete');
  return parseOverpass(data.elements);
}

/** Overpass elements → places (named, categorised, with a centre point). */
export function parseOverpass(elements: OverpassElement[]): ExternalPlace[] {
  const out: ExternalPlace[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = tags['name']?.trim();
    const pLat = el.lat ?? el.center?.lat;
    const pLng = el.lon ?? el.center?.lon;
    if (!name || typeof pLat !== 'number' || typeof pLng !== 'number') continue;
    const category = categoryFromOsm(tags, name);
    if (!category) continue;
    out.push({
      source: 'osm',
      sourceId: `${el.type}/${el.id}`,
      name,
      category,
      lat: pLat,
      lng: pLng,
      city: tags['addr:city']?.trim() || null,
      district: tags['addr:district']?.trim() || null
    });
  }
  return out;
}

interface NominatimAddress {
  city?: string;
  town?: string;
  municipality?: string;
  village?: string;
  state_district?: string;
  region?: string;
  county?: string;
  state?: string;
  province?: string;
  city_district?: string;
  district?: string;
  suburb?: string;
  country_code?: string;
  'ISO3166-2-lvl4'?: string;
}

/** 直辖市: Nominatim has no `state` for Beijing, so the ISO code names the municipality. */
const MUNICIPALITIES: Record<string, string> = { 'CN-BJ': '北京市', 'CN-SH': '上海市', 'CN-TJ': '天津市', 'CN-CQ': '重庆市' };
const DISTRICT_NAME = /[区區县縣旗]$/;
/** What a prefecture-level division (地级行政区) is called: 杭州市、大理白族自治州、锡林郭勒盟、阿里地区. */
const PREFECTURE_NAME = /(市|州|盟|地区|地區)$/;

/**
 * Asked for Chinese, Nominatim may give a name in both scripts, `法兰西岛大区;法蘭西島大區`: keep the first. Blank
 * parts count as missing.
 */
const first = (v: unknown): string | null => (typeof v === 'string' ? v.split(';')[0].trim() || null : null);

/**
 * City and district from a Nominatim address. In mainland China OSM tags the 区/县 as `city` and rarely carries the
 * prefecture-level city, so a district-looking `city` becomes the district and the city comes from `state_district` or a
 * prefecture-looking `region`, or is left for the caller to fill in.
 */
export function geocodeFromAddress(address: NominatimAddress): Geocode {
  const a = Object.fromEntries(Object.entries(address).map(([k, v]) => [k, first(v) ?? undefined])) as NominatimAddress;
  const named = a.city || a.town || a.municipality || a.village || null;
  const municipality = MUNICIPALITIES[a['ISO3166-2-lvl4'] ?? ''];
  if (municipality) {
    return { city: municipality, district: (named && named !== municipality ? named : null) ?? a.city_district ?? a.district ?? null };
  }
  if (a.country_code === 'cn' && named && DISTRICT_NAME.test(named)) {
    const prefecture = a.state_district ?? (a.region && PREFECTURE_NAME.test(a.region) ? a.region : null);
    return { city: prefecture, district: named };
  }
  const city = named || a.state_district || a.county || a.state || null;
  const district = a.city_district || a.district || (a.county && a.county !== city ? a.county : null) || a.suburb || null;
  return { city, district };
}

/** The province-level division of a Nominatim address: 浙江省, 广西壮族自治区, a municipality; a state or 都道府県 elsewhere. */
export function provinceFromAddress(a: NominatimAddress): string | null {
  return MUNICIPALITIES[a['ISO3166-2-lvl4'] ?? ''] ?? first(a.state) ?? first(a.province);
}

async function nominatimAddress(lat: number, lng: number, zoom: number): Promise<NominatimAddress | null> {
  const qs = new URLSearchParams({
    format: 'jsonv2',
    lat: lat.toFixed(6),
    lon: lng.toFixed(6),
    zoom: String(zoom),
    addressdetails: '1',
    'accept-language': 'zh-CN'
  });
  const data = await fetchJson<{ address?: NominatimAddress; error?: string }>(
    `${NOMINATIM}/reverse?${qs.toString()}`,
    'nominatim reverse'
  );
  // "Unable to geocode" (open sea, no data) is a valid empty answer, not an outage.
  return data.error ? null : (data.address ?? {});
}

/**
 * Province, city and district for a point, in Chinese where OSM has it. A street-level answer in mainland China often
 * leaves out the prefecture-level city (西湖区 comes without 杭州市); asked at zoom 7, Nominatim answers with that city,
 * so a second request fills it in. If that request fails the whole lookup fails, and nothing half-done is cached.
 */
export async function nominatimReverse(lat: number, lng: number): Promise<Region> {
  const a = await nominatimAddress(lat, lng, 16);
  if (!a) return { province: null, city: null, district: null };
  const g = geocodeFromAddress(a);
  const province = provinceFromAddress(a);
  if (g.city || a.country_code !== 'cn') return { province, ...g };
  const wide = await nominatimAddress(lat, lng, 7);
  const named = wide ? first(wide.city) || first(wide.state_district) || first(wide.region) : null;
  return { province, city: named && PREFECTURE_NAME.test(named) ? named : null, district: g.district };
}

interface NominatimHit {
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  class?: string;
  category?: string;
  type?: string;
  address?: NominatimAddress;
}

/** Name search via Nominatim; with a point, only within about 6 km of it. */
export async function nominatimSearch(q: string, near: LatLng | null = null): Promise<ExternalPlace[]> {
  const qs = new URLSearchParams({ format: 'jsonv2', q, limit: '10', addressdetails: '1', 'accept-language': 'zh-CN' });
  if (near) {
    qs.set('viewbox', bboxAround(near));
    qs.set('bounded', '1');
  }
  const data = await fetchJson<NominatimHit[]>(`${NOMINATIM}/search?${qs.toString()}`, 'nominatim search');
  if (!Array.isArray(data)) throw new UpstreamError('nominatim search: unexpected response');
  const out: ExternalPlace[] = [];
  for (const h of data) {
    const lat = Number(h.lat);
    const lng = Number(h.lon);
    const name = (h.name || h.display_name?.split(',')[0] || '').trim();
    if (!name || !h.osm_type || !h.osm_id || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const cls = h.class ?? h.category;
    const tags: Record<string, string> = cls && h.type ? { [cls]: h.type } : {};
    // Nominatim classes (boundary, place, highway…) are broader than the Overpass filter: fall back to 景.
    const category = categoryFromOsm(tags, name) ?? categoryFromOsm({ tourism: 'attraction' }, name);
    if (!category) continue;
    const g = geocodeFromAddress(h.address ?? {});
    out.push({ source: 'osm', sourceId: `${h.osm_type}/${h.osm_id}`, name, category, lat, lng, city: g.city, district: g.district });
  }
  return out;
}

export interface PhotonFeature {
  geometry?: { coordinates?: number[] };
  properties?: {
    osm_type?: string;
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    city?: string;
    district?: string;
    county?: string;
    countrycode?: string;
  };
}

const OSM_TYPE: Record<string, string> = { N: 'node', W: 'way', R: 'relation' };

/** Photon features → places. Photon reports one main OSM tag per feature, which decides the category. */
export function parsePhoton(features: PhotonFeature[]): ExternalPlace[] {
  const out: ExternalPlace[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const p = f.properties ?? {};
    const name = p.name?.trim();
    const [lng, lat] = f.geometry?.coordinates ?? [];
    const type = OSM_TYPE[p.osm_type ?? ''];
    if (!name || !type || typeof p.osm_id !== 'number' || typeof lat !== 'number' || typeof lng !== 'number') continue;
    const sourceId = `${type}/${p.osm_id}`;
    if (seen.has(sourceId)) continue;
    const category = p.osm_key && p.osm_value ? categoryFromOsmAny({ [p.osm_key]: p.osm_value }, name) : null;
    if (!category) continue;
    seen.add(sourceId);
    // Only a city or county from Photon is trusted; without one the caller fills in the reverse geocode.
    const g =
      p.city || p.county
        ? geocodeFromAddress({ city: p.city, district: p.district, county: p.county, country_code: p.countrycode?.toLowerCase() })
        : null;
    out.push({ source: 'osm', sourceId, name, category, lat, lng, city: g?.city ?? null, district: g?.district ?? null });
  }
  return out;
}

async function photonFeatures(url: string, label: string): Promise<PhotonFeature[]> {
  const data = await fetchJson<{ features?: PhotonFeature[] }>(url, label);
  if (!Array.isArray(data.features)) throw new UpstreamError(`${label}: unexpected response`);
  return data.features;
}

/**
 * Named places within `radius` metres, nearest first: the nearest of any kind (shops, cafés, buildings…) plus, in a
 * second request, the nearest landmarks. One of the two failing still gives a list.
 */
export async function photonNearby(lat: number, lng: number, radius: number): Promise<ExternalPlace[]> {
  const base = { lat: lat.toFixed(5), lon: lng.toFixed(5), limit: String(PHOTON_LIMIT), radius: (Math.max(radius, 30) / 1000).toFixed(3) };
  const scenic = new URLSearchParams(base);
  for (const tag of SCENIC_TAGS) scenic.append('osm_tag', tag);
  const answers = await Promise.allSettled([
    photonFeatures(`${PHOTON}/reverse?${new URLSearchParams(base).toString()}`, 'photon reverse'),
    photonFeatures(`${PHOTON}/reverse?${scenic.toString()}`, 'photon reverse')
  ]);
  const ok = answers.flatMap((a) => (a.status === 'fulfilled' ? [a.value] : []));
  if (!ok.length) throw (answers[0] as PromiseRejectedResult).reason;
  return parsePhoton(ok.flat());
}

/** Nearby places from OpenStreetMap: Photon, or Overpass when Photon is down. */
export async function osmNearby(lat: number, lng: number, radius: number): Promise<ExternalPlace[]> {
  try {
    return await photonNearby(lat, lng, radius);
  } catch (e) {
    console.warn('photon nearby failed, trying overpass', e instanceof Error ? e.message : e);
    return overpassAround(lat, lng, radius);
  }
}

/** Photon name search; with a point, limited to about 6 km around it and ranked by closeness. */
export async function photonSearch(q: string, near: LatLng | null): Promise<ExternalPlace[]> {
  const qs = new URLSearchParams({ q, limit: '20' });
  if (near) {
    qs.set('lat', near.lat.toFixed(5));
    qs.set('lon', near.lng.toFixed(5));
    qs.set('bbox', bboxAround(near));
  }
  return parsePhoton(await photonFeatures(`${PHOTON}/api?${qs.toString()}`, 'photon search'));
}

/** Name search on OpenStreetMap through Photon and Nominatim together; fails only when both do. */
export async function osmSearch(q: string, near: LatLng | null): Promise<ExternalPlace[]> {
  const answers = await Promise.allSettled([photonSearch(q, near), nominatimSearch(q, near)]);
  const ok = answers.flatMap((a) => (a.status === 'fulfilled' ? [a.value] : []));
  if (!ok.length) throw (answers[0] as PromiseRejectedResult).reason;
  return ok.flat();
}
