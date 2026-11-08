import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Env } from '../env';
import { fakeD1, fakeKv, type DbCall } from '../test-utils';
import { fillRegions, REGION_BATCH, REGION_SPACING_MS } from './regions';

// The hourly region job (docs/architecture/cloudflare.md#定时任务), with D1, KV and the network replaced by stand-ins.

const YULIN = { lat: 22.600624, lng: 110.143724 };
/** Nominatim's street-level answer there: the county as `city`, the prefecture as `region` */
const YULIN_ADDRESS = { address: { city: '玉州区', region: '玉林市', state: '广西壮族自治区', country_code: 'cn' } };

interface Todo {
  id: string;
  lat: number | null;
  lng: number | null;
  poi_lat?: number | null;
  poi_lng?: number | null;
}

function makeEnv(todo: Todo[], extra: Partial<Env> = {}) {
  const d1 = fakeD1((call: DbCall) => (call.method === 'all' ? todo.map((t) => ({ poi_lat: null, poi_lng: null, ...t })) : null));
  const kv = fakeKv();
  return { env: { DB: d1.db, KV: kv.kv, ...extra } as unknown as Env, d1, kv };
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

const updates = (calls: DbCall[]) => calls.filter((c) => c.method === 'run').map((c) => c.params);
const noWait = { wait: async () => {} };

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fillRegions', () => {
  it('asks for photos without a province that have a position of their own or a place, in random order', async () => {
    stubFetch(() => Response.json(YULIN_ADDRESS));
    const { env, d1 } = makeEnv([]);
    expect(await fillRegions(env, noWait)).toEqual({ filled: 0, empty: 0, failed: 0 });
    const [select] = d1.calls;
    expect(select.sql).toContain('p.province IS NULL');
    expect(select.sql).toContain('LEFT JOIN pois po ON po.id = p.poi_id');
    expect(select.sql).toContain('ORDER BY random()');
    expect(select.params).toEqual([REGION_BATCH]);
  });

  it('stores the province, and the city and district only where they are missing', async () => {
    stubFetch(() => Response.json(YULIN_ADDRESS));
    const { env, d1 } = makeEnv([{ id: 'ph_1', ...YULIN }]);
    expect(await fillRegions(env, noWait)).toEqual({ filled: 1, empty: 0, failed: 0 });
    const update = d1.calls.find((c) => c.method === 'run');
    expect(update?.sql).toContain('city = COALESCE(city, ?3), district = COALESCE(district, ?4)');
    expect(update?.sql).toContain('WHERE id = ?1 AND province IS NULL');
    expect(update?.params).toEqual(['ph_1', '广西壮族自治区', '玉林市', '玉州区']);
  });

  it('places a photo without coordinates of its own at its place', async () => {
    const calls = stubFetch(() => Response.json(YULIN_ADDRESS));
    const { env } = makeEnv([{ id: 'ph_1', lat: null, lng: null, poi_lat: YULIN.lat, poi_lng: YULIN.lng }]);
    await fillRegions(env, noWait);
    expect(calls[0].searchParams.get('lat')).toBe('22.601000');
    expect(calls[0].searchParams.get('lon')).toBe('110.144000');
  });

  it('marks a spot without a province with an empty string, so the job does not come back to it', async () => {
    stubFetch(() => Response.json({ error: 'Unable to geocode' }));
    const { env, d1 } = makeEnv([{ id: 'ph_sea', lat: 20, lng: 115 }]);
    expect(await fillRegions(env, noWait)).toEqual({ filled: 0, empty: 1, failed: 0 });
    expect(updates(d1.calls)).toEqual([['ph_sea', '', null, null]]);
  });

  it('leaves a photo for a later run when the geocoder fails, and goes on with the next', async () => {
    let n = 0;
    stubFetch(() => (n++ === 0 ? new Response('busy', { status: 503 }) : Response.json(YULIN_ADDRESS)));
    const { env, d1 } = makeEnv([
      { id: 'ph_1', ...YULIN },
      { id: 'ph_2', lat: YULIN.lat + 1, lng: YULIN.lng }
    ]);
    expect(await fillRegions(env, noWait)).toEqual({ filled: 1, empty: 0, failed: 1 });
    expect(updates(d1.calls).map((p) => p[0])).toEqual(['ph_2']);
    expect(warn).toHaveBeenCalledWith('regions: reverse geocode failed', 'ph_1', 'nominatim reverse: HTTP 503');
  });

  it('pauses between photos, not before the first', async () => {
    stubFetch(() => Response.json(YULIN_ADDRESS));
    const wait = vi.fn(async () => {});
    const { env } = makeEnv([
      { id: 'ph_1', ...YULIN },
      { id: 'ph_2', ...YULIN },
      { id: 'ph_3', ...YULIN }
    ]);
    await fillRegions(env, { wait });
    expect(wait.mock.calls).toEqual([[REGION_SPACING_MS], [REGION_SPACING_MS]]);
  });

  it('shares the reverse geocode cache with the match flow', async () => {
    const calls = stubFetch(() => Response.json(YULIN_ADDRESS));
    const { env, kv } = makeEnv([
      { id: 'ph_1', ...YULIN },
      { id: 'ph_2', lat: YULIN.lat + 0.00001, lng: YULIN.lng }
    ]);
    await fillRegions(env, noWait);
    expect(calls).toHaveLength(1);
    expect([...kv.store.keys()]).toEqual(['geo:rev2:osm:22.601:110.144']);
  });

  it('uses AMap inside China when a key is configured', async () => {
    const calls = stubFetch(() =>
      Response.json({ status: '1', regeocode: { addressComponent: { province: '广西壮族自治区', city: '玉林市', district: '玉州区' } } })
    );
    const { env, d1 } = makeEnv([{ id: 'ph_1', ...YULIN }], { AMAP_KEY: 'k' });
    await fillRegions(env, noWait);
    expect(calls[0].hostname).toBe('restapi.amap.com');
    expect(updates(d1.calls)).toEqual([['ph_1', '广西壮族自治区', '玉林市', '玉州区']]);
  });

  it('takes a smaller batch when asked', async () => {
    const { env, d1 } = makeEnv([]);
    await fillRegions(env, { ...noWait, batch: 2 });
    expect(d1.calls[0].params).toEqual([2]);
  });
});
