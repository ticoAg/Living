// Entries against real D1: docs/api/entries.md. Who sees what follows the documented rules (an entry's status narrows
// its visibility: others only ever see finished entries), never the implementation.

import { beforeEach, describe, expect, it } from 'vite-plus/test';
import {
  ENTRY_EXCERPT_MAX,
  type EntryDetail,
  type EntryStatus,
  type EntrySummary,
  type PhotoDetail,
  type PhotoSummary,
  type Poi,
  type ThemeDetail,
  type ThemeItem,
  type Visibility
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
const create = async (client: Client, body: Json): Promise<EntryDetail> =>
  expectStatus(await client.post('/api/entries', { occurredAt: AT, ...body }), 201).entry;
const list = async (client: Client, query = ''): Promise<EntrySummary[]> =>
  expectStatus(await client.get(`/api/entries${query ? `?${query}` : ''}`), 200).entries;
const rows = async (sql: string, ...params: unknown[]) =>
  (
    await platform.env.DB.prepare(sql)
      .bind(...params)
      .all()
  ).results;

/** updatedAt has a one-second resolution: set it instead of waiting. */
const OLD = '2020-01-01T00:00:00Z';
/** One of alice's collections (themes, docs/api/themes.md) holding `items`, with its updatedAt set to `at` when given. */
async function collection(title: string, visibility: Visibility, items: Json[], at?: string): Promise<string> {
  const id = expectStatus(await alice.post('/api/themes', { kind: 'topic', title, visibility }), 201).theme.id as string;
  expectStatus(await alice.put(`/api/themes/${id}/items`, { items }), 200);
  if (at) await platform.env.DB.prepare('UPDATE themes SET updated_at = ?1 WHERE id = ?2').bind(at, id).run();
  return id;
}
/** A collection item showing the entry. */
const holding = (e: EntryDetail, text?: string) => ({ kind: 'entry', entryId: e.id, text });

describe('POST /api/entries', () => {
  it('records a private, finished note from a text and a time alone', async () => {
    const e = await create(alice, { body: '今天练了一页字。' });
    expect(e.id).toMatch(/^en_/);
    expect(e).toMatchObject({
      ownerId: alice.me.id,
      ownerHandle: 'alice',
      type: 'note',
      title: null,
      body: '今天练了一页字。',
      excerpt: '今天练了一页字。',
      hasMore: false,
      occurredAt: AT,
      visibility: 'private',
      status: 'published',
      photoIds: [],
      tagIds: [],
      media: [],
      revision: 1
    });
    expect(e.createdAt).toBe(e.updatedAt);
    expect(await list(alice, 'mine=1')).toHaveLength(1);
  });

  it('keeps a day without a time, and fills in the seconds of one with a time', async () => {
    expect((await create(alice, { body: 'x', occurredAt: '2025-03-01' })).occurredAt).toBe('2025-03-01');
    expect((await create(alice, { body: 'x', occurredAt: '2025-03-01T07:15' })).occurredAt).toBe('2025-03-01T07:15:00');
  });

  it('needs a time, and something to say', async () => {
    expect((await alice.post('/api/entries', { body: '一句话' })).status).toBe(400);
    expect((await alice.post('/api/entries', { occurredAt: AT })).status).toBe(400);
    const empty = await alice.post('/api/entries', { occurredAt: AT, title: '  ', body: '\n\n', media: [] });
    expect(expectStatus(empty, 400).message).toBe('记录不能是空的：写点文字，或者加一张照片、一个附件');
    expect(await list(alice, 'mine=1')).toEqual([]);
  });

  it('shows its author’s photos in the given order, with captions, and needs nothing else', async () => {
    const [p1, p2] = [await upload(alice), await upload(alice)];
    const e = await create(alice, { media: [{ photoId: p2.id, caption: '第二张在前' }, { photoId: p1.id }] });
    expect(e.photoIds).toEqual([p2.id, p1.id]);
    expect(e.media.map((m) => [m.photoId, m.caption])).toEqual([
      [p2.id, '第二张在前'],
      [p1.id, null]
    ]);
    expect(e.media[0].photo).toMatchObject({ id: p2.id, variants: p2.variants });
    expect(e.media[0].photo).not.toHaveProperty('note');
  });

  it('refuses someone else’s photos and missing ones, and writes nothing', async () => {
    const mine = await upload(alice);
    const theirs = await upload(bob);
    for (const media of [[{ photoId: theirs.id }], [{ photoId: mine.id }, { photoId: 'ph_missing' }]]) {
      expect(expectStatus(await alice.post('/api/entries', { occurredAt: AT, body: 'x', media }), 400).message).toBe(
        '只能添加你自己的照片'
      );
    }
    expect(await list(alice, 'mine=1')).toEqual([]);
  });

  it('keeps presets and its author’s own tags, and drops the rest', async () => {
    const own = expectStatus(await alice.post('/api/tags', { name: '书法' }), 201).tag;
    const theirs = expectStatus(await bob.post('/api/tags', { name: '秘密' }), 201).tag;
    const e = await create(alice, { body: 'x', tagIds: [own.id, 'spring', theirs.id, 'ghost'] });
    expect([...e.tagIds].sort((a, b) => a.localeCompare(b))).toEqual([own.id, 'spring'].sort((a, b) => a.localeCompare(b)));
  });

  it('checks the fields', async () => {
    for (const body of [
      { type: 'diary' },
      { visibility: 'friends' },
      { status: 'deleted' },
      { media: 'ph_1' },
      { media: [{ id: 'ph_1' }] },
      { tagIds: 'spring' },
      { title: '字'.repeat(201) },
      { occurredAt: '2026-02-30' },
      { occurredAt: 'yesterday' }
    ]) {
      expect((await alice.post('/api/entries', { occurredAt: AT, body: 'x', ...body })).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('needs a session', async () => {
    expect((await anon.post('/api/entries', { occurredAt: AT, body: 'x' })).status).toBe(401);
  });
});

describe('GET /api/entries', () => {
  it('lists latest first; a day without a time comes after the timed entries of that day', async () => {
    const at = ['2026-11-15T09:00:00', '2026-11-16', '2026-11-16T07:00:00', '2026-11-16T21:00:00', '2025-01-01'];
    for (const occurredAt of at) await create(alice, { body: occurredAt, occurredAt });
    const got = await list(alice, 'mine=1');
    expect(got.map((e) => e.occurredAt)).toEqual([
      '2026-11-16T21:00:00',
      '2026-11-16T07:00:00',
      '2026-11-16',
      '2026-11-15T09:00:00',
      '2025-01-01'
    ]);
    expect(expectStatus(await alice.get('/api/entries?mine=1'), 200).truncated).toBe(false);
  });

  it('carries the start of the body, cut at a line break, and says when there is more', async () => {
    const body = `${'甲'.repeat(200)}\n${'乙'.repeat(200)}`;
    await create(alice, { body });
    const [e] = await list(alice, 'mine=1');
    expect(e).toMatchObject({ excerpt: '甲'.repeat(200), hasMore: true });
    expect(e).not.toHaveProperty('body');
    expect([...'甲'.repeat(200)].length).toBeLessThanOrEqual(ENTRY_EXCERPT_MAX);
  });

  it('needs a session for mine=1, and has nothing for an unknown owner', async () => {
    expect((await anon.get('/api/entries?mine=1')).status).toBe(401);
    await create(alice, { body: 'x', visibility: 'public' });
    expect(await list(anon, 'owner=nobody')).toEqual([]);
  });

  it('finds an owner whatever the case of the handle', async () => {
    await create(alice, { body: 'x', visibility: 'public' });
    expect(await list(anon, 'owner=ALICE')).toHaveLength(1);
  });

  it('lets anonymous public lists be cached briefly, and never a signed-in one', async () => {
    const pub = await anon.get('/api/entries');
    expect(pub.headers.get('cache-control')).toBe('public, max-age=30');
    expect((await alice.get('/api/entries?mine=1')).headers.get('cache-control')).toBe('private, no-store');
  });

  it('says how long the body is in code points, Markdown as written, 0 without one, wherever an entry is summed up', async () => {
    // 2 + 1 + 2 + 1 + 1 + 1: the emoji is one character; the line break and the Markdown count
    const long = await create(alice, { title: '标题不算', body: '**断桥**\n😀', visibility: 'public' });
    const none = await create(alice, { title: '只有标题', body: null, visibility: 'public' });
    const words = await create(alice, { body: 'a'.repeat(ENTRY_EXCERPT_MAX * 3), visibility: 'public' });
    const chars = (es: EntrySummary[]) => Object.fromEntries(es.map((e) => [e.id, e.chars]));
    const want = { [long.id]: 8, [none.id]: 0, [words.id]: ENTRY_EXCERPT_MAX * 3 };
    expect(chars(await list(alice, 'mine=1'))).toEqual(want);
    expect(chars(await list(anon, 'owner=alice'))).toEqual(want);
    expect([long.chars, none.chars, words.chars]).toEqual([8, 0, ENTRY_EXCERPT_MAX * 3]);
    expect(expectStatus(await anon.get(`/api/entries/${long.id}`), 200).chars).toBe(8);
    const t = await collection('合集', 'public', [holding(long)]);
    const item = (expectStatus(await anon.get(`/api/themes/${t}`), 200) as ThemeDetail).items[0] as Extract<ThemeItem, { kind: 'entry' }>;
    expect(item.entry?.chars).toBe(8);
  });
});

describe('type= on GET /api/entries', () => {
  const types = (es: EntrySummary[]) => es.map((e) => e.type);
  beforeEach(async () => {
    // one of each, a minute apart, the article the latest; and bob's public article
    const made = ['note', 'reading', 'practice', 'creation', 'trip', 'article'];
    for (const [i, type] of made.entries()) {
      await create(alice, { type, body: type, visibility: 'public', occurredAt: `2026-11-16T08:0${i}:00` });
    }
    await create(alice, { type: 'article', body: '草稿', visibility: 'public', status: 'draft', occurredAt: '2026-11-16T09:00:00' });
    await create(alice, { type: 'article', body: '私密', occurredAt: '2026-11-16T09:01:00' });
    await create(bob, { type: 'article', body: 'bob', visibility: 'public', occurredAt: '2026-11-16T09:02:00' });
  });

  it('keeps the entries of the types named, one or several, comma-separated, each counted once', async () => {
    expect(types(await list(anon, 'owner=alice&type=article'))).toEqual(['article']);
    expect(types(await list(anon, 'owner=alice&type=creation,article'))).toEqual(['article', 'creation']);
    expect(types(await list(anon, 'owner=alice&type=article,article'))).toEqual(['article']);
    expect(types(await list(anon, 'owner=alice&type=note,reading,practice,trip'))).toEqual(['trip', 'practice', 'reading', 'note']);
  });

  it('narrows what the viewer may see, and no more: every list the same way', async () => {
    // alice sees her draft and private articles too; anyone else her finished public one
    expect((await list(alice, 'mine=1&type=article')).map((e) => e.excerpt)).toEqual(['私密', '草稿', 'article']);
    expect((await list(alice, 'owner=alice&type=article')).map((e) => e.excerpt)).toEqual(['私密', '草稿', 'article']);
    expect((await list(bob, 'owner=alice&type=article')).map((e) => e.excerpt)).toEqual(['article']);
    // the unscoped list is everyone's finished public entries
    expect((await list(anon, 'type=article')).map((e) => e.excerpt)).toEqual(['bob', 'article']);
    // with a day range
    expect(await list(anon, 'owner=alice&type=article&from=2026-11-17')).toEqual([]);
    expect(types(await list(anon, 'owner=alice&type=article,note&to=2026-11-16'))).toEqual(['article', 'note']);
  });

  it('is no filter at all when empty', async () => {
    expect(await list(anon, 'owner=alice&type=')).toEqual(await list(anon, 'owner=alice'));
  });

  it('refuses a type it does not know, a trailing comma, and the wrong case', async () => {
    for (const type of ['poem', 'article,', ',article', 'Article', 'article;note', 'article, note']) {
      const res = await anon.get(`/api/entries?owner=alice&type=${encodeURIComponent(type)}`);
      expect(res.status, type).toBe(400);
      expect(res.body, type).toMatchObject({
        error: 'invalid_input',
        message: 'type 只能是 note / article / reading / practice / creation / trip，可以用逗号隔开几个'
      });
    }
  });
});

describe('located= on GET /api/entries (the map)', () => {
  const titles = (es: EntrySummary[]) => es.map((e) => e.title);
  beforeEach(async () => {
    const lake = expectStatus(await alice.post('/api/pois', { name: '西湖', category: '湖', lat: 30.25, lng: 120.15 }), 201).poi as Poi;
    const at = { lat: 30.26, lng: 120.16 };
    const photo = async (meta: Json) => (await upload(alice, { visibility: 'public', geoPrivacy: 'exact', ...meta })).id;
    const located = await photo(at);
    const atPlace = await photo({ poiId: lake.id });
    const unlisted = await photo({ ...at, visibility: 'unlisted' });
    const own = await photo({ ...at, visibility: 'private' });
    const nowhere = await photo({});
    const geoHidden = await photo({ ...at, geoPrivacy: 'hidden' });
    // a minute apart, the first the latest
    const made: [Client, Json][] = [
      [alice, { title: '有地点', visibility: 'public', poiId: lake.id }],
      [alice, { title: '照片有坐标', visibility: 'public', media: [{ photoId: nowhere }, { photoId: located }] }],
      [alice, { title: '照片在地点', visibility: 'public', media: [{ photoId: atPlace }] }],
      [alice, { title: '照片不进列表', visibility: 'public', media: [{ photoId: unlisted }] }],
      [alice, { title: '照片仅自己可见', visibility: 'public', media: [{ photoId: own }] }],
      [alice, { title: '照片没有位置', visibility: 'public', media: [{ photoId: nowhere }] }],
      [alice, { title: '照片的位置不公开', visibility: 'public', media: [{ photoId: geoHidden }] }],
      [alice, { title: '都没有', visibility: 'public' }],
      [alice, { title: '私密的有地点', poiId: lake.id }],
      [alice, { title: '草稿有地点', visibility: 'public', status: 'draft', poiId: lake.id }],
      [bob, { title: 'bob 有地点', visibility: 'public', poiId: lake.id }]
    ];
    for (const [i, [client, body]] of made.entries()) await create(client, { ...body, occurredAt: `2026-11-16T09:${String(59 - i)}:00` });
  });

  /** The entries a map can place from what the viewer is shown: by their place, else a photo's coordinates or place. */
  const placeable = async (client: Client, es: EntrySummary[]): Promise<EntrySummary[]> => {
    const ids = [...new Set(es.flatMap((e) => e.photoIds))];
    const photos: PhotoSummary[] = ids.length ? expectStatus(await client.get(`/api/photos?ids=${ids.join(',')}`), 200).photos : [];
    const at = new Set(photos.filter((p) => (p.lat !== null && p.lng !== null) || p.poiId).map((p) => p.id));
    return es.filter((e) => e.poi || e.photoIds.some((id) => at.has(id)));
  };

  it('keeps the entries with a place, or with a photo shown with its position, out of each list', async () => {
    // the unscoped list: everyone's finished public entries
    expect(titles(await list(anon, 'located=1'))).toEqual(['有地点', '照片有坐标', '照片在地点', '照片不进列表', 'bob 有地点']);
    // its author sees her own photos and where they are, so the entries holding them can be placed for her
    expect(titles(await list(alice, 'located=1'))).toEqual([
      '有地点',
      '照片有坐标',
      '照片在地点',
      '照片不进列表',
      '照片仅自己可见',
      '照片的位置不公开',
      'bob 有地点'
    ]);
    expect(titles(await list(alice, 'mine=1&located=1'))).toEqual([
      '有地点',
      '照片有坐标',
      '照片在地点',
      '照片不进列表',
      '照片仅自己可见',
      '照片的位置不公开',
      '私密的有地点',
      '草稿有地点'
    ]);
    expect(titles(await list(bob, 'owner=alice&located=1'))).toEqual(['有地点', '照片有坐标', '照片在地点', '照片不进列表']);
  });

  it('narrows to exactly what the viewer can place, and widens nothing', async () => {
    for (const [client, query] of [
      [anon, ''],
      [alice, ''],
      [alice, 'mine=1'],
      [bob, 'owner=alice'],
      [anon, 'owner=alice&type=note']
    ] as const) {
      const all = await list(client, query);
      const kept = await list(client, query ? `${query}&located=1` : 'located=1');
      expect(kept, query).toEqual(await placeable(client, all));
      expect(kept.length, query).toBeLessThan(all.length);
    }
  });

  it('takes 1 or true; anything else is no filter', async () => {
    const all = await list(anon);
    expect(await list(anon, 'located=true')).toEqual(await list(anon, 'located=1'));
    for (const v of ['0', 'false', '', 'yes']) expect(await list(anon, `located=${v}`), v).toEqual(all);
  });
});

describe('who sees an entry', () => {
  const VIS: Visibility[] = ['public', 'unlisted', 'private'];
  const STATUS: EntryStatus[] = ['published', 'draft', 'archived'];
  const matrix = VIS.flatMap((visibility) => STATUS.map((status) => ({ visibility, status, id: '' })));
  const key = (e: { visibility: string; status: string }) => `${e.visibility}/${e.status}`;

  beforeEach(async () => {
    for (const m of matrix) m.id = (await create(alice, { body: key(m), visibility: m.visibility, status: m.status })).id;
  });

  /** The documented rules: others see finished entries only; lists show public ones, a link opens unlisted ones too. */
  const inList = (m: (typeof matrix)[number]) => m.visibility === 'public' && m.status === 'published';
  const byLink = (m: (typeof matrix)[number]) => m.visibility !== 'private' && m.status === 'published';

  it('lists every entry for its author, and only finished public ones for anyone else', async () => {
    expect((await list(alice, 'owner=alice')).map(key).sort()).toEqual(matrix.map(key).sort());
    expect((await list(alice, 'mine=1')).map(key).sort()).toEqual(matrix.map(key).sort());
    for (const viewer of [bob, anon]) {
      expect((await list(viewer, 'owner=alice')).map(key)).toEqual(matrix.filter(inList).map(key));
    }
  });

  it('keeps the unscoped list to finished public entries, for the author too', async () => {
    for (const viewer of [alice, bob, anon]) expect((await list(viewer)).map(key)).toEqual(['public/published']);
  });

  it('opens by link what others may see, and answers 404 for the rest', async () => {
    for (const m of matrix) {
      expect((await alice.get(`/api/entries/${m.id}`)).status, key(m)).toBe(200);
      for (const viewer of [bob, anon]) expect((await viewer.get(`/api/entries/${m.id}`)).status, key(m)).toBe(byLink(m) ? 200 : 404);
    }
  });

  it('lets only its author change or delete it: 403 where others can see it, 404 where they cannot', async () => {
    for (const m of matrix) {
      const expected = byLink(m) ? 403 : 404;
      expect((await bob.patch(`/api/entries/${m.id}`, { title: '改' })).status, key(m)).toBe(expected);
      expect((await bob.del(`/api/entries/${m.id}`)).status, key(m)).toBe(expected);
      expect((await anon.patch(`/api/entries/${m.id}`, { title: '改' })).status, key(m)).toBe(401);
    }
    expect((await alice.get(`/api/entries/${matrix[0].id}`)).body.title).toBeNull();
  });

  it('counts tagged entries as the viewer may see them', async () => {
    const tag = expectStatus(await alice.post('/api/tags', { name: '书法' }), 201).tag;
    for (const m of matrix) expectStatus(await alice.patch(`/api/entries/${m.id}`, { tagIds: [tag.id] }), 200);
    const count = async (viewer: Client) =>
      (expectStatus(await viewer.get('/api/tags?owner=alice'), 200).tags as Json[]).find((t) => t.id === tag.id)?.entryCount;
    expect(await count(alice)).toBe(matrix.length);
    expect(await count(bob)).toBe(matrix.filter(inList).length);
    expect(await count(anon)).toBe(matrix.filter(inList).length);
    // a tag's own answer after an edit counts the same way
    expect(expectStatus(await alice.patch(`/api/tags/${tag.id}`, { name: '书法练习' }), 200).tag.entryCount).toBe(matrix.length);
  });

  it('counts on the profile the entries the viewer may see listed', async () => {
    const count = async (viewer: Client) => expectStatus(await viewer.get('/api/users/alice'), 200).entryCount;
    expect(await count(alice)).toBe(matrix.length);
    expect(await count(bob)).toBe(matrix.filter(inList).length);
    expect(await count(anon)).toBe(matrix.filter(inList).length);
  });
});

describe('photos in entries', () => {
  let open: PhotoDetail;
  let hidden: PhotoDetail;
  beforeEach(async () => {
    open = await upload(alice, { visibility: 'public' });
    hidden = await upload(alice, { visibility: 'private' });
  });

  it('shows others only the photos they may open, and leaves the rest out', async () => {
    const e = await create(alice, {
      body: 'x',
      visibility: 'public',
      media: [{ photoId: hidden.id }, { photoId: open.id, caption: '湖' }]
    });
    expect(e.photoIds).toEqual([hidden.id, open.id]);
    for (const viewer of [bob, anon]) {
      const seen = expectStatus(await viewer.get(`/api/entries/${e.id}`), 200) as EntryDetail;
      expect(seen.photoIds).toEqual([open.id]);
      expect(seen.media.map((m) => [m.photoId, m.caption])).toEqual([[open.id, '湖']]);
      expect((await list(viewer, 'owner=alice'))[0].photoIds).toEqual([open.id]);
    }
  });

  it('does not change a photo’s own visibility', async () => {
    await create(alice, { body: 'x', visibility: 'public', media: [{ photoId: hidden.id }] });
    expect((await bob.get(`/api/photos/${hidden.id}`)).status).toBe(404);
    expect((await bob.get(`/media/${hidden.variants.s.key}`)).status).toBe(404);
  });

  it('lists on a photo page the entries showing it that the viewer may see', async () => {
    const shared = await create(alice, { title: '断桥', visibility: 'public', media: [{ photoId: open.id }], occurredAt: '2026-05-02' });
    await create(alice, { body: '# 私下的话\n\n正文', media: [{ photoId: open.id }], occurredAt: '2026-05-03T10:00:00' });
    await create(alice, { visibility: 'public', status: 'draft', media: [{ photoId: open.id }] });
    const refs = async (viewer: Client) => (expectStatus(await viewer.get(`/api/photos/${open.id}`), 200) as PhotoDetail).entries;
    expect(await refs(alice)).toEqual([
      expect.objectContaining({ label: '随记', occurredAt: AT }),
      expect.objectContaining({ label: '私下的话', occurredAt: '2026-05-03T10:00:00' }),
      { id: shared.id, label: '断桥', occurredAt: '2026-05-02' }
    ]);
    expect(await refs(bob)).toEqual([{ id: shared.id, label: '断桥', occurredAt: '2026-05-02' }]);
    expect(await refs(anon)).toEqual([{ id: shared.id, label: '断桥', occurredAt: '2026-05-02' }]);
  });

  it('takes a deleted photo out of its entries and moves their revision on', async () => {
    const e = await create(alice, { body: 'x', media: [{ photoId: open.id }, { photoId: hidden.id }] });
    expectStatus(await alice.del(`/api/photos/${open.id}`), 200);
    const after = expectStatus(await alice.get(`/api/entries/${e.id}`), 200) as EntryDetail;
    expect(after.photoIds).toEqual([hidden.id]);
    expect(after.revision).toBe(2);
    expect(await rows('SELECT * FROM entry_media WHERE photo_id = ?1', open.id)).toEqual([]);
  });
});

describe('PATCH /api/entries/:id', () => {
  it('changes what is given, keeps the rest, and moves the revision on', async () => {
    const e = await create(alice, { body: '正文', tagIds: ['spring'] });
    const a = expectStatus(await alice.patch(`/api/entries/${e.id}`, { title: '标题', type: 'reading' }), 200).entry as EntryDetail;
    expect(a).toMatchObject({ title: '标题', type: 'reading', body: '正文', tagIds: ['spring'], revision: 2 });
    const b = expectStatus(await alice.patch(`/api/entries/${e.id}`, { status: 'archived', occurredAt: '2026-01-02' }), 200).entry;
    expect(b).toMatchObject({ status: 'archived', occurredAt: '2026-01-02', revision: 3 });
    expect(b.updatedAt >= e.updatedAt).toBe(true);
  });

  it('replaces the photos and the tags as a whole', async () => {
    const [p1, p2] = [await upload(alice), await upload(alice)];
    const e = await create(alice, { body: 'x', media: [{ photoId: p1.id }], tagIds: ['spring', 'winter'] });
    const a = expectStatus(
      await alice.patch(`/api/entries/${e.id}`, { media: [{ photoId: p2.id }, { photoId: p1.id, caption: '后' }] }),
      200
    ).entry;
    expect(a.media.map((m: Json) => [m.photoId, m.caption])).toEqual([
      [p2.id, null],
      [p1.id, '后']
    ]);
    const b = expectStatus(await alice.patch(`/api/entries/${e.id}`, { media: [], tagIds: [] }), 200).entry;
    expect(b).toMatchObject({ media: [], photoIds: [], tagIds: [] });
    const theirs = await upload(bob);
    expect((await alice.patch(`/api/entries/${e.id}`, { media: [{ photoId: theirs.id }] })).status).toBe(400);
  });

  it('will not leave an entry with nothing in it', async () => {
    const photo = await upload(alice);
    const e = await create(alice, { body: '只有正文' });
    expect(expectStatus(await alice.patch(`/api/entries/${e.id}`, { body: '' }), 400).message).toBe(
      '记录不能是空的：写点文字，或者加一张照片、一个附件'
    );
    expectStatus(await alice.patch(`/api/entries/${e.id}`, { body: '', media: [{ photoId: photo.id }] }), 200);
    expect(expectStatus(await alice.patch(`/api/entries/${e.id}`, { media: [] }), 400).message).toBe(
      '记录不能是空的：写点文字，或者加一张照片、一个附件'
    );
  });

  it('refuses an edit that started from an older revision, and changes nothing', async () => {
    const e = await create(alice, { body: '第一版' });
    expectStatus(await alice.patch(`/api/entries/${e.id}`, { body: '另一台设备上改的', revision: 1 }), 200);
    const stale = await alice.patch(`/api/entries/${e.id}`, { body: '旧窗口里的', revision: 1 });
    expect(expectStatus(stale, 409)).toMatchObject({ error: 'conflict', revision: 2 });
    expect((await alice.get(`/api/entries/${e.id}`)).body).toMatchObject({ body: '另一台设备上改的', revision: 2 });
    // without a revision the last write wins
    expectStatus(await alice.patch(`/api/entries/${e.id}`, { body: '不管了' }), 200);
    expect((await alice.get(`/api/entries/${e.id}`)).body).toMatchObject({ body: '不管了', revision: 3 });
  });

  it('answers 404 for an entry that is not there', async () => {
    expect((await alice.patch('/api/entries/en_missing', { title: 'x' })).status).toBe(404);
  });
});

describe('DELETE /api/entries/:id', () => {
  it('removes the entry with its photo links and tags, and keeps the photos', async () => {
    const photo = await upload(alice);
    const e = await create(alice, { body: 'x', media: [{ photoId: photo.id }], tagIds: ['spring'] });
    expect(expectStatus(await alice.del(`/api/entries/${e.id}`), 200)).toEqual({ ok: true });
    expect((await alice.get(`/api/entries/${e.id}`)).status).toBe(404);
    expect(await rows('SELECT * FROM entry_media WHERE entry_id = ?1', e.id)).toEqual([]);
    expect(await rows('SELECT * FROM entry_tags WHERE entry_id = ?1', e.id)).toEqual([]);
    expect((await alice.get(`/api/photos/${photo.id}`)).status).toBe(200);
  });

  it('takes a deleted tag off entries', async () => {
    const tag = expectStatus(await alice.post('/api/tags', { name: '读书' }), 201).tag;
    const e = await create(alice, { body: 'x', tagIds: [tag.id, 'spring'] });
    expectStatus(await alice.del(`/api/tags/${tag.id}`), 200);
    expect(((await alice.get(`/api/entries/${e.id}`)).body as EntryDetail).tagIds).toEqual(['spring']);
  });

  it('takes the entry out of every collection holding it, keeps the rest of them, and moves their updatedAt on', async () => {
    const photo = await upload(alice);
    const gone = await create(alice, { title: '要删的', visibility: 'public' });
    const kept = await create(alice, { title: '留下的', visibility: 'public' });
    const twice = await collection(
      '收了两次',
      'public',
      [
        holding(gone, '第一次'),
        { kind: 'text', text: '中间' },
        { kind: 'photo', photoId: photo.id },
        holding(kept),
        holding(gone, '第二次')
      ],
      OLD
    );
    const once = await collection('只收了它', 'private', [holding(gone)], OLD);
    const without = await collection('不收它', 'public', [holding(kept)], OLD);

    expect(expectStatus(await alice.del(`/api/entries/${gone.id}`), 200)).toEqual({ ok: true });
    const read = async (id: string) => expectStatus(await alice.get<ThemeDetail>(`/api/themes/${id}`), 200);
    const shape = (i: ThemeItem) =>
      i.kind === 'entry' ? `entry:${i.entryId}` : i.kind === 'photo' ? `photo:${i.photoId}` : `${i.kind}:${i.text}`;
    const a = await read(twice);
    expect(a.items.map(shape)).toEqual(['text:中间', `photo:${photo.id}`, `entry:${kept.id}`]);
    expect(a).toMatchObject({ title: '收了两次', entryCount: 1, photoCount: 1 });
    expect(a.updatedAt > OLD).toBe(true);
    const b = await read(once);
    expect(b.items).toEqual([]);
    expect(b.updatedAt > OLD).toBe(true);
    expect((await read(without)).updatedAt).toBe(OLD);
    expect(await rows('SELECT id FROM theme_items WHERE entry_id = ?1', gone.id)).toEqual([]);
  });
});

describe('collections holding an entry', () => {
  it('are listed for others when public, the latest changed first, and for its author all of theirs, each once', async () => {
    const e = await create(alice, { title: '断桥', visibility: 'public' });
    expect(e.themes).toEqual([]);
    const elsewhere = await create(alice, { title: '别的', visibility: 'public' });
    const older = await collection('早先的', 'public', [holding(e)], '2026-01-01T00:00:00Z');
    const secret = await collection('私下的', 'private', [holding(e)], '2026-02-01T00:00:00Z');
    const twice = await collection(
      '收了两次',
      'public',
      [holding(e, '一'), { kind: 'text', text: '中间' }, holding(e, '二')],
      '2026-03-01T00:00:00Z'
    );
    const linked = await collection('仅链接', 'unlisted', [holding(e)], '2026-04-01T00:00:00Z');
    await collection('不收它', 'public', [holding(elsewhere)], '2026-05-01T00:00:00Z');
    const themesOf = async (viewer: Client) => expectStatus(await viewer.get<EntryDetail>(`/api/entries/${e.id}`), 200).themes;

    expect(await themesOf(alice)).toEqual([
      { id: linked, title: '仅链接' },
      { id: twice, title: '收了两次' },
      { id: secret, title: '私下的' },
      { id: older, title: '早先的' }
    ]);
    // an unlisted collection is not given away from its entries
    for (const viewer of [bob, anon]) {
      expect(await themesOf(viewer)).toEqual([
        { id: twice, title: '收了两次' },
        { id: older, title: '早先的' }
      ]);
    }
  });
});

describe('the place of an entry', () => {
  let lake: Poi;
  let bridge: Poi;
  beforeEach(async () => {
    const place = async (client: Client, body: Json): Promise<Poi> =>
      expectStatus(await client.post('/api/pois', { lng: 120.15, city: '杭州市', ...body }), 201).poi;
    lake = await place(alice, { name: '西湖', category: '湖', lat: 30.25, district: '西湖区' });
    bridge = await place(alice, { name: '断桥', category: '桥', lat: 30.259 });
  });
  /** What an entry carries of its place (docs/api/entries.md): what a card shows and where it is, and nothing more. */
  const placed = (p: Poi) => ({ id: p.id, name: p.name, category: p.category, city: p.city, district: p.district, lat: p.lat, lng: p.lng });
  const ids = (items: { id: string }[]) => items.map((x) => x.id);

  it('is null until its author picks a place, and then that place: its id, name, category, city, district and position', async () => {
    expect((await create(alice, { body: 'x' })).poi).toBeNull();
    expect((await create(alice, { body: 'x', poiId: null })).poi).toBeNull();
    const e = await create(alice, { body: 'x', poiId: lake.id });
    const expected = { id: lake.id, name: '西湖', category: '湖', city: '杭州市', district: '西湖区', lat: 30.25, lng: 120.15 };
    expect(e.poi).toEqual(expected);
    expect(expectStatus(await alice.get<EntryDetail>(`/api/entries/${e.id}`), 200).poi).toEqual(expected);
    expect((await list(alice, 'mine=1'))[0].poi).toEqual(expected);
    expect((await create(alice, { body: 'x', poiId: bridge.id })).poi).toEqual({
      id: bridge.id,
      name: '断桥',
      category: '桥',
      city: '杭州市',
      district: null,
      lat: 30.259,
      lng: 120.15
    });
  });

  it('may be any place there is, someone else’s too, and must be given by its id', async () => {
    const theirs = expectStatus(await bob.post('/api/pois', { name: '孤山', category: '山', lat: 30.256, lng: 120.14 }), 201).poi as Poi;
    expect((await create(alice, { body: 'x', poiId: theirs.id })).poi).toEqual(placed(theirs));
    const before = await list(alice, 'mine=1');

    const missing = await alice.post('/api/entries', { occurredAt: AT, body: 'x', poiId: 'poi_missing' });
    expect(expectStatus(missing, 400)).toEqual({ error: 'invalid_input', message: '所选地点不存在' });
    for (const poiId of [42, true, {}, [lake.id], '', 'poi missing']) {
      const res = await alice.post('/api/entries', { occurredAt: AT, body: 'x', poiId });
      expect(res.status, JSON.stringify(poiId)).toBe(400);
      expect(res.body.error).toBe('invalid_input');
    }
    expect(await list(alice, 'mine=1')).toEqual(before);
  });

  it('is set, changed and cleared with PATCH, each time moving the revision on, and kept when not given', async () => {
    const e = await create(alice, { body: 'x' });
    const edit = async (body: Json) => expectStatus(await alice.patch(`/api/entries/${e.id}`, body), 200).entry as EntryDetail;
    const steps: [Json, Poi | null][] = [
      [{ poiId: lake.id }, lake],
      [{ poiId: bridge.id }, bridge],
      [{ title: '标题' }, bridge],
      [{ poiId: null }, null]
    ];
    for (const [i, [body, poi]] of steps.entries()) {
      const after = await edit(body);
      expect(after.poi, JSON.stringify(body)).toEqual(poi && placed(poi));
      expect(after.revision, JSON.stringify(body)).toBe(i + 2);
    }
    expect(expectStatus(await alice.get<EntryDetail>(`/api/entries/${e.id}`), 200)).toMatchObject({ poi: null, revision: 5 });
  });

  it('is not changed by a PATCH naming a place that is not there, or no place id at all', async () => {
    const e = await create(alice, { body: 'x', poiId: lake.id });
    const missing = await alice.patch(`/api/entries/${e.id}`, { poiId: 'poi_missing' });
    expect(expectStatus(missing, 400)).toEqual({ error: 'invalid_input', message: '所选地点不存在' });
    for (const poiId of [42, '', { id: bridge.id }]) {
      expect((await alice.patch(`/api/entries/${e.id}`, { poiId })).status, JSON.stringify(poiId)).toBe(400);
    }
    const now = expectStatus(await alice.get<EntryDetail>(`/api/entries/${e.id}`), 200);
    expect([now.poi, now.revision]).toEqual([placed(lake), 1]);
  });

  it('shows to whoever may see the entry, even a place of the author’s own in one of their privacy zones', async () => {
    // a place alice made, that no photo uses, inside a privacy zone of hers: shown all the same
    expectStatus(await alice.post('/api/privacy-zones', { name: '家', lat: 30.25, lng: 120.15, radius: 500 }), 201);
    const shown = await create(alice, { body: '公开的', visibility: 'public', poiId: lake.id });
    const linked = await create(alice, { body: '仅链接', visibility: 'unlisted', poiId: lake.id });
    for (const viewer of [bob, anon]) {
      for (const e of [shown, linked]) {
        expect(expectStatus(await viewer.get<EntryDetail>(`/api/entries/${e.id}`), 200).poi, e.body ?? '').toEqual(placed(lake));
      }
      expect((await list(viewer, 'owner=alice')).map((e) => e.poi)).toEqual([placed(lake)]);
      expect((await list(viewer)).map((e) => e.poi)).toEqual([placed(lake)]);
    }
  });

  it('lists with poi= the entries at that place: finished public ones for others, all of one’s own, latest first', async () => {
    const VIS: Visibility[] = ['public', 'unlisted', 'private'];
    const STATUS: EntryStatus[] = ['published', 'draft', 'archived'];
    const made: { id: string; owner: Client; visibility: Visibility; status: EntryStatus; occurredAt: string }[] = [];
    const add = async (owner: Client, visibility: Visibility, status: EntryStatus) => {
      // a different day for each, written down out of order
      const occurredAt = `2026-04-${10 + ((made.length * 7) % 13)}`;
      const e = await create(owner, { body: `${visibility}/${status}`, visibility, status, occurredAt, poiId: lake.id });
      made.push({ id: e.id, owner, visibility, status, occurredAt });
    };
    for (const visibility of VIS) for (const status of STATUS) await add(alice, visibility, status);
    await add(bob, 'public', 'published');
    await add(bob, 'private', 'draft');
    // elsewhere, and nowhere
    await create(alice, { body: '断桥', visibility: 'public', poiId: bridge.id });
    await create(alice, { body: '没有地点', visibility: 'public' });

    const latestFirst = (cells: typeof made) => [...cells].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map((c) => c.id);
    /** The documented rule: others see finished public entries; one's own, all of them. */
    const seenBy = (viewer: Client) => made.filter((c) => c.owner === viewer || (c.visibility === 'public' && c.status === 'published'));
    const at = async (viewer: Client, query = '') => ids(await list(viewer, `poi=${lake.id}${query}`));
    for (const viewer of [alice, bob, anon]) expect(await at(viewer)).toEqual(latestFirst(seenBy(viewer)));
    expect(latestFirst(seenBy(anon))).toHaveLength(2);
    // with other parameters, what both give
    expect(await at(alice, '&mine=1')).toEqual(latestFirst(made.filter((c) => c.owner === alice)));
    expect(await at(anon, '&owner=bob')).toEqual(latestFirst(seenBy(anon).filter((c) => c.owner === bob)));
    for (const e of await list(alice, `poi=${lake.id}`)) expect(e.poi).toEqual(placed(lake));
    expect(expectStatus(await anon.get(`/api/entries?poi=${bridge.id}`), 200).entries).toHaveLength(1);
    expect(expectStatus(await anon.get('/api/entries?poi=poi_missing'), 200)).toEqual({ entries: [], truncated: false });
  });

  it('comes with the entry wherever it is listed: an author’s entries, a project’s, and a collection’s entry items', async () => {
    const p = expectStatus(
      await alice.post('/api/projects', { title: '游湖', startDate: '2026-03-01', visibility: 'public' }),
      201
    ).project;
    const e = await create(alice, { body: 'x', visibility: 'public', poiId: lake.id, projectIds: [p.id] });
    const t = await collection('西湖', 'public', [holding(e)]);
    for (const viewer of [alice, bob, anon]) {
      expect((await list(viewer, 'owner=alice')).map((x) => x.poi)).toEqual([placed(lake)]);
      expect((await list(viewer, `project=${p.id}`)).map((x) => x.poi)).toEqual([placed(lake)]);
      const [item] = expectStatus(await viewer.get<ThemeDetail>(`/api/themes/${t}`), 200).items;
      expect(item.kind === 'entry' ? item.entry?.poi : item).toEqual(placed(lake));
    }
    expect((await list(alice, 'mine=1')).map((x) => x.poi)).toEqual([placed(lake)]);
  });

  it('stays when its entry is deleted', async () => {
    const e = await create(alice, { body: 'x', poiId: lake.id });
    expectStatus(await alice.del(`/api/entries/${e.id}`), 200);
    expect(expectStatus(await alice.get(`/api/pois/${lake.id}`), 200).poi).toMatchObject({ id: lake.id, name: '西湖' });
  });
});
