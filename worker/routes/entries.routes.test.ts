// Entries against real D1: docs/api/entries.md. Who sees what follows the documented rules (an entry's status narrows
// its visibility: others only ever see finished entries), never the implementation.

import { beforeEach, describe, expect, it } from 'vite-plus/test';
import {
  ENTRY_EXCERPT_MAX,
  type EntryDetail,
  type EntryStatus,
  type EntrySummary,
  type PhotoDetail,
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
    expect(expectStatus(empty, 400).message).toBe('记录不能是空的：写点文字，或者加一张照片');
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
      '记录不能是空的：写点文字，或者加一张照片'
    );
    expectStatus(await alice.patch(`/api/entries/${e.id}`, { body: '', media: [{ photoId: photo.id }] }), 200);
    expect(expectStatus(await alice.patch(`/api/entries/${e.id}`, { media: [] }), 400).message).toBe(
      '记录不能是空的：写点文字，或者加一张照片'
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
});
