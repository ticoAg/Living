// Import against real D1: docs/api/import.md. An export's rows brought into the signed-in account: nothing that is here
// already is touched, a second import makes nothing twice, what a row points to must be the importer's own (or, for a
// place, exist), and nobody can arrive at an id that someone else's import, or anyone's earlier item, has. Covered: the
// session, headers and body size of every endpoint; resolve; the rows' checks, times and visibility; tags, places and
// privacy zones; projects with their milestones, entries and collections with their items.
// Expectations follow the documented rules, never the implementation.

import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { destination } from '../../shared/geo';
import { IMPORT_LIMITS, MILESTONE_LIMITS, PRIVACY_ZONE_LIMITS, TAG_LIMITS, THEME_LIMITS } from '../../shared/limits';
import type {
  EntryDetail,
  ImportIdsResponse,
  ImportResolveBody,
  ImportResolveResponse,
  ImportRowsResponse,
  ImportZonesResponse,
  PhotoDetail,
  PoiDetail,
  PrivacyZone,
  ProjectDetail,
  Tag,
  ThemeDetail
} from '../../shared/types';
import { Client, expectStatus, newSha, newUser, upload, usePlatform, type ApiResponse, type Json } from '../test-platform';

const platform = usePlatform();

let alice: Client;
let bob: Client;
beforeEach(async () => {
  alice = await newUser(platform, 'alice', 'owner');
  bob = await newUser(platform, 'bob');
});

const ok = <T>(p: Promise<ApiResponse<T>>, status = 200) => p.then((r) => expectStatus(r, status));

// ---- ids and times ------------------------------------------------------------------------------------------------

/** Times as the API writes them (docs/api/conventions.md#格式). */
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** The shape of an id an import gives: the prefix and 26 Crockford base32 characters. */
const importId = (prefix: string) => new RegExp(`^${prefix}[${CROCKFORD}]{26}$`);

/**
 * The id the import gives an item of `account`'s import (docs/api/import.md#规则), worked out as the docs say: the
 * prefix, then the SHA-256 of the three lines `living-import`, the account's id and the item's id in the export, in
 * Crockford base32, the first 26 characters.
 */
async function importedId(prefix: string, account: Client, exportId: string): Promise<string> {
  const text = ['living-import', account.me.id, exportId].join('\n');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const bits = [...digest].map((b) => b.toString(2).padStart(8, '0')).join('');
  let out = '';
  for (let i = 0; i < 26; i++) out += CROCKFORD[Number.parseInt(bits.slice(5 * i, 5 * i + 5), 2)];
  return prefix + out;
}

/** A time the Worker took to be now: UTC as the API writes it, within a minute of the test's clock. */
function expectNow(time: unknown, what: string): void {
  expect(time, what).toMatch(UTC);
  expect(Math.abs(Date.parse(time as string) - Date.now()), what).toBeLessThan(60_000);
}

const sorted = (list: string[]) => [...list].sort((a, b) => a.localeCompare(b));
const byId = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
/** A `failed` row's message: some reason, in words. */
const REASON = expect.stringMatching(/\S/);
/** The entries API's message for an entry with nothing in it, as the docs' example of `failed` has it. */
const EMPTY = '记录不能是空的：写点文字，或者加一张照片';

// ---- rows as living.json has them (docs/api/export.md#livingjson), pointing to ids here ------------------------------
// `over` replaces fields; a field set to `undefined` is left out of the JSON.

const CREATED = '2026-11-16T01:00:00Z';
const UPDATED = '2026-11-16T02:00:00Z';

const entryRow = (id: unknown, over: Json = {}): Json => ({
  id,
  type: 'note',
  title: '西湖边',
  body: '沿着湖走了一圈。',
  occurredAt: '2026-11-16T15:30:00',
  visibility: 'private',
  status: 'published',
  revision: 3,
  poiId: null,
  createdAt: CREATED,
  updatedAt: UPDATED,
  media: [],
  tagIds: [],
  projectIds: [],
  ...over
});
const milestoneRow = (over: Json = {}): Json => ({
  title: '第一首曲子',
  body: null,
  date: '2026-10-20',
  createdAt: CREATED,
  updatedAt: UPDATED,
  ...over
});
const projectRow = (id: unknown, over: Json = {}): Json => ({
  id,
  type: 'learning',
  title: '学吉他',
  description: null,
  startDate: '2026-10-01',
  endDate: null,
  status: 'active',
  visibility: 'private',
  createdAt: CREATED,
  updatedAt: UPDATED,
  milestones: [],
  ...over
});
const item = (kind: string, over: Json = {}): Json => ({ kind, photoId: null, entryId: null, text: null, day: null, ...over });
const collectionRow = (id: unknown, over: Json = {}): Json => ({
  id,
  kind: 'trip',
  title: '杭州',
  subtitle: null,
  intro: null,
  coverPhotoId: null,
  startDate: '2026-11-15',
  endDate: '2026-11-17',
  visibility: 'private',
  createdAt: CREATED,
  updatedAt: UPDATED,
  publishedAt: null,
  items: [],
  ...over
});
const tagRow = (id: string, parentId: string | null, name: unknown, over: Json = {}): Json => ({
  id,
  ownerId: 'u_exporter',
  parentId,
  name,
  color: null,
  sort: 10,
  createdAt: '2026-01-01T00:00:00Z',
  ...over
});
const placeRow = (id: string, over: Json = {}): Json => ({
  id,
  name: '断桥',
  aliases: [],
  category: '桥',
  city: '杭州市',
  district: '西湖区',
  lat: 30.2593,
  lng: 120.1517,
  radius: 60,
  source: 'custom',
  sourceId: null,
  own: true,
  createdAt: CREATED,
  ...over
});
const zone = (name: string, lat: number, lng: number, radius = 300): Json => ({ name, lat, lng, radius });

// ---- the three kinds of rows ----------------------------------------------------------------------------------------

const ROWS = { projects: projectRow, entries: entryRow, collections: collectionRow };
type RowsPart = keyof typeof ROWS;
/** In the order an import sends them. */
const PARTS: RowsPart[] = ['projects', 'entries', 'collections'];
const PREFIX: Record<RowsPart, string> = { projects: 'pj_', entries: 'en_', collections: 'th_' };
/** Where one of them is read and deleted; collections are themes in the API. */
const PATH: Record<RowsPart, string> = { projects: '/api/projects', entries: '/api/entries', collections: '/api/themes' };
const LIST: Record<RowsPart, string> = { projects: 'projects', entries: 'entries', collections: 'themes' };

const resolve = (client: Client, body: ImportResolveBody) => ok(client.post<ImportResolveResponse>('/api/import/resolve', body));
const importRows = (client: Client, part: RowsPart, rows: Json[]) =>
  ok(client.post<ImportRowsResponse>(`/api/import/${part}`, { [part]: rows }));
const importTags = (client: Client, tags: Json[]) => ok(client.post<ImportIdsResponse>('/api/import/tags', { tags }));
const importPlaces = (client: Client, places: Json[]) => ok(client.post<ImportIdsResponse>('/api/import/places', { places }));
const importZones = (client: Client, zones: Json[]) => ok(client.post<ImportZonesResponse>('/api/import/zones', { zones }));
/** A request whose answer may not be JSON (a body over the size limit). */
const postRaw = (client: Client, path: string, body: unknown) =>
  client.fetch(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

// ---- the archive as the rest of the API keeps it ----------------------------------------------------------------------

const AT = '2026-11-16T09:00:00';
const newEntry = async (client: Client, body: Json = {}): Promise<EntryDetail> =>
  (await ok(client.post<{ entry: EntryDetail }>('/api/entries', { occurredAt: AT, title: '原来的记录', ...body }), 201)).entry;
const newProject = async (client: Client, body: Json = {}): Promise<ProjectDetail> =>
  (await ok(client.post<{ project: ProjectDetail }>('/api/projects', { title: '原来的项目', startDate: '2026-10-01', ...body }), 201))
    .project;
const newCollection = async (client: Client, body: Json = {}): Promise<ThemeDetail> =>
  (await ok(client.post<{ theme: ThemeDetail }>('/api/themes', { kind: 'topic', title: '原来的合集', ...body }), 201)).theme;
const CREATE: Record<RowsPart, (client: Client, body?: Json) => Promise<{ id: string }>> = {
  projects: newProject,
  entries: newEntry,
  collections: newCollection
};
const newTag = async (client: Client, name: string, parentId?: string): Promise<Tag> =>
  (await ok(client.post<{ tag: Tag }>('/api/tags', parentId ? { name, parentId } : { name }), 201)).tag;
const newPlace = async (client: Client, body: Json = {}): Promise<PoiDetail> =>
  (await ok(client.post<{ poi: PoiDetail }>('/api/pois', { name: '西湖', category: '湖', lat: 30.24, lng: 120.14, ...body }), 201)).poi;

const entryOf = (client: Client, id: string) => ok(client.get<EntryDetail>(`/api/entries/${id}`));
const projectOf = (client: Client, id: string) => ok(client.get<ProjectDetail>(`/api/projects/${id}`));
const collectionOf = (client: Client, id: string) => ok(client.get<ThemeDetail>(`/api/themes/${id}`));
const read = (client: Client, part: RowsPart, id: string) => ok(client.get(`${PATH[part]}/${id}`));
/** All of the client's own projects, entries or collections. */
const mine = async (client: Client, part: RowsPart): Promise<Json[]> =>
  (await ok(client.get(`${PATH[part]}?mine=1`)))[LIST[part]] as Json[];
const tagsOf = async (client: Client): Promise<Map<string, Tag>> =>
  new Map((await ok(client.get<{ tags: Tag[] }>('/api/tags'))).tags.map((t) => [t.id, t]));
const placeOf = async (client: Client, id: string): Promise<PoiDetail> => (await ok(client.get<{ poi: PoiDetail }>(`/api/pois/${id}`))).poi;
const zonesOf = async (client: Client): Promise<PrivacyZone[]> =>
  (await ok(client.get<{ zones: PrivacyZone[] }>('/api/privacy-zones'))).zones;
/** The first page of a part of the client's export: the rows as stored, whoever may see what they point to. */
const exported = async (client: Client, part: string): Promise<Json[]> =>
  (await ok(client.get<{ rows: Json[] }>(`/api/export/${part}`))).rows;
/** A collection's items as [kind, what it shows, its text]. */
const itemsOf = (t: ThemeDetail): unknown[][] =>
  t.items.map((i) => {
    if (i.kind === 'photo') return ['photo', i.photoId, i.text];
    if (i.kind === 'entry') return ['entry', i.entryId, i.text];
    if (i.kind === 'day') return ['day', i.day, i.text];
    return ['text', i.text];
  });

describe('a round trip', () => {
  it('brings an entry, a project and a collection over, and a second import makes nothing again', async () => {
    const sha = newSha();
    const photo = await upload(alice, { sha256: sha, title: '断桥', takenAt: '2026-11-16T08:30:00', visibility: 'public' });
    const project = (
      await ok(
        alice.post<{ project: ProjectDetail }>('/api/projects', { title: '学吉他', startDate: '2026-10-01', visibility: 'public' }),
        201
      )
    ).project;
    const entry = (
      await ok(
        alice.post<{ entry: EntryDetail }>('/api/entries', {
          title: '西湖边',
          body: `见 /p/${photo.id}`,
          occurredAt: '2026-11-16T09:00:00',
          visibility: 'public',
          media: [{ photoId: photo.id, caption: '桥' }],
          projectIds: [project.id]
        }),
        201
      )
    ).entry;

    // bob's import: the photo first, as an upload, then the rows pointing to it by its id here
    const bobPhoto = await upload(bob, { sha256: sha, title: '断桥', takenAt: '2026-11-16T08:30:00', visibility: 'public' });
    const where = await ok(
      bob.post<ImportResolveResponse>('/api/import/resolve', { photos: [sha], entries: [entry.id], projects: [project.id] })
    );
    expect(where.photos).toEqual({ [sha]: bobPhoto.id });
    expect(where.entries[entry.id].exists).toBe(false);

    const projects = await ok(
      bob.post<ImportRowsResponse>('/api/import/projects', {
        projects: [
          {
            id: project.id,
            type: 'learning',
            title: '学吉他',
            description: null,
            startDate: '2026-10-01',
            endDate: null,
            status: 'active',
            visibility: 'public',
            createdAt: '2026-10-01T00:00:00Z',
            updatedAt: '2026-10-02T00:00:00Z',
            milestones: [
              { title: '第一首', body: null, date: '2026-10-20', createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z' }
            ]
          }
        ]
      })
    );
    expect(projects.created).toBe(1);
    const projectHere = projects.ids[project.id];
    expect(projectHere).toBe(where.projects[project.id].id);

    const entries = await ok(
      bob.post<ImportRowsResponse>('/api/import/entries', {
        entries: [
          {
            id: entry.id,
            type: 'note',
            title: '西湖边',
            body: `见 /p/${bobPhoto.id}`,
            occurredAt: '2026-11-16T09:00:00',
            visibility: 'public',
            status: 'published',
            poiId: null,
            createdAt: '2026-11-16T01:00:00Z',
            updatedAt: '2026-11-16T02:00:00Z',
            media: [{ photoId: bobPhoto.id, caption: '桥' }],
            tagIds: [],
            projectIds: [projectHere]
          }
        ]
      })
    );
    expect(entries).toMatchObject({ created: 1, existing: 0, failed: [] });
    const entryHere = entries.ids[entry.id];
    const detail = await ok(bob.get<EntryDetail>(`/api/entries/${entryHere}`));
    expect(detail).toMatchObject({ title: '西湖边', createdAt: '2026-11-16T01:00:00Z', updatedAt: '2026-11-16T02:00:00Z' });
    expect(detail.media.map((m) => m.photo.id)).toEqual([bobPhoto.id]);
    expect(detail.projectIds).toEqual([projectHere]);

    const collections = await ok(
      bob.post<ImportRowsResponse>('/api/import/collections', {
        collections: [
          {
            id: 'th_X',
            kind: 'trip',
            title: '杭州',
            subtitle: null,
            intro: null,
            coverPhotoId: bobPhoto.id,
            startDate: '2026-11-15',
            endDate: '2026-11-17',
            visibility: 'public',
            createdAt: '2026-11-17T00:00:00Z',
            updatedAt: '2026-11-17T00:00:00Z',
            publishedAt: '2026-11-17T00:00:00Z',
            items: [
              { kind: 'day', day: '2026-11-16', photoId: null, entryId: null, text: '到杭州' },
              { kind: 'photo', photoId: bobPhoto.id, entryId: null, text: null, day: null },
              { kind: 'entry', entryId: entryHere, photoId: null, text: null, day: null }
            ]
          }
        ]
      })
    );
    expect(collections.created).toBe(1);
    const theme = await ok(bob.get<ThemeDetail>(`/api/themes/${collections.ids.th_X}`));
    expect(theme.items.map((i) => i.kind)).toEqual(['day', 'photo', 'entry']);

    // again: everything is here
    const again = await ok(
      bob.post<ImportRowsResponse>('/api/import/entries', {
        entries: [{ id: entry.id, type: 'note', title: '西湖边', occurredAt: '2026-11-16T09:00:00', media: [], tagIds: [], projectIds: [] }]
      })
    );
    expect(again).toMatchObject({ created: 0, existing: 1, ids: { [entry.id]: entryHere } });
    const tags = await ok(
      bob.post<ImportIdsResponse>('/api/import/tags', {
        tags: [
          { id: 't_A', ownerId: 'u_alice', parentId: 'lake', name: '断桥', color: null, sort: 10, createdAt: '2026-01-01T00:00:00Z' },
          { id: 't_B', ownerId: 'u_alice', parentId: 't_A', name: '残雪', color: null, sort: 10, createdAt: '2026-01-01T00:00:00Z' }
        ]
      })
    );
    expect(tags.created).toBe(2);
    const tagsAgain = await ok(
      bob.post<ImportIdsResponse>('/api/import/tags', {
        tags: [
          { id: 't_A', ownerId: 'u_alice', parentId: 'lake', name: '断桥', color: null, sort: 10 },
          { id: 't_B', ownerId: 'u_alice', parentId: 't_A', name: '残雪', color: null, sort: 10 }
        ]
      })
    );
    expect(tagsAgain).toEqual({ ids: tags.ids, created: 0 });
    const json: Json = await ok(bob.get('/api/tags'));
    expect((json.tags as Json[]).find((t) => t.id === tags.ids.t_B)?.parentId).toBe(tags.ids.t_A);
  });
});

describe('every endpoint', () => {
  /** One small request to each endpoint that a signed-in importer may make. */
  const requests = (): [string, Json][] => [
    ['/api/import/resolve', { photos: [newSha()], entries: ['en_A'], projects: ['pj_A'], collections: ['th_A'] }],
    ['/api/import/tags', { tags: [tagRow('t_A', 'lake', '断桥')] }],
    ['/api/import/places', { places: [placeRow('poi_A')] }],
    ['/api/import/zones', { zones: [zone('家', 30.27, 120.16)] }],
    ['/api/import/projects', { projects: [projectRow('pj_A')] }],
    ['/api/import/entries', { entries: [entryRow('en_A')] }],
    ['/api/import/collections', { collections: [collectionRow('th_A')] }]
  ];

  it('needs a session, and writes nothing without one', async () => {
    const anon = new Client(platform);
    for (const [path, body] of requests()) {
      const res = await anon.post(path, body);
      expect(res.status, path).toBe(401);
      expect(res.body.error, path).toBe('unauthenticated');
    }
    const counts = await platform.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM entries) AS entries, (SELECT COUNT(*) FROM projects) AS projects,
        (SELECT COUNT(*) FROM themes) AS themes, (SELECT COUNT(*) FROM pois) AS places,
        (SELECT COUNT(*) FROM privacy_zones) AS zones, (SELECT COUNT(*) FROM tags WHERE owner_id IS NOT NULL) AS tags`
    ).first();
    expect(counts).toEqual({ entries: 0, projects: 0, themes: 0, places: 0, zones: 0, tags: 0 });
  });

  it('answers with Cache-Control: no-store', async () => {
    for (const [path, body] of requests()) {
      const res = await bob.post(path, body);
      expect(res.status, `${path} ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.headers.get('cache-control'), path).toMatch(/\bno-store\b/);
    }
  });

  it('takes a body of up to 2 MB, and of up to 256 KB at /zones; past that 413', async () => {
    /** An empty batch (for resolve, no list at all), padded with JSON whitespace to `bytes`. */
    const padded = (list: string | null, bytes: number) => `{${list ? `"${list}": []` : ''}${' '.repeat(bytes)}}`;
    const send = async (path: string, text: string) =>
      (await bob.fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text })).status;
    const statuses: Record<string, number> = {};
    const expected: Record<string, number> = {};
    for (const [path, list] of [
      ['/api/import/resolve', null],
      ['/api/import/tags', 'tags'],
      ['/api/import/places', 'places'],
      ['/api/import/projects', 'projects'],
      ['/api/import/entries', 'entries'],
      ['/api/import/collections', 'collections']
    ] as const) {
      statuses[`${path} 1.5 MB`] = await send(path, padded(list, 1_500_000));
      statuses[`${path} 2.5 MB`] = await send(path, padded(list, 2_500_000));
      Object.assign(expected, { [`${path} 1.5 MB`]: 200, [`${path} 2.5 MB`]: 413 });
    }
    statuses['/api/import/zones 200 KB'] = await send('/api/import/zones', padded('zones', 200_000));
    statuses['/api/import/zones 300 KB'] = await send('/api/import/zones', padded('zones', 300_000));
    Object.assign(expected, { '/api/import/zones 200 KB': 200, '/api/import/zones 300 KB': 413 });
    expect(statuses).toEqual(expected);
  });

  it('brings a batch of more than the 1 MB a new entry may come in, and nothing of a batch past 2 MB', async () => {
    // bodies of 45 000 characters, within the 50 000 an entry may have
    const rows = (n: number) => Array.from({ length: n }, (_, i) => entryRow(`en_big${i}`, { body: 'x'.repeat(45_000) }));
    // about 1.4 MB
    expect(await importRows(bob, 'entries', rows(30))).toMatchObject({ created: 30, existing: 0, failed: [] });
    // about 2.5 MB
    expect((await postRaw(bob, '/api/import/entries', { entries: rows(56) })).status).toBe(413);
    expect(await mine(bob, 'entries')).toHaveLength(30);
  });

  it('counts the body in bytes, whether or not the request says its length', async () => {
    // 100 000 Chinese characters are 300 KB of UTF-8: past the 256 KB of /zones
    const text = JSON.stringify({ zones: [zone('字'.repeat(100_000), 30.27, 120.16)] });
    const bytes = new TextEncoder().encode(text).length;
    expect(bytes).toBeGreaterThan(300_000);
    const send = async (headers: Record<string, string>) =>
      (await bob.fetch('/api/import/zones', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: text }))
        .status;
    // as a browser sends it, and as a streamed (chunked) upload does, without Content-Length
    expect({ declared: await send({ 'content-length': String(bytes) }), undeclared: await send({}) }).toEqual({
      declared: 413,
      undeclared: 413
    });
    expect(await zonesOf(bob)).toEqual([]);
  });
  it('answers 503 quota_exceeded, saying when to go on, once the database has had its rows for the day', async () => {
    // D1 on the Workers Free plan, past the day's rows read or written: every query fails with this message
    // (developers.cloudflare.com/d1/observability/debug-d1/#list-of-d1_errors)
    const real = platform.env;
    for (const kind of ['read', 'write']) {
      const message = `D1_ERROR: Your account has exceeded D1's free tier daily row ${kind} limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.`;
      const fail = () => Promise.reject(new Error(message));
      const statement = { bind: () => statement, first: fail, all: fail, run: fail, raw: fail };
      platform.env = { ...real, DB: { prepare: () => statement, batch: fail, exec: fail } as unknown as D1Database };
      try {
        for (const [path, body] of requests()) {
          const res = await bob.post(path, body);
          expect(res.status, `${kind}: ${path}`).toBe(503);
          expect(res.body, `${kind}: ${path}`).toMatchObject({
            error: 'quota_exceeded',
            message: expect.stringContaining('北京时间 8 点')
          });
          expect(res.headers.get('cache-control'), `${kind}: ${path}`).toMatch(/\bno-store\b/);
        }
      } finally {
        platform.env = real;
      }
    }
    // any other failure of the database is still a server error
    const statement = { bind: () => statement, first: () => Promise.reject(new Error('D1_ERROR: no such table: users')) };
    platform.env = { ...real, DB: { prepare: () => statement } as unknown as D1Database };
    try {
      expect((await bob.post('/api/import/zones', { zones: [] })).status).toBe(500);
    } finally {
      platform.env = real;
    }
  });
});

describe('POST /api/import/resolve', () => {
  it('finds photos by the SHA-256 of the importer’s own files only, in either case, keyed in lower case', async () => {
    const [mineOnly, both, hersOnly, nobodys, shouted] = [newSha(), newSha(), newSha(), newSha(), newSha()];
    const myPhoto = await upload(bob, { sha256: mineOnly });
    const myCopy = await upload(bob, { sha256: both });
    // uploaded with its hash in capitals
    const myShouted = await upload(bob, { sha256: shouted.toUpperCase() });
    const herCopy = await upload(alice, { sha256: both });
    await upload(alice, { sha256: hersOnly });

    expect(await resolve(bob, { photos: [mineOnly.toUpperCase(), both, hersOnly, nobodys, shouted] })).toEqual({
      photos: { [mineOnly]: myPhoto.id, [both]: myCopy.id, [shouted]: myShouted.id },
      entries: {},
      projects: {},
      collections: {}
    });
    expect((await resolve(alice, { photos: [both.toUpperCase(), mineOnly] })).photos).toEqual({ [both]: herCopy.id });
  });

  it('lists the importer’s own entries, projects and collections as here, and anyone else’s as not, at an id of the import’s', async () => {
    const [e, p, c] = [await newEntry(alice), await newProject(alice), await newCollection(alice)];
    expect(await resolve(alice, { entries: [e.id], projects: [p.id], collections: [c.id] })).toEqual({
      photos: {},
      entries: { [e.id]: { id: e.id, exists: true } },
      projects: { [p.id]: { id: p.id, exists: true } },
      collections: { [c.id]: { id: c.id, exists: true } }
    });

    const where = await resolve(bob, { entries: [e.id, 'en_unknown'], projects: [p.id], collections: [c.id] });
    expect(sorted(Object.keys(where.entries))).toEqual(sorted([e.id, 'en_unknown']));
    for (const [part, id] of [
      ['entries', e.id],
      ['entries', 'en_unknown'],
      ['projects', p.id],
      ['collections', c.id]
    ] as const) {
      const target = where[part][id];
      expect(target.exists, `${part} ${id}`).toBe(false);
      expect(target.id, `${part} ${id}`).toMatch(importId(PREFIX[part]));
      expect(target.id, `${part} ${id}`).not.toBe(id);
    }
    expect(await resolve(bob, {})).toEqual({ photos: {}, entries: {}, projects: {}, collections: {} });
  });

  it('gives an item the same id each time and a different one in each account: the one the docs derive', async () => {
    const carol = await newUser(platform, 'carol');
    const body = { entries: ['en_X'], projects: ['pj_X'], collections: ['th_X'] };
    const his = await resolve(bob, body);
    expect(await resolve(bob, body)).toEqual(his);
    const hers = await resolve(carol, body);
    for (const [part, id] of [
      ['entries', 'en_X'],
      ['projects', 'pj_X'],
      ['collections', 'th_X']
    ] as const) {
      expect(his[part][id].exists, part).toBe(false);
      expect(hers[part][id].exists, part).toBe(false);
      expect(hers[part][id].id, part).toMatch(importId(PREFIX[part]));
      expect(hers[part][id].id, part).not.toBe(his[part][id].id);
      expect(his[part][id].id, part).toBe(await importedId(PREFIX[part], bob, id));
      expect(hers[part][id].id, part).toBe(await importedId(PREFIX[part], carol, id));
    }
  });

  it('lists an imported item as here, at the id the import gave it', async () => {
    const [e, p, c] = [await newEntry(alice), await newProject(alice), await newCollection(alice)];
    const body = { entries: [e.id], projects: [p.id], collections: [c.id] };
    const before = await resolve(bob, body);
    const made = {
      projects: await importRows(bob, 'projects', [projectRow(p.id)]),
      entries: await importRows(bob, 'entries', [entryRow(e.id)]),
      collections: await importRows(bob, 'collections', [collectionRow(c.id)])
    };
    const after = await resolve(bob, body);
    for (const [part, id] of [
      ['entries', e.id],
      ['projects', p.id],
      ['collections', c.id]
    ] as const) {
      expect(made[part].ids[id], part).toBe(before[part][id].id);
      expect(after[part][id], part).toEqual({ id: before[part][id].id, exists: true });
    }
    // an export bob makes later holds the item at its id here, which is his own
    const here = made.entries.ids[e.id];
    expect((await resolve(bob, { entries: [here] })).entries).toEqual({ [here]: { id: here, exists: true } });
  });

  it('does not list an item its owner deleted as here', async () => {
    const e = await newEntry(alice);
    expectStatus(await alice.del(`/api/entries/${e.id}`), 200);
    const target = (await resolve(alice, { entries: [e.id] })).entries[e.id];
    expect(target.exists).toBe(false);
    expect(target.id).toMatch(importId('en_'));
    expect(target.id).not.toBe(e.id);
  });

  it('refuses a list that is no list, holds what is no SHA-256 or id, or is longer than 1000', async () => {
    const sha = newSha();
    const shas = (n: number) => Array.from({ length: n }, (_, i) => i.toString(16).padStart(64, '0'));
    const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
    const bad: Json[] = [
      { photos: sha },
      { photos: [sha.slice(1)] },
      { photos: [`${sha}0`] },
      { photos: [`${sha.slice(1)}g`] },
      { photos: [42] },
      { photos: shas(IMPORT_LIMITS.resolve + 1) },
      { entries: 'en_A' },
      { entries: ['en A'] },
      { entries: ['en.A'] },
      { entries: ['en/A'] },
      { entries: ['x'.repeat(65)] },
      { entries: [null] },
      { entries: ids('en_', IMPORT_LIMITS.resolve + 1) },
      { projects: { pj_A: true } },
      { projects: ['pj_ä'] },
      { projects: ids('pj_', IMPORT_LIMITS.resolve + 1) },
      { collections: [7] },
      { collections: ids('th_', IMPORT_LIMITS.resolve + 1) }
    ];
    for (const body of bad) {
      const what = JSON.stringify(body).slice(0, 90);
      const res = await bob.post('/api/import/resolve', body);
      expect(res.status, what).toBe(400);
      expect(res.body.error, what).toBe('invalid_input');
    }
    // as many as that is fine, and an id may have 64 characters of [A-Za-z0-9_-]
    const longest = `A-b_${'9'.repeat(60)}`;
    const most = await resolve(bob, {
      photos: shas(IMPORT_LIMITS.resolve),
      entries: [...ids('en_', IMPORT_LIMITS.resolve - 1), longest],
      projects: ids('pj_', IMPORT_LIMITS.resolve),
      collections: ids('th_', IMPORT_LIMITS.resolve)
    });
    expect(most.photos).toEqual({});
    expect(Object.keys(most.entries)).toHaveLength(IMPORT_LIMITS.resolve);
    expect(most.entries[longest].exists).toBe(false);
    expect(Object.keys(most.projects)).toHaveLength(IMPORT_LIMITS.resolve);
    expect(Object.keys(most.collections)).toHaveLength(IMPORT_LIMITS.resolve);
  });
});

describe('nothing that is here is overwritten', () => {
  it('leaves the importer’s own entry, project and collection as they are, and counts them as existing', async () => {
    const photo = await upload(alice);
    const own = {
      projects: await newProject(alice, { title: '原来的项目', visibility: 'unlisted' }),
      entries: await newEntry(alice, { title: '原来的记录', body: '原来的正文', visibility: 'public', media: [{ photoId: photo.id }] }),
      collections: await newCollection(alice, { title: '原来的合集', coverPhotoId: photo.id })
    };
    const before = {
      projects: await projectOf(alice, own.projects.id),
      entries: await entryOf(alice, own.entries.id),
      collections: await collectionOf(alice, own.collections.id)
    };
    const rows = {
      projects: projectRow(own.projects.id, { title: '导出里的项目', visibility: 'public', milestones: [milestoneRow()] }),
      entries: entryRow(own.entries.id, { title: '导出里的记录', body: null, visibility: 'private', media: [] }),
      collections: collectionRow(own.collections.id, { title: '导出里的合集', items: [item('text', { text: '一段' })] })
    };
    for (const part of PARTS) {
      const id = own[part].id;
      expect(await importRows(alice, part, [rows[part]]), part).toEqual({ ids: { [id]: id }, created: 0, existing: 1, failed: [] });
      expect(await read(alice, part, id), part).toEqual(before[part]);
    }
  });

  it('makes nothing the second time the same batches come', async () => {
    const photo = await upload(bob);
    const batches: Record<RowsPart, Json[]> = {
      projects: [projectRow('pj_1', { milestones: [milestoneRow()] })],
      entries: [entryRow('en_1', { media: [{ photoId: photo.id, caption: '桥' }] }), entryRow('en_2', { title: '第二条' })],
      collections: [collectionRow('th_1', { items: [item('photo', { photoId: photo.id }), item('text', { text: '一段' })] })]
    };
    const first: Partial<Record<RowsPart, ImportRowsResponse>> = {};
    for (const part of PARTS) {
      first[part] = await importRows(bob, part, batches[part]);
      expect(first[part], part).toMatchObject({ created: batches[part].length, existing: 0, failed: [] });
    }
    for (const part of PARTS) {
      expect(await importRows(bob, part, batches[part]), part).toEqual({
        ids: first[part]?.ids,
        created: 0,
        existing: batches[part].length,
        failed: []
      });
      expect(await mine(bob, part), part).toHaveLength(batches[part].length);
    }
    expect((await projectOf(bob, first.projects?.ids.pj_1 ?? '')).milestones).toHaveLength(1);
    expect((await entryOf(bob, first.entries?.ids.en_1 ?? '')).media).toHaveLength(1);
    expect((await collectionOf(bob, first.collections?.ids.th_1 ?? '')).items).toHaveLength(2);
  });

  it('answers for every row of a batch: made, here already, or left out with why', async () => {
    const own = await newEntry(bob, { title: '原来的记录' });
    const res = await importRows(bob, 'entries', [
      entryRow('en_new', { title: '新的' }),
      entryRow(own.id, { title: '导出里的' }),
      entryRow('en_empty', { title: null, body: null, media: [] }),
      entryRow('en_new', { title: '又一次' })
    ]);
    expect(res).toEqual({
      ids: { en_new: await importedId('en_', bob, 'en_new'), [own.id]: own.id },
      created: 1,
      existing: 1,
      failed: [{ id: 'en_empty', message: EMPTY }]
    });
    expect((await entryOf(bob, res.ids.en_new)).title).toBe('新的');
    expect((await entryOf(bob, own.id)).title).toBe('原来的记录');
    expect(await mine(bob, 'entries')).toHaveLength(2);
  });

  it('counts a row given twice in one batch once, as it came first', async () => {
    for (const part of PARTS) {
      const id = `${PREFIX[part]}twice`;
      const res = await importRows(bob, part, [ROWS[part](id, { title: '第一次' }), ROWS[part](id, { title: '第二次' })]);
      expect(res, part).toEqual({ ids: { [id]: expect.stringMatching(importId(PREFIX[part])) }, created: 1, existing: 0, failed: [] });
      expect((await read(bob, part, res.ids[id])).title, part).toBe('第一次');
      expect(await mine(bob, part), part).toHaveLength(1);
    }
  });
});

describe('nobody arrives at an id that is someone else’s', () => {
  it('gives the importer’s items other ids than another account’s, and leaves that account’s as they are', async () => {
    const carol = await newUser(platform, 'carol');
    for (const part of PARTS) {
      const theirs = await CREATE[part](alice, { title: 'alice 的', visibility: 'public' });
      const before = await read(alice, part, theirs.id);
      // alice's row as her export has it, owner and all
      const res = await importRows(bob, part, [ROWS[part](theirs.id, { ownerId: alice.me.id, title: 'bob 的', visibility: 'public' })]);
      expect(res, part).toMatchObject({ created: 1, existing: 0, failed: [] });
      const here = res.ids[theirs.id];
      expect(here, part).not.toBe(theirs.id);
      expect(here, part).toMatch(importId(PREFIX[part]));
      expect(await read(bob, part, here), part).toMatchObject({ id: here, ownerId: bob.me.id, title: 'bob 的' });
      expect(await read(alice, part, theirs.id), part).toEqual(before);
      // and carol's import of the same row arrives at an id of hers
      const hers = await importRows(carol, part, [ROWS[part](theirs.id, { title: 'carol 的' })]);
      expect(hers, part).toMatchObject({ created: 1, existing: 0, failed: [] });
      expect(new Set([hers.ids[theirs.id], here, theirs.id]).size, part).toBe(3);
    }
  });

  it('cannot bring an item back at the id of one that was deleted, not even for its owner', async () => {
    const anon = new Client(platform);
    for (const part of PARTS) {
      const gone = await CREATE[part](alice, { visibility: 'public' });
      expectStatus(await alice.del(`${PATH[part]}/${gone.id}`), 200);

      const bobs = await importRows(bob, part, [ROWS[part](gone.id, { visibility: 'public' })]);
      expect(bobs, part).toMatchObject({ created: 1, existing: 0, failed: [] });
      expect(bobs.ids[gone.id], part).not.toBe(gone.id);
      // what was deleted is not here any more, so alice's own import makes it anew at an id of the import's
      const hers = await importRows(alice, part, [ROWS[part](gone.id, { visibility: 'public' })]);
      expect(hers, part).toMatchObject({ created: 1, existing: 0, failed: [] });
      expect(hers.ids[gone.id], part).not.toBe(gone.id);
      expect(hers.ids[gone.id], part).toMatch(importId(PREFIX[part]));

      for (const client of [alice, bob, anon]) expect((await client.get(`${PATH[part]}/${gone.id}`)).status, part).toBe(404);
    }
  });

  it('cannot take the id another account’s import is to give', async () => {
    const target = (await resolve(alice, { entries: ['en_hers'] })).entries.en_hers;
    expect(target.exists).toBe(false);
    // bob knows the id (alice's user id is public), and imports a row with it before she does
    const bobs = await importRows(bob, 'entries', [entryRow(target.id, { title: 'bob 抢先' })]);
    expect(bobs).toMatchObject({ created: 1, existing: 0, failed: [] });
    expect(bobs.ids[target.id]).not.toBe(target.id);

    const hers = await importRows(alice, 'entries', [entryRow('en_hers', { title: 'alice 的' })]);
    expect(hers).toEqual({ ids: { en_hers: target.id }, created: 1, existing: 0, failed: [] });
    expect(await entryOf(alice, target.id)).toMatchObject({ ownerId: alice.me.id, title: 'alice 的' });
    expect(await entryOf(bob, bobs.ids[target.id])).toMatchObject({ ownerId: bob.me.id, title: 'bob 抢先' });
  });
});

describe('what a row points to', () => {
  it('keeps in an entry only the importer’s own photos and projects, presets and own tags, and a place that exists', async () => {
    const [myPhoto, herPhoto] = [await upload(bob), await upload(alice, { visibility: 'public' })];
    const [myTag, herTag] = [await newTag(bob, '我的'), await newTag(alice, '她的')];
    const [myProject, herProject] = [await newProject(bob), await newProject(alice, { visibility: 'public' })];
    const place = await newPlace(alice);
    const res = await importRows(bob, 'entries', [
      entryRow('en_refs', {
        media: [
          { photoId: herPhoto.id, caption: '她的' },
          { photoId: myPhoto.id, caption: '我的' },
          { photoId: 'ph_missing', caption: null }
        ],
        tagIds: [herTag.id, 'lake', myTag.id, 't_missing'],
        projectIds: [herProject.id, myProject.id, 'pj_missing'],
        poiId: place.id
      }),
      entryRow('en_nowhere', { poiId: 'poi_missing' })
    ]);
    expect(res).toMatchObject({ created: 2, existing: 0, failed: [] });

    const e = await entryOf(bob, res.ids.en_refs);
    expect(e.media.map((m) => [m.photoId, m.caption])).toEqual([[myPhoto.id, '我的']]);
    expect(e.photoIds).toEqual([myPhoto.id]);
    expect(sorted(e.tagIds)).toEqual(sorted(['lake', myTag.id]));
    expect(e.projectIds).toEqual([myProject.id]);
    expect(e.poi?.id).toBe(place.id);
    expect((await entryOf(bob, res.ids.en_nowhere)).poi).toBeNull();
    // as stored, whoever may see what: nothing of alice's
    expect((await exported(bob, 'entryMedia')).map((r) => r.photoId)).toEqual([myPhoto.id]);
    expect(sorted((await exported(bob, 'entryTags')).map((r) => r.tagId as string))).toEqual(sorted(['lake', myTag.id]));
    expect((await exported(bob, 'entryProjects')).map((r) => r.projectId)).toEqual([myProject.id]);
  });

  it('keeps in a collection only the importer’s own photos and entries, and only an own photo as its cover', async () => {
    const [myPhoto, herPhoto] = [await upload(bob), await upload(alice, { visibility: 'public' })];
    const [myEntry, herEntry] = [await newEntry(bob, { visibility: 'public' }), await newEntry(alice, { visibility: 'public' })];
    const res = await importRows(bob, 'collections', [
      collectionRow('th_mixed', {
        visibility: 'public',
        coverPhotoId: herPhoto.id,
        items: [
          item('photo', { photoId: herPhoto.id, text: '她的' }),
          item('day', { day: '2026-11-15', text: '第一天' }),
          item('photo', { photoId: myPhoto.id, text: '我的' }),
          item('entry', { entryId: herEntry.id }),
          item('photo', { photoId: 'ph_missing' }),
          item('entry', { entryId: myEntry.id, text: '我的记录' }),
          item('entry', { entryId: 'en_missing' }),
          item('text', { text: '一段' })
        ]
      }),
      collectionRow('th_mine', { coverPhotoId: myPhoto.id }),
      collectionRow('th_nothing', { coverPhotoId: 'ph_missing' })
    ]);
    expect(res).toMatchObject({ created: 3, existing: 0, failed: [] });

    const mixed = await collectionOf(bob, res.ids.th_mixed);
    expect(mixed.coverPhotoId).toBeNull();
    expect(itemsOf(mixed)).toEqual([
      ['day', '2026-11-15', '第一天'],
      ['photo', myPhoto.id, '我的'],
      ['entry', myEntry.id, '我的记录'],
      ['text', '一段']
    ]);
    expect((await collectionOf(bob, res.ids.th_mine)).coverPhotoId).toBe(myPhoto.id);
    expect((await collectionOf(bob, res.ids.th_nothing)).coverPhotoId).toBeNull();
    // as stored
    const stored = (await exported(bob, 'themeItems')).filter((r) => r.themeId === res.ids.th_mixed);
    expect(sorted(stored.map((r) => (r.photoId ?? r.entryId ?? r.kind) as string))).toEqual(
      sorted([myPhoto.id, myEntry.id, 'day', 'text'])
    );
  });

  it('leaves out an entry with nothing left in it, and brings the rest of the batch', async () => {
    const herPhoto = await upload(alice);
    const res = await importRows(bob, 'entries', [
      entryRow('en_her_photo', { title: null, body: null, media: [{ photoId: herPhoto.id, caption: '只有她的照片' }] }),
      entryRow('en_blank', { title: '  ', body: '\n\n', media: [] }),
      entryRow('en_titled', { title: '有标题', body: null, media: [{ photoId: herPhoto.id, caption: null }] })
    ]);
    expect(res).toMatchObject({ created: 1, existing: 0 });
    expect(Object.keys(res.ids)).toEqual(['en_titled']);
    expect(byId(res.failed)).toEqual([
      { id: 'en_blank', message: EMPTY },
      { id: 'en_her_photo', message: EMPTY }
    ]);
    expect((await mine(bob, 'entries')).map((e) => e.id)).toEqual([res.ids.en_titled]);
    expect((await entryOf(bob, res.ids.en_titled)).media).toEqual([]);
  });
});

describe('a row is checked as a new one is', () => {
  it('leaves out a row that could not be made new, says why, and brings the others of its batch', async () => {
    const batches: Record<RowsPart, Json[]> = {
      projects: [
        projectRow('pj_backwards', { startDate: '2026-10-01', endDate: '2026-09-30' }),
        projectRow('pj_untitled', { title: '   ' }),
        projectRow('pj_long', { title: 'x'.repeat(101) }),
        projectRow('pj_type', { type: 'hobby' }),
        projectRow('pj_start', { startDate: 'soon' }),
        projectRow('pj_milestone', { milestones: [milestoneRow({ date: 'soon' })] }),
        projectRow('pj_ok')
      ],
      entries: [
        entryRow('en_when', { occurredAt: 'yesterday' }),
        entryRow('en_no_when', { occurredAt: undefined }),
        entryRow('en_long', { title: 'x'.repeat(201) }),
        entryRow('en_type', { type: 'diary' }),
        entryRow('en_status', { status: 'deleted' }),
        entryRow('en_visibility', { visibility: 'friends' }),
        entryRow('en_ok')
      ],
      collections: [
        collectionRow('th_kind', { kind: 'album' }),
        collectionRow('th_item', { items: [item('video', { text: '一段视频' })] }),
        collectionRow('th_text', { items: [item('text', { text: '' })] }),
        collectionRow('th_day', { items: [item('day', { day: 'Monday' })] }),
        collectionRow('th_dates', { startDate: '2026-11-17', endDate: '2026-11-15' }),
        collectionRow('th_untitled', { title: '' }),
        collectionRow('th_ok')
      ]
    };
    for (const part of PARTS) {
      const res = await importRows(bob, part, batches[part]);
      const good = `${PREFIX[part]}ok`;
      const bad = batches[part].map((r) => r.id as string).filter((id) => id !== good);
      expect(res, part).toMatchObject({ created: 1, existing: 0 });
      expect(Object.keys(res.ids), part).toEqual([good]);
      expect(byId(res.failed), part).toEqual(sorted(bad).map((id) => ({ id, message: REASON })));
      expect(await mine(bob, part), part).toHaveLength(1);
    }
  });

  it('leaves out a collection with more items than a new one may have', async () => {
    const texts = (n: number) => Array.from({ length: n }, (_, i) => item('text', { text: `第 ${i + 1} 段` }));
    const res = await importRows(bob, 'collections', [
      collectionRow('th_too_many', { items: texts(THEME_LIMITS.itemCount + 1) }),
      collectionRow('th_most', { items: texts(THEME_LIMITS.itemCount) })
    ]);
    expect(res).toMatchObject({ created: 1, existing: 0, failed: [{ id: 'th_too_many', message: REASON }] });
    expect(Object.keys(res.ids)).toEqual(['th_most']);
    const most = itemsOf(await collectionOf(bob, res.ids.th_most));
    expect(most).toHaveLength(THEME_LIMITS.itemCount);
    // in the order of the array
    expect(most.map((i) => i[1])).toEqual(texts(THEME_LIMITS.itemCount).map((i) => i.text));
  });

  it('refuses a whole batch with an id that is no id, with more rows than a batch takes, or rows that are no list', async () => {
    for (const part of PARTS) {
      const row = ROWS[part];
      for (const id of [`${PREFIX[part]}a b`, `${PREFIX[part]}a.b`, 'x'.repeat(65), 42, null, undefined]) {
        const res = await bob.post(`/api/import/${part}`, { [part]: [row(`${PREFIX[part]}fine`), row(id)] });
        expect(res.status, `${part} ${String(id)}`).toBe(400);
        expect(res.body.error, `${part} ${String(id)}`).toBe('invalid_input');
      }
      const tooMany = Array.from({ length: IMPORT_LIMITS[part] + 1 }, (_, i) => row(`${PREFIX[part]}${i}`));
      expect((await bob.post(`/api/import/${part}`, { [part]: tooMany })).status, part).toBe(400);
      expect((await bob.post(`/api/import/${part}`, { [part]: row(`${PREFIX[part]}fine`) })).status, part).toBe(400);
      expect(await mine(bob, part), part).toEqual([]);
    }
  });

  it('takes as many rows as a batch may hold', async () => {
    for (const part of PARTS) {
      const rows = Array.from({ length: IMPORT_LIMITS[part] }, (_, i) => ROWS[part](`${PREFIX[part]}${i}`));
      expect(await importRows(bob, part, rows), part).toMatchObject({ created: IMPORT_LIMITS[part], existing: 0, failed: [] });
    }
  });
});

describe('times', () => {
  it('takes an entry’s times from its row, but none later than now, and no change before its creation', async () => {
    const rows: [string, Json][] = [
      ['en_kept', { createdAt: '2026-05-01T08:00:00Z', updatedAt: '2026-05-02T09:30:00Z' }],
      ['en_future', { createdAt: '2099-01-01T00:00:00Z', updatedAt: '2099-01-02T00:00:00Z' }],
      ['en_changed_later', { createdAt: '2026-05-01T08:00:00Z', updatedAt: '2099-01-02T00:00:00Z' }],
      ['en_backwards', { createdAt: '2026-05-02T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' }],
      ['en_missing', { createdAt: undefined, updatedAt: undefined }],
      ['en_garbage', { createdAt: 'yesterday', updatedAt: 12345 }],
      ['en_local', { createdAt: '2026-05-01T08:00:00', updatedAt: '2026-05-01 08:00:00' }],
      // made now, so changed no earlier than now
      ['en_created_now', { createdAt: null, updatedAt: '2026-05-01T00:00:00Z' }]
    ];
    const res = await importRows(
      bob,
      'entries',
      rows.map(([id, times]) => entryRow(id, times))
    );
    expect(res).toMatchObject({ created: rows.length, existing: 0, failed: [] });
    const times = async (id: string) => {
      const e = await entryOf(bob, res.ids[id]);
      return [e.createdAt, e.updatedAt];
    };
    expect(await times('en_kept')).toEqual(['2026-05-01T08:00:00Z', '2026-05-02T09:30:00Z']);
    expect(await times('en_backwards')).toEqual(['2026-05-02T00:00:00Z', '2026-05-02T00:00:00Z']);
    const [created, updated] = await times('en_changed_later');
    expect(created).toBe('2026-05-01T08:00:00Z');
    expectNow(updated, 'en_changed_later');
    for (const id of ['en_future', 'en_missing', 'en_garbage', 'en_local', 'en_created_now']) {
      const [c, u] = await times(id);
      expectNow(c, `${id} createdAt`);
      expectNow(u, `${id} updatedAt`);
      expect(Date.parse(u), id).toBeGreaterThanOrEqual(Date.parse(c));
    }
  });

  it('starts an imported entry at revision 1, whatever its row says', async () => {
    const res = await importRows(bob, 'entries', [entryRow('en_r', { revision: 7 })]);
    const e = await entryOf(bob, res.ids.en_r);
    expect(e.revision).toBe(1);
    // and the editor's check counts on from there
    expect(expectStatus(await bob.patch(`/api/entries/${e.id}`, { title: '改过', revision: 1 }), 200).entry.revision).toBe(2);
  });

  it('takes the times of projects, their milestones and collections the same way, and a collection’s publishedAt', async () => {
    const projects = await importRows(bob, 'projects', [
      projectRow('pj_kept', {
        createdAt: '2026-05-01T08:00:00Z',
        updatedAt: '2026-05-02T08:00:00Z',
        milestones: [milestoneRow({ createdAt: '2026-05-03T00:00:00Z', updatedAt: '2026-05-04T00:00:00Z' })]
      }),
      projectRow('pj_future', {
        createdAt: '2099-01-01T00:00:00Z',
        updatedAt: 'garbage',
        milestones: [milestoneRow({ createdAt: '2099-01-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' })]
      }),
      projectRow('pj_backwards', { createdAt: '2026-05-02T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' })
    ]);
    expect(projects).toMatchObject({ created: 3, failed: [] });
    const kept = await projectOf(bob, projects.ids.pj_kept);
    expect([kept.createdAt, kept.updatedAt]).toEqual(['2026-05-01T08:00:00Z', '2026-05-02T08:00:00Z']);
    expect(kept.milestones.map((m) => [m.createdAt, m.updatedAt])).toEqual([['2026-05-03T00:00:00Z', '2026-05-04T00:00:00Z']]);
    const future = await projectOf(bob, projects.ids.pj_future);
    expectNow(future.createdAt, 'pj_future createdAt');
    expectNow(future.updatedAt, 'pj_future updatedAt');
    // its milestone: made now, so changed no earlier than now
    expectNow(future.milestones[0]?.createdAt, 'pj_future milestone createdAt');
    expectNow(future.milestones[0]?.updatedAt, 'pj_future milestone updatedAt');
    const backwards = await projectOf(bob, projects.ids.pj_backwards);
    expect([backwards.createdAt, backwards.updatedAt]).toEqual(['2026-05-02T00:00:00Z', '2026-05-02T00:00:00Z']);

    const times = { createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-03T00:00:00Z' };
    const collections = await importRows(bob, 'collections', [
      collectionRow('th_published', { ...times, visibility: 'public', publishedAt: '2026-05-02T00:00:00Z' }),
      collectionRow('th_unpublished', { ...times, visibility: 'public', publishedAt: null }),
      collectionRow('th_withdrawn', { ...times, visibility: 'private', publishedAt: '2026-05-02T00:00:00Z' }),
      collectionRow('th_future', {
        visibility: 'public',
        createdAt: '2099-01-01T00:00:00Z',
        updatedAt: '2099-01-01T00:00:00Z',
        publishedAt: '2099-01-01T00:00:00Z'
      })
    ]);
    expect(collections).toMatchObject({ created: 4, failed: [] });
    const of = async (id: string) => {
      const t = await collectionOf(bob, collections.ids[id]);
      return { createdAt: t.createdAt, updatedAt: t.updatedAt, publishedAt: t.publishedAt };
    };
    expect(await of('th_published')).toEqual({ ...times, publishedAt: '2026-05-02T00:00:00Z' });
    // public without one: published when it was made
    expect(await of('th_unpublished')).toEqual({ ...times, publishedAt: times.createdAt });
    // once public, private now: the time it was published stays
    expect(await of('th_withdrawn')).toEqual({ ...times, publishedAt: '2026-05-02T00:00:00Z' });
    const later = await of('th_future');
    expectNow(later.createdAt, 'th_future createdAt');
    expectNow(later.updatedAt, 'th_future updatedAt');
    expectNow(later.publishedAt, 'th_future publishedAt');
  });
});

describe('visibility', () => {
  it('is what the row says, and private for a row that says none', async () => {
    const anon = new Client(platform);
    for (const part of PARTS) {
      const res = await importRows(bob, part, [
        ROWS[part](`${PREFIX[part]}public`, { visibility: 'public' }),
        ROWS[part](`${PREFIX[part]}unlisted`, { visibility: 'unlisted' }),
        ROWS[part](`${PREFIX[part]}private`, { visibility: 'private' }),
        ROWS[part](`${PREFIX[part]}unsaid`, { visibility: undefined })
      ]);
      expect(res, part).toMatchObject({ created: 4, existing: 0, failed: [] });
      for (const [key, visibility] of [
        ['public', 'public'],
        ['unlisted', 'unlisted'],
        ['private', 'private'],
        ['unsaid', 'private']
      ]) {
        const id = res.ids[`${PREFIX[part]}${key}`];
        expect((await read(bob, part, id)).visibility, `${part} ${key}`).toBe(visibility);
        expect((await anon.get(`${PATH[part]}/${id}`)).status, `${part} ${key}`).toBe(visibility === 'private' ? 404 : 200);
      }
    }
  });

  it('brings drafts and archived entries as they are', async () => {
    const anon = new Client(platform);
    const res = await importRows(bob, 'entries', [
      entryRow('en_draft', { status: 'draft', visibility: 'public' }),
      entryRow('en_archived', { status: 'archived', visibility: 'public' }),
      entryRow('en_finished', { status: 'published', visibility: 'public' })
    ]);
    expect(res).toMatchObject({ created: 3, failed: [] });
    for (const [key, status] of [
      ['en_draft', 'draft'],
      ['en_archived', 'archived'],
      ['en_finished', 'published']
    ]) {
      expect((await entryOf(bob, res.ids[key])).status, key).toBe(status);
      expect((await anon.get(`/api/entries/${res.ids[key]}`)).status, key).toBe(status === 'published' ? 200 : 404);
    }
  });
});

describe('POST /api/import/tags', () => {
  it('maps a preset and one’s own tag to themselves, and leaves them as they are', async () => {
    const own = await newTag(bob, '书法', 'lake');
    const before = await tagsOf(bob);
    const res = await importTags(bob, [
      tagRow('lake', 'nature', '湖', { ownerId: null }),
      tagRow('nature', 'subject', '自然', { ownerId: null }),
      tagRow('warm', 'tone', '暖', { ownerId: null, color: '#C9925E' }),
      tagRow(own.id, 'sea', '改过的名字', { ownerId: bob.me.id, color: '#123456', sort: 99 })
    ]);
    expect(res).toEqual({ ids: { lake: 'lake', nature: 'nature', warm: 'warm', [own.id]: own.id }, created: 0 });
    expect(await tagsOf(bob)).toEqual(before);
  });

  it('maps a tag to a sibling of the same name, in any case or width, under the parent it maps to', async () => {
    const abc = await newTag(bob, 'ABC', 'lake');
    const hers = await newTag(alice, 'XYZ', 'lake');
    const res = await importTags(bob, [
      tagRow('t_kid', 't_wide', '子'),
      tagRow('t_wide', 'lake', 'ａｂｃ'),
      tagRow('t_case', 'lake', 'abc'),
      tagRow('t_width', 'lake', 'ＡＢＣ'),
      tagRow('t_preset', 'nature', '湖'),
      tagRow('t_elsewhere', 'sea', 'abc'),
      tagRow('t_hers', 'lake', 'xyz')
    ]);
    expect(res.ids).toMatchObject({ t_wide: abc.id, t_case: abc.id, t_width: abc.id, t_preset: 'lake' });
    expect(res.created).toBe(3);

    const tags = await tagsOf(bob);
    expect(tags.get(res.ids.t_kid)).toMatchObject({ name: '子', parentId: abc.id, ownerId: bob.me.id });
    // under another parent, and next to someone else's tag: tags of bob's own
    expect(tags.get(res.ids.t_elsewhere)).toMatchObject({ name: 'abc', parentId: 'sea', ownerId: bob.me.id });
    expect(tags.get(res.ids.t_hers)).toMatchObject({ name: 'xyz', parentId: 'lake', ownerId: bob.me.id });
    expect(res.ids.t_hers).not.toBe(hers.id);
    expect((await tagsOf(alice)).get(hers.id)).toMatchObject({ name: 'XYZ', parentId: 'lake', ownerId: alice.me.id });
  });

  it('creates the rest as the importer’s own, with the export’s name, colour, sort and time, under the parent mapped', async () => {
    const hers = await newTag(alice, '她的根');
    const res = await importTags(bob, [
      // the child first: the parent is decided first all the same
      tagRow('t_child', 't_parent', '残雪', { color: '#aabbcc', sort: 30, createdAt: '2025-03-04T05:06:07Z' }),
      tagRow('t_parent', 'lake', '断桥', { color: null, sort: 20, createdAt: '2025-01-02T03:04:05Z' }),
      tagRow('t_root', null, '我的根', { sort: 40 }),
      // alice's tag, in an export of hers: bob gets a tag of his own, and its child goes under that
      tagRow('t_under_hers', hers.id, '挂在下面', { sort: 50 }),
      tagRow(hers.id, null, '她的根', { ownerId: alice.me.id, sort: 60 })
    ]);
    expect(res.created).toBe(5);
    expect(sorted(Object.keys(res.ids))).toEqual(sorted(['t_child', 't_parent', 't_root', 't_under_hers', hers.id]));
    for (const id of Object.values(res.ids)) expect(id).toMatch(/^t_/);
    expect(res.ids[hers.id]).not.toBe(hers.id);

    const tags = await tagsOf(bob);
    const mineOnly = { ownerId: bob.me.id };
    expect(tags.get(res.ids.t_parent)).toMatchObject({ ...mineOnly, name: '断桥', parentId: 'lake', color: null, sort: 20 });
    expect(tags.get(res.ids.t_child)).toMatchObject({ ...mineOnly, name: '残雪', parentId: res.ids.t_parent, color: '#aabbcc', sort: 30 });
    expect(tags.get(res.ids.t_root)).toMatchObject({ ...mineOnly, name: '我的根', parentId: null, sort: 40 });
    expect(tags.get(res.ids[hers.id])).toMatchObject({ ...mineOnly, name: '她的根', parentId: null, sort: 60 });
    expect(tags.get(res.ids.t_under_hers)).toMatchObject({ ...mineOnly, name: '挂在下面', parentId: res.ids[hers.id], sort: 50 });
    const times = new Map((await exported(bob, 'tags')).map((r) => [r.id as string, r.createdAt]));
    expect(times.get(res.ids.t_parent)).toBe('2025-01-02T03:04:05Z');
    expect(times.get(res.ids.t_child)).toBe('2025-03-04T05:06:07Z');
  });

  it('puts a tag at the root when its parent is neither here nor in the batch: someone else’s tag is not here', async () => {
    const hers = await newTag(alice, '她的');
    const res = await importTags(bob, [tagRow('t_orphan', 't_nowhere', '孤儿'), tagRow('t_under_hers', hers.id, '挂在她的下面')]);
    expect(res.created).toBe(2);
    const tags = await tagsOf(bob);
    expect(tags.get(res.ids.t_orphan)).toMatchObject({ name: '孤儿', parentId: null, ownerId: bob.me.id });
    expect(tags.get(res.ids.t_under_hers)).toMatchObject({ name: '挂在她的下面', parentId: null, ownerId: bob.me.id });
  });

  it('leaves out a tag whose name will not do, and puts its children under its parent', async () => {
    const res = await importTags(bob, [
      tagRow('t_kid1', 't_empty', '一'),
      tagRow('t_empty', 'lake', ''),
      tagRow('t_long', 'lake', 'x'.repeat(TAG_LIMITS.nameMax + 1)),
      tagRow('t_kid2', 't_long', '二'),
      tagRow('t_nameless', null, null),
      tagRow('t_kid3', 't_nameless', '三'),
      tagRow('t_bad_a', 'sea', ''),
      tagRow('t_bad_b', 't_bad_a', 42),
      tagRow('t_kid4', 't_bad_b', '四'),
      tagRow('t_longest', 'lake', 'y'.repeat(TAG_LIMITS.nameMax))
    ]);
    expect(sorted(Object.keys(res.ids))).toEqual(['t_kid1', 't_kid2', 't_kid3', 't_kid4', 't_longest']);
    expect(res.created).toBe(5);
    const tags = await tagsOf(bob);
    expect(tags.get(res.ids.t_kid1)?.parentId).toBe('lake');
    expect(tags.get(res.ids.t_kid2)?.parentId).toBe('lake');
    expect(tags.get(res.ids.t_kid3)?.parentId).toBeNull();
    expect(tags.get(res.ids.t_kid4)?.parentId).toBe('sea');
  });

  it('makes nothing the second time the same tags come', async () => {
    const batch = [tagRow('t_a', 'lake', '断桥'), tagRow('t_b', 't_a', '残雪'), tagRow('t_c', null, '我的根'), tagRow('t_d', 't_c', '枝')];
    const first = await importTags(bob, batch);
    expect(first.created).toBe(4);
    const count = (await tagsOf(bob)).size;
    expect(await importTags(bob, batch)).toEqual({ ids: first.ids, created: 0 });
    expect((await tagsOf(bob)).size).toBe(count);
  });

  it('takes up to 2000 tags in a batch', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => tagRow(`t_${i}`, null, `标签${i}`));
    expect((await bob.post('/api/import/tags', { tags: many(IMPORT_LIMITS.tags + 1) })).status).toBe(400);
    expect((await bob.post('/api/import/tags', { tags: tagRow('t_1', null, '一') })).status).toBe(400);
    expect((await importTags(bob, many(IMPORT_LIMITS.tags))).created).toBe(IMPORT_LIMITS.tags);
  });
});

describe('POST /api/import/places', () => {
  it('maps a place that is here to itself, and leaves it as it is', async () => {
    const place = await newPlace(alice, { name: '断桥', category: '桥', lat: 30.2593, lng: 120.1517 });
    const before = await placeOf(alice, place.id);
    const res = await importPlaces(bob, [
      placeRow(place.id, { name: '改过的名字', category: '湖', lat: 31, lng: 121, radius: 999, aliases: ['别名'], own: true })
    ]);
    expect(res).toEqual({ ids: { [place.id]: place.id }, created: 0 });
    expect(await placeOf(alice, place.id)).toEqual(before);
    expect((await placeOf(bob, place.id)).canEdit).toBe(false);
  });

  it('finds a place of a map service by the service and its number there, and makes one otherwise', async () => {
    const carol = await newUser(platform, 'carol');
    const lake = await newPlace(alice, { name: '西湖', category: '湖', lat: 30.24, lng: 120.14, source: 'osm', sourceId: 'relation/1' });
    const rows = [
      placeRow('poi_lake', {
        name: '西湖（导出里的）',
        category: '湖',
        lat: 30.24,
        lng: 120.14,
        source: 'osm',
        sourceId: 'relation/1',
        own: false
      }),
      placeRow('poi_pagoda', {
        name: '雷峰塔',
        category: '塔',
        lat: 30.2311,
        lng: 120.1489,
        radius: 80,
        source: 'osm',
        sourceId: 'way/2',
        own: false
      }),
      placeRow('poi_temple', {
        name: '灵隐寺',
        category: '寺',
        lat: 30.2408,
        lng: 120.1012,
        radius: 150,
        source: 'amap',
        sourceId: 'B023B0',
        own: false
      }),
      // the same number in another service is another place
      placeRow('poi_other', { name: '别的服务', category: '湖', source: 'amap', sourceId: 'relation/1', own: false })
    ];
    const res = await importPlaces(bob, rows);
    expect(res.created).toBe(3);
    expect(res.ids.poi_lake).toBe(lake.id);
    expect((await placeOf(alice, lake.id)).name).toBe('西湖');

    const made = ['poi_pagoda', 'poi_temple', 'poi_other'];
    expect(new Set(made.map((k) => res.ids[k])).size).toBe(3);
    for (const key of made) {
      expect(res.ids[key], key).toMatch(/^poi_/);
      expect(res.ids[key], key).not.toBe(key);
      expect(res.ids[key], key).not.toBe(lake.id);
      // a new id, not the one an import gives a place of one's own
      expect(res.ids[key], key).not.toBe(await importedId('poi_', bob, key));
    }
    expect(await placeOf(bob, res.ids.poi_pagoda)).toMatchObject({
      name: '雷峰塔',
      category: '塔',
      lat: 30.2311,
      lng: 120.1489,
      radius: 80,
      source: 'osm',
      sourceId: 'way/2'
    });
    expect(await placeOf(bob, res.ids.poi_temple)).toMatchObject({ name: '灵隐寺', category: '寺', source: 'amap', sourceId: 'B023B0' });
    expect(await placeOf(bob, res.ids.poi_other)).toMatchObject({ source: 'amap', sourceId: 'relation/1' });

    // found by the service's number the next time, by anyone: places are the site's
    expect(await importPlaces(bob, rows)).toEqual({ ids: res.ids, created: 0 });
    expect(await importPlaces(carol, rows)).toEqual({ ids: res.ids, created: 0 });
  });

  it('makes a place of no map service at the id the import gives, and finds it there the next time', async () => {
    const carol = await newUser(platform, 'carol');
    const row = placeRow('poi_gate', { name: '小区门口', category: '街区', source: 'custom', sourceId: null, own: true });
    const res = await importPlaces(bob, [row]);
    expect(res.created).toBe(1);
    expect(res.ids.poi_gate).toMatch(importId('poi_'));
    expect(await importPlaces(bob, [row])).toEqual({ ids: res.ids, created: 0 });
    // in another account's import the id is that account's: another place
    const hers = await importPlaces(carol, [row]);
    expect(hers.created).toBe(1);
    expect(hers.ids.poi_gate).toMatch(importId('poi_'));
    expect(hers.ids.poi_gate).not.toBe(res.ids.poi_gate);
    // the id the docs derive
    expect(res.ids.poi_gate).toBe(await importedId('poi_', bob, 'poi_gate'));
    expect(hers.ids.poi_gate).toBe(await importedId('poi_', carol, 'poi_gate'));

    // a place of a map service without its number there cannot be found by it: it is made like one's own
    const unnumbered = placeRow('poi_unnumbered', { name: '无编号', source: 'osm', sourceId: null, own: false });
    const made = await importPlaces(bob, [unnumbered]);
    expect(made).toEqual({ ids: { poi_unnumbered: await importedId('poi_', bob, 'poi_unnumbered') }, created: 1 });
    expect(await importPlaces(bob, [unnumbered])).toEqual({ ids: made.ids, created: 0 });
  });

  it('makes a new place the importer’s, with the export’s fields, the radius within 10–5000 m, and aliases for own places only', async () => {
    const carol = await newUser(platform, 'carol');
    const res = await importPlaces(bob, [
      placeRow('poi_own', {
        name: '断桥',
        aliases: ['断桥残雪', 'Broken Bridge'],
        category: '桥',
        city: '杭州市',
        district: '西湖区',
        lat: 30.2593,
        lng: 120.1517,
        radius: 3,
        own: true
      }),
      placeRow('poi_used', {
        name: '湖滨',
        aliases: ['湖滨路'],
        category: '街区',
        city: '杭州市',
        district: '上城区',
        lat: 30.2585,
        lng: 120.163,
        radius: 250,
        own: false
      }),
      placeRow('poi_long', {
        name: '苏堤',
        aliases: ['苏公堤'],
        category: '堤',
        city: null,
        district: null,
        lat: 30.245,
        lng: 120.137,
        radius: 99_999,
        source: 'osm',
        sourceId: 'way/77',
        own: false
      })
    ]);
    expect(res.created).toBe(3);
    expect(await placeOf(bob, res.ids.poi_own)).toMatchObject({
      name: '断桥',
      category: '桥',
      city: '杭州市',
      district: '西湖区',
      lat: 30.2593,
      lng: 120.1517,
      radius: 10,
      source: 'custom',
      sourceId: null,
      canEdit: true,
      aliases: ['断桥残雪', 'Broken Bridge']
    });
    expect(await placeOf(bob, res.ids.poi_used)).toMatchObject({
      name: '湖滨',
      category: '街区',
      city: '杭州市',
      district: '上城区',
      lat: 30.2585,
      lng: 120.163,
      radius: 250,
      source: 'custom',
      canEdit: true,
      aliases: []
    });
    expect(await placeOf(bob, res.ids.poi_long)).toMatchObject({
      name: '苏堤',
      category: '堤',
      city: null,
      district: null,
      radius: 5000,
      source: 'osm',
      sourceId: 'way/77',
      canEdit: true,
      aliases: []
    });
    // made by bob: another member may not change them, and is not told their aliases
    for (const id of Object.values(res.ids)) {
      const seen = await placeOf(carol, id);
      expect(seen.canEdit, id).toBe(false);
      expect(seen, id).not.toHaveProperty('aliases');
    }
    // bob's export counts them as his own
    const own = (await exported(bob, 'places')).filter((r) => r.own).map((r) => r.id as string);
    expect(sorted(own)).toEqual(sorted(Object.values(res.ids)));
  });

  it('keeps the radius of a new place within 10–5000 m, however far out the export’s is', async () => {
    const radii = { poi_r0: 0, poi_r3: 3, poi_r10: 10, poi_r5000: 5000, poi_r99999: 99_999, poi_r2m: 2_000_000 };
    const res = await importPlaces(
      bob,
      Object.entries(radii).map(([id, radius], i) => placeRow(id, { name: `半径${radius}`, lat: 30.25 + i / 100, radius }))
    );
    const kept: Record<string, number | undefined> = {};
    for (const id of Object.keys(radii)) kept[id] = res.ids[id] ? (await placeOf(bob, res.ids[id])).radius : undefined;
    expect(kept).toEqual({ poi_r0: 10, poi_r3: 10, poi_r10: 10, poi_r5000: 5000, poi_r99999: 5000, poi_r2m: 5000 });
    expect(res.created).toBe(Object.keys(radii).length);
  });

  it('leaves out a place that will not do', async () => {
    const res = await importPlaces(bob, [
      placeRow('poi_planet', { category: '星球' }),
      placeRow('poi_nowhere', { lat: null, lng: null }),
      placeRow('poi_no_lng', { lng: undefined }),
      placeRow('poi_nameless', { name: undefined }),
      placeRow('poi_ok', { category: '寺' })
    ]);
    expect(res).toEqual({ ids: { poi_ok: expect.stringMatching(/^poi_/) }, created: 1 });
    expect(await platform.env.DB.prepare('SELECT COUNT(*) AS n FROM pois').first('n')).toBe(1);
  });

  it('takes up to 500 places in a batch', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => placeRow(`poi_${i}`, { name: `地点${i}`, lat: 30 + i / 1000 }));
    expect((await bob.post('/api/import/places', { places: many(IMPORT_LIMITS.places + 1) })).status).toBe(400);
    expect((await bob.post('/api/import/places', { places: placeRow('poi_1') })).status).toBe(400);
    expect((await importPlaces(bob, many(IMPORT_LIMITS.places))).created).toBe(IMPORT_LIMITS.places);
  });
});

describe('POST /api/import/zones', () => {
  const sameZone = ({ name, lat, lng, radius }: Json) => ({ name, lat, lng, radius });

  it('creates zones as the settings do, and counts one of the same name, centre and radius as existing', async () => {
    const set = (await ok(bob.post<{ zone: PrivacyZone }>('/api/privacy-zones', zone('公司', 30.3, 120.2, 500)), 201)).zone;
    const batch = [
      zone('家', 30.27, 120.16, 300),
      zone('公司', 30.3, 120.2, 500),
      zone('公司', 30.3, 120.2, 800),
      zone('学校', 30.3, 120.2, 500)
    ];
    expect(await importZones(bob, batch)).toEqual({ created: 3, existing: 1, full: 0 });
    const zones = await zonesOf(bob);
    expect(zones).toHaveLength(4);
    expect(zones).toContainEqual(set);
    expect(zones.map(sameZone)).toEqual(expect.arrayContaining(batch));
    for (const z of zones) expect(z.id).toMatch(/^pz_/);

    expect(await importZones(bob, batch)).toEqual({ created: 0, existing: 4, full: 0 });
    expect(await zonesOf(bob)).toHaveLength(4);
    expect(await zonesOf(alice)).toEqual([]);
  });

  it('hides the position of the importer’s photos already inside a new zone', async () => {
    const HOME = { lat: 30.27, lng: 120.16 };
    const near = (bearing: number, meters: number) => {
      const [lat, lng] = destination(HOME.lat, HOME.lng, bearing, meters);
      return { lat, lng };
    };
    const inside = await upload(bob, { ...near(90, 120), geoPrivacy: 'exact', visibility: 'public' });
    const fuzzy = await upload(bob, { ...near(200, 250), geoPrivacy: 'fuzzy', visibility: 'public' });
    const outside = await upload(bob, { ...near(0, 400), geoPrivacy: 'exact', visibility: 'public' });
    const hers = await upload(alice, { ...near(0, 10), geoPrivacy: 'exact', visibility: 'public' });
    const visitor = new Client(platform);
    const seen = (id: string) => ok(visitor.get<PhotoDetail>(`/api/photos/${id}`));
    expect((await seen(inside.id)).lat).not.toBeNull();

    expect(await importZones(bob, [zone('家', HOME.lat, HOME.lng, 300)])).toEqual({ created: 1, existing: 0, full: 0 });
    for (const id of [inside.id, fuzzy.id]) expect(await seen(id), id).toMatchObject({ geoPrivacy: 'hidden', lat: null, lng: null });
    for (const id of [outside.id, hers.id]) expect((await seen(id)).geoPrivacy, id).toBe('exact');
  });

  it('leaves out zones past the 50 an account may have', async () => {
    const z = (i: number) => zone(`区域${i}`, 30 + i / 100, 120.1);
    const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => z(from + i));
    expect((await bob.post('/api/import/zones', { zones: range(0, IMPORT_LIMITS.zones + 1) })).status).toBe(400);
    expect((await bob.post('/api/import/zones', { zones: z(0) })).status).toBe(400);

    for (let from = 0; from < 40; from += 10)
      expect(await importZones(bob, range(from, 10)), String(from)).toEqual({ created: 10, existing: 0, full: 0 });
    expect(await importZones(bob, [z(0), ...range(40, 9)])).toEqual({ created: 9, existing: 1, full: 0 });
    expect(await importZones(bob, [z(1), z(49), z(50), z(51)])).toEqual({ created: 1, existing: 1, full: 2 });
    const names = (await zonesOf(bob)).map((x) => x.name);
    expect(names).toHaveLength(PRIVACY_ZONE_LIMITS.count);
    expect(names).toContain('区域49');
    expect(names).not.toContain('区域50');
    // a zone that is here is still here once the account is full
    expect(await importZones(bob, [z(2)])).toEqual({ created: 0, existing: 1, full: 0 });
  });

  it('leaves out zones that will not do', async () => {
    const res = await importZones(bob, [
      { lat: 30, lng: 120, radius: 300 },
      zone('x'.repeat(PRIVACY_ZONE_LIMITS.nameMax + 1), 30, 120),
      zone('纬度', 91, 120),
      { name: '没有经度', lat: 30, radius: 300 },
      zone('太小', 30, 120, PRIVACY_ZONE_LIMITS.radiusMin - 1),
      zone('太大', 30, 120, PRIVACY_ZONE_LIMITS.radiusMax + 1),
      zone('好的', 30, 120)
    ]);
    expect(res).toEqual({ created: 1, existing: 0, full: 0 });
    expect((await zonesOf(bob)).map(sameZone)).toEqual([zone('好的', 30, 120)]);
  });
});

describe('POST /api/import/projects', () => {
  it('creates a project with its milestones', async () => {
    const res = await importRows(bob, 'projects', [
      projectRow('pj_guitar', {
        type: 'practice',
        title: '学吉他',
        description: '每天半小时',
        startDate: '2026-10-01',
        endDate: '2026-12-31',
        status: 'paused',
        visibility: 'public',
        milestones: [
          milestoneRow({ title: '第一首曲子', body: '《小星星》', date: '2026-10-20' }),
          milestoneRow({ title: '换弦', body: null, date: '2026-10-05' })
        ]
      })
    ]);
    expect(res).toEqual({ ids: { pj_guitar: expect.stringMatching(importId('pj_')) }, created: 1, existing: 0, failed: [] });
    const p = await projectOf(bob, res.ids.pj_guitar);
    expect(p).toMatchObject({
      id: res.ids.pj_guitar,
      ownerId: bob.me.id,
      type: 'practice',
      title: '学吉他',
      description: '每天半小时',
      startDate: '2026-10-01',
      endDate: '2026-12-31',
      status: 'paused',
      visibility: 'public'
    });
    expect(p.milestones.map((m) => [m.title, m.body, m.date])).toEqual([
      ['换弦', null, '2026-10-05'],
      ['第一首曲子', '《小星星》', '2026-10-20']
    ]);
    for (const m of p.milestones) {
      expect(m.id).toMatch(/^ms_/);
      expect(m.projectId).toBe(p.id);
    }
  });

  it('leaves a project that is here as it is, without adding the milestones of its row', async () => {
    const own = await newProject(bob, { title: '原来的项目' });
    expectStatus(await bob.post(`/api/projects/${own.id}/milestones`, { title: '原来的里程碑', date: '2026-10-02' }), 201);
    const before = await projectOf(bob, own.id);
    const res = await importRows(bob, 'projects', [
      projectRow(own.id, { title: '导出里的项目', milestones: [milestoneRow(), milestoneRow({ title: '第二个' })] })
    ]);
    expect(res).toEqual({ ids: { [own.id]: own.id }, created: 0, existing: 1, failed: [] });
    expect(await projectOf(bob, own.id)).toEqual(before);

    // one imported before, imported again with a milestone more
    const first = await importRows(bob, 'projects', [projectRow('pj_m', { milestones: [milestoneRow({ title: '一' })] })]);
    const again = await importRows(bob, 'projects', [
      projectRow('pj_m', { milestones: [milestoneRow({ title: '一' }), milestoneRow({ title: '二' })] })
    ]);
    expect(again).toEqual({ ids: first.ids, created: 0, existing: 1, failed: [] });
    expect((await projectOf(bob, first.ids.pj_m)).milestones.map((m) => m.title)).toEqual(['一']);
  });

  it('leaves out a project with more milestones than a project may have', async () => {
    const steps = (n: number) => Array.from({ length: n }, (_, i) => milestoneRow({ title: `第 ${i + 1} 步` }));
    const res = await importRows(bob, 'projects', [
      projectRow('pj_too_many', { milestones: steps(MILESTONE_LIMITS.count + 1) }),
      projectRow('pj_most', { milestones: steps(MILESTONE_LIMITS.count) })
    ]);
    expect(res).toMatchObject({ created: 1, existing: 0, failed: [{ id: 'pj_too_many', message: REASON }] });
    expect(Object.keys(res.ids)).toEqual(['pj_most']);
    expect((await projectOf(bob, res.ids.pj_most)).milestones).toHaveLength(MILESTONE_LIMITS.count);
    expect(await mine(bob, 'projects')).toHaveLength(1);
  });
});

describe('POST /api/import/entries', () => {
  it('creates an entry with the fields of its row', async () => {
    const [p1, p2] = [await upload(bob), await upload(bob)];
    const tag = await newTag(bob, '散步', 'lake');
    const project = await newProject(bob);
    const place = await newPlace(bob);
    const res = await importRows(bob, 'entries', [
      entryRow('en_full', {
        type: 'trip',
        title: '西湖边',
        body: '# 下午\n\n沿着湖走了一圈。',
        occurredAt: '2026-11-16T15:30:00',
        visibility: 'unlisted',
        status: 'published',
        poiId: place.id,
        media: [
          { photoId: p2.id, caption: '第二张在前' },
          { photoId: p1.id, caption: null }
        ],
        tagIds: ['lake', tag.id],
        projectIds: [project.id]
      }),
      entryRow('en_day', { occurredAt: '2026-11-15', title: null, body: '只有日期' })
    ]);
    expect(res).toMatchObject({ created: 2, existing: 0, failed: [] });
    const e = await entryOf(bob, res.ids.en_full);
    expect(e).toMatchObject({
      id: res.ids.en_full,
      ownerId: bob.me.id,
      type: 'trip',
      title: '西湖边',
      body: '# 下午\n\n沿着湖走了一圈。',
      occurredAt: '2026-11-16T15:30:00',
      visibility: 'unlisted',
      status: 'published',
      projectIds: [project.id],
      revision: 1
    });
    expect(e.poi?.id).toBe(place.id);
    expect(e.media.map((m) => [m.photoId, m.caption])).toEqual([
      [p2.id, '第二张在前'],
      [p1.id, null]
    ]);
    expect(sorted(e.tagIds)).toEqual(sorted(['lake', tag.id]));
    expect(await entryOf(bob, res.ids.en_day)).toMatchObject({ occurredAt: '2026-11-15', title: null, body: '只有日期' });
  });
});

describe('POST /api/import/collections', () => {
  it('creates a collection with the fields of its row and its items in order', async () => {
    const photo = await upload(bob);
    const e = await newEntry(bob);
    const res = await importRows(bob, 'collections', [
      collectionRow('th_full', {
        kind: 'topic',
        title: '湖',
        subtitle: '一年四季',
        intro: '西湖的四季。',
        coverPhotoId: photo.id,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        visibility: 'unlisted',
        items: [
          item('text', { text: '开头' }),
          item('day', { day: '2026-03-01', text: null }),
          item('photo', { photoId: photo.id, text: '春' }),
          item('entry', { entryId: e.id, text: '那天' })
        ]
      })
    ]);
    expect(res).toEqual({ ids: { th_full: expect.stringMatching(importId('th_')) }, created: 1, existing: 0, failed: [] });
    const t = await collectionOf(bob, res.ids.th_full);
    expect(t).toMatchObject({
      id: res.ids.th_full,
      ownerId: bob.me.id,
      kind: 'topic',
      title: '湖',
      subtitle: '一年四季',
      intro: '西湖的四季。',
      coverPhotoId: photo.id,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      visibility: 'unlisted'
    });
    expect(itemsOf(t)).toEqual([
      ['text', '开头'],
      ['day', '2026-03-01', null],
      ['photo', photo.id, '春'],
      ['entry', e.id, '那天']
    ]);
    for (const i of t.items) expect(i.id).toMatch(/^it_/);
  });
});
