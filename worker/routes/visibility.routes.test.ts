// Who sees what (docs/api/conventions.md#可见性, #位置精度对非所有者; docs/product/features/privacy.md), end to end through
// the real SQL. Expectations come from the documented rules applied to a fixture, never from the implementation.
// The fixture is built once; every test here only reads.

import { describe, expect, it, beforeAll } from 'vite-plus/test';
import { fuzz } from '../../shared/geo';
import type { GeoPrivacy, PhotoDetail, PhotoSummary, ThemeDetail, ThemeSummary, Visibility } from '../../shared/types';
import { Client, expectStatus, newUser, upload, usePlatform, type Json } from '../test-platform';

const platform = usePlatform({ resetBetweenTests: false });

type Viewer = 'alice' | 'bob' | 'carol' | 'anon';
/** alice owns the matrix; bob is another member, carol an admin (staff get no extra visibility), anon a visitor. */
const VIEWERS: Viewer[] = ['alice', 'bob', 'carol', 'anon'];
const VIS: Visibility[] = ['public', 'unlisted', 'private'];
const GEO: GeoPrivacy[] = ['exact', 'fuzzy', 'hidden'];

const PLACE = { P: [30.25, 120.15], Q: [30.259, 120.15], R: [30.268, 120.15] } as const;
type Place = keyof typeof PLACE;

interface Fixture {
  key: string;
  owner: 'alice' | 'bob';
  vis: Visibility;
  geo: GeoPrivacy;
  place: Place;
  lat: number;
  lng: number;
  takenAt: string;
  id: string;
}

const AREA = { province: '浙江省', city: '杭州市', district: '西湖区' };
const HEADING = 95;
const ALT = 12;

let day = 0;
const fixture = (key: string, owner: Fixture['owner'], vis: Visibility, geo: GeoPrivacy, place: Place): Fixture => ({
  key,
  owner,
  vis,
  geo,
  place,
  // a few hundred metres from the place, so the stored distance is not zero
  lat: PLACE[place][0] - 0.0032,
  lng: PLACE[place][1] + 0.0005,
  takenAt: `2026-05-${String(++day).padStart(2, '0')}T10:00:00`,
  id: ''
});

/** alice's 3 × 3 matrix at P, bob's public photo at Q, and alice's private photo at R (both within 5 km of P). */
const MATRIX = VIS.flatMap((vis) => GEO.map((geo) => fixture(`${vis}-${geo}`, 'alice', vis, geo, 'P')));
const BOB_Q = fixture('bob-public-exact', 'bob', 'public', 'exact', 'Q');
const ALICE_R = fixture('alice-private-R', 'alice', 'private', 'exact', 'R');
const ALL = [...MATRIX, BOB_Q, ALICE_R];
const byKey = (key: string) => ALL.find((f) => f.key === key) as Fixture;

// ---- the documented rules ----------------------------------------------------------------------------------------

const isOwner = (f: { owner: string }, v: Viewer) => v !== 'anon' && f.owner === v;
/** Lists and counts: public, plus the viewer's own. */
const inList = (f: Fixture, v: Viewer) => isOwner(f, v) || f.vis === 'public';
/** Opened by id or link: public and unlisted, plus the viewer's own. */
const byId = (f: Fixture, v: Viewer) => isOwner(f, v) || f.vis !== 'private';
/** The location (place included) may be shown. */
const locShown = (f: Fixture, v: Viewer) => isOwner(f, v) || f.geo !== 'hidden';

const ids = (list: { id: string }[]) => list.map((p) => p.id).sort();
const expectIds = (fixtures: Fixture[]) => fixtures.map((f) => f.id).sort();

// ---- fixture ------------------------------------------------------------------------------------------------------

const clients = {} as Record<Viewer, Client>;
const poiIds = {} as Record<Place, string>;
const themeIds = { public: '', unlisted: '', private: '', bob: '' };
let aliceTag = '';

beforeAll(async () => {
  clients.alice = await newUser(platform, 'alice', 'owner');
  clients.bob = await newUser(platform, 'bob');
  clients.carol = await newUser(platform, 'carol', 'admin');
  clients.anon = new Client(platform);

  for (const [place, [lat, lng]] of Object.entries(PLACE) as [Place, readonly [number, number]][]) {
    const creator = place === 'Q' ? clients.bob : clients.alice;
    const res = await creator.post('/api/pois', {
      name: `地点${place}`,
      category: '湖',
      lat,
      lng,
      city: AREA.city,
      district: AREA.district
    });
    poiIds[place] = expectStatus(res, 201).poi.id;
  }
  aliceTag = expectStatus(await clients.alice.post('/api/tags', { name: '爱丽丝' }), 201).tag.id;

  for (const f of ALL) {
    const photo = await upload(clients[f.owner], {
      title: f.key,
      note: `note ${f.key}`,
      takenAt: f.takenAt,
      lat: f.lat,
      lng: f.lng,
      heading: HEADING,
      alt: ALT,
      ...AREA,
      poiId: poiIds[f.place],
      poiMethod: 'confirmed',
      visibility: f.vis,
      geoPrivacy: f.geo,
      tagIds: f.owner === 'alice' ? ['lake', aliceTag] : ['lake']
    });
    f.id = photo.id;
  }

  const theme = async (client: Client, visibility: Visibility, photoIds: string[], coverPhotoId?: string) =>
    expectStatus(await client.post('/api/themes', { kind: 'topic', title: `主题 ${visibility}`, visibility, photoIds, coverPhotoId }), 201)
      .theme.id as string;
  // The public theme's chosen cover is a private photo: others must get another cover.
  themeIds.public = await theme(
    clients.alice,
    'public',
    [...MATRIX].reverse().map((f) => f.id),
    byKey('private-exact').id
  );
  themeIds.unlisted = await theme(clients.alice, 'unlisted', [byKey('public-exact').id, byKey('private-exact').id]);
  themeIds.private = await theme(clients.alice, 'private', [byKey('public-exact').id]);
  themeIds.bob = await theme(clients.bob, 'public', [BOB_Q.id]);
});

// ---- location precision ---------------------------------------------------------------------------------------------

/** What a viewer may learn of a photo's location, per the table in conventions.md. */
function expectedGeo(f: Fixture, v: Viewer) {
  const level = isOwner(f, v) ? 'exact' : f.geo;
  return {
    geoPrivacy: f.geo,
    lat: level === 'hidden' ? null : level === 'fuzzy' ? fuzz(f.lat) : f.lat,
    lng: level === 'hidden' ? null : level === 'fuzzy' ? fuzz(f.lng) : f.lng,
    heading: level === 'exact' ? HEADING : null,
    poiId: level === 'hidden' ? null : poiIds[f.place],
    province: AREA.province,
    city: AREA.city,
    district: level === 'hidden' ? null : AREA.district
  };
}

function expectSummaryGeo(p: PhotoSummary, v: Viewer) {
  const f = ALL.find((x) => x.id === p.id) as Fixture;
  const want = expectedGeo(f, v);
  expect(
    {
      geoPrivacy: p.geoPrivacy,
      lat: p.lat,
      lng: p.lng,
      heading: p.heading,
      poiId: p.poiId,
      province: p.province,
      city: p.city,
      district: p.district
    },
    `${f.key} seen by ${v}`
  ).toEqual(want);
}

function expectDetailGeo(p: PhotoDetail, v: Viewer) {
  expectSummaryGeo(p, v);
  const f = ALL.find((x) => x.id === p.id) as Fixture;
  const level = isOwner(f, v) ? 'exact' : f.geo;
  const at = `${f.key} seen by ${v}`;
  expect(p.alt, at).toBe(level === 'exact' ? ALT : null);
  expect(p.poi?.id ?? null, at).toBe(level === 'hidden' ? null : poiIds[f.place]);
  expect(p.poiMethod, at).toBe(level === 'hidden' ? null : 'confirmed');
  // conventions.md: only exact gives the stored distance (a few hundred metres here); with fuzzy, the distance to the
  // place's exact centre would undo the rounding, so it is null like with hidden.
  if (level === 'exact') expect(p.poiDistance, at).toBeGreaterThan(100);
  else expect(p.poiDistance, at).toBeNull();
}

// ---- photos -------------------------------------------------------------------------------------------------------

describe('GET /api/photos', () => {
  it.each(VIEWERS)('without parameters is the public gallery of every user, for %s too', async (v) => {
    const body = expectStatus(await clients[v].get<{ photos: PhotoSummary[] }>('/api/photos'), 200);
    expect(ids(body.photos)).toEqual(expectIds(ALL.filter((f) => f.vis === 'public')));
    for (const p of body.photos) expectSummaryGeo(p, v);
  });

  it('is ordered by capture time, newest first', async () => {
    const body = expectStatus(await clients.alice.get<{ photos: PhotoSummary[] }>('/api/photos?mine=1'), 200);
    const taken = body.photos.map((p) => p.takenAt);
    expect(taken).toEqual([...taken].sort((a, b) => (b ?? '').localeCompare(a ?? '')));
  });

  it.each(VIEWERS)('owner= lists what %s may see of that user', async (v) => {
    const body = expectStatus(await clients[v].get<{ photos: PhotoSummary[] }>('/api/photos?owner=alice'), 200);
    expect(ids(body.photos)).toEqual(expectIds(ALL.filter((f) => f.owner === 'alice' && inList(f, v))));
    for (const p of body.photos) expectSummaryGeo(p, v);
  });

  it('owner= with an unknown handle is an empty list', async () => {
    expect(expectStatus(await clients.anon.get('/api/photos?owner=nobody'), 200).photos).toEqual([]);
  });

  it.each(['alice', 'bob', 'carol'] as const)('mine=1 is all of the photos of %s, whatever their visibility', async (v) => {
    const body = expectStatus(await clients[v].get<{ photos: PhotoSummary[] }>('/api/photos?mine=1'), 200);
    expect(ids(body.photos)).toEqual(expectIds(ALL.filter((f) => f.owner === v)));
    for (const p of body.photos) expectSummaryGeo(p, v);
  });

  it('mine=1 needs a session', async () => {
    expect((await clients.anon.get('/api/photos?mine=1')).status).toBe(401);
  });

  it.each(VIEWERS)('poi= lists the photos at a place that %s may see with their location', async (v) => {
    const body = expectStatus(await clients[v].get<{ photos: PhotoSummary[] }>(`/api/photos?poi=${poiIds.P}`), 200);
    expect(ids(body.photos)).toEqual(expectIds(ALL.filter((f) => f.place === 'P' && inList(f, v) && locShown(f, v))));
    for (const p of body.photos) expectSummaryGeo(p, v);
  });

  it.each(VIEWERS)('poi= combines with owner= for %s', async (v) => {
    const body = expectStatus(await clients[v].get<{ photos: PhotoSummary[] }>(`/api/photos?poi=${poiIds.Q}&owner=alice`), 200);
    expect(body.photos).toEqual([]);
    const bob = expectStatus(await clients[v].get<{ photos: PhotoSummary[] }>(`/api/photos?poi=${poiIds.Q}&owner=bob`), 200);
    expect(ids(bob.photos)).toEqual([BOB_Q.id]);
  });

  it.each(VIEWERS)('ids= returns the photos %s may open by id, and drops the rest', async (v) => {
    const all = ALL.map((f) => f.id).join(',');
    const body = expectStatus(await clients[v].get<{ photos: PhotoSummary[] }>(`/api/photos?ids=${all},ph_missing`), 200);
    expect(ids(body.photos)).toEqual(expectIds(ALL.filter((f) => byId(f, v))));
    for (const p of body.photos) expectSummaryGeo(p, v);
  });

  it('ids= accepts at most 200 ids', async () => {
    const many = Array.from({ length: 201 }, (_, i) => `ph_${i}`).join(',');
    expect((await clients.anon.get(`/api/photos?ids=${many}`)).status).toBe(400);
  });

  it('lists never carry the note text, only whether there is one', async () => {
    const body = expectStatus(await clients.alice.get<{ photos: Json[] }>('/api/photos?mine=1'), 200);
    for (const p of body.photos) {
      expect(p).not.toHaveProperty('note');
      expect(p.hasNote).toBe(true);
    }
  });

  it('may be cached briefly for visitors, never with a session', async () => {
    const anon = await clients.anon.get('/api/photos');
    expect(anon.headers.get('cache-control')).toBe('public, max-age=30');
    expect(anon.headers.get('vary')).toContain('Cookie');
    const signedIn = await clients.bob.get('/api/photos');
    expect(signedIn.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('GET /api/photos/:id', () => {
  for (const v of VIEWERS) {
    it.each(MATRIX.map((f) => f.key))(`%s, seen by ${v}`, async (key) => {
      const f = byKey(key);
      const res = await clients[v].get<PhotoDetail>(`/api/photos/${f.id}`);
      if (!byId(f, v)) {
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ error: 'not_found' });
        return;
      }
      const p = expectStatus(res, 200);
      expect(p.id).toBe(f.id);
      expect(p.note).toBe(`note ${key}`);
      expect(p.tagIds.sort()).toEqual(['lake', aliceTag].sort());
      expectDetailGeo(p, v);
    });
  }

  it.each(VIEWERS)('lists only the themes %s may see in lists (not unlisted ones of others)', async (v) => {
    const p = expectStatus(await clients[v].get<PhotoDetail>(`/api/photos/${byKey('public-exact').id}`), 200);
    const want = v === 'alice' ? [themeIds.public, themeIds.unlisted, themeIds.private] : [themeIds.public];
    expect(p.themes.map((t) => t.id).sort()).toEqual(want.sort());
  });
});

// ---- places -------------------------------------------------------------------------------------------------------

describe('GET /api/pois', () => {
  it.each(VIEWERS)('counts, per place, the photos %s may see with their location', async (v) => {
    const body = expectStatus(await clients[v].get<{ pois: Json[] }>('/api/pois'), 200);
    const want = (Object.keys(PLACE) as Place[])
      .map((place) => ({ id: poiIds[place], count: ALL.filter((f) => f.place === place && inList(f, v) && locShown(f, v)).length }))
      .filter((p) => p.count > 0);
    expect(body.pois.map((p) => ({ id: p.id, count: p.count })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      want.sort((a, b) => a.id.localeCompare(b.id))
    );
  });

  it.each(VIEWERS)('owner= only counts that user’s photos, for %s', async (v) => {
    const body = expectStatus(await clients[v].get<{ pois: Json[] }>('/api/pois?owner=bob'), 200);
    expect(body.pois.map((p) => [p.id, p.count])).toEqual([[poiIds.Q, 1]]);
  });

  it('owner= with an unknown handle is a 404', async () => {
    expect((await clients.anon.get('/api/pois?owner=nobody')).status).toBe(404);
  });
});

describe('GET /api/pois/:id', () => {
  it.each(VIEWERS)('lists nearby places that have photos %s may see', async (v) => {
    const body = expectStatus(await clients[v].get<{ poi: Json; nearby: Json[] }>(`/api/pois/${poiIds.P}`), 200);
    expect(body.poi.id).toBe(poiIds.P);
    const want = (['Q', 'R'] as Place[]).filter((place) => ALL.some((f) => f.place === place && inList(f, v) && locShown(f, v)));
    expect(body.nearby.map((p) => p.id)).toEqual(want.map((place) => poiIds[place]));
    expect(body.nearby.every((p) => typeof p.distance === 'number' && p.distance <= 5000)).toBe(true);
  });

  it.each(VIEWERS)('says whether %s may edit, and shows aliases only then, never the creator', async (v) => {
    const body = expectStatus(await clients[v].get<{ poi: Json }>(`/api/pois/${poiIds.P}`), 200);
    // P was created by alice; carol is an admin
    const canEdit = v === 'alice' || v === 'carol';
    expect(body.poi.canEdit).toBe(canEdit);
    if (canEdit) expect(body.poi.aliases).toEqual([]);
    else expect(body.poi).not.toHaveProperty('aliases');
    expect(JSON.stringify(body)).not.toContain(clients.alice.me.id);
  });

  it('is a 404 for an unknown place', async () => {
    expect((await clients.anon.get('/api/pois/poi_missing')).status).toBe(404);
  });
});

// ---- themes -------------------------------------------------------------------------------------------------------

describe('GET /api/themes', () => {
  it.each(VIEWERS)('without parameters lists the public themes of every user, for %s too', async (v) => {
    const body = expectStatus(await clients[v].get<{ themes: ThemeSummary[] }>('/api/themes'), 200);
    expect(body.themes.map((t) => t.id).sort()).toEqual([themeIds.public, themeIds.bob].sort());
  });

  it.each(VIEWERS)('owner= lists what %s may see of that user', async (v) => {
    const body = expectStatus(await clients[v].get<{ themes: ThemeSummary[] }>('/api/themes?owner=alice'), 200);
    const want = v === 'alice' ? [themeIds.public, themeIds.unlisted, themeIds.private] : [themeIds.public];
    expect(body.themes.map((t) => t.id).sort()).toEqual(want.sort());
  });

  it('mine=1 lists all of the viewer’s themes and needs a session', async () => {
    const body = expectStatus(await clients.alice.get<{ themes: ThemeSummary[] }>('/api/themes?mine=1'), 200);
    expect(body.themes).toHaveLength(3);
    expect((await clients.anon.get('/api/themes?mine=1')).status).toBe(401);
  });

  it.each(VIEWERS)('never shows %s a cover they could not open', async (v) => {
    const body = expectStatus(await clients[v].get<{ themes: ThemeSummary[] }>('/api/themes'), 200);
    const t = body.themes.find((x) => x.id === themeIds.public) as ThemeSummary;
    const cover = MATRIX.find((f) => f.id === t.cover?.id);
    expect(cover, 'a cover').toBeDefined();
    expect(byId(cover as Fixture, v)).toBe(true);
    if (v !== 'alice') expect(t.coverPhotoId).not.toBe(byKey('private-exact').id);
    expect(t.cover).not.toHaveProperty('note');
  });
});

describe('GET /api/themes/:id', () => {
  it.each(VIEWERS)('shows %s the items, with the photos they may not open set to null', async (v) => {
    const t = expectStatus(await clients[v].get<ThemeDetail>(`/api/themes/${themeIds.public}`), 200);
    const photoItems = t.items.filter((i) => i.kind === 'photo');
    expect(photoItems).toHaveLength(MATRIX.length);
    for (const item of photoItems) {
      const f = MATRIX.find((x) => x.id === item.photoId) as Fixture;
      if (byId(f, v)) {
        expect(item.photo?.id, `${f.key} for ${v}`).toBe(f.id);
        expect(item.photo?.note).toBe(`note ${f.key}`);
        expectSummaryGeo(item.photo as PhotoSummary, v);
      } else {
        expect(item.photo, `${f.key} for ${v}`).toBeNull();
      }
    }
    // The count matches what the viewer is shown.
    expect(t.photoCount).toBe(photoItems.filter((i) => i.photo).length);
  });

  it.each(VIEWERS)('lists for %s only the places of photos they may open with their location', async (v) => {
    const t = expectStatus(await clients[v].get<ThemeDetail>(`/api/themes/${themeIds.public}`), 200);
    const shown = MATRIX.some((f) => byId(f, v) && locShown(f, v));
    expect(t.pois.map((p) => p.id)).toEqual(shown ? [poiIds.P] : []);
  });

  it.each(VIEWERS)('opens an unlisted theme by id for %s', async (v) => {
    const t = expectStatus(await clients[v].get<ThemeDetail>(`/api/themes/${themeIds.unlisted}`), 200);
    expect(t.items.map((i) => (i.kind === 'photo' ? i.photo !== null : null))).toEqual([true, v === 'alice']);
  });

  it.each(VIEWERS)('answers a private theme with 404 unless %s owns it', async (v) => {
    const res = await clients[v].get(`/api/themes/${themeIds.private}`);
    expect(res.status).toBe(v === 'alice' ? 200 : 404);
  });
});

// ---- tags and profiles --------------------------------------------------------------------------------------------

describe('GET /api/tags', () => {
  const countOf = (tags: Json[], id: string) => tags.find((t) => t.id === id)?.count as number | undefined;

  it.each(VIEWERS)('counts the photos %s sees in lists', async (v) => {
    const body = expectStatus(await clients[v].get<{ tags: Json[] }>('/api/tags'), 200);
    expect(countOf(body.tags, 'lake')).toBe(ALL.filter((f) => inList(f, v)).length);
    // Presets for everyone, plus the viewer's own tags only.
    if (v === 'alice') expect(countOf(body.tags, aliceTag)).toBe(ALL.filter((f) => f.owner === 'alice').length);
    else expect(countOf(body.tags, aliceTag)).toBeUndefined();
  });

  it.each(VIEWERS)('owner= brings that user’s tags and counts only their photos, for %s', async (v) => {
    const body = expectStatus(await clients[v].get<{ tags: Json[] }>('/api/tags?owner=alice'), 200);
    const visible = ALL.filter((f) => f.owner === 'alice' && inList(f, v)).length;
    expect(countOf(body.tags, 'lake')).toBe(visible);
    expect(countOf(body.tags, aliceTag)).toBe(visible);
  });
});

describe('GET /api/users/:handle', () => {
  it.each(VIEWERS)('counts what %s may see in lists', async (v) => {
    const body = expectStatus(await clients[v].get<Json>('/api/users/alice'), 200);
    expect(body.photoCount).toBe(ALL.filter((f) => f.owner === 'alice' && inList(f, v)).length);
    expect(body.themeCount).toBe(v === 'alice' ? 3 : 1);
    expect(body).not.toHaveProperty('role');
  });

  it('is a 404 for an unknown user', async () => {
    expect((await clients.anon.get('/api/users/nobody')).status).toBe(404);
  });
});

// ---- media --------------------------------------------------------------------------------------------------------

describe('GET /media/v/:photoId/:file', () => {
  for (const v of VIEWERS) {
    it.each(MATRIX.filter((f) => f.geo === 'exact').map((f) => f.key))(`%s, for ${v}`, async (key) => {
      const f = byKey(key);
      const path = `/media/v/${f.id}/m.webp`;
      const res = await clients[v].fetch(path);
      if (!byId(f, v)) {
        expect(res.status).toBe(404);
        return;
      }
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/webp');
      expect(res.headers.get('etag')).toBeTruthy();
      if (f.vis === 'private') {
        expect(res.headers.get('cache-control')).toBe('private, no-store');
        expect(await platform.cached(path)).toBe(false);
      } else {
        expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
        // written to the edge cache, and served from there next time
        expect(await platform.cached(path)).toBe(true);
        const again = await clients[v].fetch(path);
        expect(again.status).toBe(200);
        expect(again.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      }
    });
  }

  it('answers If-None-Match with 304, from R2 and from the edge cache', async () => {
    for (const key of ['public-exact', 'private-exact']) {
      const path = `/media/v/${byKey(key).id}/s.webp`;
      const first = await clients.alice.fetch(path);
      const etag = first.headers.get('etag') as string;
      const again = await clients.alice.fetch(path, { headers: { 'if-none-match': etag } });
      expect(again.status, key).toBe(304);
    }
  });

  it('is a 404 for a file the photo does not have, or a malformed name', async () => {
    const id = byKey('public-exact').id;
    for (const file of ['s.jpg', 'x.webp', 'm.png', '..'])
      expect((await clients.alice.fetch(`/media/v/${id}/${file}`)).status, file).toBe(404);
  });
});

describe('GET /media/o/:ownerId/:file', () => {
  it.each(VIEWERS)('serves the original only to its owner, for %s', async (v) => {
    for (const f of MATRIX.filter((x) => x.geo === 'exact')) {
      const res = await clients[v].fetch(`/media/o/${clients.alice.me.id}/${f.id}.jpg`);
      if (v !== 'alice') {
        expect(res.status, f.key).toBe(404);
        continue;
      }
      expect(res.status, f.key).toBe(200);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(res.headers.get('content-disposition')).toBe('inline');
      expect(res.headers.get('content-type')).toBe('image/jpeg');
    }
  });
});
