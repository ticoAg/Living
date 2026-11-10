// The hourly region job: fills in the province of photos stored without one (uploads from before provinces were kept,
// and uploads whose reverse geocode failed), and a missing city or district with it. The map groups photos into
// province → city → county albums by these columns. Docs: /docs/architecture/cloudflare.md#定时任务

import type { Env } from '../env';
import { settle } from '../providers/http';
import { providerFor, reverse } from '../providers/match';

/** photos per run; each may take two Nominatim requests */
export const REGION_BATCH = 8;
/** pause between photos: Nominatim asks for one request a second at most, and a lookup may need two */
export const REGION_SPACING_MS = 2200;

interface TodoRow {
  id: string;
  lat: number | null;
  lng: number | null;
  poi_lat: number | null;
  poi_lng: number | null;
}

export interface RegionRun {
  /** photos that got a province */
  filled: number;
  /** looked up, but there is no province there (open sea, no data): stored as '' so they are not visited again */
  empty: number;
  /** the geocoder failed: left for a later run */
  failed: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Looks up to `batch` photos up. A photo without coordinates of its own is placed at its place's centre. The rows come
 * in random order, so a few that keep failing cannot hold up the rest. Lookups share the match flow's cache (providers/cache.ts).
 */
export async function fillRegions(env: Env, { batch = REGION_BATCH, wait = sleep } = {}): Promise<RegionRun> {
  const run: RegionRun = { filled: 0, empty: 0, failed: 0 };
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.lat, p.lng, po.lat AS poi_lat, po.lng AS poi_lng
     FROM photos p LEFT JOIN pois po ON po.id = p.poi_id
     WHERE p.province IS NULL AND ((p.lat IS NOT NULL AND p.lng IS NOT NULL) OR po.id IS NOT NULL)
     ORDER BY random() LIMIT ?1`
  )
    .bind(batch)
    .all<TodoRow>();

  for (const [i, row] of results.entries()) {
    const own = row.lat !== null && row.lng !== null;
    const lat = own ? row.lat : row.poi_lat;
    const lng = own ? row.lng : row.poi_lng;
    if (lat === null || lng === null) continue;
    if (i > 0) await wait(REGION_SPACING_MS);
    const found = await settle(reverse(env, providerFor(env, lat, lng), lat, lng));
    if (!found.ok) {
      run.failed++;
      console.warn('regions: reverse geocode failed', row.id, found.error instanceof Error ? found.error.message : found.error);
      continue;
    }
    const { province, city, district } = found.value;
    // only what is missing is filled in: a city or district chosen at upload stays as it is
    await env.DB.prepare(
      `UPDATE photos SET province = ?2, city = COALESCE(city, ?3), district = COALESCE(district, ?4) WHERE id = ?1 AND province IS NULL`
    )
      .bind(row.id, province ?? '', city, district)
      .run();
    if (province) run.filled++;
    else run.empty++;
  }
  return run;
}
