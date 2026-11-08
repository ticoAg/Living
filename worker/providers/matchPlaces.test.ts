import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { destination, distance, wgs84ToGcj02 } from '../../shared/geo';
import type { Env } from '../env';
import type { PoiRow } from '../lib/poi';
import { fakeD1, fakeKv, type DbCall } from '../test-utils';
import { matchPlaces } from './match';

// matchPlaces end to end: local table + provider + reverse geocode + privacy zones, with the network and
// database replaced by stand-ins. docs/api/pois.md#post-apipoismatch-登录

// Leifeng Pagoda, in China
const PHOTO = { lat: 30.2316, lng: 120.1479 };
const INPUT = { ...PHOTO, heading: null, radius: 300 };

const poiRow = (over: Partial<PoiRow> = {}): PoiRow => ({
  id: 'poi_1',
  name: '净慈寺',
  aliases: null,
  category: '寺',
  city: '杭州',
  district: '西湖区',
  lat: 0,
  lng: 0,
  radius: 150,
  source: 'custom',
  source_id: null,
  created_by: 'u_1',
  created_at: '2026-11-01T00:00:00Z',
  ...over
});

/** A stored place `meters` from the photo towards `bearing`. */
function poiAt(bearing: number, meters: number, over: Partial<PoiRow> = {}): PoiRow {
  const [lat, lng] = destination(PHOTO.lat, PHOTO.lng, bearing, meters);
  return poiRow({ lat, lng, ...over });
}

interface World {
  pois?: PoiRow[];
  zones?: { id: string; name: string; lat: number; lng: number; radius: number }[];
}

function makeEnv(world: World = {}, extra: Partial<Env> = {}) {
  const pois = world.pois ?? [];
  const widest = pois.reduce((m, p) => Math.max(m, p.radius), 0);
  const d1 = fakeD1((call: DbCall) => {
    if (call.sql.includes('MAX(radius)')) return { r: widest };
    if (call.sql.includes('FROM pois')) return pois;
    if (call.sql.includes('privacy_zones')) return world.zones ?? [];
    return null;
  });
  const kv = fakeKv();
  return { env: { DB: d1.db, KV: kv.kv, ...extra } as unknown as Env, kv, d1 };
}

/** Replaces `fetch`; every request is answered by `handler` and logged. */
function stubFetch(handler: (url: URL) => Response) {
  const calls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      calls.push(url);
      return handler(url);
    })
  );
  return calls;
}

const elementAt = (bearing: number, meters: number, id: number, tags: Record<string, string>) => {
  const [lat, lon] = destination(PHOTO.lat, PHOTO.lng, bearing, meters);
  return { type: 'node', id, lat, lon, tags };
};

const CHINA_ADDRESS = { address: { country_code: 'cn', city: '西湖区', state_district: '杭州市', state: '浙江省' } };

type Element = ReturnType<typeof elementAt>;

/** The same places as Photon reports them: a GeoJSON point and the main OSM tag. */
const photonOf = (elements: Element[]) => ({
  type: 'FeatureCollection',
  features: elements.map((e) => {
    const [key, value] = Object.entries(e.tags).find(([k]) => k !== 'name') ?? ['', ''];
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
      properties: { osm_type: 'N', osm_id: e.id, osm_key: key, osm_value: value, name: e.tags['name'] }
    };
  })
});

/**
 * An OpenStreetMap world: Photon and Overpass both know `places` (or fail when given a status), Nominatim answers the
 * reverse geocode with `nominatim`.
 */
function osm(places: { elements: Element[] } | number, nominatim: unknown = CHINA_ADDRESS) {
  return (url: URL) => {
    const body =
      url.hostname === 'photon.komoot.io'
        ? typeof places === 'number'
          ? places
          : photonOf(places.elements)
        : url.hostname.includes('overpass')
          ? places
          : nominatim;
    return typeof body === 'number' ? new Response('error', { status: body }) : Response.json(body);
  };
}

const hosts = (calls: URL[]) => calls.map((u) => u.hostname).sort();

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('matchPlaces with OpenStreetMap', () => {
  const world = (): World => ({
    pois: [
      poiAt(90, 250, { id: 'poi_temple', name: '净慈寺', category: '寺', radius: 150 }),
      poiAt(180, 500, { id: 'poi_lake', name: '西湖', category: '湖', radius: 600 }),
      poiAt(0, 800, { id: 'poi_far', name: '远处的塔', category: '塔', radius: 100 })
    ]
  });

  it('merges local and provider places, ranks them, and reports the provider and the area', async () => {
    stubFetch(
      osm({
        elements: [
          elementAt(0, 100, 1, { name: '雷峰塔', tourism: 'attraction' }),
          // the same temple the site already has, a few metres from where the site has it
          elementAt(90, 255, 2, { name: '净慈寺', amenity: 'place_of_worship' })
        ]
      })
    );
    const { env } = makeEnv(world());
    const result = await matchPlaces(env, 'u_1', INPUT);

    expect(result.provider).toBe('osm');
    expect(result.province).toBe('浙江省');
    expect(result.city).toBe('杭州市');
    expect(result.district).toBe('西湖区');
    expect(result.privacyZone).toBeNull();
    expect(result.candidates.map((c) => c.name)).toEqual(['雷峰塔', '净慈寺', '西湖']);
    expect(result.candidates.map((c) => c.source)).toEqual(['osm', 'local', 'local']);
    // the lake contains the photo, so it is the fallback: distance 0, area, last
    expect(result.candidates[2]).toMatchObject({ area: true, distance: 0, poiId: 'poi_lake' });
    // the provider's copy of the temple was dropped, not listed twice
    expect(result.candidates.filter((c) => c.name === '净慈寺')).toHaveLength(1);
  });

  it('leaves out stored places that are beyond both the search radius and their own radius', async () => {
    stubFetch(osm({ elements: [] }));
    const { env } = makeEnv(world());
    const names = (await matchPlaces(env, 'u_1', INPUT)).candidates.map((c) => c.name);
    expect(names).not.toContain('远处的塔');
  });

  it('includes a large stored place even when it is further than the search radius', async () => {
    stubFetch(osm({ elements: [] }));
    // the lake is 500 m away and the search radius 300 m, but its own radius is 600 m
    const { env } = makeEnv(world());
    const names = (await matchPlaces(env, 'u_1', { ...INPUT, radius: 300 })).candidates.map((c) => c.name);
    expect(names).toContain('西湖');
  });

  it('puts a place in front of the camera ahead of one behind it', async () => {
    stubFetch(
      osm({
        elements: [
          elementAt(0, 120, 1, { name: '面前', tourism: 'attraction' }),
          elementAt(180, 100, 2, { name: '身后', tourism: 'attraction' })
        ]
      })
    );
    const { env } = makeEnv();
    const facingNorth = await matchPlaces(env, 'u_1', { ...INPUT, heading: 0 });
    expect(facingNorth.candidates.map((c) => c.name)).toEqual(['面前', '身后']);
    expect(facingNorth.candidates[0].inView).toBe(true);
    const noHeading = await matchPlaces(makeEnv().env, 'u_1', INPUT);
    expect(noHeading.candidates.map((c) => c.name)).toEqual(['身后', '面前']);
  });

  it('names the privacy zone the photo falls in, and still returns candidates', async () => {
    stubFetch(osm({ elements: [elementAt(0, 100, 1, { name: '雷峰塔', tourism: 'attraction' })] }));
    const zones = [{ id: 'pz_1', name: '家', lat: PHOTO.lat, lng: PHOTO.lng, radius: 100 }];
    const result = await matchPlaces(makeEnv({ zones }).env, 'u_1', INPUT);
    expect(result.privacyZone).toBe('家');
    expect(result.candidates).toHaveLength(1);
  });
});

describe('matchPlaces when a provider fails', () => {
  const stored = () => ({ pois: [poiAt(90, 250, { id: 'poi_temple', name: '净慈寺', category: '寺', radius: 150 })] });

  it('falls back to Overpass when Photon is down', async () => {
    const elements = [elementAt(0, 100, 1, { name: '雷峰塔', tourism: 'attraction' })];
    stubFetch((url) => (url.hostname === 'photon.komoot.io' ? new Response('down', { status: 502 }) : osm({ elements })(url)));
    const result = await matchPlaces(makeEnv().env, 'u_1', INPUT);
    expect(result.provider).toBe('osm');
    expect(result.candidates.map((c) => c.name)).toEqual(['雷峰塔']);
    expect(warn).toHaveBeenCalledWith('photon nearby failed, trying overpass', 'photon reverse: HTTP 502');
  });

  it('still lists places when only one of the two Photon requests fails', async () => {
    const elements = [elementAt(0, 100, 1, { name: '雷峰塔', tourism: 'attraction' })];
    // the landmark request carries osm_tag filters; let only that one fail
    const calls = stubFetch((url) => (url.searchParams.has('osm_tag') ? new Response('busy', { status: 503 }) : osm({ elements })(url)));
    const result = await matchPlaces(makeEnv().env, 'u_1', INPUT);
    expect(result.provider).toBe('osm');
    expect(result.candidates.map((c) => c.name)).toEqual(['雷峰塔']);
    expect(calls.some((u) => u.hostname.includes('overpass'))).toBe(false);
  });

  it('still answers with the stored places and says the provider was "local"', async () => {
    stubFetch(osm(500));
    const result = await matchPlaces(makeEnv(stored()).env, 'u_1', INPUT);
    expect(result.provider).toBe('local');
    expect(result.candidates.map((c) => c.name)).toEqual(['净慈寺']);
    // the geocoder worked, so the area is still known
    expect(result.city).toBe('杭州市');
    expect(warn).toHaveBeenCalledWith('match: osm nearby search failed', 'overpass: HTTP 500');
  });

  it('takes city and district from the nearest stored place when reverse geocoding fails', async () => {
    stubFetch(osm({ elements: [elementAt(0, 100, 1, { name: '雷峰塔', tourism: 'attraction' })] }, 503));
    const result = await matchPlaces(makeEnv(stored()).env, 'u_1', INPUT);
    expect(result.provider).toBe('osm');
    // 雷峰塔 has no address of its own, so the temple’s is used
    expect(result.candidates.map((c) => c.name)).toEqual(['雷峰塔', '净慈寺']);
    expect(result.city).toBe('杭州');
    expect(result.district).toBe('西湖区');
    // places carry no province: only the geocoder knows it
    expect(result.province).toBeNull();
    expect(warn).toHaveBeenCalledWith('match: osm reverse geocode failed', 'nominatim reverse: HTTP 503');
  });

  it('answers with nothing, but does not fail, when everything is down and nothing is stored', async () => {
    stubFetch(osm(500, 500));
    const result = await matchPlaces(makeEnv().env, 'u_1', INPUT);
    expect(result).toEqual({ candidates: [], province: null, city: null, district: null, provider: 'local', privacyZone: null });
  });

  it('looks up the prefecture-level city when the street address leaves it out, once per spot', async () => {
    const calls = stubFetch((url) => {
      if (url.hostname !== 'nominatim.openstreetmap.org') return osm({ elements: [] })(url);
      const wide = url.searchParams.get('zoom') === '7';
      return Response.json({ address: { country_code: 'cn', city: wide ? '杭州市' : '西湖区', state: '浙江省' } });
    });
    const { env } = makeEnv();
    const result = await matchPlaces(env, 'u_1', INPUT);
    expect(result).toMatchObject({ province: '浙江省', city: '杭州市', district: '西湖区' });
    await matchPlaces(env, 'u_2', INPUT);
    const nominatim = calls.filter((u) => u.hostname === 'nominatim.openstreetmap.org').map((u) => u.searchParams.get('zoom'));
    expect(nominatim).toEqual(['16', '7']);
  });

  it('fills a provider place’s missing city and district from the reverse geocode', async () => {
    stubFetch(osm({ elements: [elementAt(0, 100, 1, { name: '雷峰塔', tourism: 'attraction' })] }));
    const result = await matchPlaces(makeEnv().env, 'u_1', INPUT);
    expect(result.candidates[0]).toMatchObject({ city: '杭州市', district: '西湖区' });
  });
});

describe('matchPlaces with AMap', () => {
  const env = () => makeEnv({}, { AMAP_KEY: 'amap-key' });
  const [gLat, gLng] = wgs84ToGcj02(PHOTO.lat, PHOTO.lng);
  const gcj = (lat: number, lng: number) => {
    const [a, b] = wgs84ToGcj02(lat, lng);
    return `${b.toFixed(6)},${a.toFixed(6)}`;
  };

  function amapWorld(url: URL) {
    if (url.pathname.endsWith('/place/around')) {
      const [lat, lng] = destination(PHOTO.lat, PHOTO.lng, 0, 100);
      return Response.json({
        status: '1',
        pois: [
          {
            id: 'B0FFF1',
            name: '雷峰塔',
            type: '风景名胜;风景名胜;国家级景点',
            location: gcj(lat, lng),
            cityname: '杭州市',
            adname: '西湖区'
          }
        ]
      });
    }
    return Response.json({ status: '1', regeocode: { addressComponent: { province: '浙江省', city: '杭州市', district: '西湖区' } } });
  }

  it('queries AMap in GCJ-02 and gets the answer back in WGS-84', async () => {
    const calls = stubFetch(amapWorld);
    const result = await matchPlaces(env().env, 'u_1', INPUT);

    expect(result.provider).toBe('amap');
    expect(calls.every((u) => u.hostname === 'restapi.amap.com')).toBe(true);
    const around = calls.find((u) => u.pathname.endsWith('/place/around'));
    expect(around?.searchParams.get('location')).toBe(`${gLng.toFixed(6)},${gLat.toFixed(6)}`);
    expect(around?.searchParams.get('key')).toBe('amap-key');

    expect(result.candidates).toHaveLength(1);
    const [tower] = result.candidates;
    expect(tower).toMatchObject({ name: '雷峰塔', category: '塔', source: 'amap', sourceId: 'B0FFF1' });
    // 100 m north of the photo in WGS-84, although AMap spoke GCJ-02 (about 500 m off)
    expect(tower.distance).toBeGreaterThan(99);
    expect(tower.distance).toBeLessThan(101);
    expect(tower.bearing).toBe(0);
    expect(distance(PHOTO.lat, PHOTO.lng, tower.lat, tower.lng)).toBeCloseTo(100, 0);
    expect(result).toMatchObject({ province: '浙江省', city: '杭州市', district: '西湖区' });
  });

  it('uses OpenStreetMap instead for a photo taken abroad, key or not', async () => {
    const calls = stubFetch(osm({ elements: [] }, { address: { city: 'Tokyo', suburb: 'Shibuya' } }));
    const result = await matchPlaces(env().env, 'u_1', { lat: 35.6595, lng: 139.7005, heading: null, radius: 300 });
    expect(result.provider).toBe('osm');
    expect(hosts(calls)).toEqual(['nominatim.openstreetmap.org', 'photon.komoot.io', 'photon.komoot.io']);
    expect(result).toMatchObject({ city: 'Tokyo', district: 'Shibuya' });
  });

  it('uses OpenStreetMap in China when no key is configured', async () => {
    const calls = stubFetch(osm({ elements: [] }));
    const result = await matchPlaces(makeEnv().env, 'u_1', INPUT);
    expect(result.provider).toBe('osm');
    expect(calls.some((u) => u.hostname === 'restapi.amap.com')).toBe(false);
  });
});

describe('matchPlaces caching', () => {
  const elements = [elementAt(0, 100, 1, { name: '雷峰塔', tourism: 'attraction' })];

  it('stores provider answers in KV under keys with the source, a coordinate grid and the radius', async () => {
    stubFetch(osm({ elements }));
    const { env, kv } = makeEnv();
    await matchPlaces(env, 'u_1', INPUT);
    expect([...kv.store.keys()].sort()).toEqual(['geo:rev2:osm:30.232:120.148', 'poi:near:photon:30.2316:120.1479:300']);
    expect(kv.puts.every((p) => (p.options as { expirationTtl: number }).expirationTtl === 604_800)).toBe(true);
  });

  it('asks each provider only once for the same spot, however many photos are taken there', async () => {
    const calls = stubFetch(osm({ elements }));
    const { env } = makeEnv();
    const first = await matchPlaces(env, 'u_1', INPUT);
    const second = await matchPlaces(env, 'u_2', INPUT);
    // two Photon requests (nearest anything, nearest landmarks) and one reverse geocode
    expect(calls).toHaveLength(3);
    expect(second).toEqual(first);
  });

  it('looks again for a different radius, but not again for the reverse geocode', async () => {
    const calls = stubFetch(osm({ elements }));
    const { env } = makeEnv();
    await matchPlaces(env, 'u_1', INPUT);
    await matchPlaces(env, 'u_1', { ...INPUT, radius: 500 });
    expect(hosts(calls)).toEqual(['nominatim.openstreetmap.org', ...Array<string>(4).fill('photon.komoot.io')]);
  });

  it('shares an answer between photos a few metres apart', async () => {
    const calls = stubFetch(osm({ elements }));
    const { env } = makeEnv();
    await matchPlaces(env, 'u_1', INPUT);
    await matchPlaces(env, 'u_1', { ...INPUT, lat: PHOTO.lat + 0.00001, lng: PHOTO.lng - 0.00001 });
    expect(calls).toHaveLength(3);
  });

  it('does not cache a failed lookup, so the next photo tries again', async () => {
    let healthy = false;
    const calls = stubFetch((url) =>
      healthy || !/photon|overpass/.test(url.hostname) ? osm({ elements })(url) : new Response('busy', { status: 500 })
    );
    const { env } = makeEnv();
    expect((await matchPlaces(env, 'u_1', INPUT)).provider).toBe('local');
    healthy = true;
    const retry = await matchPlaces(env, 'u_1', INPUT);
    expect(retry.provider).toBe('osm');
    expect(retry.candidates.map((c) => c.name)).toEqual(['雷峰塔']);
    // Photon twice per attempt; Overpass only as the fallback of the failed first attempt
    expect(calls.filter((u) => u.hostname === 'photon.komoot.io')).toHaveLength(4);
    expect(calls.filter((u) => u.hostname.includes('overpass'))).toHaveLength(1);
  });
});
