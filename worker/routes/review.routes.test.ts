// Review (回顾) against real D1: docs/api/review.md. One's own archive by the calendar: the years that hold anything,
// and a year looked back on (its days, what was written, the places and tags most used, the projects worked on, the
// collections made, the favourite photos). Only the signed-in owner's entries (archived ones aside) and photos count,
// whatever their visibility; nothing of anyone else's, however public. Also the `from` and `to` days that bound the
// entry and photo lists (docs/api/entries.md, docs/api/photos.md). Expectations follow the documented rules, never the
// implementation.

import { beforeEach, describe, expect, it } from 'vite-plus/test';
import {
  REVIEW_FAVORITES,
  REVIEW_TOP,
  type EntryDetail,
  type EntryStatus,
  type EntrySummary,
  type Milestone,
  type PhotoDetail,
  type PhotoListResponse,
  type PhotoSummary,
  type ProjectDetail,
  type ReviewYearsResponse,
  type ThemeDetail,
  type ThemeSummary,
  type Visibility,
  type YearReview
} from '../../shared/types';
import { Client, expectStatus, newUser, upload, usePlatform, type Json } from '../test-platform';

const platform = usePlatform();

let alice: Client;
let bob: Client;
let anon: Client;
beforeEach(async () => {
  alice = await newUser(platform, 'alice', 'owner');
  bob = await newUser(platform, 'bob');
  anon = new Client(platform);
});

/** An entry of `client`'s that happened at `occurredAt`: a finished private note saying "x" unless `fields` say otherwise. */
const entry = async (client: Client, occurredAt: string, fields: Json = {}): Promise<EntryDetail> =>
  expectStatus(await client.post('/api/entries', { occurredAt, body: 'x', ...fields }), 201).entry;
/** A photo of `client`'s taken at `takenAt`, or without a capture time for null. */
const photo = (client: Client, takenAt: string | null, meta: Json = {}): Promise<PhotoDetail> =>
  upload(client, takenAt === null ? meta : { takenAt, ...meta });
const place = async (client: Client, name: string): Promise<string> =>
  expectStatus(await client.post('/api/pois', { name, category: '湖', lat: 30.25, lng: 120.15, city: '杭州市' }), 201).poi.id;
const tag = async (client: Client, name: string, color?: string): Promise<string> =>
  expectStatus(await client.post('/api/tags', { name, color }), 201).tag.id;
const project = async (client: Client, body: Json = {}): Promise<ProjectDetail> =>
  expectStatus(await client.post('/api/projects', { title: '项目', startDate: '2026-01-01', ...body }), 201).project;
const milestone = async (client: Client, projectId: string, date: string, title = '里程碑'): Promise<Milestone> =>
  expectStatus(await client.post(`/api/projects/${projectId}/milestones`, { title, date }), 201).milestone;
/** A collection (theme) of `client`'s holding `items`. */
async function collection(client: Client, body: Json = {}, items: Json[] = []): Promise<ThemeDetail> {
  const t = expectStatus(await client.post('/api/themes', { kind: 'topic', title: '合集', ...body }), 201).theme as ThemeDetail;
  if (items.length) expectStatus(await client.put(`/api/themes/${t.id}/items`, { items }), 200);
  return t;
}
/** A milestone as a review lists it. */
const mark = (m: Milestone) => ({ id: m.id, title: m.title, date: m.date });

const years = async (client: Client) => expectStatus(await client.get<ReviewYearsResponse>('/api/review'), 200).years;
const review = async (client: Client, year: number | string): Promise<YearReview> =>
  expectStatus(await client.get<YearReview>(`/api/review/${year}`), 200);
/** The review of a year with nothing in it. */
const nothing = (year: number): YearReview => ({
  year,
  days: [],
  chars: 0,
  types: [],
  places: [],
  placeCount: 0,
  tags: [],
  projects: [],
  collections: [],
  favorites: []
});
/** The photos as their owner gets them in a list, by id. */
async function summaries(client: Client, ids: string[]): Promise<Map<string, PhotoSummary>> {
  const list = expectStatus(await client.get<PhotoListResponse>(`/api/photos?ids=${ids.join(',')}`), 200).photos;
  return new Map(list.map((p) => [p.id, p]));
}

const run = (sql: string, ...params: unknown[]) =>
  platform.env.DB.prepare(sql)
    .bind(...params)
    .run();
/** Rows written straight to D1 in one statement, in this order: more than the API would make in a test's time. */
async function insert(table: string, rows: Json[]): Promise<void> {
  const cols = Object.keys(rows[0]);
  await run(
    `INSERT INTO ${table} (${cols.join(', ')}) SELECT ${cols.map((c) => `json_extract(value, '$.${c}')`).join(', ')} FROM json_each(?1)`,
    JSON.stringify(rows)
  );
}
const VARIANTS = JSON.stringify({
  s: { key: 'v/x/s.webp', w: 480, h: 320 },
  m: { key: 'v/x/m.webp', w: 1600, h: 1067 },
  l: { key: 'v/x/l.webp', w: 2560, h: 1707 }
});
const pad = (i: number) => String(i).padStart(2, '0');

interface PhotoRow {
  id: string;
  at: string | null;
  poi?: string;
  favorite?: boolean;
  tags?: string[];
}
/** Photos of `owner`'s straight into D1, uploaded in this order, with their tags. */
async function addPhotos(owner: Client, list: PhotoRow[]): Promise<void> {
  await insert(
    'photos',
    list.map((r) => ({
      id: r.id,
      owner_id: owner.me.id,
      taken_at: r.at,
      poi_id: r.poi ?? null,
      favorite: r.favorite ? 1 : 0,
      width: 3000,
      height: 2000,
      file_key: `o/${owner.me.id}/${r.id}.jpg`,
      variants: VARIANTS
    }))
  );
  const tagged = list.flatMap((r) => (r.tags ?? []).map((t) => ({ photo_id: r.id, tag_id: t })));
  if (tagged.length) await insert('photo_tags', tagged);
}

interface EntryRow {
  id: string;
  at: string;
  status?: EntryStatus;
  poi?: string;
  tags?: string[];
}
/** Entries of `owner`'s straight into D1, with their tags. */
async function addEntries(owner: Client, list: EntryRow[]): Promise<void> {
  await insert(
    'entries',
    list.map((r) => ({
      id: r.id,
      owner_id: owner.me.id,
      body: 'x',
      occurred_at: r.at,
      status: r.status ?? 'published',
      poi_id: r.poi ?? null
    }))
  );
  const tagged = list.flatMap((r) => (r.tags ?? []).map((t) => ({ entry_id: r.id, tag_id: t })));
  if (tagged.length) await insert('entry_tags', tagged);
}

describe('GET /api/review and GET /api/review/:year', () => {
  it('need a session', async () => {
    await entry(alice, '2026-05-01', { visibility: 'public' });
    await photo(alice, '2026-05-01T08:00:00', { visibility: 'public' });
    for (const path of ['/api/review', '/api/review/2026']) {
      const res = await anon.get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error, path).toBe('unauthenticated');
    }
  });

  it('refuse a year that is not exactly four digits', async () => {
    for (const year of ['26', '202', '20266', 'abcd', '202a', '-202', '+2026', '2026.0', '２０２６', ' 2026', '2026 ', '0x7e']) {
      const res = await alice.get(`/api/review/${encodeURIComponent(year)}`);
      expect(res.status, year).toBe(400);
      expect(res.body.error, year).toBe('invalid_input');
    }
  });

  it('answer a year with nothing in it with no days, no characters and empty lists, never to be cached', async () => {
    await entry(alice, '2025-12-31T23:59:59');
    await photo(alice, '2027-01-01T00:00:00', { favorite: true });
    const res = await alice.get<YearReview>('/api/review/2026');
    expect(expectStatus(res, 200)).toEqual(nothing(2026));
    expect(res.headers.get('cache-control')).toMatch(/\bno-store\b/);
    expect((await alice.get('/api/review')).headers.get('cache-control')).toMatch(/\bno-store\b/);
    expect(await review(alice, 1999)).toEqual(nothing(1999));
    expect(await years(bob)).toEqual([]);
  });
});

describe('GET /api/review', () => {
  it('lists the years that hold anything, latest first, with how many entries and photos each', async () => {
    await entry(alice, '2024-03-01');
    await entry(alice, '2024-12-31T23:59:59', { visibility: 'public' });
    await entry(alice, '2026-01-01', { status: 'draft' });
    await entry(alice, '2026-07-01T10:00:00');
    await photo(alice, '2026-02-01T10:00:00');
    await photo(alice, '2025-06-01T10:00:00', { visibility: 'private' });
    await photo(alice, '2025-06-02T10:00:00');
    // an archived entry and a photo without a capture time count nowhere: 2023 holds nothing else
    await entry(alice, '2023-05-01', { status: 'archived' });
    await photo(alice, null);
    // nor does anyone else's
    await entry(bob, '2022-05-01', { visibility: 'public' });
    await photo(bob, '2022-05-01T10:00:00', { visibility: 'public' });

    expect(await years(alice)).toEqual([
      { year: 2026, entries: 2, photos: 1 },
      { year: 2025, entries: 0, photos: 2 },
      { year: 2024, entries: 2, photos: 0 }
    ]);
    expect(await years(bob)).toEqual([{ year: 2022, entries: 1, photos: 1 }]);
  });
});

describe('whose archive a review reads', () => {
  it('never anyone else’s, however public: no entry, photo, place, tag, project, milestone or collection of theirs', async () => {
    const lake = await place(bob, '西湖');
    const own = await tag(bob, '湖光');
    const p = await project(bob, { visibility: 'public' });
    const shot = await photo(bob, '2026-05-01T08:00:00', { visibility: 'public', favorite: true, poiId: lake, tagIds: ['lake', own] });
    await entry(bob, '2026-05-01', {
      title: '游湖',
      visibility: 'public',
      type: 'trip',
      poiId: lake,
      tagIds: ['lake', own],
      projectIds: [p.id]
    });
    await milestone(bob, p.id, '2026-06-01');
    await collection(bob, { visibility: 'public', startDate: '2026-05-01', coverPhotoId: shot.id }, [{ kind: 'photo', photoId: shot.id }]);
    await collection(bob, { visibility: 'public' }, [{ kind: 'photo', photoId: shot.id }]);

    expect(await years(alice)).toEqual([]);
    expect(await review(alice, 2026)).toEqual(nothing(2026));
    // all of it is bob's own
    expect(await years(bob)).toEqual([{ year: 2026, entries: 1, photos: 1 }]);
    const his = await review(bob, 2026);
    expect([his.placeCount, his.tags.length, his.projects.length, his.collections.length, his.favorites.length]).toEqual([1, 2, 1, 2, 1]);
  });

  it('holds all of one’s own, whatever its visibility or location precision', async () => {
    const home = await place(alice, '家');
    const mine = await tag(alice, '私事');
    const p = await project(alice);
    for (const visibility of ['public', 'unlisted', 'private'] as Visibility[]) {
      await photo(alice, '2026-05-01T08:00:00', { visibility, geoPrivacy: 'hidden', favorite: true, poiId: home, tagIds: [mine] });
      await entry(alice, '2026-05-01', { visibility, poiId: home, tagIds: [mine], projectIds: [p.id] });
    }
    const t = await collection(alice, { startDate: '2026-05-01' });

    expect(await years(alice)).toEqual([{ year: 2026, entries: 3, photos: 3 }]);
    const got = await review(alice, 2026);
    expect(got.days).toEqual([{ day: '2026-05-01', entries: 3, photos: 3 }]);
    expect(got.places).toEqual([expect.objectContaining({ id: home, photos: 3, entries: 3 })]);
    expect(got.tags).toEqual([expect.objectContaining({ id: mine, photos: 3, entries: 3 })]);
    expect(got.projects).toEqual([expect.objectContaining({ id: p.id, visibility: 'private', entries: 3, days: 1 })]);
    expect(got.collections.map((c) => [c.id, c.visibility])).toEqual([[t.id, 'private']]);
    expect(got.favorites.map((f) => [f.visibility, f.geoPrivacy, f.poiId])).toEqual([
      ['public', 'hidden', home],
      ['unlisted', 'hidden', home],
      ['private', 'hidden', home]
    ]);
  });

  it('counts every entry but the archived ones, drafts included; a photo without a capture time is on no day', async () => {
    const lake = await place(alice, '西湖');
    const p = await project(alice);
    for (const status of ['published', 'draft', 'archived'] as EntryStatus[]) {
      await entry(alice, '2026-05-01T09:00:00', {
        status,
        title: status,
        body: null,
        type: status === 'draft' ? 'article' : 'note',
        poiId: lake,
        tagIds: ['lake'],
        projectIds: [p.id]
      });
    }
    // a year of archived entries alone holds nothing
    await entry(alice, '2025-05-01', { status: 'archived', poiId: lake, tagIds: ['lake'], projectIds: [p.id] });
    // nor does a favourite without a capture time, at a place and tagged
    await photo(alice, null, { favorite: true, poiId: lake, tagIds: ['mono'] });

    expect(await years(alice)).toEqual([{ year: 2026, entries: 2, photos: 0 }]);
    expect(await review(alice, 2026)).toMatchObject({
      days: [{ day: '2026-05-01', entries: 2, photos: 0 }],
      chars: 'published'.length + 'draft'.length,
      types: [
        { type: 'article', count: 1 },
        { type: 'note', count: 1 }
      ],
      places: [{ id: lake, photos: 0, entries: 2 }],
      placeCount: 1,
      tags: [{ id: 'lake', photos: 0, entries: 2 }],
      projects: [{ id: p.id, entries: 2, days: 1, milestones: [] }],
      favorites: []
    });
    expect(await review(alice, 2025)).toEqual(nothing(2025));
  });
});

describe('the days of a year', () => {
  it('run from January 1 to December 31, both included, for an entry known by its day or by its time, and for a photo', async () => {
    for (const at of [
      '2025-12-31T23:59:59',
      '2025-12-31',
      '2026-01-01',
      '2026-01-01T00:00:00',
      '2026-12-31',
      '2026-12-31T23:59:59',
      '2027-01-01',
      '2027-01-01T00:00:00'
    ]) {
      await entry(alice, at);
    }
    for (const at of ['2025-12-31T23:59:59', '2026-01-01T00:00:00', '2026-12-31T23:59:59', '2027-01-01T00:00:00']) await photo(alice, at);

    expect(await years(alice)).toEqual([
      { year: 2027, entries: 2, photos: 1 },
      { year: 2026, entries: 4, photos: 2 },
      { year: 2025, entries: 2, photos: 1 }
    ]);
    expect((await review(alice, 2026)).days).toEqual([
      { day: '2026-01-01', entries: 2, photos: 1 },
      { day: '2026-12-31', entries: 2, photos: 1 }
    ]);
    expect((await review(alice, 2025)).days).toEqual([{ day: '2025-12-31', entries: 2, photos: 1 }]);
    expect((await review(alice, 2027)).days).toEqual([{ day: '2027-01-01', entries: 2, photos: 1 }]);
  });

  it('are listed once each when they hold anything, in date order, with their entries and photos', async () => {
    await entry(alice, '2026-03-02T21:00:00');
    await entry(alice, '2026-11-30T23:00:00', { status: 'draft' });
    await photo(alice, '2026-03-02T08:00:00');
    await entry(alice, '2026-03-02');
    await photo(alice, '2026-01-15T09:00:00');
    await photo(alice, '2026-01-15T08:00:00');
    // nothing that counts on these
    await entry(alice, '2026-02-01', { status: 'archived' });
    await entry(bob, '2026-02-02', { visibility: 'public' });

    expect((await review(alice, 2026)).days).toEqual([
      { day: '2026-01-15', entries: 0, photos: 2 },
      { day: '2026-03-02', entries: 2, photos: 1 },
      { day: '2026-11-30', entries: 1, photos: 0 }
    ]);
  });
});

describe('what was written', () => {
  it('counts the characters of the year’s titles and bodies as code points, Markdown and line breaks included', async () => {
    const shot = await photo(alice, '2026-07-01T08:00:00');
    // 2 + 11: the emoji is one character, two UTF-16 units and four bytes
    await entry(alice, '2026-05-01', { title: '西湖', body: '**断桥** 残雪 😀' });
    await entry(alice, '2026-06-01T09:00:00', { type: 'reading', title: 'Book', body: null });
    await entry(alice, '2026-07-01', { type: 'trip', body: null, media: [{ photoId: shot.id }] });
    await entry(alice, '2026-08-01', { status: 'draft', body: '# 标题\n\n正文' });
    // NUL characters go when written, and what follows one still counts
    await entry(alice, '2026-09-01', { title: 'a\u0000b', body: 'cd\u0000ef' });
    // none of these
    await entry(alice, '2026-08-02', { status: 'archived', title: '归档', body: '不算' });
    await entry(alice, '2025-12-31T23:59:59', { title: '去年', body: '写的' });
    await entry(bob, '2026-05-01', { title: '别人', body: '别人的字', visibility: 'public' });

    expect((await review(alice, 2026)).chars).toBe(2 + 11 + 4 + 0 + 8 + 6);
    expect((await review(alice, 2025)).chars).toBe(4);
  });

  it('counts the entries of each type, most first, ties by the type’s name', async () => {
    const types = ['trip', 'reading', 'note', 'article', 'note', 'trip', 'article', 'note'];
    for (const [i, type] of types.entries()) await entry(alice, `2026-04-${pad(i + 1)}`, { type });
    await entry(alice, '2026-05-01', { type: 'practice', status: 'archived' });
    await entry(alice, '2025-05-01', { type: 'creation' });
    await entry(bob, '2026-05-01', { type: 'creation', visibility: 'public' });

    expect((await review(alice, 2026)).types).toEqual([
      { type: 'note', count: 3 },
      { type: 'article', count: 2 },
      { type: 'trip', count: 2 },
      { type: 'reading', count: 1 }
    ]);
  });
});

describe('a year’s review', () => {
  it('gives its days, characters, types, places, tags, projects, collections and favourites in their documented fields', async () => {
    const lake = await place(alice, '西湖');
    const calligraphy = await tag(alice, '书法', '#aabbcc');
    const p = await project(alice, { title: '练字', type: 'practice', status: 'paused', visibility: 'unlisted' });
    const m = await milestone(alice, p.id, '2026-06-01', '第一阶段');
    const shot = await photo(alice, '2026-05-01T08:00:00', {
      favorite: true,
      poiId: lake,
      tagIds: [calligraphy, 'lake'],
      visibility: 'private'
    });
    const e = await entry(alice, '2026-05-01', {
      type: 'practice',
      title: '临帖',
      body: '一页《兰亭序》',
      poiId: lake,
      tagIds: [calligraphy],
      projectIds: [p.id],
      media: [{ photoId: shot.id }]
    });
    const t = await collection(
      alice,
      { kind: 'trip', title: '杭州', startDate: '2026-05-01', endDate: '2026-05-02', coverPhotoId: shot.id },
      [
        { kind: 'photo', photoId: shot.id },
        { kind: 'entry', entryId: e.id }
      ]
    );
    const [listed] = expectStatus(await alice.get('/api/themes?mine=1'), 200).themes as ThemeSummary[];
    expect(listed).toMatchObject({ id: t.id, photoCount: 2, entryCount: 1, cover: expect.objectContaining({ id: shot.id }) });

    expect(await review(alice, 2026)).toEqual({
      year: 2026,
      days: [{ day: '2026-05-01', entries: 1, photos: 1 }],
      chars: 2 + 7,
      types: [{ type: 'practice', count: 1 }],
      places: [{ id: lake, name: '西湖', category: '湖', city: '杭州市', district: null, photos: 1, entries: 1 }],
      placeCount: 1,
      tags: [
        { id: calligraphy, name: '书法', color: '#aabbcc', photos: 1, entries: 1 },
        { id: 'lake', name: '湖', color: null, photos: 1, entries: 0 }
      ],
      projects: [
        {
          id: p.id,
          title: '练字',
          type: 'practice',
          status: 'paused',
          visibility: 'unlisted',
          entries: 1,
          days: 1,
          milestones: [{ id: m.id, title: '第一阶段', date: '2026-06-01' }]
        }
      ],
      collections: [listed],
      favorites: [(await summaries(alice, [shot.id])).get(shot.id)]
    });
  });
});

describe('places', () => {
  it('are those of the year’s photos and entries, whoever made them: most used first, then by name and id, 10 of all those counted', async () => {
    const pois: [string, string][] = [
      ['poi_a', '孤山'],
      ['poi_b', '断桥'],
      // by name before poi_d1, by id after it
      ['poi_c9', '白堤'],
      ['poi_d1', '苏堤'],
      // the same name: by id
      ['poi_e2', '湖心亭'],
      ['poi_e1', '湖心亭'],
      ['poi_f', '雷峰塔'],
      ['poi_g', '灵隐寺'],
      ['poi_h', '龙井村'],
      ['poi_i', '虎跑'],
      ['poi_j', '九溪'],
      ['poi_k', '云栖'],
      // used by nothing that counts in 2026
      ['poi_x', '宝石山'],
      ['poi_y', '北山街']
    ];
    await insert(
      'pois',
      pois.map(([id, name]) => ({
        id,
        name,
        category: id === 'poi_a' ? '山' : '景',
        city: id === 'poi_a' ? '杭州市' : null,
        district: id === 'poi_a' ? '西湖区' : null,
        lat: 30.25,
        lng: 120.15,
        created_by: bob.me.id
      }))
    );
    const at = '2026-02-01T10:00:00';
    await addPhotos(alice, [
      { id: 'ph_a1', at, poi: 'poi_a' },
      { id: 'ph_a2', at: '2027-01-01T00:00:00', poi: 'poi_a' },
      { id: 'ph_b1', at, poi: 'poi_b' },
      { id: 'ph_b2', at: '2026-12-31T23:59:59', poi: 'poi_b' },
      { id: 'ph_b3', at: '2026-01-01T00:00:00', poi: 'poi_b' },
      { id: 'ph_d1', at, poi: 'poi_d1' },
      { id: 'ph_d2', at, poi: 'poi_d1' },
      { id: 'ph_e1', at, poi: 'poi_e1' },
      { id: 'ph_e2', at, poi: 'poi_e2' },
      { id: 'ph_x1', at: '2025-12-31T23:59:59', poi: 'poi_x' },
      { id: 'ph_y1', at: null, poi: 'poi_y' },
      { id: 'ph_none', at }
    ]);
    await addEntries(alice, [
      { id: 'en_a1', at: '2026-03-01', poi: 'poi_a' },
      { id: 'en_a2', at: '2026-03-02T10:00:00', poi: 'poi_a', status: 'draft' },
      { id: 'en_a3', at: '2026-03-03', poi: 'poi_a' },
      { id: 'en_a4', at: '2026-03-04', poi: 'poi_a', status: 'archived' },
      { id: 'en_c1', at: '2026-03-01', poi: 'poi_c9' },
      { id: 'en_c2', at: '2026-03-01', poi: 'poi_c9' },
      ...['f', 'g', 'h', 'i', 'j', 'k'].map((k) => ({ id: `en_${k}1`, at: '2026-06-01', poi: `poi_${k}` })),
      { id: 'en_x1', at: '2026-06-01', poi: 'poi_x', status: 'archived' },
      { id: 'en_none', at: '2026-06-01' }
    ]);
    await addPhotos(bob, [
      { id: 'ph_bob1', at, poi: 'poi_x' },
      { id: 'ph_bob2', at, poi: 'poi_a' }
    ]);
    await addEntries(bob, [{ id: 'en_bob1', at: '2026-06-01', poi: 'poi_x' }]);

    const got = await review(alice, 2026);
    expect(got.places.map((p) => [p.id, p.photos, p.entries])).toEqual([
      ['poi_a', 1, 3],
      ['poi_b', 3, 0],
      ['poi_c9', 0, 2],
      ['poi_d1', 2, 0],
      ['poi_j', 0, 1],
      ['poi_k', 0, 1],
      ['poi_e1', 1, 0],
      ['poi_e2', 1, 0],
      ['poi_g', 0, 1],
      ['poi_i', 0, 1]
    ]);
    expect(got.places).toHaveLength(REVIEW_TOP);
    expect(got.places[0]).toEqual({ id: 'poi_a', name: '孤山', category: '山', city: '杭州市', district: '西湖区', photos: 1, entries: 3 });
    expect(got.places[1]).toEqual({ id: 'poi_b', name: '断桥', category: '景', city: null, district: null, photos: 3, entries: 0 });
    // poi_f and poi_h, one use each, are past the 10 but counted
    expect(got.placeCount).toBe(12);
    // fewer than 10: all of them
    expect(await review(alice, 2025)).toMatchObject({ places: [{ id: 'poi_x', photos: 1, entries: 0 }], placeCount: 1 });
    expect(await review(alice, 2027)).toMatchObject({ places: [{ id: 'poi_a', photos: 1, entries: 0 }], placeCount: 1 });
  });
});

describe('tags', () => {
  it('are those of the year’s photos and entries, presets included: most used first, then by name and id, 10 of them', async () => {
    await insert('tags', [
      { id: 't_calli', owner_id: alice.me.id, name: '书法', color: '#aabbcc' },
      { id: 't_rain', owner_id: alice.me.id, name: '雨', color: null },
      { id: 't_bob', owner_id: bob.me.id, name: '湖光', color: null }
    ]);
    const at = '2026-02-01T10:00:00';
    await addPhotos(alice, [
      ...[1, 2, 3, 4].map((i) => ({ id: `ph_sunset${i}`, at, tags: ['sunset'] })),
      { id: 'ph_lake', at: '2026-01-01T00:00:00', tags: ['lake'] },
      { id: 'ph_mono', at: '2026-12-31T23:59:59', tags: ['mono'] },
      { id: 'ph_one1', at, tags: ['spring', 'tree', 'flower'] },
      { id: 'ph_one2', at, tags: ['tea', 'snow', 'fog'] },
      // none of these count in 2026
      { id: 'ph_2025', at: '2025-12-31T23:59:59', tags: ['snow', 'lake', 'temple'] },
      { id: 'ph_2027', at: '2027-01-01T00:00:00', tags: ['temple', 'mono'] },
      { id: 'ph_undated', at: null, tags: ['pagoda', 'temple'] }
    ]);
    await addEntries(alice, [
      ...[1, 2, 3].map((i) => ({ id: `en_calli${i}`, at: `2026-03-0${i}`, tags: ['t_calli'] })),
      { id: 'en_lake1', at: '2026-01-01', tags: ['lake', 'rain', 't_rain'] },
      { id: 'en_lake2', at: '2026-12-31T23:59:59', tags: ['lake', 'rain', 't_rain', 'mono'] },
      { id: 'en_archived', at: '2026-05-01', status: 'archived', tags: ['pagoda', 'temple', 'lake'] },
      { id: 'en_2027', at: '2027-01-01', tags: ['pagoda', 'temple'] }
    ]);
    await addPhotos(bob, [{ id: 'ph_bob', at, tags: ['lake', 't_bob', 'pagoda', 'temple'] }]);
    await addEntries(bob, [{ id: 'en_bob', at: '2026-05-01', tags: ['lake', 't_bob', 'pagoda'] }]);

    const got = (await review(alice, 2026)).tags;
    expect(got.map((t) => [t.id, t.photos, t.entries])).toEqual([
      ['sunset', 4, 0],
      ['t_calli', 0, 3],
      ['lake', 1, 2],
      ['rain', 0, 2],
      ['t_rain', 0, 2],
      ['mono', 1, 1],
      ['spring', 1, 0],
      ['tree', 1, 0],
      ['flower', 1, 0],
      ['tea', 1, 0]
    ]);
    expect(got).toHaveLength(REVIEW_TOP);
    expect(got.find((t) => t.id === 't_calli')).toEqual({ id: 't_calli', name: '书法', color: '#aabbcc', photos: 0, entries: 3 });
    expect(got.find((t) => t.id === 'mono')).toEqual({ id: 'mono', name: '黑白', color: 'mono', photos: 1, entries: 1 });
    expect(got.find((t) => t.id === 'lake')).toEqual({ id: 'lake', name: '湖', color: null, photos: 1, entries: 2 });
  });
});

describe('projects', () => {
  it('are one’s own with an entry that counts in the year or a milestone dated in it, most entries first, then by title and id', async () => {
    const reading = await project(alice, { title: '读书', type: 'reading' });
    const writing = await project(alice, { title: '练字', type: 'practice', status: 'paused', visibility: 'public' });
    const camera = await project(alice, { title: '摄影', type: 'creation', status: 'completed', visibility: 'unlisted' });
    const tripA = await project(alice, { title: '旅行' });
    const tripB = await project(alice, { title: '旅行' });
    const before = await project(alice, { title: '去年' });
    const shelved = await project(alice, { title: '归档' });
    await project(alice, { title: '空着' });
    const his = await project(bob, { title: '他的', visibility: 'public' });

    // three entries in 2026, on two days: one known by its day and one by its time on the same day, and a draft
    await entry(alice, '2026-03-01', { projectIds: [reading.id] });
    await entry(alice, '2026-03-01T21:00:00', { projectIds: [reading.id] });
    await entry(alice, '2026-04-02T08:00:00', { projectIds: [reading.id], status: 'draft' });
    // and three that do not count in 2026
    await entry(alice, '2026-04-03', { projectIds: [reading.id, shelved.id], status: 'archived' });
    await entry(alice, '2025-12-31T23:59:59', { projectIds: [reading.id, before.id] });
    await entry(alice, '2027-01-01', { projectIds: [reading.id] });
    const late = await milestone(alice, reading.id, '2026-12-31', '读完');
    const early = await milestone(alice, reading.id, '2026-01-01', '开始');
    const planned = await milestone(alice, reading.id, '2025-12-31', '计划');
    await milestone(alice, reading.id, '2027-01-01', '下一年');
    await entry(alice, '2026-06-01', { projectIds: [writing.id] });
    await entry(alice, '2026-07-01', { projectIds: [camera.id] });
    // a milestone and no entries
    const setOffA = await milestone(alice, tripA.id, '2026-05-01', '出发');
    const setOffB = await milestone(alice, tripB.id, '2026-08-01', '出发');
    const lastYear = await milestone(alice, before.id, '2025-06-01', '去年的');
    // bob's, with an entry and a milestone in 2026
    await entry(bob, '2026-05-01', { projectIds: [his.id], visibility: 'public' });
    await milestone(bob, his.id, '2026-05-01');

    const summary = (p: ProjectDetail, entries: number, days: number, milestones: Milestone[]) => ({
      id: p.id,
      title: p.title,
      type: p.type,
      status: p.status,
      visibility: p.visibility,
      entries,
      days,
      milestones: milestones.map(mark)
    });
    const trips = [
      [tripA, setOffA],
      [tripB, setOffB]
    ] as const;
    const [first, second] = [...trips].sort(([a], [b]) => (a.id < b.id ? -1 : 1));
    expect((await review(alice, 2026)).projects).toEqual([
      summary(reading, 3, 2, [early, late]),
      summary(camera, 1, 1, []),
      summary(writing, 1, 1, []),
      summary(first[0], 0, 0, [first[1]]),
      summary(second[0], 0, 0, [second[1]])
    ]);
    expect((await review(alice, 2025)).projects).toEqual([summary(before, 1, 1, [lastYear]), summary(reading, 1, 1, [planned])]);
  });
});

describe('collections', () => {
  it('are one’s own whose days meet the year, a single date being one day, as the collections list shows them', async () => {
    const shot = await photo(alice, '2024-05-01T08:00:00');
    const e = await entry(alice, '2026-05-01', { media: [{ photoId: shot.id }] });
    const made: Record<string, string> = {};
    const make = async (name: string, dates: Json, items: Json[] = []) => {
      made[name] = (await collection(alice, { kind: 'trip', title: name, ...dates }, items)).id;
    };
    await make('跨年', { startDate: '2025-12-01', endDate: '2026-01-01' });
    await make('除夕', { startDate: '2026-12-31' });
    await make('元旦', { endDate: '2026-01-01' });
    await make('去年', { startDate: '2025-06-01', endDate: '2025-12-31' });
    await make('截至去年', { endDate: '2025-12-31' });
    await make('明年', { startDate: '2027-01-01', endDate: '2027-01-03' });
    await make('三年', { startDate: '2025-01-01', endDate: '2027-12-31' });
    // its dates place it, not what it holds
    await make('一天', { startDate: '2024-05-01', coverPhotoId: shot.id }, [
      { kind: 'photo', photoId: shot.id },
      { kind: 'entry', entryId: e.id },
      { kind: 'day', day: '2026-05-01' }
    ]);
    // the latest changed first, as the collections list has them
    const changed = ['截至去年', '去年', '跨年', '元旦', '三年', '除夕', '一天', '明年'];
    for (const [i, name] of changed.entries()) {
      await run('UPDATE themes SET updated_at = ?1 WHERE id = ?2', `2026-11-${pad(20 - i)}T00:00:00Z`, made[name]);
    }
    // bob's, public, dated in the year
    await collection(bob, { kind: 'trip', visibility: 'public', startDate: '2026-05-01' });

    const listed = expectStatus(await alice.get('/api/themes?mine=1'), 200).themes as ThemeSummary[];
    expect(listed.map((t) => t.title)).toEqual(changed);
    const inYear = async (year: number) => (await review(alice, year)).collections;
    const shown = (names: string[]) => listed.filter((t) => names.includes(t.title));
    expect(await inYear(2026)).toEqual(shown(['跨年', '除夕', '元旦', '三年']));
    expect((await inYear(2026)).map((t) => t.title)).toEqual(['跨年', '元旦', '三年', '除夕']);
    expect(await inYear(2025)).toEqual(shown(['截至去年', '去年', '跨年', '三年']));
    expect(await inYear(2027)).toEqual(shown(['明年', '三年']));
    expect(await inYear(2024)).toEqual(shown(['一天']));
    expect(listed.find((t) => t.title === '一天')).toMatchObject({
      photoCount: 2,
      entryCount: 1,
      cover: expect.objectContaining({ id: shot.id })
    });
  });

  it('are, when undated, those holding a photo, an entry or a day of the year, whenever they were made', async () => {
    const at = {
      lastNight: await photo(alice, '2026-12-31T23:59:59'),
      lastYear: await photo(alice, '2025-12-31T23:59:59'),
      undated: await photo(alice, null)
    };
    const newYear = await entry(alice, '2026-01-01');
    const lastMinute = await entry(alice, '2026-12-31T23:59:00');
    const nextYear = await entry(alice, '2027-01-01T00:00:00');
    const archived = await entry(alice, '2026-06-01', { status: 'archived' });
    const draft = await entry(alice, '2026-06-02', { status: 'draft' });
    const made: Record<string, string> = {};
    const make = async (name: string, items: Json[], createdAt = '2026-06-01T00:00:00Z') => {
      const t = await collection(alice, { title: name }, items);
      await run('UPDATE themes SET created_at = ?1 WHERE id = ?2', createdAt, t.id);
      made[name] = t.id;
    };
    const photoItem = (p: PhotoDetail) => ({ kind: 'photo', photoId: p.id });
    const entryItem = (x: EntryDetail) => ({ kind: 'entry', entryId: x.id });
    await make('除夕的照片', [photoItem(at.lastNight)], '2027-02-01T00:00:00Z');
    await make('元旦的记录', [entryItem(newYear)], '2025-02-01T00:00:00Z');
    await make('除夕的记录', [entryItem(lastMinute)]);
    await make('草稿', [entryItem(draft)]);
    await make('一个日子', [
      { kind: 'text', text: '一段话' },
      { kind: 'day', day: '2026-07-01' }
    ]);
    await make('两头', [photoItem(at.lastYear), entryItem(nextYear)]);
    // nothing of a year: an archived entry, a photo without a capture time, words, nothing at all
    await make('归档', [entryItem(archived)]);
    await make('没有时间', [photoItem(at.undated)]);
    await make('只有文字', [{ kind: 'text', text: '一段话' }]);
    await make('空的', []);
    // bob's, public, holding his photo of the year
    const bobs = await photo(bob, '2026-05-01T08:00:00', { visibility: 'public' });
    await collection(bob, { visibility: 'public' }, [{ kind: 'photo', photoId: bobs.id }]);

    const titles = async (year: number) => (await review(alice, year)).collections.map((t) => t.title).sort();
    expect(await titles(2026)).toEqual(['一个日子', '元旦的记录', '草稿', '除夕的照片', '除夕的记录'].sort());
    expect(await titles(2025)).toEqual(['两头']);
    expect(await titles(2027)).toEqual(['两头']);
    expect(await titles(2024)).toEqual([]);
  });
});

describe('favourite photos', () => {
  it('are one’s own favourites taken in the year, all of them in the order they were taken while there are 24', async () => {
    // 24 favourites taken in 2026: photo i on February i, and photo 0 at the same time as photo 1. They are uploaded out
    // of order, photo 0 before photo 1 although its id sorts after: taken at the same time, they keep their upload order.
    const n = REVIEW_FAVORITES;
    const at = (i: number) => `2026-02-${pad(Math.max(i, 1))}T12:00:00`;
    const id = (i: number) => `ph_fav${pad(n - i)}`;
    const uploaded = Array.from({ length: n }, (_, k) => (k * 11) % n);
    expect(new Set(uploaded).size).toBe(n);
    expect(uploaded.indexOf(0)).toBeLessThan(uploaded.indexOf(1));
    expect(id(0) > id(1)).toBe(true);
    await addPhotos(
      alice,
      uploaded.map((i) => ({ id: id(i), at: at(i), favorite: true }))
    );
    await addPhotos(alice, [
      { id: 'ph_plain', at: '2026-01-01T00:00:00' },
      { id: 'ph_fav2025', at: '2025-12-31T23:59:59', favorite: true },
      { id: 'ph_fav2027', at: '2027-01-01T00:00:00', favorite: true },
      { id: 'ph_favundated', at: null, favorite: true }
    ]);
    await addPhotos(bob, [{ id: 'ph_bobfav', at: '2026-01-01T00:00:00', favorite: true }]);

    const got = (await review(alice, 2026)).favorites;
    expect(got.map((p) => p.id)).toEqual(Array.from({ length: n }, (_, i) => id(i)));
    const listed = await summaries(
      alice,
      got.map((p) => p.id)
    );
    expect(got).toEqual(got.map((p) => listed.get(p.id)));
    expect(got.every((p) => p.favorite)).toBe(true);

    expect((await review(alice, 2025)).favorites.map((p) => p.id)).toEqual(['ph_fav2025']);
    expect((await review(alice, 2027)).favorites.map((p) => p.id)).toEqual(['ph_fav2027']);
  });

  it('are, when there are more, the first of each of 24 equal runs in the order taken, so the whole year shows', async () => {
    // 49 favourites a week apart, January 1 to December 3, uploaded out of order: runs of two or three, the last in November
    const n = REVIEW_FAVORITES * 2 + 1;
    const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i * 7)).toISOString().slice(0, 10);
    const id = (i: number) => `ph_week${pad(i)}`;
    const uploaded = Array.from({ length: n }, (_, k) => (k * 11) % n);
    expect(new Set(uploaded).size).toBe(n);
    await addPhotos(
      alice,
      uploaded.map((i) => ({ id: id(i), at: `${day(i)}T12:00:00`, favorite: true }))
    );

    const firsts = Array.from({ length: REVIEW_FAVORITES }, (_, k) => Math.ceil((k * n) / REVIEW_FAVORITES));
    expect(firsts.slice(0, 4)).toEqual([0, 3, 5, 7]);
    expect(firsts.at(-1)).toBe(47);
    const got = (await review(alice, 2026)).favorites;
    expect(got.map((p) => p.id)).toEqual(firsts.map(id));
    expect(got.at(-1)?.takenAt?.slice(0, 7)).toBe('2026-11');
  });
});

describe('from and to on GET /api/entries and GET /api/photos', () => {
  const entryTimes = async (client: Client, query: string) =>
    (expectStatus(await client.get(`/api/entries?${query}`), 200).entries as EntrySummary[]).map((e) => e.occurredAt);
  const photoTimes = async (client: Client, query: string) =>
    expectStatus(await client.get<PhotoListResponse>(`/api/photos?${query}`), 200).photos.map((p) => p.takenAt);
  const entryIds = async (client: Client, query: string) =>
    (expectStatus(await client.get(`/api/entries?${query}`), 200).entries as EntrySummary[]).map((e) => e.id);
  const photoIds = async (client: Client, query: string) =>
    expectStatus(await client.get<PhotoListResponse>(`/api/photos?${query}`), 200).photos.map((p) => p.id);

  it('keep the entries of the days from `from` to `to`, both included, known by their day or by their time', async () => {
    for (const at of [
      '2026-04-01T00:00:00',
      '2026-03-31T23:59:59',
      '2026-04-30',
      '2026-04-01',
      '2026-05-01T00:00:00',
      '2026-04-15T12:00:00',
      '2026-05-01',
      '2026-04-30T23:59:59'
    ]) {
      await entry(alice, at);
    }
    const april = ['2026-04-30T23:59:59', '2026-04-30', '2026-04-15T12:00:00', '2026-04-01T00:00:00', '2026-04-01'];
    const fromLast = ['2026-05-01T00:00:00', '2026-05-01', '2026-04-30T23:59:59', '2026-04-30'];
    const toFirst = ['2026-04-01T00:00:00', '2026-04-01', '2026-03-31T23:59:59'];
    const cases: [string, string[]][] = [
      ['from=2026-04-01&to=2026-04-30', april],
      ['from=2026-04-30', fromLast],
      ['to=2026-04-01', toFirst],
      ['from=2026-04-01&to=2026-04-01', ['2026-04-01T00:00:00', '2026-04-01']],
      ['from=2026-04-02&to=2026-04-14', []],
      ['from=2026-05-02', []],
      ['to=2026-03-30', []],
      // left empty, a bound is no bound
      ['from=&to=2026-04-01', toFirst],
      ['from=2026-04-30&to=', fromLast]
    ];
    for (const [query, want] of cases) expect(await entryTimes(alice, `mine=1&${query}`), query).toEqual(want);
    const all = await entryTimes(alice, 'mine=1');
    expect(all).toHaveLength(8);
    expect(await entryTimes(alice, 'mine=1&from=&to=')).toEqual(all);
  });

  it('keep the photos taken on the days from `from` to `to`, both included; one without a capture time only without either', async () => {
    const taken = ['2026-04-01T00:00:00', '2026-05-01T00:00:00', '2026-03-31T23:59:59', '2026-04-30T23:59:59', '2026-04-15T12:00:00'];
    for (const at of taken) await photo(alice, at);
    await photo(alice, null);
    await photo(alice, null);
    const fromLast = ['2026-05-01T00:00:00', '2026-04-30T23:59:59'];
    const toFirst = ['2026-04-01T00:00:00', '2026-03-31T23:59:59'];
    const cases: [string, (string | null)[]][] = [
      ['from=2026-04-01&to=2026-04-30', ['2026-04-30T23:59:59', '2026-04-15T12:00:00', '2026-04-01T00:00:00']],
      ['from=2026-04-30', fromLast],
      ['to=2026-04-01', toFirst],
      ['from=2026-04-01&to=2026-04-01', ['2026-04-01T00:00:00']],
      ['from=2026-05-02', []],
      ['to=2026-03-30', []],
      ['from=&to=2026-04-01', toFirst],
      ['from=2026-04-30&to=', fromLast]
    ];
    for (const [query, want] of cases) expect(await photoTimes(alice, `mine=1&${query}`), query).toEqual(want);
    const all = [...[...taken].sort().reverse(), null, null];
    expect(await photoTimes(alice, 'mine=1')).toEqual(all);
    expect(await photoTimes(alice, 'mine=1&from=&to=')).toEqual(all);
  });

  it('refuse a day that is not a calendar day written YYYY-MM-DD, and a `to` before `from`', async () => {
    const bad = ['2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-1-1', '2026-04-1', '26-04-01', '2026/04/01', '20260401'];
    bad.push('2026-04-01T00:00:00', ' 2026-04-01', '2026-04-01 ', 'x', 'today');
    for (const path of ['/api/entries', '/api/photos']) {
      for (const day of bad) {
        const d = encodeURIComponent(day);
        for (const query of [`from=${d}`, `to=${d}`, `mine=1&from=2026-01-01&to=${d}`, `owner=alice&from=${d}&to=2026-12-31`]) {
          const res = await alice.get(`${path}?${query}`);
          expect(res.status, `${path}?${query}`).toBe(400);
          expect(res.body.error, `${path}?${query}`).toBe('invalid_input');
        }
      }
      for (const query of [
        'from=2026-04-02&to=2026-04-01',
        'from=2027-01-01&to=2026-12-31',
        'owner=nobody&from=2026-04-02&to=2026-04-01'
      ]) {
        const res = await anon.get(`${path}?${query}`);
        expect(res.status, `${path}?${query}`).toBe(400);
        expect(res.body.error, `${path}?${query}`).toBe('invalid_input');
      }
      // a leap day is a day, and a range may be one day long
      for (const query of ['from=2028-02-29', 'to=2028-02-29', 'from=2026-04-01&to=2026-04-01', 'from=0001-01-01&to=9999-12-31']) {
        expectStatus(await anon.get(`${path}?${query}`), 200);
      }
    }
  });

  it('narrow the public entry list and those of mine=1, owner=, project= and poi= alike', async () => {
    const lake = await place(alice, '西湖');
    const p = await project(alice, { title: '游湖', visibility: 'public' });
    const make = async (client: Client, at: string, fields: Json = {}) => (await entry(client, at, { visibility: 'public', ...fields })).id;
    const inside = await make(alice, '2026-04-10', { poiId: lake, projectIds: [p.id] });
    const later = await make(alice, '2026-05-10', { poiId: lake, projectIds: [p.id] });
    const draft = await make(alice, '2026-04-11', { status: 'draft', poiId: lake, projectIds: [p.id] });
    const hidden = await make(alice, '2026-04-12T08:00:00', { visibility: 'private', poiId: lake });
    const his = await make(bob, '2026-04-13', { poiId: lake });
    const hisLater = await make(bob, '2026-06-01', { poiId: lake });
    const april = 'from=2026-04-01&to=2026-04-30';

    expect(await entryIds(anon, april)).toEqual([his, inside]);
    expect(await entryIds(anon, 'from=2026-04-11')).toEqual([hisLater, later, his]);
    expect(await entryIds(bob, `owner=alice&${april}`)).toEqual([inside]);
    expect(await entryIds(alice, `owner=alice&${april}`)).toEqual([hidden, draft, inside]);
    expect(await entryIds(alice, `mine=1&${april}`)).toEqual([hidden, draft, inside]);
    expect(await entryIds(alice, 'mine=1&to=2026-04-11')).toEqual([draft, inside]);
    expect(await entryIds(anon, `project=${p.id}&${april}`)).toEqual([inside]);
    expect(await entryIds(alice, `project=${p.id}&${april}`)).toEqual([draft, inside]);
    expect(await entryIds(alice, `project=${p.id}&from=2026-05-01`)).toEqual([later]);
    expect(await entryIds(anon, `poi=${lake}&${april}`)).toEqual([his, inside]);
    expect(await entryIds(alice, `poi=${lake}&${april}`)).toEqual([his, hidden, draft, inside]);
    expect(await entryIds(bob, `poi=${lake}&from=2026-04-13&to=2026-05-31`)).toEqual([later, his]);
  });

  it('narrow the public gallery and the photo lists of mine=1, owner=, poi= and ids= alike', async () => {
    const lake = await place(alice, '西湖');
    const inside = await photo(alice, '2026-04-10T10:00:00', { poiId: lake });
    const later = await photo(alice, '2026-05-10T10:00:00', { poiId: lake });
    const hidden = await photo(alice, '2026-04-11T10:00:00', { visibility: 'private', poiId: lake });
    const undated = await photo(alice, null, { poiId: lake });
    const his = await photo(bob, '2026-04-12T10:00:00', { poiId: lake });
    const april = 'from=2026-04-01&to=2026-04-30';

    expect(await photoIds(anon, april)).toEqual([his.id, inside.id]);
    expect(await photoIds(anon, 'to=2026-04-11')).toEqual([inside.id]);
    expect(await photoIds(bob, `owner=alice&${april}`)).toEqual([inside.id]);
    expect(await photoIds(alice, `mine=1&${april}`)).toEqual([hidden.id, inside.id]);
    expect(await photoIds(alice, 'mine=1&from=2026-04-11')).toEqual([later.id, hidden.id]);
    expect(await photoIds(anon, `poi=${lake}&${april}`)).toEqual([his.id, inside.id]);
    expect(await photoIds(alice, `poi=${lake}&${april}`)).toEqual([his.id, hidden.id, inside.id]);
    const mine = [inside, later, hidden, undated].map((p) => p.id);
    expect(await photoIds(alice, `ids=${mine.join(',')}&${april}`)).toEqual([hidden.id, inside.id]);
    expect(await photoIds(alice, `ids=${mine.join(',')}&to=2026-12-31`)).toEqual([later.id, hidden.id, inside.id]);
    expect(await photoIds(alice, `ids=${mine.join(',')}`)).toEqual([later.id, hidden.id, inside.id, undated.id]);
  });
});
