// Places against real D1 and KV, with the place providers stubbed: docs/api/pois.md.

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { MatchCandidate, MatchResponse, Poi } from '../../shared/types';
import { Client, expectStatus, newUser, upload, usePlatform } from '../test-platform';

const platform = usePlatform();

let owner: Client;
let alice: Client;
let bob: Client;
beforeEach(async () => {
  // provider failures are logged as warnings; they are the expected case here
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  owner = await newUser(platform, 'site_owner', 'owner');
  alice = await newUser(platform, 'alice');
  bob = await newUser(platform, 'bob');
});

const HERE = { lat: 30.2588, lng: 120.1512 };
const createPoi = async (client: Client, body: Record<string, unknown>): Promise<Poi> =>
  expectStatus(await client.post('/api/pois', body), 201).poi;

describe('POST /api/pois', () => {
  it('creates a custom place with the category’s default radius', async () => {
    const poi = await createPoi(alice, { name: '断桥', category: '桥', lat: 30.2593, lng: 120.1517, city: '杭州市' });
    expect(poi).toMatchObject({ name: '断桥', category: '桥', source: 'custom', sourceId: null, radius: 60, city: '杭州市' });
    expect(poi.id).toMatch(/^poi_/);
    expect(poi).not.toHaveProperty('createdBy');
  });

  it('returns the existing place for a provider source id', async () => {
    const body = { name: '西湖', category: '湖', lat: 30.24, lng: 120.14, source: 'osm', sourceId: 'relation/1' };
    const a = await createPoi(alice, body);
    const b = await createPoi(bob, { ...body, name: '另一个名字' });
    expect(b.id).toBe(a.id);
    expect(b.name).toBe('西湖');
  });

  it('checks the input', async () => {
    for (const body of [
      { category: '湖', lat: 1, lng: 1 },
      { name: 'x', category: '星球', lat: 1, lng: 1 },
      { name: 'x', category: '湖' }
    ]) {
      expect((await alice.post('/api/pois', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await new Client(platform).post('/api/pois', { name: 'x', category: '湖', lat: 1, lng: 1 })).status).toBe(401);
  });
});

describe('PATCH /api/pois/:id', () => {
  it('lets the creator change name, category, radius and aliases', async () => {
    const poi = await createPoi(alice, { name: '断桥', category: '桥', lat: 30.2593, lng: 120.1517 });
    const res = await alice.patch(`/api/pois/${poi.id}`, {
      name: '断桥残雪',
      category: '景',
      radius: 150,
      aliases: ['Broken Bridge', '断桥']
    });
    const updated = expectStatus(res, 200).poi;
    expect(updated).toMatchObject({ name: '断桥残雪', category: '景', radius: 150, aliases: ['Broken Bridge', '断桥'], canEdit: true });
    expect(updated).not.toHaveProperty('count');
    expect(expectStatus(await alice.patch(`/api/pois/${poi.id}`, { aliases: [] }), 200).poi.aliases).toEqual([]);
  });

  it('splits aliases given as one string on the documented separators', async () => {
    const poi = await createPoi(alice, { name: '西湖', category: '湖', lat: 30.24, lng: 120.14 });
    const res = await alice.patch(`/api/pois/${poi.id}`, { aliases: 'West Lake，钱塘湖;明圣湖；西子湖、金牛湖\n上湖' });
    expect(expectStatus(res, 200).poi.aliases).toEqual(['West Lake', '钱塘湖', '明圣湖', '西子湖', '金牛湖', '上湖']);
  });

  it('merges repeated aliases given as one string', async () => {
    const poi = await createPoi(alice, { name: '西湖', category: '湖', lat: 30.24, lng: 120.14 });
    const res = await alice.patch(`/api/pois/${poi.id}`, { aliases: '西子湖，西子湖、West Lake' });
    expect(expectStatus(res, 200).poi.aliases).toEqual(['西子湖', 'West Lake']);
  });

  it('accepts at most 20 aliases', async () => {
    const poi = await createPoi(alice, { name: '西湖', category: '湖', lat: 30.24, lng: 120.14 });
    const aliases = Array.from({ length: 21 }, (_, i) => `别名${i}`);
    expect((await alice.patch(`/api/pois/${poi.id}`, { aliases })).status).toBe(400);
    expectStatus(await alice.patch(`/api/pois/${poi.id}`, { aliases: aliases.slice(1) }), 200);
  });

  it('holds aliases given as one string to the 20-alias limit', async () => {
    const poi = await createPoi(alice, { name: '西湖', category: '湖', lat: 30.24, lng: 120.14 });
    const aliases = Array.from({ length: 21 }, (_, i) => `别名${i}`);
    expect((await alice.patch(`/api/pois/${poi.id}`, { aliases: aliases.join('、') })).status).toBe(400);
  });

  it('checks the fields', async () => {
    const poi = await createPoi(alice, { name: '西湖', category: '湖', lat: 30.24, lng: 120.14 });
    for (const body of [
      { name: '' },
      { name: 'x'.repeat(81) },
      { category: '星球' },
      { radius: 9 },
      { radius: 5001 },
      { aliases: ['x'.repeat(81)] }
    ]) {
      expect((await alice.patch(`/api/pois/${poi.id}`, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('is for the creator, the site owner and admins only', async () => {
    const poi = await createPoi(alice, { name: '西湖', category: '湖', lat: 30.24, lng: 120.14 });
    const res = await bob.patch(`/api/pois/${poi.id}`, { name: 'x' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden' });
    expect((await new Client(platform).patch(`/api/pois/${poi.id}`, { name: 'x' })).status).toBe(401);
    expect((await alice.patch('/api/pois/poi_missing', { name: 'x' })).status).toBe(404);
    expectStatus(await owner.patch(`/api/pois/${poi.id}`, { name: '西湖景区' }), 200);
  });
});

describe('POST /api/pois/match', () => {
  const match = async (client: Client, body: Record<string, unknown> = HERE) =>
    expectStatus(await client.post<MatchResponse>('/api/pois/match', body), 200);
  const names = (candidates: MatchCandidate[]) => candidates.map((c) => c.name);

  it('falls back to the site’s own places when the providers are down, without leaving the machine', async () => {
    await createPoi(alice, { name: '断桥', category: '桥', lat: 30.2593, lng: 120.1517, city: '杭州市', district: '西湖区' });
    const res = await match(alice);
    expect(res.provider).toBe('local');
    expect(names(res.candidates)).toEqual(['断桥']);
    expect(res.candidates[0]).toMatchObject({ source: 'local', poiId: expect.stringMatching(/^poi_/) });
    // the nearest local place still tells the city and district
    expect(res).toMatchObject({ province: null, city: '杭州市', district: '西湖区', privacyZone: null });
    // the providers were asked (and answered by the stub)
    expect(platform.external.calls.length).toBeGreaterThan(0);
    expect(
      platform.external.calls.every((u) => ['photon.komoot.io', 'nominatim.openstreetmap.org', 'overpass-api.de'].includes(u.hostname))
    ).toBe(true);
  });

  it('names the privacy zone the point is in', async () => {
    expectStatus(await alice.post('/api/privacy-zones', { name: '家', lat: 30.258, lng: 120.151, radius: 300 }), 201);
    expect((await match(alice)).privacyZone).toBe('家');
    expect((await match(bob)).privacyZone).toBeNull();
  });

  it('offers someone else’s custom place only once a public photo shows its location', async () => {
    const place = await createPoi(bob, { name: '我家楼下', category: '景', lat: 30.2589, lng: 120.1513 });
    expect(names((await match(alice)).candidates)).toEqual([]);
    expect(names((await match(bob)).candidates)).toEqual(['我家楼下']);

    await upload(bob, { ...HERE, poiId: place.id, visibility: 'public', geoPrivacy: 'hidden' });
    await upload(bob, { ...HERE, poiId: place.id, visibility: 'unlisted', geoPrivacy: 'exact' });
    expect(names((await match(alice)).candidates)).toEqual([]);

    await upload(bob, { ...HERE, poiId: place.id, visibility: 'public', geoPrivacy: 'fuzzy' });
    expect(names((await match(alice)).candidates)).toEqual(['我家楼下']);
  });

  it('uses a provider’s answer when there is one', async () => {
    platform.external.respond = (url) => {
      if (url.hostname === 'photon.komoot.io' && url.pathname === '/reverse') {
        return Response.json({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [120.1514, 30.2589] },
              properties: { osm_type: 'N', osm_id: 42, osm_key: 'tourism', osm_value: 'attraction', name: '断桥残雪' }
            }
          ]
        });
      }
      return new Response('down', { status: 503 });
    };
    const res = await match(alice);
    expect(res.provider).toBe('osm');
    expect(res.candidates.map((c) => [c.name, c.source])).toContainEqual(['断桥残雪', 'osm']);
  });

  it('needs coordinates and a session', async () => {
    expect((await alice.post('/api/pois/match', { lat: 30 })).status).toBe(400);
    expect((await new Client(platform).post('/api/pois/match', HERE)).status).toBe(401);
  });
});

describe('GET /api/pois/search', () => {
  it('finds the places offered to the requester by name or alias, with the providers down', async () => {
    const lake = await createPoi(alice, { name: '西湖', category: '湖', lat: 30.24, lng: 120.14 });
    expectStatus(await alice.patch(`/api/pois/${lake.id}`, { aliases: ['West Lake'] }), 200);
    await createPoi(bob, { name: '西湖边的家', category: '景', lat: 30.25, lng: 120.15 });

    const byName = expectStatus(await alice.get('/api/pois/search?q=西湖'), 200).results as MatchCandidate[];
    expect(byName.map((r) => r.poiId)).toEqual([lake.id]);
    const byAlias = expectStatus(await alice.get('/api/pois/search?q=west'), 200).results as MatchCandidate[];
    expect(byAlias.map((r) => r.poiId)).toEqual([lake.id]);
    expect(expectStatus(await alice.get('/api/pois/search?q='), 200).results).toEqual([]);

    const near = expectStatus(await alice.get(`/api/pois/search?q=西湖&lat=${HERE.lat}&lng=${HERE.lng}`), 200).results as MatchCandidate[];
    expect(near[0].distance).toBeGreaterThan(1000);
  });

  it('escapes LIKE wildcards', async () => {
    await createPoi(alice, { name: '西湖', category: '湖', lat: 30.24, lng: 120.14 });
    expect(expectStatus(await alice.get('/api/pois/search?q=%25'), 200).results).toEqual([]);
    expect(expectStatus(await alice.get('/api/pois/search?q=_'), 200).results).toEqual([]);
  });
});
