// POI matching: local places + AMap (with a key, inside China) or OpenStreetMap, scored by distance and heading.
// docs/api/pois.md#post-apipoismatch-登录

import { angleDiff, bearing, distance, outOfChina } from '../../shared/geo';
import type { MatchCandidate, MatchResponse } from '../../shared/types';
import type { Env } from '../env';
import { POI_COLS, type PoiRow } from '../lib/poi';
import { zoneAt } from '../lib/privacy';
import { prepQ, Sql } from '../lib/sql';
import { poiOffered } from '../lib/visibility';
import { amapAround, amapRegeo } from './amap';
import { isAreaCategory, radiusOf } from './category';
import { kvCached, settle } from './http';
import { nominatimReverse, overpassAround } from './osm';
import type { ExternalPlace, Geocode } from './types';

const AREA_PENALTY = 10_000; // areal fallbacks rank after every point candidate
const IN_VIEW_DEGREES = 30;
const IN_VIEW_BONUS = 25;
const LOCAL_BONUS = 10;
const DEDUPE_METERS = 80;
const MAX_CANDIDATES = 40;

export interface MatchInput {
  lat: number;
  lng: number;
  heading: number | null;
  radius: number;
}

/** A place before scoring, from the local table or a provider. */
export interface RawPlace {
  key: string;
  poiId: string | null;
  name: string;
  category: string;
  lat: number;
  lng: number;
  source: 'local' | 'amap' | 'osm';
  /** the `pois.source` / `pois.source_id` pair, for dedupe against provider results */
  storedSource: string | null;
  sourceId: string | null;
  city: string | null;
  district: string | null;
  /** how far from its centre a photo still counts as "inside" (areal categories) */
  extent: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function fromPoiRow(p: PoiRow): RawPlace {
  return {
    key: p.id,
    poiId: p.id,
    name: p.name,
    category: p.category,
    lat: p.lat,
    lng: p.lng,
    source: 'local',
    storedSource: p.source,
    sourceId: p.source_id,
    city: p.city,
    district: p.district,
    extent: p.radius
  };
}

export function fromExternal(e: ExternalPlace, fallback: Geocode): RawPlace {
  return {
    key: `${e.source}:${e.sourceId}`,
    poiId: null,
    name: e.name,
    category: e.category,
    lat: e.lat,
    lng: e.lng,
    source: e.source,
    storedSource: e.source,
    sourceId: e.sourceId,
    city: e.city ?? fallback.city,
    district: e.district ?? fallback.district,
    extent: radiusOf(e.category)
  };
}

/** Distance, bearing, view test and score for one place relative to the photo. */
export function score(p: RawPlace, at: { lat: number; lng: number; heading: number | null }): MatchCandidate {
  const raw = distance(at.lat, at.lng, p.lat, p.lng);
  const area = isAreaCategory(p.category) && raw <= p.extent;
  const brg = bearing(at.lat, at.lng, p.lat, p.lng);
  const inView = !area && at.heading !== null && raw > 0 && angleDiff(brg, at.heading) <= IN_VIEW_DEGREES;
  const s = (area ? AREA_PENALTY : 0) + raw - (inView ? IN_VIEW_BONUS : 0) - (p.source === 'local' ? LOCAL_BONUS : 0);
  return {
    key: p.key,
    poiId: p.poiId,
    name: p.name,
    category: p.category,
    lat: p.lat,
    lng: p.lng,
    distance: area ? 0 : round1(raw),
    bearing: Math.round(brg) % 360,
    inView,
    score: round1(s),
    source: p.source,
    sourceId: p.sourceId,
    area,
    city: p.city,
    district: p.district
  };
}

const nameKey = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s·・\-_()（）]/g, '');

/** Drops provider results that duplicate a local place (same source id, or same name within 80 m) or each other. */
export function dedupe(local: RawPlace[], external: RawPlace[], at?: { lat: number; lng: number }): RawPlace[] {
  const localKeys = new Set(local.filter((l) => l.sourceId).map((l) => `${l.storedSource}:${l.sourceId}`));
  const kept: RawPlace[] = [];
  // Nearest first, so of two twins the closer one survives.
  const byDistance = at
    ? [...external].sort((a, b) => distance(at.lat, at.lng, a.lat, a.lng) - distance(at.lat, at.lng, b.lat, b.lng))
    : external;
  for (const e of byDistance) {
    if (e.sourceId && localKeys.has(`${e.storedSource}:${e.sourceId}`)) continue;
    const k = nameKey(e.name);
    const twin = (other: RawPlace) => nameKey(other.name) === k && distance(other.lat, other.lng, e.lat, e.lng) < DEDUPE_METERS;
    if (local.some(twin) || kept.some(twin)) continue;
    kept.push(e);
  }
  return kept;
}

async function localPlaces(db: D1Database, userId: string, lat: number, lng: number, radius: number): Promise<PoiRow[]> {
  const widest = await db.prepare('SELECT COALESCE(MAX(radius), 0) AS r FROM pois').first<{ r: number }>();
  const reach = Math.max(radius, widest?.r ?? 0);
  const dLat = reach / 111_320;
  const dLng = reach / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const q = new Sql();
  const res = await prepQ(
    db,
    `SELECT ${POI_COLS} FROM pois po
     WHERE po.lat BETWEEN ${q.p(lat - dLat)} AND ${q.p(lat + dLat)} AND po.lng BETWEEN ${q.p(lng - dLng)} AND ${q.p(lng + dLng)}
       AND ${poiOffered(q, userId)}`,
    q
  ).all<PoiRow>();
  // Within the search radius, or within the place's own radius when that is larger.
  return res.results.filter((p) => distance(lat, lng, p.lat, p.lng) <= Math.max(radius, p.radius));
}

function nearby(env: Env, provider: 'amap' | 'osm', lat: number, lng: number, radius: number): Promise<ExternalPlace[]> {
  const qLat = Number(lat.toFixed(4));
  const qLng = Number(lng.toFixed(4));
  const key = `poi:near:${provider}:${qLat.toFixed(4)}:${qLng.toFixed(4)}:${Math.round(radius)}`;
  return kvCached(env.KV, key, () =>
    provider === 'amap' ? amapAround(env.AMAP_KEY as string, qLat, qLng, radius) : overpassAround(qLat, qLng, radius)
  );
}

export function reverse(env: Env, provider: 'amap' | 'osm', lat: number, lng: number): Promise<Geocode> {
  const qLat = Number(lat.toFixed(3));
  const qLng = Number(lng.toFixed(3));
  const key = `geo:rev:${provider}:${qLat.toFixed(3)}:${qLng.toFixed(3)}`;
  return kvCached(env.KV, key, () => (provider === 'amap' ? amapRegeo(env.AMAP_KEY as string, qLat, qLng) : nominatimReverse(qLat, qLng)));
}

/** AMap only covers mainland China; outside it (or without a key) OpenStreetMap is used. */
export function providerFor(env: Env, lat: number, lng: number): 'amap' | 'osm' {
  return env.AMAP_KEY && !outOfChina(lat, lng) ? 'amap' : 'osm';
}

/** Merge local and provider places (dedupe), score them against the photo, best first. */
export function rank(local: RawPlace[], external: RawPlace[], at: { lat: number; lng: number; heading: number | null }): MatchCandidate[] {
  return [...local, ...dedupe(local, external, at)]
    .map((p) => score(p, at))
    .sort((a, b) => a.score - b.score || Number(b.source === 'local') - Number(a.source === 'local') || a.name.localeCompare(b.name))
    .slice(0, MAX_CANDIDATES);
}

export async function matchPlaces(env: Env, userId: string, input: MatchInput): Promise<MatchResponse> {
  const { lat, lng, radius } = input;
  const provider = providerFor(env, lat, lng);
  const [localRows, external, geo, zone] = await Promise.all([
    localPlaces(env.DB, userId, lat, lng, radius),
    settle(nearby(env, provider, lat, lng, radius)),
    settle(reverse(env, provider, lat, lng)),
    zoneAt(env.DB, userId, lat, lng)
  ]);

  const local = localRows.map(fromPoiRow);
  if (!external.ok)
    console.warn(`match: ${provider} nearby search failed`, external.error instanceof Error ? external.error.message : external.error);
  if (!geo.ok) console.warn(`match: ${provider} reverse geocode failed`, geo.error instanceof Error ? geo.error.message : geo.error);

  const area: Geocode = geo.ok ? geo.value : { city: null, district: null };
  const candidates = rank(local, external.ok ? external.value.map((e) => fromExternal(e, area)) : [], input);

  // Without a geocoder answer, the nearest local place still tells which city/district this is.
  const nearest = candidates.find((c) => c.city || c.district);
  return {
    candidates,
    city: area.city ?? nearest?.city ?? null,
    district: area.district ?? nearest?.district ?? null,
    provider: external.ok ? provider : 'local',
    privacyZone: zone?.name ?? null
  };
}
