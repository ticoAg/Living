import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { destination } from '../../shared/geo';
import type { Env } from '../env';
import type { PoiRow } from '../lib/poi';
import { fakeD1, fakeKv, fakePlaceCache, type DbCall } from '../test-utils';
import { searchPlaces } from './match';

// searchPlaces end to end: stored places by name + provider search, merged, deduplicated and ordered, with the network
// and database replaced by stand-ins. docs/api/pois.md#get-apipoissearchqlatlng登录

const AT = { lat: 30.2593, lng: 120.1516 };

const poiRow = (over: Partial<PoiRow> = {}): PoiRow => ({
  id: 'poi_1',
  name: '断桥',
  aliases: null,
  category: '桥',
  city: '杭州市',
  district: '西湖区',
  lat: AT.lat,
  lng: AT.lng,
  radius: 60,
  source: 'custom',
  source_id: null,
  created_by: 'u_1',
  created_at: '2026-11-01T00:00:00Z',
  ...over
});

/** A Photon feature `meters` from AT towards `bearing`. */
function feature(name: string, id: number, bearing: number, meters: number) {
  const [lat, lng] = destination(AT.lat, AT.lng, bearing, meters);
  return {
    geometry: { coordinates: [lng, lat] },
    properties: { osm_type: 'N', osm_id: id, osm_key: 'tourism', osm_value: 'attraction', name }
  };
}

let calls: URL[];
let answer: (url: URL) => Response;

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      calls.push(url);
      return answer(url);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Photon's name search finds `hits`; its nearby list and Nominatim find nothing. */
const photon = (hits: unknown[]) => (url: URL) =>
  url.hostname === 'photon.komoot.io' && url.pathname === '/api'
    ? Response.json({ features: hits })
    : Response.json(url.hostname === 'photon.komoot.io' ? { features: [] } : []);

function makeEnv(local: PoiRow[]) {
  const cache = fakePlaceCache();
  const d1 = fakeD1(cache.wrap((call: DbCall) => (call.sql.includes('FROM pois') ? local : null)));
  return { env: { DB: d1.db, KV: fakeKv().kv } as unknown as Env, d1 };
}

describe('searchPlaces without a position', () => {
  it('lists stored places first, then provider results in their order, without distances', async () => {
    answer = photon([feature('断桥残雪', 2, 90, 3000), feature('断桥公园', 3, 0, 500)]);
    const { env } = makeEnv([poiRow()]);
    const results = await searchPlaces(env, 'u_1', '断桥', null);
    expect(results.map((r) => [r.name, r.source])).toEqual([
      ['断桥', 'local'],
      ['断桥残雪', 'osm'],
      ['断桥公园', 'osm']
    ]);
    expect(results[0]).toEqual({
      key: 'poi_1',
      poiId: 'poi_1',
      name: '断桥',
      category: '桥',
      lat: AT.lat,
      lng: AT.lng,
      distance: 0,
      bearing: 0,
      inView: false,
      score: 0,
      source: 'local',
      sourceId: null,
      area: false,
      city: '杭州市',
      district: '西湖区'
    });
    // provider results keep their own city and district, not a guessed one
    expect(results[1]).toMatchObject({ poiId: null, distance: 0, score: 0, city: null, district: null });
  });

  it('drops a provider result that is a stored place under the same name', async () => {
    answer = photon([feature('断桥', 2, 0, 10)]);
    const results = await searchPlaces(makeEnv([poiRow()]).env, 'u_1', '断桥', null);
    expect(results.map((r) => r.source)).toEqual(['local']);
  });

  it('looks for the term in names and aliases with LIKE wildcards escaped, among the places offered to the user', async () => {
    answer = photon([]);
    const { env, d1 } = makeEnv([]);
    await searchPlaces(env, 'u_1', '50%_', null);
    const query = d1.calls.find((c) => c.sql.includes('FROM pois'));
    expect(query?.sql).toMatch(/po\.name LIKE \?1 ESCAPE '\\' OR po\.aliases LIKE \?2 ESCAPE '\\'/);
    expect(query?.params.slice(0, 2)).toEqual(['%50\\%\\_%', '%50\\%\\_%']);
    expect(query?.params).toContain('u_1');
  });

  it('keeps the stored places when every provider fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    answer = () => new Response('down', { status: 502 });
    const results = await searchPlaces(makeEnv([poiRow()]).env, 'u_1', '断桥', null);
    expect(results.map((r) => r.name)).toEqual(['断桥']);
    expect(warn).toHaveBeenCalledWith('search: provider failed', expect.anything());
  });

  it('returns at most 30', async () => {
    answer = photon(Array.from({ length: 40 }, (_, i) => feature(`断桥${i}`, 100 + i, i * 9, 200 + i * 100)));
    const results = await searchPlaces(makeEnv([poiRow()]).env, 'u_1', '断桥', null);
    expect(results).toHaveLength(30);
    expect(results[0].source).toBe('local');
  });
});

describe('searchPlaces near a photo', () => {
  it('measures every result from the photo and sorts by distance', async () => {
    answer = photon([feature('断桥残雪', 2, 90, 3000), feature('断桥公园', 3, 0, 500)]);
    const results = await searchPlaces(makeEnv([poiRow({ lat: destination(AT.lat, AT.lng, 180, 1000)[0] })]).env, 'u_1', '断桥', AT);
    expect(results.map((r) => [r.name, Math.round(r.distance)])).toEqual([
      ['断桥公园', 500],
      ['断桥', 1000],
      ['断桥残雪', 3000]
    ]);
    expect(results.every((r) => r.inView === false)).toBe(true);
  });

  it('puts the stored place first when it is as far as a provider result', async () => {
    const [lat, lng] = destination(AT.lat, AT.lng, 0, 300);
    // a different name (no dedupe) and no areal suffix (that would make it an area at distance 0)
    answer = photon([feature('Lakeside', 2, 0, 300)]);
    const results = await searchPlaces(makeEnv([poiRow({ name: '断桥', lat, lng })]).env, 'u_1', '断桥', AT);
    expect(results.map((r) => [r.source, r.distance])).toEqual([
      ['local', 300],
      ['osm', 300]
    ]);
  });
});
