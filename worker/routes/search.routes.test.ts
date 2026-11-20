// Search against real D1: docs/api/search.md. A search reads the signed-in user's own archive (entries, photos,
// projects, collections, and the places and tags they use) whatever its visibility or status, and nobody else's,
// public or not. Every word of the query must be in an item, each anywhere in it. Expectations follow the documented
// rules, never the implementation.

import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { SEARCH_LIMITS } from '../../shared/limits';
import { SNIPPET_MAX } from '../../shared/search';
import {
  SEARCH_GROUP_MAX,
  SEARCH_GROUPS,
  SEARCH_HITS,
  type EntryDetail,
  type EntryStatus,
  type PhotoDetail,
  type PhotoSummary,
  type ProjectDetail,
  type SearchGroupName,
  type SearchResponse,
  type ThemeDetail,
  type Visibility
} from '../../shared/types';
import { bytesOf, Client, expectStatus, newUser, upload, uploadAttachment, usePlatform, type Json } from '../test-platform';

const platform = usePlatform();

let alice: Client;
let bob: Client;
beforeEach(async () => {
  alice = await newUser(platform, 'alice', 'owner');
  bob = await newUser(platform, 'bob');
});

const AT = '2026-11-16T08:30:00';
/** Code points a snippet shows before the first word found (shared/search.ts). */
const LEAD = 24;

const entry = async (client: Client, body: Json = {}): Promise<EntryDetail> =>
  expectStatus(await client.post('/api/entries', { occurredAt: AT, ...body }), 201).entry;
const project = async (client: Client, body: Json = {}): Promise<ProjectDetail> =>
  expectStatus(await client.post('/api/projects', { title: '项目', startDate: '2026-03-01', ...body }), 201).project;
const milestone = async (client: Client, projectId: string, body: Json) =>
  expectStatus(await client.post(`/api/projects/${projectId}/milestones`, { date: '2026-04-01', ...body }), 201);
/** A collection (theme) of `client`'s holding `items`. */
async function collection(client: Client, body: Json = {}, items: Json[] = []): Promise<ThemeDetail> {
  const t = expectStatus(await client.post('/api/themes', { kind: 'topic', title: '合集', ...body }), 201).theme as ThemeDetail;
  if (items.length) expectStatus(await client.put(`/api/themes/${t.id}/items`, { items }), 200);
  return t;
}
/** A place `client` makes, with `aliases` when given. */
async function place(client: Client, name: string, aliases?: string[]): Promise<string> {
  const id = expectStatus(await client.post('/api/pois', { name, category: '湖', lat: 30.25, lng: 120.15, city: '杭州市' }), 201).poi
    .id as string;
  if (aliases) expectStatus(await client.patch(`/api/pois/${id}`, { aliases }), 200);
  return id;
}
const tag = async (client: Client, name: string, parentId?: string): Promise<string> =>
  expectStatus(await client.post('/api/tags', { name, parentId }), 201).tag.id;
/** An entry's `media` showing these photos, in this order. */
const showing = (...photos: PhotoDetail[]) => photos.map((p) => ({ photoId: p.id }));
/** The photo as its owner gets it in a list. */
const summary = async (client: Client, p: PhotoDetail): Promise<PhotoSummary> =>
  (expectStatus(await client.get(`/api/photos?ids=${p.id}`), 200).photos as PhotoSummary[])[0];

const path = (q: string, extra = '') => `/api/search?q=${encodeURIComponent(q)}${extra}`;
const search = async (client: Client, q: string, extra = ''): Promise<SearchResponse> =>
  expectStatus(await client.get<SearchResponse>(path(q, extra)), 200);
/** The hits of one group for `q`, in order. */
async function hits(client: Client, q: string, group: SearchGroupName): Promise<Json[]> {
  const res = await search(client, q);
  expect(res[group], group).toBeDefined();
  return res[group]?.hits as Json[];
}
/** The ids found in one group for `q`, in order. */
const found = async (client: Client, q: string, group: SearchGroupName): Promise<string[]> =>
  (await hits(client, q, group)).map((h) => h.id as string);
const sorted = (items: string[]) => [...items].sort((a, b) => a.localeCompare(b));
const setDb = (sql: string, ...params: unknown[]) =>
  platform.env.DB.prepare(sql)
    .bind(...params)
    .run();

/** Rows written straight to D1 in one statement: more than the API would make in a test's time. */
async function insert(table: string, rows: Json[]): Promise<void> {
  const cols = Object.keys(rows[0]);
  await setDb(
    `INSERT INTO ${table} (${cols.join(', ')}) SELECT ${cols.map((c) => `json_extract(value, '$.${c}')`).join(', ')} FROM json_each(?1)`,
    JSON.stringify(rows)
  );
}
const VARIANTS = JSON.stringify({
  s: { key: 'v/x/s.webp', w: 480, h: 320 },
  m: { key: 'v/x/m.webp', w: 1600, h: 1067 },
  l: { key: 'v/x/l.webp', w: 2560, h: 1707 }
});
const pad = (i: number) => String(i).padStart(3, '0');

describe('GET /api/search', () => {
  it('needs a session', async () => {
    const res = await new Client(platform).get(path('西湖'));
    expect(expectStatus(res, 401).error).toBe('unauthenticated');
  });

  it('refuses a query without words, of more than 100 characters or 5 words, and a group that is not there', async () => {
    for (const p of [
      '/api/search',
      path(''),
      path('   '),
      path('\u3000\t\n'),
      path('" "'),
      path('「　」'),
      path('字'.repeat(SEARCH_LIMITS.queryMax + 1)),
      path('😀'.repeat(SEARCH_LIMITS.queryMax + 1)),
      path('一 二 三 四 五 六'),
      path('西湖', '&in=nope'),
      path('西湖', '&in='),
      path('西湖', '&in=Entries')
    ]) {
      const res = await alice.get(p);
      expect(res.status, p).toBe(400);
      expect(res.body.error, p).toBe('invalid_input');
    }
  });

  it('takes 100 characters, counted as code points, and 5 words, a quoted phrase as one and a repeated word once', async () => {
    for (const q of [
      '字'.repeat(SEARCH_LIMITS.queryMax),
      '😀'.repeat(SEARCH_LIMITS.queryMax),
      '一 二 三 四 五',
      '"一 二 三 四 五 六"',
      '西湖 西湖 西湖 西湖 西湖 西湖',
      'west West WEST wEst weSt wesT'
    ]) {
      expectStatus(await alice.get(path(q)), 200);
    }
  });

  it('reads the words of the query: split at any space, a phrase in quotes kept whole, each word once whatever its A–Z case', async () => {
    const cases: [string, string[]][] = [
      ['西湖　断桥\t苏堤\n白堤', ['西湖', '断桥', '苏堤', '白堤']],
      ['"West  Lake" 断桥', ['West Lake', '断桥']],
      ['“断桥 残雪” 「三潭 印月」', ['断桥 残雪', '三潭 印月']],
      ['West west WEST 西湖 西湖', ['West', '西湖']],
      // a quote not yet closed, as it is being typed
      ['断桥 "West La', ['断桥', 'West La']]
    ];
    for (const [q, terms] of cases) expect((await search(alice, q)).terms, q).toEqual(terms);
  });

  it('answers every group with its hits and how many matched, and with in= that group alone, never to be cached', async () => {
    const empty = { hits: [], total: 0 };
    const res = await alice.get<SearchResponse>(path('西湖'));
    expect(expectStatus(res, 200)).toEqual({ terms: ['西湖'], ...Object.fromEntries(SEARCH_GROUPS.map((g) => [g, empty])) });
    expect(res.headers.get('cache-control')).toMatch(/\bno-store\b/);
    for (const g of SEARCH_GROUPS) expect(await search(alice, '西湖', `&in=${g}`), g).toEqual({ terms: ['西湖'], [g]: empty });
  });
});

describe('whose archive a search reads', () => {
  it('never someone else’s entries, photos, projects or collections, however public, nor their own tags and places', async () => {
    const own = await tag(bob, '西湖');
    const lake = await place(bob, '西湖', ['西湖']);
    const shot = await upload(bob, { title: '西湖', note: '西湖', visibility: 'public', tagIds: ['lake', own], poiId: lake });
    const sound = await uploadAttachment(bob, bytesOf(10), { name: '西湖.m4a' });
    await entry(bob, {
      title: '西湖',
      body: '西湖',
      visibility: 'public',
      media: [{ photoId: shot.id, caption: '西湖' }],
      attachments: [{ attachmentId: sound.id, caption: '西湖' }],
      tagIds: [own],
      poiId: lake
    });
    const p = await project(bob, { title: '西湖', description: '西湖', visibility: 'public' });
    await milestone(bob, p.id, { title: '西湖', body: '西湖' });
    await collection(bob, { title: '西湖', subtitle: '西湖', intro: '西湖', visibility: 'public', coverPhotoId: shot.id }, [
      { kind: 'text', text: '西湖' },
      { kind: 'photo', photoId: shot.id, text: '西湖' }
    ]);

    for (const q of ['西湖', '湖']) {
      const res = await search(alice, q);
      for (const g of SEARCH_GROUPS) expect(res[g], `${q}: ${g}`).toEqual({ hits: [], total: 0 });
    }
    // bob finds every one of them, and the preset his photo carries
    const his = await search(bob, '湖');
    expect(Object.fromEntries(SEARCH_GROUPS.map((g) => [g, his[g]?.total]))).toEqual({
      entries: 1,
      photos: 1,
      projects: 1,
      themes: 1,
      places: 1,
      tags: 2
    });
  });

  it('finds all of one’s own, drafts, archived and private entries and private photos too, saying which they are', async () => {
    const entries: string[] = [];
    for (const status of ['draft', 'published', 'archived'] as EntryStatus[]) {
      for (const visibility of ['private', 'unlisted', 'public'] as Visibility[]) {
        const e = await entry(alice, { body: `西湖 ${status} ${visibility}`, status, visibility });
        entries.push(`${e.id} ${status} ${visibility}`);
      }
    }
    const photos: string[] = [];
    for (const visibility of ['private', 'unlisted', 'public'] as Visibility[]) {
      photos.push(`${(await upload(alice, { note: '西湖', visibility })).id} ${visibility}`);
    }
    const p = await project(alice, { title: '西湖', status: 'paused' });
    const t = await collection(alice, { title: '西湖' });

    const res = await search(alice, '西湖');
    expect(sorted((res.entries?.hits ?? []).map((h) => `${h.id} ${h.status} ${h.visibility}`))).toEqual(sorted(entries));
    expect(res.entries?.total).toBe(9);
    expect(sorted((res.photos?.hits ?? []).map((h) => `${h.id} ${h.visibility}`))).toEqual(sorted(photos));
    expect(res.projects?.hits.map((h) => [h.id, h.status, h.visibility])).toEqual([[p.id, 'paused', 'private']]);
    expect(res.themes?.hits.map((h) => [h.id, h.visibility])).toEqual([[t.id, 'private']]);
  });
});

describe('how words match', () => {
  it('needs every word in an entry or photo, each anywhere in it: title, body, a caption; title, note', async () => {
    const [p1, p2] = [await upload(alice), await upload(alice)];
    const both = await entry(alice, { title: '西湖', body: '断桥' });
    const bodyAndCaption = await entry(alice, { body: '西湖', media: [{ photoId: p1.id, caption: '断桥' }] });
    const titleAndCaption = await entry(alice, { title: '断桥', body: '雪', media: [{ photoId: p2.id, caption: '西湖' }] });
    const twoCaptions = await entry(alice, {
      body: '雪',
      media: [
        { photoId: p1.id, caption: '西湖' },
        { photoId: p2.id, caption: '断桥' }
      ]
    });
    await entry(alice, { title: '西湖', body: '西湖', media: [{ photoId: p1.id, caption: '西湖' }] });
    await entry(alice, { body: '断桥' });
    const titled = await upload(alice, { title: '西湖', note: '断桥' });
    await upload(alice, { title: '西湖', note: '西湖' });
    await upload(alice, { note: '断桥' });

    for (const q of ['西湖 断桥', '断桥 西湖']) {
      expect(sorted(await found(alice, q, 'entries')), q).toEqual(sorted([both.id, bodyAndCaption.id, titleAndCaption.id, twoCaptions.id]));
      expect(await found(alice, q, 'photos'), q).toEqual([titled.id]);
    }
  });

  it('finds an entry by its attachments too: their captions and their files’ names, while it holds them', async () => {
    const recording = (name: string) => uploadAttachment(alice, bytesOf(10), { name });
    const [named, captioned, both] = [await recording('西湖夜游.m4a'), await recording('a.m4a'), await recording('断桥.m4a')];
    const byName = await entry(alice, { body: '雪', attachments: [{ attachmentId: named.id }] });
    const byCaption = await entry(alice, { body: '雨', attachments: [{ attachmentId: captioned.id, caption: '西湖的雨声' }] });
    const across = await entry(alice, { title: '游记', attachments: [{ attachmentId: both.id, caption: '西湖' }] });
    // in no entry, it is found nowhere
    await recording('西湖.m4a');
    const snippets = Object.fromEntries((await hits(alice, '西湖', 'entries')).map((h) => [h.id, h.snippet]));
    expect(snippets).toEqual({ [byName.id]: '西湖夜游.m4a', [byCaption.id]: '西湖的雨声', [across.id]: '西湖' });
    expect(await found(alice, '西湖 断桥', 'entries')).toEqual([across.id]);
    expect(await found(alice, '游记 断桥', 'entries')).toEqual([across.id]);
    // taken out of its entry, it no longer finds it
    expectStatus(await alice.patch(`/api/entries/${byName.id}`, { attachments: [] }), 200);
    expect(sorted(await found(alice, '西湖', 'entries'))).toEqual(sorted([byCaption.id, across.id]));
  });

  it('needs every word in a project, a collection, a place or a tag, each anywhere in it', async () => {
    const withMilestone = await project(alice, { title: '西湖' });
    await milestone(alice, withMilestone.id, { title: '断桥' });
    const described = await project(alice, { title: '跑步', description: '西湖' });
    await milestone(alice, described.id, { title: '十公里', body: '断桥' });
    await project(alice, { title: '西湖', description: '西湖' });

    const subtitled = await collection(alice, { title: '断桥', subtitle: '西湖' });
    const introduced = await collection(alice, { title: '雪', intro: '西湖' }, [{ kind: 'text', text: '断桥' }]);
    await collection(alice, { title: '西湖', intro: '西湖' });

    const aliased = await place(alice, '西湖', ['断桥残雪']);
    await place(alice, '西湖边');
    const both = await tag(alice, '西湖断桥');
    await tag(alice, '西湖');

    const res = await search(alice, '西湖 断桥');
    expect(sorted((res.projects?.hits ?? []).map((h) => h.id))).toEqual(sorted([withMilestone.id, described.id]));
    expect(sorted((res.themes?.hits ?? []).map((h) => h.id))).toEqual(sorted([subtitled.id, introduced.id]));
    expect(res.places?.hits.map((h) => h.id)).toEqual([aliased]);
    expect(res.tags?.hits.map((h) => h.id)).toEqual([both]);
  });

  it('takes a phrase in quotes as one word, its spaces included', async () => {
    const phrase = await entry(alice, { body: '断桥 残雪' });
    const apart = await entry(alice, { body: '残雪落在断桥上' });
    for (const q of ['"断桥 残雪"', '“断桥 残雪”', '「断桥 残雪」', '"断桥   残雪"'])
      expect(await found(alice, q, 'entries'), q).toEqual([phrase.id]);
    expect(sorted(await found(alice, '断桥 残雪', 'entries'))).toEqual(sorted([phrase.id, apart.id]));
  });

  it('matches %, _ and \\ as themselves', async () => {
    const percent = await entry(alice, { body: '涨了 100%' });
    await entry(alice, { body: '涨了 100x' });
    const underscore = await entry(alice, { body: 'snake a_b' });
    await entry(alice, { body: 'snake axb' });
    const backslash = await entry(alice, { body: 'C:\\temp' });
    await entry(alice, { body: 'C:temp' });
    const cases: [string, string[]][] = [
      ['100%', [percent.id]],
      ['%', [percent.id]],
      ['a_b', [underscore.id]],
      ['_', [underscore.id]],
      ['C:\\temp', [backslash.id]],
      ['\\', [backslash.id]]
    ];
    for (const [q, ids] of cases) expect(await found(alice, q, 'entries'), q).toEqual(ids);
  });

  it('ignores the case of A–Z, and only of A–Z', async () => {
    const lake = await entry(alice, { title: 'West Lake' });
    const cafe = await entry(alice, { title: 'ÉCLAIR' });
    for (const q of ['west', 'WEST LAKE', '"west lake"', 'lAkE']) expect(await found(alice, q, 'entries'), q).toEqual([lake.id]);
    expect(await found(alice, 'ÉCLAIR', 'entries')).toEqual([cafe.id]);
    expect(await found(alice, 'éclair', 'entries')).toEqual([]);
  });

  it('finds a word anywhere inside the text: Chinese has no spaces between words', async () => {
    const e = await entry(alice, { body: '今天沿着西湖边散步，走到了断桥。' });
    for (const q of ['西湖', '湖边', '断桥。', '今天沿着']) expect(await found(alice, q, 'entries'), q).toEqual([e.id]);
  });
});

describe('entries', () => {
  it('give their label, type, time, status, visibility, first photo and a plain-text snippet', async () => {
    const [first, second] = [await upload(alice, { visibility: 'private', note: '私下的笔记' }), await upload(alice)];
    const e = await entry(alice, {
      type: 'trip',
      body: '## 去西湖\n\n> 苏堤上 **断桥** 边 `人` 很多\n\n- [看这里](https://example.com/west)',
      media: showing(first, second),
      occurredAt: '2026-05-01',
      status: 'draft',
      visibility: 'unlisted'
    });
    const bare = await entry(alice, { type: 'reading', media: [{ photoId: second.id, caption: '断桥的书' }] });
    const titled = await entry(alice, { title: '游记', body: '断桥' });

    const got = await hits(alice, '断桥', 'entries');
    const hit = got.find((h) => h.id === e.id);
    expect(hit).toEqual({
      id: e.id,
      type: 'trip',
      title: null,
      label: '去西湖',
      occurredAt: '2026-05-01',
      status: 'draft',
      visibility: 'unlisted',
      photo: await summary(alice, first),
      snippet: '去西湖 苏堤上 断桥 边 人 很多 看这里'
    });
    expect(hit?.photo).not.toHaveProperty('note');
    // without a title the label is the body's first line, without either the entry's type
    expect(sorted(got.map((h) => `${h.id} ${h.label} ${h.snippet}`))).toEqual(
      sorted([`${e.id} 去西湖 ${hit?.snippet}`, `${bare.id} 阅读 断桥的书`, `${titled.id} 游记 断桥`])
    );
    expect(got.find((h) => h.id === titled.id)?.photo).toBeNull();
  });

  it('cut the snippet around the earliest word of the body, with … where the body goes on', async () => {
    const deep = await entry(alice, { body: `${'甲'.repeat(300)}断桥${'乙'.repeat(300)}西湖${'丙'.repeat(10)}` });
    const atStart = await entry(alice, { body: `断桥${'乙'.repeat(300)}` });
    const atEnd = await entry(alice, { body: `${'甲'.repeat(300)}断桥` });
    const middle = `…${'甲'.repeat(LEAD)}断桥${'乙'.repeat(SNIPPET_MAX - LEAD - 2)}…`;
    expect(await hits(alice, '西湖 断桥', 'entries')).toEqual([expect.objectContaining({ id: deep.id, snippet: middle })]);
    const own: Record<string, string> = Object.fromEntries((await hits(alice, '断桥', 'entries')).map((h) => [h.id, h.snippet]));
    expect(own[deep.id]).toBe(middle);
    expect(own[atStart.id]).toBe(`断桥${'乙'.repeat(SNIPPET_MAX - 2)}…`);
    // near the end, more of what comes before shows, and no … after the last word
    expect(own[atEnd.id]).toMatch(new RegExp(`^…甲{${LEAD},}断桥$`));
    const [lake] = await hits(alice, '西湖', 'entries');
    expect(lake.snippet).toMatch(new RegExp(`^…乙{${LEAD},}西湖丙{10}$`));
    for (const s of Object.values(own)) expect([...s.replaceAll('…', '')].length).toBeLessThanOrEqual(SNIPPET_MAX);
  });

  it('cut the snippet around a word whatever the A–Z case of the word and the text', async () => {
    const e = await entry(alice, { body: `${'甲'.repeat(300)}WEST Lake${'乙'.repeat(300)}` });
    for (const q of ['West', 'west lake']) {
      expect(await hits(alice, q, 'entries'), q).toEqual([
        expect.objectContaining({ id: e.id, snippet: `…${'甲'.repeat(LEAD)}WEST Lake${'乙'.repeat(SNIPPET_MAX - LEAD - 9)}…` })
      ]);
    }
  });

  it('take the snippet from the first caption with a word when the body has none, and from the body’s start when only the title has', async () => {
    const [p1, p2, p3] = [await upload(alice), await upload(alice), await upload(alice)];
    const captioned = await entry(alice, {
      title: '游记',
      body: '今天天气很好',
      media: [
        { photoId: p1.id, caption: '湖边的树' },
        { photoId: p2.id, caption: '西湖的断桥' },
        { photoId: p3.id, caption: '西湖的雨' }
      ]
    });
    const both = await entry(alice, { body: '西湖的早晨', media: [{ photoId: p1.id, caption: '西湖的晚上' }] });
    const titleOnly = await entry(alice, { title: '西湖', body: '甲'.repeat(100), media: [{ photoId: p1.id, caption: '树' }] });
    const noBody = await entry(alice, { title: '西湖', media: showing(p2) });
    const snippets = Object.fromEntries((await hits(alice, '西湖', 'entries')).map((h) => [h.id, h.snippet]));
    expect(snippets).toEqual({
      [captioned.id]: '西湖的断桥',
      [both.id]: '西湖的早晨',
      [titleOnly.id]: `${'甲'.repeat(SNIPPET_MAX)}…`,
      [noBody.id]: null
    });
  });

  it('come with a word in the title first, then the latest first, titled or not', async () => {
    const older = await entry(alice, { title: '西湖', occurredAt: '2024-01-01' });
    const oldest = await entry(alice, { title: '去西湖', body: '断桥', occurredAt: '2023-01-01' });
    const latest = await entry(alice, { body: '西湖', occurredAt: '2026-01-01T09:00:00' });
    const later = await entry(alice, { body: '西湖', occurredAt: '2025-06-01' });
    const meanwhile = await entry(alice, { body: '在西湖', occurredAt: '2025-07-01' });
    // a title without the word sorts by time like no title at all
    const walk = await entry(alice, { title: '散步', body: '西湖', occurredAt: '2020-01-01' });
    expect(await found(alice, '西湖', 'entries')).toEqual([older.id, oldest.id, latest.id, meanwhile.id, later.id, walk.id]);
  });
});

describe('photos', () => {
  it('are found by title or note, each a photo summary with a snippet from its note, or null without one', async () => {
    const titled = await upload(alice, { title: 'Sunset at West Lake', takenAt: '2026-05-03T18:00:00' });
    const noted = await upload(alice, { note: '## 断桥\n\n**西湖**边的早晨', takenAt: '2026-05-02T07:00:00', visibility: 'private' });
    const both = await upload(alice, { title: '西湖', note: `${'甲'.repeat(100)}`, takenAt: '2026-05-01T07:00:00' });
    await upload(alice);

    const [westHit] = await hits(alice, 'west', 'photos');
    expect(westHit).toEqual({ ...(await summary(alice, titled)), snippet: null });
    const lake = await hits(alice, '西湖', 'photos');
    expect(lake).toEqual([
      { ...(await summary(alice, both)), snippet: `${'甲'.repeat(SNIPPET_MAX)}…` },
      { ...(await summary(alice, noted)), snippet: '断桥 西湖边的早晨' }
    ]);
    expect(lake[1]).toMatchObject({ hasNote: true, visibility: 'private' });
    expect(lake[1]).not.toHaveProperty('note');
  });

  it('come with a word in the title first, then the latest taken first, titled or not', async () => {
    const older = await upload(alice, { title: '西湖', takenAt: '2024-01-01T10:00:00' });
    const oldest = await upload(alice, { title: '西湖边', note: '雪', takenAt: '2023-01-01T10:00:00' });
    const latest = await upload(alice, { note: '西湖', takenAt: '2026-01-01T10:00:00' });
    const earlier = await upload(alice, { note: '西湖', takenAt: '2025-01-01T10:00:00' });
    const between = await upload(alice, { note: '在西湖', takenAt: '2025-06-01T10:00:00' });
    const walk = await upload(alice, { title: '湖边', note: '西湖', takenAt: '2020-01-01T10:00:00' });
    expect(await found(alice, '西湖', 'photos')).toEqual([older.id, oldest.id, latest.id, between.id, earlier.id, walk.id]);
  });
});

describe('projects', () => {
  it('are found by title, description, or a milestone’s title or summary, with a snippet from where the words are', async () => {
    const described = await project(alice, { title: '学书法', description: '每天在**西湖**边练字', endDate: '2026-12-31' });
    const reached = await project(alice, { title: '跑步', type: 'practice' });
    await milestone(alice, reached.id, { title: '西湖十公里', body: '第一次跑完' });
    const summed = await project(alice, { title: '读书', description: '一年读二十本' });
    await milestone(alice, summed.id, { title: '读完', body: '在西湖边读完了', date: '2026-05-01' });
    await milestone(alice, summed.id, { title: '开始', body: '在西湖边开始', date: '2026-04-01' });
    await milestone(alice, summed.id, { title: '第一本', body: '没有那个词', date: '2026-03-01' });
    const titled = await project(alice, { title: '西湖摄影', description: '拍一年' });
    const bare = await project(alice, { title: '西湖' });
    await project(alice, { title: '画画', description: '湖边' });

    const got = Object.fromEntries((await hits(alice, '西湖', 'projects')).map((h) => [h.id, h]));
    expect(got).toEqual({
      [described.id]: {
        id: described.id,
        type: 'other',
        title: '学书法',
        status: 'active',
        visibility: 'private',
        startDate: '2026-03-01',
        endDate: '2026-12-31',
        snippet: '每天在西湖边练字'
      },
      [reached.id]: expect.objectContaining({ type: 'practice', snippet: '西湖十公里 第一次跑完' }),
      [summed.id]: expect.objectContaining({ snippet: '开始 在西湖边开始' }),
      [titled.id]: expect.objectContaining({ snippet: '拍一年' }),
      [bare.id]: expect.objectContaining({ snippet: null })
    });
  });

  it('come with a word in the title first', async () => {
    const titled = await project(alice, { title: '西湖' });
    const described = await project(alice, { title: '跑步', description: '西湖' });
    await setDb('UPDATE projects SET updated_at = ?1 WHERE id = ?2', '2020-01-01T00:00:00Z', titled.id);
    expect(await found(alice, '西湖', 'projects')).toEqual([titled.id, described.id]);
  });

  it('count every match but give 20; in=projects gives them all and no other group', async () => {
    const made: string[] = [];
    for (let i = 0; i < 25; i++) made.push((await project(alice, { title: `练字 ${i}`, description: '在西湖边' })).id);
    const res = await search(alice, '西湖');
    expect(res.projects?.total).toBe(25);
    expect(res.projects?.hits).toHaveLength(SEARCH_HITS.projects);
    const only = await search(alice, '西湖', '&in=projects');
    expect(Object.keys(only).sort()).toEqual(['projects', 'terms']);
    expect(only.projects?.total).toBe(25);
    expect(sorted((only.projects?.hits ?? []).map((h) => h.id))).toEqual(sorted(made));
  });
});

describe('collections', () => {
  it('are found by title, subtitle, opening words or an item’s text: a paragraph, a caption, a day’s heading', async () => {
    const shot = await upload(alice, { visibility: 'private' });
    const e = await entry(alice, { body: 'x' });
    const subtitled = await collection(alice, { title: '旅行', subtitle: '西湖三日', intro: '第一天下雨' });
    const introduced = await collection(alice, { title: '散步', intro: `${'甲'.repeat(100)}西湖${'乙'.repeat(100)}` });
    const paragraph = await collection(alice, { title: '雨' }, [
      { kind: 'text', text: '没有那个词' },
      { kind: 'text', text: '西湖的雨' },
      { kind: 'photo', photoId: shot.id, text: '西湖的雾' }
    ]);
    const caption = await collection(alice, { title: '雾', coverPhotoId: shot.id }, [
      { kind: 'photo', photoId: shot.id, text: '西湖晨光' }
    ]);
    const day = await collection(alice, { kind: 'trip', title: '杭州', startDate: '2026-11-16', endDate: '2026-11-17' }, [
      { kind: 'day', day: '2026-11-16', text: '西湖第一天' }
    ]);
    const noted = await collection(alice, { title: '记录' }, [{ kind: 'entry', entryId: e.id, text: '西湖那天' }]);
    const titled = await collection(alice, { title: '西湖' });
    await collection(alice, { title: '别处', intro: '湖边' }, [{ kind: 'text', text: '断桥' }]);

    const got = Object.fromEntries((await hits(alice, '西湖', 'themes')).map((h) => [h.id, h]));
    expect(got).toEqual({
      [subtitled.id]: {
        id: subtitled.id,
        kind: 'topic',
        title: '旅行',
        subtitle: '西湖三日',
        visibility: 'private',
        startDate: null,
        endDate: null,
        cover: null,
        snippet: '第一天下雨'
      },
      [introduced.id]: expect.objectContaining({ snippet: `…${'甲'.repeat(LEAD)}西湖${'乙'.repeat(SNIPPET_MAX - LEAD - 2)}…` }),
      [paragraph.id]: expect.objectContaining({ snippet: '西湖的雨' }),
      [caption.id]: expect.objectContaining({ snippet: '西湖晨光', cover: await summary(alice, shot) }),
      [day.id]: expect.objectContaining({ kind: 'trip', startDate: '2026-11-16', endDate: '2026-11-17', snippet: '西湖第一天' }),
      [noted.id]: expect.objectContaining({ snippet: '西湖那天' }),
      [titled.id]: expect.objectContaining({ snippet: null, cover: null })
    });
    expect(got[caption.id].cover).not.toHaveProperty('note');
  });

  it('show the cover the collections list shows: the chosen photo, else the first photo, an entry’s included', async () => {
    const [a, b, c] = [await upload(alice), await upload(alice), await upload(alice)];
    const withPhotos = await entry(alice, { body: 'x', media: showing(b, c) });
    const chosen = await collection(alice, { title: '西湖一', coverPhotoId: c.id }, [{ kind: 'photo', photoId: a.id }]);
    const photoFirst = await collection(alice, { title: '西湖二' }, [
      { kind: 'text', text: '先说几句' },
      { kind: 'photo', photoId: a.id },
      { kind: 'entry', entryId: withPhotos.id }
    ]);
    const entryFirst = await collection(alice, { title: '西湖三' }, [
      { kind: 'entry', entryId: withPhotos.id },
      { kind: 'photo', photoId: a.id }
    ]);
    const words = await collection(alice, { title: '西湖四' }, [{ kind: 'text', text: '只有字' }]);
    // by position, whatever the order of the items' ids
    const reordered = await collection(alice, { title: '西湖五' });
    await insert('theme_items', [
      { id: 'it_z', theme_id: reordered.id, position: 0, kind: 'entry', photo_id: null, entry_id: withPhotos.id },
      { id: 'it_a', theme_id: reordered.id, position: 1, kind: 'photo', photo_id: a.id, entry_id: null }
    ]);

    const got = Object.fromEntries((await hits(alice, '西湖', 'themes')).map((h) => [h.id, h.cover]));
    expect(got).toEqual({
      [chosen.id]: await summary(alice, c),
      [photoFirst.id]: await summary(alice, a),
      [entryFirst.id]: await summary(alice, b),
      [words.id]: null,
      [reordered.id]: await summary(alice, b)
    });
    const listed = expectStatus(await alice.get('/api/themes?mine=1'), 200).themes as Json[];
    for (const t of listed) expect(got[t.id as string]?.id ?? null, t.title as string).toBe((t.cover as Json | null)?.id ?? null);
  });

  it('come with a word in the title first', async () => {
    const titled = await collection(alice, { title: '西湖' });
    const introduced = await collection(alice, { title: '散步', intro: '西湖' });
    await setDb('UPDATE themes SET updated_at = ?1 WHERE id = ?2', '2020-01-01T00:00:00Z', titled.id);
    expect(await found(alice, '西湖', 'themes')).toEqual([titled.id, introduced.id]);
  });
});

describe('places', () => {
  it('are those one’s photos or entries are at and those one made, by name or alias, with one’s own counts only', async () => {
    // bob's place, which alice's photo and entries are at too
    const lake = await place(bob, '西湖', ['West Lake', '钱塘湖']);
    for (let i = 0; i < 3; i++) await upload(bob, { poiId: lake });
    await upload(alice, { poiId: lake, visibility: 'private' });
    await entry(alice, { body: 'x', poiId: lake });
    await entry(alice, { body: 'y', poiId: lake, status: 'draft' });
    // bob's alone
    const bobs = await place(bob, '西湖南线');
    await upload(bob, { poiId: bobs });
    // alice's, with nothing at it yet
    const home = await place(alice, '西湖边的家');

    const hit = { id: lake, name: '西湖', category: '湖', city: '杭州市', district: null, photoCount: 1, entryCount: 2 };
    expect(await hits(alice, '西湖', 'places')).toEqual([hit, { ...hit, id: home, name: '西湖边的家', photoCount: 0, entryCount: 0 }]);
    for (const q of ['west', '钱塘', 'LAKE']) expect(await hits(alice, q, 'places'), q).toEqual([hit]);
    // each alias on its own: not the brackets, quotes and commas of the JSON that holds them
    for (const q of ['[', ']', ',', 'Lake","钱塘']) expect(await hits(alice, q, 'places'), q).toEqual([]);
    expect(await hits(bob, '西湖', 'places')).toEqual([
      { ...hit, photoCount: 3, entryCount: 0 },
      { ...hit, id: bobs, name: '西湖南线', photoCount: 1, entryCount: 0 }
    ]);

    // an alias is found by what it says, a backslash too (which its JSON doubles); aliases that are no JSON are none
    const study = await place(alice, '书房', ['a\\b']);
    expect(await found(alice, 'a\\b', 'places')).toEqual([study]);
    await insert('pois', [{ id: 'poi_bad', name: '坏的', lat: 30, lng: 120, created_by: alice.me.id, aliases: '["断桥' }]);
    expect(await found(alice, '断桥', 'places')).toEqual([]);
    expect(await found(alice, '坏的', 'places')).toEqual(['poi_bad']);
  });

  it('come most used first, and count every match beyond the 20 they give', async () => {
    const rows = Array.from({ length: SEARCH_HITS.places + 3 }, (_, i) => ({
      id: `poi_s${pad(i)}`,
      name: `西湖${pad(i)}`,
      lat: 30,
      lng: 120,
      created_by: alice.me.id
    }));
    await insert('pois', rows);
    const busy = rows[SEARCH_HITS.places + 2].id;
    await entry(alice, { body: 'x', poiId: busy });
    const res = await search(alice, '西湖');
    expect(res.places?.total).toBe(rows.length);
    expect(res.places?.hits).toHaveLength(SEARCH_HITS.places);
    expect(res.places?.hits[0]).toMatchObject({ id: busy, entryCount: 1 });
    expect((await search(alice, '西湖', '&in=places')).places?.hits).toHaveLength(rows.length);
  });
});

describe('tags', () => {
  it('are one’s own and the presets one’s photos or entries carry, with their parent and one’s own counts', async () => {
    // the preset 湖 under 自然, carried by bob's photo only
    await upload(bob, { tagIds: ['lake'] });
    await tag(bob, '湖光');
    const shore = await tag(alice, '湖畔', 'lake');
    expect(await hits(alice, '湖', 'tags')).toEqual([
      { id: shore, name: '湖畔', parentName: '湖', color: null, photoCount: 0, entryCount: 0 }
    ]);

    await upload(alice, { tagIds: ['lake'] });
    await entry(alice, { body: 'x', tagIds: ['lake', shore] });
    await entry(alice, { body: 'y', tagIds: ['lake'], status: 'archived' });
    expect(await hits(alice, '湖', 'tags')).toEqual([
      { id: 'lake', name: '湖', parentName: '自然', color: null, photoCount: 1, entryCount: 2 },
      { id: shore, name: '湖畔', parentName: '湖', color: null, photoCount: 0, entryCount: 1 }
    ]);
    expect(await hits(alice, 'mono', 'tags')).toEqual([]);
    await upload(alice, { tagIds: ['mono'] });
    expect(await hits(alice, '黑白', 'tags')).toEqual([
      { id: 'mono', name: '黑白', parentName: '色调', color: 'mono', photoCount: 1, entryCount: 0 }
    ]);
  });

  it('come most used first, then by name', async () => {
    const [one, two, three, four] = [
      await tag(alice, '湖一'),
      await tag(alice, '湖二'),
      await tag(alice, '湖三'),
      await tag(alice, '湖丁')
    ];
    await upload(alice, { tagIds: [three] });
    await entry(alice, { body: 'x', tagIds: [three] });
    await entry(alice, { body: 'y', tagIds: [two] });
    expect(await found(alice, '湖', 'tags')).toEqual([three, two, one, four]);
  });
});

describe('how many hits a group gives', () => {
  it('at most its own number, with the total of all matches; in= gives one group up to 500', async () => {
    const owner = alice.me.id;
    const n = (g: SearchGroupName) => SEARCH_HITS[g] + 2;
    await insert(
      'entries',
      Array.from({ length: n('entries') }, (_, i) => ({
        id: `en_s${pad(i)}`,
        owner_id: owner,
        body: '西湖',
        occurred_at: `2026-01-01T00:${pad(i).slice(1)}:00`
      }))
    );
    await insert(
      'photos',
      Array.from({ length: n('photos') }, (_, i) => ({
        id: `ph_s${pad(i)}`,
        owner_id: owner,
        note: '西湖',
        taken_at: `2026-01-01T00:${pad(i).slice(1)}:00`,
        width: 3000,
        height: 2000,
        file_key: `o/${owner}/ph_s${pad(i)}.jpg`,
        variants: VARIANTS
      }))
    );
    await insert(
      'projects',
      Array.from({ length: n('projects') }, (_, i) => ({
        id: `pj_s${pad(i)}`,
        owner_id: owner,
        title: `西湖${i}`,
        start_date: '2026-01-01'
      }))
    );
    await insert(
      'themes',
      Array.from({ length: n('themes') }, (_, i) => ({ id: `th_s${pad(i)}`, owner_id: owner, title: `西湖${i}` }))
    );
    await insert(
      'pois',
      Array.from({ length: n('places') }, (_, i) => ({ id: `poi_s${pad(i)}`, name: `西湖${i}`, lat: 30, lng: 120, created_by: owner }))
    );
    await insert(
      'tags',
      Array.from({ length: n('tags') }, (_, i) => ({ id: `t_s${pad(i)}`, owner_id: owner, name: `西湖${i}` }))
    );

    const all = await search(alice, '西湖');
    for (const g of SEARCH_GROUPS) {
      expect(all[g]?.hits, g).toHaveLength(SEARCH_HITS[g]);
      expect(all[g]?.total, g).toBe(n(g));
      const only = await search(alice, '西湖', `&in=${g}`);
      expect(Object.keys(only).sort(), g).toEqual([g, 'terms'].sort());
      expect(only[g]?.hits, g).toHaveLength(n(g));
      expect(only[g]?.total, g).toBe(n(g));
    }
    // the latest entries
    expect(all.entries?.hits.map((h) => h.id)).toEqual(
      Array.from({ length: SEARCH_HITS.entries }, (_, i) => `en_s${pad(n('entries') - 1 - i)}`)
    );

    await insert(
      'tags',
      Array.from({ length: SEARCH_GROUP_MAX }, (_, i) => ({ id: `t_m${pad(i)}`, owner_id: owner, name: `西湖m${i}` }))
    );
    const many = await search(alice, '西湖', '&in=tags');
    expect(many.tags?.hits).toHaveLength(SEARCH_GROUP_MAX);
    expect(many.tags?.total).toBe(SEARCH_GROUP_MAX + n('tags'));
  });
});
