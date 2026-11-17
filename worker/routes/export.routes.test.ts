// Export against real D1: docs/api/export.md. The signed-in user's archive, read part by part and page by page: their
// own rows only, besides every preset tag and the places their photos and entries are at; no secrets (no password hash,
// no share-link token); and pages that neither overlap nor skip a row, however the rows are spread among other people's.
// Expectations follow the documented rules, never the implementation.

import { beforeEach, describe, expect, it } from 'vite-plus/test';
import {
  EXPORT_PARTS,
  type EntryDetail,
  type ExportPage,
  type ExportPart,
  type ExportSummary,
  type Milestone,
  type PhotoDetail,
  type ProjectDetail,
  type ShareLink,
  type ThemeDetail
} from '../../shared/types';
import { Client, expectStatus, JPEG, newSha, newUser, upload, usePlatform, type Json } from '../test-platform';

const platform = usePlatform();

let alice: Client;
let bob: Client;
beforeEach(async () => {
  alice = await newUser(platform, 'alice', 'owner');
  bob = await newUser(platform, 'bob');
});

const AT = '2026-11-16T08:30:00';
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** A page holds at most this many rows, and about this many bytes unless one row alone is more (docs/api/export.md). */
const PAGE_ROWS = 500;
const PAGE_BYTES = 1_000_000;

/** The fields that tell the rows of a part keyed by two ids apart; every other part has `id`. */
const COMPOSITE: Partial<Record<ExportPart, string[]>> = {
  photoTags: ['photoId', 'tagId'],
  entryMedia: ['entryId', 'photoId'],
  entryTags: ['entryId', 'tagId'],
  entryProjects: ['entryId', 'projectId']
};
/** A row's position in its part, as `after` takes it. */
const keyOf = (part: ExportPart, r: Json): string => COMPOSITE[part]?.map((k) => r[k] as string).join(',') ?? (r.id as string);
/** Ids in the order of their bytes, as the parts are ordered. */
const byBytes = (items: string[]) => [...items].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const bytes = (s: unknown) => (typeof s === 'string' ? new TextEncoder().encode(s).length : 0);
const pad = (i: number, n = 3) => String(i).padStart(n, '0');

const page = async (client: Client, part: string, after?: string): Promise<ExportPage<Json>> =>
  expectStatus(await client.get<ExportPage<Json>>(`/api/export/${part}${after === undefined ? '' : `?after=${after}`}`), 200);
/** Every page of a part, from the first, following `next` to the end. */
async function pages(client: Client, part: ExportPart): Promise<ExportPage<Json>[]> {
  const out: ExportPage<Json>[] = [];
  let after: string | undefined;
  for (;;) {
    const p = await page(client, part, after);
    out.push(p);
    if (p.next === null) return out;
    expect(p.rows.length, `${part} page ${out.length}`).toBeGreaterThan(0);
    expect(out.length, part).toBeLessThan(50);
    after = p.next;
  }
}
const rowsOf = async (client: Client, part: ExportPart): Promise<Json[]> => (await pages(client, part)).flatMap((p) => p.rows);
/** The text of every response an export reads: the summary and each page of each part. */
async function everything(client: Client): Promise<string> {
  const read = async (path: string) => {
    const res = await client.fetch(path);
    expect(res.status, path).toBe(200);
    return res.text();
  };
  const texts = [await read('/api/export')];
  for (const part of EXPORT_PARTS) {
    let after: string | null = null;
    do {
      const text = await read(`/api/export/${part}${after ? `?after=${after}` : ''}`);
      texts.push(text);
      after = (JSON.parse(text) as ExportPage).next;
    } while (after);
  }
  return texts.join('\n');
}

const run = (sql: string, ...params: unknown[]) =>
  platform.env.DB.prepare(sql)
    .bind(...params)
    .run();
const rows = async (sql: string, ...params: unknown[]) =>
  (
    await platform.env.DB.prepare(sql)
      .bind(...params)
      .all<Json>()
  ).results;
/** Rows written straight to D1 in one statement: more than the API would make in a test's time. */
async function insert(table: string, list: Json[]): Promise<void> {
  const cols = Object.keys(list[0]);
  await run(
    `INSERT INTO ${table} (${cols.join(', ')}) SELECT ${cols.map((c) => `json_extract(value, '$.${c}')`).join(', ')} FROM json_each(?1)`,
    JSON.stringify(list)
  );
}
const photoRow = (id: string, owner: Client) => ({
  id,
  owner_id: owner.me.id,
  width: 3000,
  height: 2000,
  file_key: `o/${owner.me.id}/${id}.jpg`,
  variants: JSON.stringify({
    s: { key: `v/${id}/s.webp`, w: 1, h: 1 },
    m: { key: `v/${id}/m.webp`, w: 1, h: 1 },
    l: { key: `v/${id}/l.webp`, w: 1, h: 1 }
  })
});
/** The preset tags, which every account's export holds, in key order. */
const presets = async (): Promise<string[]> =>
  byBytes((await rows('SELECT id FROM tags WHERE owner_id IS NULL')).map((r) => r.id as string));

const createPlace = async (client: Client, name: string): Promise<string> =>
  expectStatus(await client.post('/api/pois', { name, category: '湖', lat: 30.25, lng: 120.15 }), 201).poi.id;
const share = async (client: Client, kind: string, id: string, body: Json = {}): Promise<ShareLink> =>
  expectStatus(await client.post('/api/shares', { kind, id, ...body }), 201).share;

/** One of everything a person keeps here: a row in every part of their export. */
interface Archive {
  tag: string;
  place: string;
  photos: [PhotoDetail, PhotoDetail];
  sha: string;
  entry: EntryDetail;
  project: ProjectDetail;
  milestone: Milestone;
  theme: ThemeDetail;
  zone: string;
  share: ShareLink;
}

async function archive(client: Client, name: string): Promise<Archive> {
  const tag = expectStatus(await client.post('/api/tags', { name, parentId: 'lake' }), 201).tag.id as string;
  const place = await createPlace(client, `${name}的湖`);
  const sha = newSha();
  const first = await upload(client, {
    title: `${name}的断桥`,
    note: '雪后',
    takenAt: '2026-05-01T08:00:00',
    tz: '+08:00',
    lat: 30.2593,
    lng: 120.1517,
    alt: 12,
    heading: 95,
    geoPrivacy: 'fuzzy',
    province: '浙江省',
    city: '杭州市',
    district: '西湖区',
    poiId: place,
    poiMethod: 'confirmed',
    camera: 'X100V',
    lens: '23mm',
    focal: 23,
    focal35: 35,
    aperture: 2,
    shutter: '1/250',
    iso: 160,
    thumbhash: 'abc',
    palette: ['#aabbcc'],
    focus: [0.25, 0.75],
    visibility: 'unlisted',
    inLiving: false,
    favorite: true,
    sha256: sha,
    tagIds: [tag, 'lake']
  });
  const second = await upload(client, { visibility: 'private' });
  const pid = expectStatus(
    await client.post('/api/projects', {
      title: `${name}的项目`,
      type: 'practice',
      startDate: '2026-03-01',
      description: '每天写',
      status: 'paused'
    }),
    201
  ).project.id as string;
  const milestone = expectStatus(
    await client.post(`/api/projects/${pid}/milestones`, { title: '第一步', date: '2026-04-01', body: '小结' }),
    201
  ).milestone as Milestone;
  const e = expectStatus(
    await client.post('/api/entries', {
      occurredAt: AT,
      type: 'trip',
      title: `${name}的记录`,
      body: '正文',
      status: 'archived',
      visibility: 'unlisted',
      media: [{ photoId: first.id, caption: '说明' }, { photoId: second.id }],
      tagIds: [tag, 'lake'],
      projectIds: [pid],
      poiId: place
    }),
    201
  ).entry as EntryDetail;
  const tid = expectStatus(
    await client.post('/api/themes', {
      kind: 'trip',
      title: `${name}的合集`,
      subtitle: '三日',
      intro: '导语',
      coverPhotoId: first.id,
      startDate: '2026-05-01'
    }),
    201
  ).theme.id as string;
  const items = [
    { kind: 'text', text: '一段' },
    { kind: 'photo', photoId: second.id, text: '照片说明' },
    { kind: 'entry', entryId: e.id },
    { kind: 'day', day: '2026-05-01', text: '第一天' }
  ];
  expectStatus(await client.put(`/api/themes/${tid}/items`, { items }), 200);
  const zone = expectStatus(await client.post('/api/privacy-zones', { name: '家', lat: 31, lng: 121, radius: 300 }), 201).zone.id as string;
  const link = await share(client, 'entry', e.id, { expiresInDays: 7 });
  return {
    tag,
    place,
    photos: [
      expectStatus(await client.get<PhotoDetail>(`/api/photos/${first.id}`), 200),
      expectStatus(await client.get<PhotoDetail>(`/api/photos/${second.id}`), 200)
    ],
    sha,
    entry: expectStatus(await client.get<EntryDetail>(`/api/entries/${e.id}`), 200),
    project: expectStatus(await client.get<ProjectDetail>(`/api/projects/${pid}`), 200),
    milestone,
    theme: expectStatus(await client.get<ThemeDetail>(`/api/themes/${tid}`), 200),
    zone,
    share: link
  };
}

/** What each part of an export must hold of `a`, in key order, besides the presets among the tags. */
function keysOf(a: Archive, presetIds: string[]): Record<ExportPart, string[]> {
  const [p1, p2] = a.photos;
  const e = a.entry.id;
  const keys: Record<ExportPart, string[]> = {
    photos: [p1.id, p2.id],
    photoTags: [`${p1.id},${a.tag}`, `${p1.id},lake`],
    entries: [e],
    entryMedia: [`${e},${p1.id}`, `${e},${p2.id}`],
    entryTags: [`${e},${a.tag}`, `${e},lake`],
    entryProjects: [`${e},${a.project.id}`],
    projects: [a.project.id],
    milestones: [a.milestone.id],
    themes: [a.theme.id],
    themeItems: a.theme.items.map((i) => i.id),
    tags: [...presetIds, a.tag],
    places: [a.place],
    privacyZones: [a.zone],
    shareLinks: [a.share.id]
  };
  return Object.fromEntries(Object.entries(keys).map(([part, list]) => [part, byBytes(list)])) as Record<ExportPart, string[]>;
}

describe('GET /api/export and /api/export/:part', () => {
  it('need a session', async () => {
    const anon = new Client(platform);
    for (const p of ['/api/export', ...EXPORT_PARTS.map((part) => `/api/export/${part}`)]) {
      const res = await anon.get(p);
      expect(res.status, p).toBe(401);
      expect(res.body.error, p).toBe('unauthenticated');
    }
  });

  it('answer 404 for a part that is not there', async () => {
    for (const part of ['nope', 'Photos', 'photo_tags', 'users', 'invites', 'settings', 'constructor', '__proto__', 'toString']) {
      const res = await alice.get(`/api/export/${part}`);
      expect(res.status, part).toBe(404);
      expect(res.body.error, part).toBe('not_found');
    }
  });

  it('refuse an after that is no position in the part: an id for each of its keys, comma-joined', async () => {
    const bad: [ExportPart, string][] = [
      ['photos', ''],
      ['photos', ','],
      ['photos', 'ph_a,ph_b'],
      ['photos', 'ph a'],
      ['photos', 'ph.a'],
      ['photos', 'ph/a'],
      ['photos', 'ä'],
      ['photos', 'x'.repeat(65)],
      ['tags', "lake'--"],
      ['photoTags', 'ph_a'],
      ['photoTags', 'ph_a,lake,x'],
      ['photoTags', 'ph_a,'],
      ['photoTags', ',lake'],
      ['entryMedia', 'en_a'],
      ['entryTags', 'en_a,t a'],
      ['entryProjects', 'en_a']
    ];
    for (const [part, after] of bad) {
      const res = await alice.get(`/api/export/${part}?after=${encodeURIComponent(after)}`);
      expect(res.status, `${part} ${after}`).toBe(400);
      expect(res.body.error, `${part} ${after}`).toBe('invalid_input');
    }
    // any ids will do, whether or not there is such a row
    for (const [part, after] of [
      ['photos', 'x'.repeat(64)],
      ['photoTags', 'ph_a,lake'],
      ['entryMedia', 'A-b_9,ph_x'],
      ['entryProjects', 'en_a,pj_b']
    ]) {
      expect(await page(alice, part, after), `${part} ${after}`).toEqual({ rows: [], next: null });
    }
  });

  it('answer an empty page for a part without rows, and past a part’s end', async () => {
    for (const part of EXPORT_PARTS.filter((p) => p !== 'tags')) expect(await page(alice, part), part).toEqual({ rows: [], next: null });
    await archive(alice, '我');
    for (const part of EXPORT_PARTS) {
      const after = COMPOSITE[part] ? 'zzzz,zzzz' : 'zzzz';
      expect(await page(alice, part, after), part).toEqual({ rows: [], next: null });
    }
  });
});

describe('what an export holds', () => {
  it('sums the archive up: the profile, as many rows a part as its pages hold, and the bytes of the original files', async () => {
    const mine = await archive(alice, '我');
    await archive(bob, '他');
    expectStatus(
      await alice.patch('/api/me', {
        displayName: '爱丽丝',
        bio: '写字的人',
        avatarPhotoId: mine.photos[0].id,
        photoVisibility: 'private'
      }),
      200
    );
    // the sizes of the originals, set straight in D1: the uploads here carry a few bytes each
    await run('UPDATE photos SET file_size = ?1 WHERE id = ?2', 1_500_000, mine.photos[0].id);
    await run('UPDATE photos SET file_size = ?1 WHERE id = ?2', 2_345, mine.photos[1].id);

    const res = await alice.get<ExportSummary>('/api/export');
    const summary = expectStatus(res, 200);
    expect(res.headers.get('cache-control')).toMatch(/\bno-store\b/);
    expect((await alice.get('/api/export/photos')).headers.get('cache-control')).toMatch(/\bno-store\b/);
    expect(summary.profile).toEqual({
      id: alice.me.id,
      handle: 'alice',
      displayName: '爱丽丝',
      bio: '写字的人',
      avatarPhotoId: mine.photos[0].id,
      role: 'owner',
      photoVisibility: 'private',
      createdAt: expect.stringMatching(UTC)
    });
    expect(summary.originalBytes).toBe(1_502_345);
    const held = Object.fromEntries(await Promise.all(EXPORT_PARTS.map(async (part) => [part, (await rowsOf(alice, part)).length])));
    expect(summary.counts).toEqual(held);
    expect(summary.counts).toEqual({
      photos: 2,
      photoTags: 2,
      entries: 1,
      entryMedia: 2,
      entryTags: 2,
      entryProjects: 1,
      projects: 1,
      milestones: 1,
      themes: 1,
      themeItems: 4,
      tags: (await presets()).length + 1,
      places: 1,
      privacyZones: 1,
      shareLinks: 1
    });
    // bob's sum: his originals as uploaded
    expect(expectStatus(await bob.get<ExportSummary>('/api/export'), 200).originalBytes).toBe(2 * JPEG.length);
  });

  it('holds one’s own rows in every part, the presets among the tags, and nothing of anyone else’s', async () => {
    const mine = await archive(alice, '我');
    const theirs = await archive(bob, '他');
    const presetIds = await presets();
    for (const part of EXPORT_PARTS) {
      expect(
        (await rowsOf(alice, part)).map((r) => keyOf(part, r)),
        part
      ).toEqual(keysOf(mine, presetIds)[part]);
      expect(
        (await rowsOf(bob, part)).map((r) => keyOf(part, r)),
        part
      ).toEqual(keysOf(theirs, presetIds)[part]);
    }
    const text = await everything(alice);
    const his = [
      bob.me.id,
      theirs.tag,
      theirs.place,
      ...theirs.photos.map((p) => p.id),
      theirs.entry.id,
      theirs.project.id,
      theirs.milestone.id,
      theirs.theme.id,
      ...theirs.theme.items.map((i) => i.id),
      theirs.zone,
      theirs.share.id,
      theirs.share.token
    ];
    for (const id of his) expect(text).not.toContain(id);
  });

  it('gives each part’s rows in their documented fields', async () => {
    const a = await archive(alice, '我');
    const [p1, p2] = a.photos;
    const owner = alice.me.id;
    expect(await rowsOf(alice, 'photos')).toEqual([
      {
        id: p1.id,
        title: '我的断桥',
        note: '雪后',
        takenAt: '2026-05-01T08:00:00',
        tz: '+08:00',
        lat: 30.2593,
        lng: 120.1517,
        alt: 12,
        heading: 95,
        geoPrivacy: 'fuzzy',
        province: '浙江省',
        city: '杭州市',
        district: '西湖区',
        poiId: a.place,
        poiDistance: p1.poiDistance,
        poiMethod: 'confirmed',
        camera: 'X100V',
        lens: '23mm',
        focal: 23,
        focal35: 35,
        aperture: 2,
        shutter: '1/250',
        iso: 160,
        width: 3000,
        height: 2000,
        fileKey: `o/${owner}/${p1.id}.jpg`,
        fileType: 'image/jpeg',
        fileSize: JPEG.length,
        sha256: a.sha,
        variants: p1.variants,
        thumbhash: 'abc',
        palette: ['#aabbcc'],
        focus: [0.25, 0.75],
        visibility: 'unlisted',
        inLiving: false,
        favorite: true,
        uploadedAt: p1.uploadedAt,
        updatedAt: p1.updatedAt
      },
      expect.objectContaining({ id: p2.id, title: null, note: null, visibility: 'private', inLiving: true, favorite: false, focus: null })
    ]);
    expect(typeof p1.poiDistance).toBe('number');
    expect(await rowsOf(alice, 'photoTags')).toEqual(
      [
        { photoId: p1.id, tagId: a.tag, source: 'manual' },
        { photoId: p1.id, tagId: 'lake', source: 'manual' }
      ].sort((x, y) => (x.tagId < y.tagId ? -1 : 1))
    );
    expect(await rowsOf(alice, 'entries')).toEqual([
      {
        id: a.entry.id,
        type: 'trip',
        title: '我的记录',
        body: '正文',
        occurredAt: AT,
        visibility: 'unlisted',
        status: 'archived',
        revision: 1,
        poiId: a.place,
        createdAt: a.entry.createdAt,
        updatedAt: a.entry.updatedAt
      }
    ]);
    expect(await rowsOf(alice, 'entryMedia')).toEqual([
      { entryId: a.entry.id, photoId: p1.id, position: 0, caption: '说明' },
      { entryId: a.entry.id, photoId: p2.id, position: 1, caption: null }
    ]);
    expect(await rowsOf(alice, 'entryTags')).toEqual(
      [
        { entryId: a.entry.id, tagId: a.tag },
        { entryId: a.entry.id, tagId: 'lake' }
      ].sort((x, y) => (x.tagId < y.tagId ? -1 : 1))
    );
    expect(await rowsOf(alice, 'entryProjects')).toEqual([{ entryId: a.entry.id, projectId: a.project.id }]);
    expect(await rowsOf(alice, 'projects')).toEqual([
      {
        id: a.project.id,
        type: 'practice',
        title: '我的项目',
        description: '每天写',
        startDate: '2026-03-01',
        endDate: null,
        status: 'paused',
        visibility: 'private',
        createdAt: a.project.createdAt,
        updatedAt: a.project.updatedAt
      }
    ]);
    expect(await rowsOf(alice, 'milestones')).toEqual([a.milestone]);
    expect(a.milestone).toMatchObject({ projectId: a.project.id, title: '第一步', body: '小结', date: '2026-04-01' });
    expect(await rowsOf(alice, 'themes')).toEqual([
      {
        id: a.theme.id,
        kind: 'trip',
        title: '我的合集',
        subtitle: '三日',
        intro: '导语',
        coverPhotoId: p1.id,
        startDate: '2026-05-01',
        endDate: null,
        visibility: 'private',
        createdAt: a.theme.createdAt,
        updatedAt: a.theme.updatedAt,
        publishedAt: null
      }
    ]);
    const item = (i: number, fields: Json) => ({
      id: a.theme.items[i].id,
      themeId: a.theme.id,
      position: i,
      photoId: null,
      entryId: null,
      text: null,
      day: null,
      ...fields
    });
    expect(await rowsOf(alice, 'themeItems')).toEqual(
      [
        item(0, { kind: 'text', text: '一段' }),
        item(1, { kind: 'photo', photoId: p2.id, text: '照片说明' }),
        item(2, { kind: 'entry', entryId: a.entry.id }),
        item(3, { kind: 'day', day: '2026-05-01', text: '第一天' })
      ].sort((x, y) => (x.id < y.id ? -1 : 1))
    );
    const tags = await rowsOf(alice, 'tags');
    expect(tags.find((t) => t.id === a.tag)).toEqual({
      id: a.tag,
      ownerId: owner,
      parentId: 'lake',
      name: '我',
      color: null,
      sort: expect.any(Number),
      createdAt: expect.stringMatching(UTC)
    });
    expect(tags.find((t) => t.id === 'lake')).toEqual({
      id: 'lake',
      ownerId: null,
      parentId: 'nature',
      name: '湖',
      color: null,
      sort: 10,
      createdAt: expect.stringMatching(UTC)
    });
    expect(tags.find((t) => t.id === 'mono')).toMatchObject({ ownerId: null, parentId: 'tone', name: '黑白', color: 'mono' });
    expect(await rowsOf(alice, 'places')).toEqual([
      {
        id: a.place,
        name: '我的湖',
        aliases: [],
        category: '湖',
        city: null,
        district: null,
        lat: 30.25,
        lng: 120.15,
        radius: expect.any(Number),
        source: 'custom',
        sourceId: null,
        own: true,
        createdAt: expect.stringMatching(UTC)
      }
    ]);
    expect(await rowsOf(alice, 'privacyZones')).toEqual([
      { id: a.zone, name: '家', lat: 31, lng: 121, radius: 300, createdAt: expect.stringMatching(UTC) }
    ]);
    expect(await rowsOf(alice, 'shareLinks')).toEqual([
      { id: a.share.id, kind: 'entry', itemId: a.entry.id, createdAt: a.share.createdAt, expiresAt: a.share.expiresAt }
    ]);
  });

  it('holds the places one made and those one’s photos and entries are at, saying which one made', async () => {
    const made = await createPlace(alice, '家');
    const shot = await createPlace(bob, '湖');
    const written = await createPlace(bob, '桥');
    const both = await createPlace(alice, '塔');
    const his = await createPlace(bob, '山');
    // a provider's place that no account made
    await insert('pois', [{ id: 'poi_osm1', name: '寺', lat: 30.2, lng: 120.1, source: 'osm', source_id: 'node/1', created_by: null }]);
    expectStatus(await alice.patch(`/api/pois/${both}`, { aliases: ['Leifeng Pagoda', '雷峰塔'] }), 200);
    await upload(alice, { poiId: shot });
    await upload(alice, { poiId: both });
    await upload(alice, { poiId: 'poi_osm1' });
    expectStatus(await alice.post('/api/entries', { occurredAt: AT, body: 'x', poiId: written, status: 'draft' }), 201);
    await upload(bob, { poiId: his });
    await upload(bob, { poiId: made });

    const own = async (client: Client) => (await rowsOf(client, 'places')).map((r) => `${r.id} ${r.own}`);
    expect(await own(alice)).toEqual(byBytes([`${made} true`, `${shot} false`, `${written} false`, `${both} true`, 'poi_osm1 false']));
    expect(await own(bob)).toEqual(byBytes([`${made} false`, `${shot} true`, `${written} true`, `${his} true`]));
    expect((await rowsOf(alice, 'places')).find((r) => r.id === both)).toMatchObject({ name: '塔', aliases: ['Leifeng Pagoda', '雷峰塔'] });
    expect((await rowsOf(alice, 'places')).find((r) => r.id === shot)).toMatchObject({ name: '湖', own: false });
    expect((await rowsOf(alice, 'places')).find((r) => r.id === 'poi_osm1')).toMatchObject({
      source: 'osm',
      sourceId: 'node/1',
      own: false
    });
  });

  it('leaves out share links’ tokens and the password hash, wherever one might look', async () => {
    const a = await archive(alice, '我');
    const links = [a.share, await share(alice, 'theme', a.theme.id), await share(alice, 'project', a.project.id, { expiresInDays: 30 })];
    const got = await rowsOf(alice, 'shareLinks');
    expect(got).toEqual(
      byBytes(links.map((l) => l.id)).map((id) => {
        const l = links.find((x) => x.id === id) as ShareLink;
        return { id, kind: l.kind, itemId: l.targetId, createdAt: l.createdAt, expiresAt: l.expiresAt };
      })
    );
    for (const r of got) expect(r).not.toHaveProperty('token');
    const [{ password_hash: hash }] = await rows('SELECT password_hash FROM users WHERE id = ?1', alice.me.id);
    const secrets = [...links.map((l) => l.token), hash as string, ...(hash as string).split('$').slice(2)];
    const text = await everything(alice);
    for (const s of secrets) expect(text).not.toContain(s);
    expect(text).not.toMatch(/password/i);
  });
});

describe('paging', () => {
  it('gives a part of more than 500 rows 500 a page, each after the one before, none twice and none left out', async () => {
    // 1,100 tags of alice's and 300 of bob's, their ids in among hers
    await insert(
      'tags',
      Array.from({ length: 1100 }, (_, i) => ({ id: `t_${pad(i, 4)}a`, owner_id: alice.me.id, name: `标签${i}` }))
    );
    await insert(
      'tags',
      Array.from({ length: 300 }, (_, i) => ({ id: `t_${pad(i * 3, 4)}b`, owner_id: bob.me.id, name: `他的${i}` }))
    );
    const all = await pages(alice, 'tags');
    const presetIds = await presets();
    expect(all.map((p) => p.rows.length)).toEqual([PAGE_ROWS, PAGE_ROWS, presetIds.length + 1100 - 2 * PAGE_ROWS]);
    const ids = all.flatMap((p) => p.rows.map((r) => r.id as string));
    expect(ids).toEqual(byBytes([...presetIds, ...Array.from({ length: 1100 }, (_, i) => `t_${pad(i, 4)}a`)]));
    // each page names the last row it holds, and the last page none
    expect(all.map((p) => p.next)).toEqual([...all.slice(0, -1).map((p) => p.rows[p.rows.length - 1].id), null]);
    // a page may start anywhere
    const from = ids[700];
    expect((await page(alice, 'tags', from)).rows.map((r) => r.id)).toEqual(ids.slice(701, 701 + PAGE_ROWS));
  });

  it('pages a part keyed by two ids the same way, a page ending halfway through one photo’s tags', async () => {
    // 12 photos of alice's and 12 of bob's, every one with each preset: 540 rows of alice's
    await insert('photos', [
      ...Array.from({ length: 12 }, (_, i) => photoRow(`ph_${pad(i)}a`, alice)),
      ...Array.from({ length: 12 }, (_, i) => photoRow(`ph_${pad(i)}b`, bob))
    ]);
    await run('INSERT INTO photo_tags (photo_id, tag_id) SELECT p.id, t.id FROM photos p, tags t WHERE t.owner_id IS NULL');
    const presetIds = await presets();
    const expected = Array.from({ length: 12 }, (_, i) => presetIds.map((t) => `ph_${pad(i)}a,${t}`)).flat();
    const all = await pages(alice, 'photoTags');
    expect(all.map((p) => p.rows.length)).toEqual([PAGE_ROWS, expected.length - PAGE_ROWS]);
    expect(all.flatMap((p) => p.rows.map((r) => keyOf('photoTags', r)))).toEqual(expected);
    // 500 rows: eleven photos' tags and five of the twelfth's
    expect(all[0].next).toBe(`ph_011a,${presetIds[PAGE_ROWS - 11 * presetIds.length - 1]}`);
    expect(all[0].next).toBe(expected[PAGE_ROWS - 1]);
    expect(all[1].next).toBeNull();
  });

  it('gives exactly 500 rows in one page, and a 501st on a page of its own', async () => {
    const presetIds = await presets();
    const own = Array.from({ length: PAGE_ROWS - presetIds.length }, (_, i) => ({
      id: `t_${pad(i)}`,
      owner_id: alice.me.id,
      name: `标签${i}`
    }));
    await insert('tags', own);
    const one = await pages(alice, 'tags');
    expect(one.map((p) => [p.rows.length, p.next])).toEqual([[PAGE_ROWS, null]]);
    await insert('tags', [{ id: 'zz_last', owner_id: alice.me.id, name: '最后' }]);
    const two = await pages(alice, 'tags');
    expect(two.map((p) => [p.rows.length, p.next])).toEqual([
      [PAGE_ROWS, one[0].rows[PAGE_ROWS - 1].id],
      [1, null]
    ]);
    expect(two[1].rows[0].id).toBe('zz_last');
  });

  it('pages long entries by their size: at most 1,000,000 bytes of text a page, unless one entry alone is longer', async () => {
    // 30 entries of 40,000 characters of three bytes each, one of more than a page's worth, and bob's long entries among them
    const body = (chars: number) => `replace(hex(zeroblob(${chars})), '00', '字')`;
    const ids = (from: number, to: number, suffix: string) =>
      JSON.stringify(Array.from({ length: to - from }, (_, i) => `en_${pad(from + i)}${suffix}`));
    const add = (owner: Client, list: string, chars: number) =>
      run(
        `INSERT INTO entries (id, owner_id, title, body, occurred_at) SELECT value, ?1, '长文', ${body(chars)}, '2026-01-01' FROM json_each(?2)`,
        owner.me.id,
        list
      );
    await add(alice, ids(0, 30, 'a'), 40_000);
    await add(alice, JSON.stringify(['en_014z']), 366_667);
    await add(bob, ids(0, 30, 'b'), 40_000);

    const all = await pages(alice, 'entries');
    const sizes = all.map((p) => p.rows.reduce((n, r) => n + bytes(r.body) + bytes(r.title), 0));
    for (const [i, p] of all.entries()) {
      if (p.rows.length > 1) expect(sizes[i], `page ${i}`).toBeLessThanOrEqual(PAGE_BYTES);
    }
    // eight entries make a page; the long one goes alone, and the page before it ends early
    expect(all.map((p) => p.rows.length)).toEqual([8, 7, 1, 8, 7]);
    expect(all[2].rows[0]).toMatchObject({ id: 'en_014z' });
    expect(bytes(all[2].rows[0].body)).toBeGreaterThan(PAGE_BYTES);
    expect(all.flatMap((p) => p.rows.map((r) => r.id))).toEqual(byBytes([...(JSON.parse(ids(0, 30, 'a')) as string[]), 'en_014z']));
    expect((await rowsOf(alice, 'entries')).every((r) => r.body === '字'.repeat(r.id === 'en_014z' ? 366_667 : 40_000))).toBe(true);
  });
});
