// Collections (合集: themes holding entries beside photos, text and days) against real D1: docs/api/themes.md. Who sees
// what follows the documented rules (docs/api/conventions.md#可见性: a collection shows and counts only what its reader
// could open by id, and others open an entry only when it is finished and not private), never the implementation.

import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { THEME_ITEM_LIMITS } from '../../shared/limits';
import type {
  EntryDetail,
  EntryStatus,
  EntrySummary,
  PhotoDetail,
  PhotoSummary,
  ThemeDetail,
  ThemeEntry,
  ThemeItem,
  ThemeSummary,
  Visibility
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

const AT = '2026-11-16T08:30:00';
const VIS: Visibility[] = ['public', 'unlisted', 'private'];
const STATUS: EntryStatus[] = ['published', 'draft', 'archived'];
const ITEM_ID = expect.stringMatching(/^it_/);

const collection = async (client: Client, body: Json = {}): Promise<ThemeDetail> =>
  expectStatus(await client.post('/api/themes', { kind: 'topic', title: '合集', ...body }), 201).theme;
const entry = async (client: Client, body: Json = {}): Promise<EntryDetail> =>
  expectStatus(await client.post('/api/entries', { occurredAt: AT, body: 'x', ...body }), 201).entry;
/** An entry's `media` showing these photos, in this order. */
const showing = (...photos: PhotoDetail[]) => photos.map((p) => ({ photoId: p.id }));
const put = (client: Client, themeId: string, items: Json[]) => client.put(`/api/themes/${themeId}/items`, { items });
const setItems = async (themeId: string, items: Json[]): Promise<ThemeDetail> => expectStatus(await put(alice, themeId, items), 200).theme;
const detail = async (client: Client, id: string): Promise<ThemeDetail> =>
  expectStatus(await client.get<ThemeDetail>(`/api/themes/${id}`), 200);
const list = async (client: Client, query = ''): Promise<ThemeSummary[]> =>
  expectStatus(await client.get(`/api/themes${query ? `?${query}` : ''}`), 200).themes;
const rows = async (sql: string, ...params: unknown[]) =>
  (
    await platform.env.DB.prepare(sql)
      .bind(...params)
      .all()
  ).results;

type EntryItem = Extract<ThemeItem, { kind: 'entry' }>;
const entryItems = (t: ThemeDetail) => t.items.filter((i): i is EntryItem => i.kind === 'entry');
const ids = (items: { id: string }[]) => items.map((x) => x.id);

/** The entry as `viewer` opens it, cut down to its summary: docs/api/entries.md (detail = summary + these four). */
async function summaryFor(viewer: Client, id: string): Promise<EntrySummary> {
  const res = await viewer.get<EntryDetail>(`/api/entries/${id}`);
  const { body: _body, media: _media, revision: _revision, themes: _themes, ...summary } = expectStatus(res, 200);
  return summary;
}

/** These photos as `viewer` gets them in a list (`PhotoSummary`, so no note), in the order given. All must be visible. */
async function summaries(viewer: Client, photos: PhotoDetail[]): Promise<PhotoSummary[]> {
  const got = expectStatus(await viewer.get(`/api/photos?ids=${ids(photos).join(',')}`), 200).photos as PhotoSummary[];
  expect(ids(got).sort()).toEqual(ids(photos).sort());
  return photos.map((p) => got.find((g) => g.id === p.id) as PhotoSummary);
}

describe('PUT /api/themes/:id/items with entries', () => {
  it('keeps entry items in place among photos, text and days, each with its entry and the photos it shows', async () => {
    const lake = await upload(alice, { title: '湖', note: '湖边的笔记' });
    const bridge = await upload(alice, { title: '桥', note: '桥上的笔记' });
    const rain = await upload(alice, { title: '雨', note: '雨里的笔记' });
    const walk = await entry(alice, {
      title: '散步',
      body: '沿着湖走了一圈。',
      visibility: 'public',
      media: [{ photoId: bridge.id, caption: '桥上' }, { photoId: lake.id }]
    });
    const words = await entry(alice, { body: '只有文字' });
    const t = await collection(alice, { visibility: 'public' });

    const saved = await setItems(t.id, [
      { kind: 'text', text: '序' },
      { kind: 'entry', entryId: walk.id, text: '那天的记录' },
      { kind: 'photo', photoId: rain.id, text: '雨中' },
      { kind: 'day', day: '2026-11-16' },
      { kind: 'entry', entryId: words.id }
    ]);
    const [rainSummary] = await summaries(alice, [rain]);
    expect(saved.items).toEqual([
      { id: ITEM_ID, kind: 'text', text: '序' },
      {
        id: ITEM_ID,
        kind: 'entry',
        entryId: walk.id,
        text: '那天的记录',
        entry: { ...(await summaryFor(alice, walk.id)), photos: await summaries(alice, [bridge, lake]) }
      },
      { id: ITEM_ID, kind: 'photo', photoId: rain.id, text: '雨中', photo: { ...rainSummary, note: '雨里的笔记' } },
      { id: ITEM_ID, kind: 'day', day: '2026-11-16', text: null },
      { id: ITEM_ID, kind: 'entry', entryId: words.id, text: null, entry: { ...(await summaryFor(alice, words.id)), photos: [] } }
    ]);
    for (const p of entryItems(saved)[0].entry?.photos ?? []) expect(p).not.toHaveProperty('note');
    expect(await detail(alice, t.id)).toEqual(saved);
  });

  it('names the first item that lacks an entryId or has a kind it does not know, and changes nothing', async () => {
    const mine = await entry(alice);
    const t = await collection(alice);
    await setItems(t.id, [{ kind: 'entry', entryId: mine.id }]);
    const cases: [Json[], string][] = [
      [[{ kind: 'entry' }], '第 1 个条目缺少 entryId'],
      [
        [
          { kind: 'text', text: '序' },
          { kind: 'day', day: '2026-11-16' },
          { kind: 'entry', entryId: '' }
        ],
        '第 3 个条目缺少 entryId'
      ],
      [
        [
          { kind: 'entry', entryId: mine.id },
          { kind: 'video', url: 'x' }
        ],
        '第 2 个条目的类型需要是 photo、text、day 或 entry'
      ],
      [[{ entryId: mine.id }], '第 1 个条目的类型需要是 photo、text、day 或 entry'],
      [[{ kind: 'entry', entryId: mine.id }, { kind: 'entry', text: '没有记录' }, { kind: 'video' }], '第 2 个条目缺少 entryId']
    ];
    for (const [items, message] of cases) {
      expect(expectStatus(await put(alice, t.id, items), 400), JSON.stringify(items)).toEqual({ error: 'invalid_input', message });
    }
    expect(entryItems(await detail(alice, t.id)).map((i) => i.entryId)).toEqual([mine.id]);
  });

  it('takes only its owner’s own entries, refusing someone else’s and missing ones', async () => {
    const mine = await entry(alice);
    const theirs = await entry(bob, { visibility: 'public' });
    const t = await collection(alice);
    for (const entryId of [theirs.id, 'en_missing']) {
      const res = await put(alice, t.id, [
        { kind: 'entry', entryId: mine.id },
        { kind: 'entry', entryId }
      ]);
      expect(expectStatus(res, 400), entryId).toEqual({ error: 'invalid_input', message: '记录必须是你自己的记录' });
    }
    expect((await detail(alice, t.id)).items).toEqual([]);
    expect(await rows('SELECT id FROM theme_items WHERE theme_id = ?1', t.id)).toEqual([]);
  });

  it('takes a caption of up to 5000 characters under an entry, an emoji counting as one', async () => {
    const e = await entry(alice);
    const t = await collection(alice);
    const max = THEME_ITEM_LIMITS.captionMax;
    const long = await put(alice, t.id, [{ kind: 'entry', entryId: e.id, text: '字'.repeat(max + 1) }]);
    expect(expectStatus(long, 400).error).toBe('invalid_input');
    expect((await detail(alice, t.id)).items).toEqual([]);
    const saved = await setItems(t.id, [{ kind: 'entry', entryId: e.id, text: '😀'.repeat(max) }]);
    expect(entryItems(saved).map((i) => i.text)).toEqual(['😀'.repeat(max)]);
  });

  it('checks the form of every item before whose entries they hold', async () => {
    const theirs = await entry(bob, { visibility: 'public' });
    const t = await collection(alice);
    const res = await put(alice, t.id, [{ kind: 'entry', entryId: theirs.id }, { kind: 'entry' }]);
    expect(expectStatus(res, 400).message).toBe('第 2 个条目缺少 entryId');
  });
});

describe('who sees an entry in a collection', () => {
  interface Cell {
    visibility: Visibility;
    status: EntryStatus;
    id: string;
    photo: PhotoDetail;
  }
  const key = (c: Cell) => `${c.visibility}/${c.status}`;
  /** The documented rule for others: finished entries, public or unlisted. */
  const othersOpen = (c: Cell) => c.visibility !== 'private' && c.status === 'published';

  let cells: Cell[];
  let t: ThemeDetail;
  let saved: ThemeDetail;
  beforeEach(async () => {
    cells = [];
    for (const visibility of VIS) {
      for (const status of STATUS) {
        const photo = await upload(alice, { title: `${visibility}/${status}` });
        const e = await entry(alice, { title: `${visibility}/${status}`, visibility, status, media: showing(photo) });
        cells.push({ visibility, status, id: e.id, photo });
      }
    }
    t = await collection(alice, { visibility: 'public' });
    // every entry under a caption naming it, between two paragraphs
    saved = await setItems(t.id, [
      { kind: 'text', text: '开头' },
      ...cells.map((c) => ({ kind: 'entry', entryId: c.id, text: key(c) })),
      { kind: 'text', text: '结尾' }
    ]);
  });

  /** What `viewer` should be given: every item in its place, an entry they may not open as null under its own caption. */
  async function itemsFor(viewer: Client, opens: (c: Cell) => boolean): Promise<ThemeItem[]> {
    const out: ThemeItem[] = [{ id: saved.items[0].id, kind: 'text', text: '开头' }];
    for (const [i, c] of cells.entries()) {
      const shown = opens(c) ? { ...(await summaryFor(viewer, c.id)), photos: await summaries(viewer, [c.photo]) } : null;
      out.push({ id: saved.items[i + 1].id, kind: 'entry', entryId: c.id, text: key(c), entry: shown });
    }
    out.push({ id: saved.items[cells.length + 1].id, kind: 'text', text: '结尾' });
    return out;
  }

  it('takes its owner’s drafts, archived and private entries, and shows the owner all of them', async () => {
    const all = await itemsFor(alice, () => true);
    expect(saved.items).toEqual(all);
    expect((await detail(alice, t.id)).items).toEqual(all);
  });

  it('shows others only the finished public and unlisted entries, and leaves the rest in place with their captions', async () => {
    expect(cells.filter(othersOpen).map(key)).toEqual(['public/published', 'unlisted/published']);
    for (const viewer of [bob, anon]) expect((await detail(viewer, t.id)).items).toEqual(await itemsFor(viewer, othersOpen));
  });
});

describe('the photos of an entry in a collection', () => {
  it('leave out what a reader may not open, and show its owner all of them, in the entry’s order', async () => {
    const hidden = await upload(alice, { visibility: 'private', note: '笔记' });
    const open = await upload(alice, { visibility: 'public', note: '笔记' });
    const linked = await upload(alice, { visibility: 'unlisted', note: '笔记' });
    const e = await entry(alice, { visibility: 'public', media: showing(hidden, open, linked) });
    const t = await collection(alice, { visibility: 'public' });
    await setItems(t.id, [{ kind: 'entry', entryId: e.id }]);
    const shown = async (viewer: Client) => entryItems(await detail(viewer, t.id))[0].entry as ThemeEntry;

    const own = await shown(alice);
    expect(own.photos).toEqual(await summaries(alice, [hidden, open, linked]));
    expect(own.photoIds).toEqual(ids([hidden, open, linked]));
    for (const viewer of [bob, anon]) {
      const seen = await shown(viewer);
      expect(seen.photos).toEqual(await summaries(viewer, [open, linked]));
      expect(seen.photoIds).toEqual(ids([open, linked]));
    }
  });

  it('do not name the collection on their own page, which lists only collections holding the photo itself', async () => {
    const photo = await upload(alice);
    const e = await entry(alice, { visibility: 'public', media: showing(photo) });
    const through = await collection(alice, { title: '经记录收录', visibility: 'public' });
    await setItems(through.id, [{ kind: 'entry', entryId: e.id }]);
    const direct = await collection(alice, { title: '直接收录', visibility: 'public' });
    await setItems(direct.id, [{ kind: 'photo', photoId: photo.id }]);
    for (const viewer of [alice, bob, anon]) {
      const page = expectStatus(await viewer.get<PhotoDetail>(`/api/photos/${photo.id}`), 200);
      expect(page.themes).toEqual([{ id: direct.id, title: '直接收录' }]);
    }
  });
});

describe('what a collection counts', () => {
  let t: ThemeDetail;
  beforeEach(async () => {
    const up = (visibility: Visibility) => upload(alice, { visibility });
    const add = async (visibility: Visibility, status: EntryStatus, photos: PhotoDetail[]) =>
      ({ kind: 'entry', entryId: (await entry(alice, { visibility, status, media: showing(...photos) })).id }) as const;
    const [lake, secret, link] = [await up('public'), await up('private'), await up('unlisted')];
    // the lake shows as a photo item and again inside the walk, which itself shows twice
    const walk = await add('public', 'published', [lake, secret, link]);
    t = await collection(alice, { visibility: 'public' });
    await setItems(t.id, [
      { kind: 'photo', photoId: lake.id },
      { kind: 'photo', photoId: secret.id },
      { kind: 'photo', photoId: link.id },
      walk,
      await add('unlisted', 'published', [await up('public')]),
      await add('private', 'published', [await up('public')]),
      await add('public', 'draft', [await up('public')]),
      await add('public', 'archived', [await up('public')]),
      await add('public', 'published', []),
      { kind: 'text', text: '再看一次' },
      walk,
      { kind: 'day', day: '2026-11-16' }
    ]);
  });

  it('counts for its owner every photo item, every entry item, and the photos of an entry each time it shows', async () => {
    // photos: 3 items + the walk's 3 twice + one in each of the other four entries that have photos
    const counts = { photoCount: 13, entryCount: 7 };
    expect(await detail(alice, t.id)).toMatchObject(counts);
    for (const query of ['mine=1', 'owner=alice', '']) {
      expect(await list(alice, query), query).toEqual([expect.objectContaining({ id: t.id, ...counts })]);
    }
  });

  it('counts for others only the photos and finished entries they may open, unlisted ones included', async () => {
    // photos: the lake and the unlisted photo as items, the same two in the walk twice, one in the unlisted entry
    const counts = { photoCount: 7, entryCount: 4 };
    for (const viewer of [bob, anon]) {
      expect(await detail(viewer, t.id)).toMatchObject(counts);
      for (const query of ['owner=alice', '']) {
        expect(await list(viewer, query), query).toEqual([expect.objectContaining({ id: t.id, ...counts })]);
      }
    }
  });

  it('counts what each reader is shown', async () => {
    for (const viewer of [alice, bob, anon]) {
      const d = await detail(viewer, t.id);
      const photos = d.items.map((i) =>
        i.kind === 'photo' ? Number(i.photo !== null) : i.kind === 'entry' ? (i.entry?.photos.length ?? 0) : 0
      );
      expect(d.photoCount).toBe(photos.reduce((a, b) => a + b, 0));
      expect(d.entryCount).toBe(entryItems(d).filter((i) => i.entry).length);
    }
  });
});

describe('a collection’s cover', () => {
  let hidden: PhotoDetail;
  let first: PhotoDetail;
  let last: PhotoDetail;
  let own: PhotoDetail;
  let diary: Json;
  let walk: Json;
  beforeEach(async () => {
    [hidden, first, last, own] = [
      await upload(alice, { visibility: 'private' }),
      await upload(alice),
      await upload(alice),
      await upload(alice)
    ];
    const second = await upload(alice);
    // only alice may open the diary; the walk is public, its first photo private
    diary = { kind: 'entry', entryId: (await entry(alice, { visibility: 'private', media: showing(own) })).id };
    walk = { kind: 'entry', entryId: (await entry(alice, { visibility: 'public', media: showing(hidden, first, second) })).id };
  });

  /** The cover `viewer` gets, the same in the detail and in the list, without a note. */
  async function coverOf(viewer: Client, themeId: string): Promise<string | null> {
    const d = await detail(viewer, themeId);
    expect((await list(viewer, 'owner=alice')).find((x) => x.id === themeId)?.cover).toEqual(d.cover);
    if (d.cover) expect(d.cover).not.toHaveProperty('note');
    return d.cover?.id ?? null;
  }

  it('is the first photo the reader may see in item order, an entry’s included, when none is chosen', async () => {
    const t = await collection(alice, { visibility: 'public' });
    await setItems(t.id, [{ kind: 'text', text: '序' }, diary, walk, { kind: 'photo', photoId: last.id }]);
    expect(await coverOf(alice, t.id)).toBe(own.id);
    // the diary is passed over, and in the walk the private photo
    for (const viewer of [bob, anon]) expect(await coverOf(viewer, t.id)).toBe(first.id);
  });

  it('is a photo item that comes before the entries', async () => {
    const t = await collection(alice, { visibility: 'public' });
    await setItems(t.id, [{ kind: 'photo', photoId: last.id }, diary, walk]);
    for (const viewer of [alice, bob, anon]) expect(await coverOf(viewer, t.id)).toBe(last.id);
  });

  it('is null for a reader while no item shows them a photo', async () => {
    const t = await collection(alice, { visibility: 'public' });
    const veiled = { kind: 'entry', entryId: (await entry(alice, { visibility: 'public', media: showing(hidden) })).id };
    await setItems(t.id, [diary, veiled, { kind: 'photo', photoId: hidden.id }]);
    expect(await coverOf(alice, t.id)).toBe(own.id);
    for (const viewer of [bob, anon]) expect(await coverOf(viewer, t.id)).toBeNull();
  });

  it('is the chosen photo when the reader may see it, and otherwise found in item order', async () => {
    const t = await collection(alice, { visibility: 'public', coverPhotoId: last.id });
    await setItems(t.id, [walk, { kind: 'photo', photoId: last.id }]);
    for (const viewer of [alice, bob, anon]) expect(await coverOf(viewer, t.id)).toBe(last.id);
    expectStatus(await alice.patch(`/api/themes/${t.id}`, { coverPhotoId: hidden.id }), 200);
    expect(await coverOf(alice, t.id)).toBe(hidden.id);
    for (const viewer of [bob, anon]) expect(await coverOf(viewer, t.id)).toBe(first.id);
  });
});

describe('a collection’s places', () => {
  it('are those of the photos it shows, an entry’s included, in the order they first appear, locations hidden left out', async () => {
    const place = async (name: string, lat: number) =>
      expectStatus(await alice.post('/api/pois', { name, category: '湖', lat, lng: 120.15 }), 201).poi.id as string;
    const [A, B, C, D, E, F] = [
      await place('甲', 30.21),
      await place('乙', 30.22),
      await place('丙', 30.23),
      await place('丁', 30.24),
      await place('戊', 30.25),
      await place('己', 30.26)
    ];
    const at = (poiId: string, meta: Json = {}) => upload(alice, { poiId, ...meta });
    const atA = await at(A);
    const atB = await at(B);
    const atC = await at(C, { geoPrivacy: 'hidden' });
    const atD = await at(D);
    const atE = await at(E, { visibility: 'private' });
    const atF = await at(F, { geoPrivacy: 'fuzzy' });
    const atD2 = await at(D);
    const holding = async (visibility: Visibility, photos: PhotoDetail[]) => ({
      kind: 'entry',
      entryId: (await entry(alice, { visibility, media: showing(...photos) })).id
    });
    const t = await collection(alice, { visibility: 'public' });
    await setItems(t.id, [
      { kind: 'text', text: '序' },
      await holding('public', [atB]),
      { kind: 'photo', photoId: atA.id },
      await holding('public', [atA, atC]),
      await holding('private', [atD]),
      { kind: 'photo', photoId: atE.id },
      await holding('unlisted', [atF]),
      { kind: 'photo', photoId: atD2.id }
    ]);
    expect(ids((await detail(alice, t.id)).pois)).toEqual([B, A, C, D, E, F]);
    // others: C's location is hidden, the private entry and the private photo are not shown, so D comes last
    for (const viewer of [bob, anon]) expect(ids((await detail(viewer, t.id)).pois)).toEqual([B, A, F, D]);
  });
});

describe('DELETE /api/themes/:id with entries', () => {
  it('leaves the entries it held as they were', async () => {
    const photo = await upload(alice);
    const e = await entry(alice, { visibility: 'public', media: showing(photo), tagIds: ['spring'] });
    const t = await collection(alice, { title: '要删的合集', visibility: 'public' });
    await setItems(t.id, [
      { kind: 'entry', entryId: e.id },
      { kind: 'entry', entryId: e.id }
    ]);
    const before = expectStatus(await alice.get<EntryDetail>(`/api/entries/${e.id}`), 200);
    expect(before.themes).toEqual([{ id: t.id, title: '要删的合集' }]);

    expect(expectStatus(await alice.del(`/api/themes/${t.id}`), 200)).toEqual({ ok: true });
    expect(await rows('SELECT id FROM theme_items WHERE theme_id = ?1', t.id)).toEqual([]);
    expect(expectStatus(await alice.get<EntryDetail>(`/api/entries/${e.id}`), 200)).toEqual({ ...before, themes: [] });
    expect(ids(expectStatus(await anon.get('/api/entries?owner=alice'), 200).entries)).toEqual([e.id]);
  });
});
