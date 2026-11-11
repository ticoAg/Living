import { CATEGORY_RADIUS, distance } from '../../shared/geo';
import type { MatchCandidate, NewPoi, Poi } from '../../shared/types';
import { DEFAULT_RADIUS, choiceFromCandidate, isPickable, choiceFromPoi, type PlaceChoice } from './match';
import { coordsOf, isEditable, placeOf, type Item } from './upload-model';

// One place for several photos at once (the "一起整理" panel), and picking the photos taken at one spot.
// Pure functions; the panel and the page wire them up. Docs: /docs/product/features/upload.md#一起整理

/** A place offered for the whole selection: what its photos' own matches found, merged. */
export interface BatchCandidate {
  /** the occurrence nearest to its photo, as the match returned it */
  c: MatchCandidate;
  /** how many of the photos list it */
  count: number;
  /** mean distance from those photos, metres (0 where a photo is inside an area place) */
  distance: number;
}

/**
 * The union of the photos' match candidates: places more of them list first, then the nearer on average. Places
 * created in this session (`extras`) that no match lists come last, by their distance to the nearest photo.
 */
export function mergeCandidates(items: readonly Item[], extras: readonly Poi[] = []): BatchCandidate[] {
  const by = new Map<string, { c: MatchCandidate; count: number; sum: number }>();
  for (const it of items) {
    const seen = new Set<string>();
    for (const c of it.match?.res?.candidates ?? []) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      const d = c.area ? 0 : c.distance;
      const hit = by.get(c.key);
      if (!hit) by.set(c.key, { c, count: 1, sum: d });
      else {
        hit.count++;
        hit.sum += d;
        if (d < (hit.c.area ? 0 : hit.c.distance)) hit.c = c;
      }
    }
  }
  const merged = [...by.values()]
    .map(({ c, count, sum }) => ({ c, count, distance: sum / count }))
    .sort((a, b) => b.count - a.count || a.distance - b.distance || a.c.name.localeCompare(b.c.name));
  const spots = items.map(coordsOf).filter((x): x is { lat: number; lng: number } => !!x);
  const created = extras
    .filter((p) => !by.has(p.id))
    .map((p): BatchCandidate => {
      const d = spots.length ? Math.min(...spots.map((s) => distance(s.lat, s.lng, p.lat, p.lng))) : 0;
      return { c: candidateFromPoi(p, d), count: 0, distance: d };
    })
    .sort((a, b) => a.distance - b.distance);
  return [...merged, ...created];
}

function candidateFromPoi(p: Poi, d: number): MatchCandidate {
  return {
    key: p.id,
    poiId: p.id,
    name: p.name,
    category: p.category,
    lat: p.lat,
    lng: p.lng,
    distance: Math.round(d),
    bearing: 0,
    inView: false,
    score: d,
    source: 'local',
    sourceId: p.sourceId,
    area: false,
    city: p.city,
    district: p.district
  };
}

/** Slack around any place: a photo of it can be taken from across a street, a square or a river. */
export const FAR_SLACK = 500;

/**
 * How far from a place a photo may be and still get it in one go: `FAR_SLACK` plus twice the place's extent, taken
 * from its category's default radius. A point place stays tight (桥 620 m, 店 560 m) while areas get room for their
 * size (园 900 m, 山 1.3 km, 湖 1.7 km). Anything farther was almost certainly taken somewhere else.
 */
export const farLimit = (category: string): number => FAR_SLACK + 2 * (CATEGORY_RADIUS[category] ?? 120);

/**
 * Is this photo clearly too far from the place to share it? Never for a photo without a position, a place without
 * one, or a place the photo's own match offers (inside its matching radius, or an area the photo is inside).
 */
export function isTooFar(it: Item, place: Pick<PlaceChoice, 'key' | 'lat' | 'lng' | 'category'>): boolean {
  const at = coordsOf(it);
  if (!at || place.lat == null || place.lng == null) return false;
  const radius = it.match?.radius ?? DEFAULT_RADIUS;
  if (it.match?.res?.candidates.some((c) => c.key === place.key && isPickable(c, radius))) return false;
  return distance(at.lat, at.lng, place.lat, place.lng) > farLimit(place.category);
}

/**
 * The place as this photo records it. Picked from the merged candidates, a photo whose own match lists the place
 * gets it as "confirmed" with its own distance and view, exactly as if picked on its own; any other way (a photo
 * whose match did not list it, a search, a new place, a photo without a position) is a manual choice, as it is for
 * a single photo.
 */
export function choiceFor(it: Item, base: PlaceChoice, fromCandidates: boolean): PlaceChoice {
  const own = it.match?.res?.candidates.find((c) => c.key === base.key);
  if (own && fromCandidates) return choiceFromCandidate(own, 'confirmed');
  const at = coordsOf(it);
  const d = at && base.lat != null && base.lng != null ? Math.round(distance(at.lat, at.lng, base.lat, base.lng)) : null;
  return { ...base, method: 'manual', distance: own?.area ? 0 : d, area: own?.area || undefined, inView: own?.inView, from: undefined };
}

export interface PlacePlan {
  /** per photo id, what to set */
  patches: Map<string, Partial<Item>>;
  /** photos left alone because they were taken too far away */
  far: string[];
  /** photos left alone because they are still being read */
  pending: string[];
}

/** Give `base` to every photo in `items` that can take it. Sent and unreadable photos are not touched. */
export function planPlace(items: readonly Item[], base: PlaceChoice, fromCandidates: boolean): PlacePlan {
  const plan: PlacePlan = { patches: new Map(), far: [], pending: [] };
  for (const it of items) {
    if (!isEditable(it)) continue;
    if (it.stage !== 'ready' || !it.p) plan.pending.push(it.id);
    else if (isTooFar(it, base)) plan.far.push(it.id);
    else plan.patches.set(it.id, { place: choiceFor(it, base, fromCandidates), cleared: false });
  }
  return plan;
}

/** The place every editable photo will be published with, when they all share one; null otherwise. */
export function sharedPlace(items: readonly Item[], all: Item[]): PlaceChoice | null {
  const open = items.filter(isEditable);
  if (!open.length) return null;
  const first = placeOf(open[0], all);
  if (!first) return null;
  return open.every((it) => placeOf(it, all)?.key === first.key) ? first : null;
}

/**
 * A place that the server would create anew for every photo (a custom place without a source id: `findOrCreatePoi`
 * only de-duplicates by source and source id) is created once here, so the photos all point at the same row.
 */
export async function ensureSaved(
  base: PlaceChoice,
  create: (body: NewPoi) => Promise<Poi>
): Promise<{ choice: PlaceChoice; created: Poi | null }> {
  if (base.poiId || !base.newPoi || base.newPoi.sourceId) return { choice: base, created: null };
  const poi = await create(base.newPoi);
  return { choice: { ...choiceFromPoi(poi, base.method), distance: base.distance, area: base.area, inView: base.inView }, created: poi };
}

/** Where a place made for the whole selection goes: the middle of the photos that have a position. */
export function centreOf(items: readonly Item[]): { lat: number; lng: number } | null {
  const spots = items.map(coordsOf).filter((x): x is { lat: number; lng: number } => !!x);
  if (!spots.length) return null;
  return { lat: spots.reduce((s, x) => s + x.lat, 0) / spots.length, lng: spots.reduce((s, x) => s + x.lng, 0) / spots.length };
}

/** Two photos this close are taken at the same spot … */
export const NEAR_LINK = 200;
/** … and a spot is at most this far across from the photo it starts at. */
export const NEAR_REACH = 1000;

/**
 * The photos taken around the same spot as `id`, in queue order: starting from it, every photo with a position
 * within `NEAR_LINK` of one already in the group, none farther than `NEAR_REACH` from the first. Only photos that can
 * still be edited join; an empty list when `id` has no position.
 */
export function nearbyGroup(items: readonly Item[], id: string, link = NEAR_LINK, reach = NEAR_REACH): string[] {
  const start = items.find((i) => i.id === id);
  const origin = start && isEditable(start) ? coordsOf(start) : null;
  if (!origin) return [];
  const pool = items
    .filter((i) => i.id !== id && isEditable(i))
    .map((i) => ({ id: i.id, at: coordsOf(i) }))
    .filter(
      (x): x is { id: string; at: { lat: number; lng: number } } => !!x.at && distance(origin.lat, origin.lng, x.at.lat, x.at.lng) <= reach
    );
  const group = new Set([id]);
  const frontier = [origin];
  while (frontier.length) {
    const from = frontier.pop()!;
    for (const x of pool) {
      if (group.has(x.id) || distance(from.lat, from.lng, x.at.lat, x.at.lng) > link) continue;
      group.add(x.id);
      frontier.push(x.at);
    }
  }
  return items.filter((i) => group.has(i.id)).map((i) => i.id);
}
