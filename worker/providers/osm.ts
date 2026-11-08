// OpenStreetMap: Overpass for nearby places, Nominatim for reverse geocoding and name search.
// Both are WGS-84, so no coordinate conversion is needed.

import { categoryFromOsm } from './category';
import { fetchJson, UpstreamError } from './http';
import type { ExternalPlace, Geocode } from './types';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const NOMINATIM = 'https://nominatim.openstreetmap.org';

interface OverpassElement {
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
  const data = await fetchJson<{ elements?: OverpassElement[] }>(OVERPASS, 'overpass', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery(lat, lng, radius))}`
  });
  if (!Array.isArray(data.elements)) throw new UpstreamError('overpass: unexpected response');
  const out: ExternalPlace[] = [];
  for (const el of data.elements) {
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
  county?: string;
  state?: string;
  city_district?: string;
  district?: string;
  suburb?: string;
  country_code?: string;
  'ISO3166-2-lvl4'?: string;
}

/** 直辖市: Nominatim has no `state` for Beijing, so the ISO code names the municipality. */
const MUNICIPALITIES: Record<string, string> = { 'CN-BJ': '北京市', 'CN-SH': '上海市', 'CN-TJ': '天津市', 'CN-CQ': '重庆市' };
const DISTRICT_NAME = /[区區县縣旗]$/;

/**
 * City and district from a Nominatim address. In mainland China OSM tags the 区/县 as `city` and rarely carries the
 * prefecture-level city, so a district-looking `city` becomes the district and the city is left for the caller to fill in.
 */
export function geocodeFromAddress(a: NominatimAddress): Geocode {
  const named = a.city || a.town || a.municipality || a.village || null;
  const municipality = MUNICIPALITIES[a['ISO3166-2-lvl4'] ?? ''];
  if (municipality) {
    return { city: municipality, district: (named && named !== municipality ? named : null) ?? a.city_district ?? a.district ?? null };
  }
  if (a.country_code === 'cn' && named && DISTRICT_NAME.test(named)) {
    return { city: a.state_district ?? null, district: named };
  }
  const city = named || a.state_district || a.county || a.state || null;
  const district = a.city_district || a.district || (a.county && a.county !== city ? a.county : null) || a.suburb || null;
  return { city, district };
}

/** City and district for a point, in Chinese where OSM has it. */
export async function nominatimReverse(lat: number, lng: number): Promise<Geocode> {
  const qs = new URLSearchParams({
    format: 'jsonv2',
    lat: lat.toFixed(6),
    lon: lng.toFixed(6),
    zoom: '16',
    addressdetails: '1',
    'accept-language': 'zh-CN'
  });
  const data = await fetchJson<{ address?: NominatimAddress; error?: string }>(`${NOMINATIM}/reverse?${qs}`, 'nominatim reverse');
  // "Unable to geocode" (open sea, no data) is a valid empty answer, not an outage.
  if (data.error) return { city: null, district: null };
  return geocodeFromAddress(data.address ?? {});
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

/** Name search via Nominatim (used when no AMap key is configured). */
export async function nominatimSearch(q: string): Promise<ExternalPlace[]> {
  const qs = new URLSearchParams({ format: 'jsonv2', q, limit: '10', addressdetails: '1', 'accept-language': 'zh-CN' });
  const data = await fetchJson<NominatimHit[]>(`${NOMINATIM}/search?${qs}`, 'nominatim search');
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
