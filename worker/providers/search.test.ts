import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Env } from '../env';
import { fakeKv } from '../test-utils';
import { nameMatches, searchExternal } from './match';

// Name search for the upload place picker: near the photo when it has a position, otherwise anywhere.
// docs/api/pois.md#get-apipoissearchqlatlng登录

const AT = { lat: 30.2593, lng: 120.1516 };

const feature = (name: string, id: number, key: string, value: string) => ({
  geometry: { coordinates: [120.1517, 30.2594] },
  properties: { osm_type: 'N', osm_id: id, osm_key: key, osm_value: value, name }
});

let calls: URL[];
let answer: (url: URL) => Response;

beforeEach(() => {
  calls = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
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

const env = (extra: Partial<Env> = {}) => {
  const kv = fakeKv();
  return { env: { KV: kv.kv, ...extra } as unknown as Env, kv };
};

/** Photon's word search finds only `searchHits`; its nearby list holds `nearby`; Nominatim finds nothing. */
function world(searchHits: unknown[], nearby: unknown[]) {
  return (url: URL) => {
    if (url.hostname === 'photon.komoot.io') return Response.json({ features: url.pathname === '/api' ? searchHits : nearby });
    return Response.json([]);
  };
}

describe('nameMatches', () => {
  it('finds a term inside a name, ignoring case, width and separators', () => {
    expect(nameMatches('库迪咖啡', '咖啡')).toBe(true);
    expect(nameMatches('Starbucks Reserve', 'starbucks')).toBe(true);
    expect(nameMatches('ＳＴＡＲＢＵＣＫＳ', 'starbucks')).toBe(true);
    expect(nameMatches('断桥 残雪', '断桥残雪')).toBe(true);
    expect(nameMatches('断桥', '孤山')).toBe(false);
  });
});

describe('searchExternal near a photo', () => {
  it('adds nearby places whose name contains the term, which word search misses', async () => {
    answer = world(
      [feature('华欧法式烘焙&咖啡', 1, 'shop', 'bakery')],
      [feature('库迪咖啡', 2, 'amenity', 'cafe'), feature('断桥', 3, 'man_made', 'bridge')]
    );
    const names = (await searchExternal(env().env, '咖啡', AT)).map((p) => p.name);
    expect(names).toEqual(['华欧法式烘焙&咖啡', '库迪咖啡']);
  });

  it('asks Photon and Nominatim within the box around the photo', async () => {
    answer = world([], []);
    await searchExternal(env().env, '断桥', AT);
    const search = calls.find((u) => u.pathname === '/api');
    const nominatim = calls.find((u) => u.hostname === 'nominatim.openstreetmap.org');
    expect(search?.searchParams.get('bbox')).toBeTruthy();
    expect(nominatim?.searchParams.get('bounded')).toBe('1');
    // the substring filter runs over the places within 1 km
    expect(calls.filter((u) => u.pathname === '/reverse').every((u) => u.searchParams.get('radius') === '1.000')).toBe(true);
  });

  it('caches the search per term and roughly per kilometre', async () => {
    answer = world([], []);
    const { env: e, kv } = env();
    await searchExternal(e, ' 断桥 '.trim(), AT);
    expect([...kv.store.keys()].sort()).toEqual(['poi:near:photon:30.2593:120.1516:1000', 'poi:q:osm:断桥:30.26:120.15']);
  });

  it('still answers from the nearby list when name search is down', async () => {
    answer = (url) =>
      url.hostname === 'photon.komoot.io' && url.pathname === '/reverse'
        ? Response.json({ features: [feature('库迪咖啡', 2, 'amenity', 'cafe')] })
        : new Response('down', { status: 502 });
    expect((await searchExternal(env().env, '咖啡', AT)).map((p) => p.name)).toEqual(['库迪咖啡']);
  });

  it('fails when every source does', async () => {
    answer = () => new Response('down', { status: 502 });
    await expect(searchExternal(env().env, '咖啡', AT)).rejects.toThrow();
  });
});

describe('searchExternal without a position', () => {
  it('searches everywhere and does not look at a nearby list', async () => {
    answer = world([feature('断桥', 3, 'man_made', 'bridge')], []);
    const names = (await searchExternal(env().env, '断桥', null)).map((p) => p.name);
    expect(names).toEqual(['断桥']);
    expect(calls.some((u) => u.pathname === '/reverse')).toBe(false);
    expect(calls.find((u) => u.pathname === '/api')?.searchParams.has('bbox')).toBe(false);
  });
});

describe('searchExternal with an AMap key', () => {
  const amap = () => Response.json({ status: '1', pois: [] });

  it('uses AMap’s nearby keyword search in China', async () => {
    answer = amap;
    await searchExternal(env({ AMAP_KEY: 'k' }).env, '咖啡', AT);
    expect(calls).toHaveLength(1);
    expect(calls[0].pathname).toBe('/v3/place/around');
    expect(calls[0].searchParams.get('keywords')).toBe('咖啡');
    expect(calls[0].searchParams.get('radius')).toBe('6000');
    expect(calls[0].searchParams.has('types')).toBe(false);
  });

  it('uses AMap’s text search without a position', async () => {
    answer = amap;
    await searchExternal(env({ AMAP_KEY: 'k' }).env, '断桥', null);
    expect(calls[0].pathname).toBe('/v3/place/text');
  });

  it('uses OpenStreetMap abroad even with a key', async () => {
    answer = world([], []);
    // Tokyo: east of the rough China box (Kyoto and Seoul still fall inside it)
    await searchExternal(env({ AMAP_KEY: 'k' }).env, 'Shibuya', { lat: 35.6595, lng: 139.7005 });
    expect(calls.some((u) => u.hostname === 'restapi.amap.com')).toBe(false);
  });
});
