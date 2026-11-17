// Share links against real D1: docs/api/shares.md, with the share paragraph of docs/api/conventions.md#可见性 and the
// share bullets of docs/api/entries.md and docs/api/media.md. A browser that opened a link keeps it in a cookie and,
// while the link works, opens what it shares whatever its visibility; drafts, archived entries and hidden locations stay
// as they are. Expectations follow the documented rules, never the implementation.

import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { fuzz } from '../../shared/geo';
import {
  SHARE_LIMITS,
  type EntryDetail,
  type EntryStatus,
  type EntrySummary,
  type Milestone,
  type PhotoDetail,
  type ProjectDetail,
  type ShareKind,
  type ShareLink,
  type ThemeDetail,
  type ThemeItem
} from '../../shared/types';
import { Client, expectStatus, newUser, upload, usePlatform, type Json } from '../test-platform';

const platform = usePlatform();

/**
 * A browser that also keeps the share links it opened: the `living_shares` cookie the Worker sets goes back with every
 * request, as a real browser sends it (it is HttpOnly, so no page script ever sees it). `Client` carries the session only.
 */
class Browser extends Client {
  shares: string | null = null;

  override async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.shares && !headers.has('cookie')) {
      const session = this.cookie ? `living_session=${this.cookie}; ` : '';
      headers.set('cookie', `${session}living_shares=${this.shares}`);
    }
    const res = await super.fetch(path, { ...init, headers });
    for (const line of res.headers.getSetCookie()) {
      const m = /^living_shares=([^;]*)/.exec(line);
      if (m) this.shares = m[1] && !/max-age=0\b/i.test(line) ? m[1] : null;
    }
    return res;
  }
}

let alice: Client;
let bob: Client;
beforeEach(async () => {
  alice = await newUser(platform, 'alice', 'owner');
  bob = await newUser(platform, 'bob');
});

/** A browser with `client`'s session, or a visitor's. */
function browser(client?: Client): Browser {
  const b = new Browser(platform);
  b.cookie = client?.cookie ?? null;
  b.user = client?.user ?? null;
  return b;
}
/** Two browsers to open a link in: a visitor's, and bob's while he is signed in. */
const holders = (): Browser[] => [browser(), browser(bob)];
/** The same two people without the link. */
const strangers = (): Client[] => [new Client(platform), bob];

const AT = '2026-11-16T08:30:00';
const ULID = '[0-9A-HJKMNP-TV-Z]{26}';
/** 18 random bytes as base64url. */
const TOKEN = /^[A-Za-z0-9_-]{24}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const DAY = 86_400_000;
/** The links one browser holds at most (docs/api/shares.md#怎么生效). */
const HELD = 20;
/** The end of a link that has run out, set straight in D1: no test waits a day. */
const PAST = '2020-01-01T00:00:00Z';
const GONE = { error: 'not_found', message: '链接不存在或已失效' };
const NO_STORE = 'private, no-store';

const entry = async (client: Client, body: Json = {}): Promise<EntryDetail> =>
  expectStatus(await client.post('/api/entries', { occurredAt: AT, body: 'x', ...body }), 201).entry;
const collection = async (client: Client, body: Json = {}): Promise<ThemeDetail> =>
  expectStatus(await client.post('/api/themes', { kind: 'topic', title: '合集', ...body }), 201).theme;
const setItems = async (client: Client, themeId: string, items: Json[]) =>
  expectStatus(await client.put(`/api/themes/${themeId}/items`, { items }), 200);
const project = async (client: Client, body: Json = {}): Promise<ProjectDetail> =>
  expectStatus(await client.post('/api/projects', { title: '学书法', startDate: '2026-03-01', ...body }), 201).project;
/** One of alice's places. */
const place = async (name: string, lat: number): Promise<string> =>
  expectStatus(await alice.post('/api/pois', { name, category: '湖', lat, lng: 120.15 }), 201).poi.id;
/** An entry's `media` showing these photos, in this order. */
const showing = (...photos: PhotoDetail[]) => photos.map((p) => ({ photoId: p.id }));

const share = async (client: Client, kind: ShareKind, id: string, body: Json = {}): Promise<ShareLink> =>
  expectStatus(await client.post('/api/shares', { kind, id, ...body }), 201).share;
const shares = async (client: Client, query = ''): Promise<ShareLink[]> =>
  expectStatus(await client.get(`/api/shares${query ? `?${query}` : ''}`), 200).shares;
const opening = (b: Client, token: unknown) => b.post('/api/shares/open', { token });
/** Opens the link in `b`; it must work. */
const open = async (b: Browser, link: ShareLink): Promise<Json> => expectStatus(await opening(b, link.token), 200);
const expire = (link: ShareLink) =>
  platform.env.DB.prepare('UPDATE share_links SET expires_at = ?1 WHERE id = ?2').bind(PAST, link.id).run();
const rows = async (sql: string, ...params: unknown[]) =>
  (
    await platform.env.DB.prepare(sql)
      .bind(...params)
      .all()
  ).results;

const ids = (items: { id: string }[]) => items.map((x) => x.id);
const sorted = (items: string[]) => [...items].sort((a, b) => a.localeCompare(b));

/** `path` as `viewer` reads it through a link: there, and for that browser only. */
async function shared<T = Json>(viewer: Client, path: string): Promise<T> {
  const res = await viewer.get<T>(path);
  const body = expectStatus(res, 200);
  expect(res.headers.get('cache-control'), path).toBe(NO_STORE);
  return body;
}
/** The status `viewer` gets at `path`, an API answer or an image. */
const statusAt = async (viewer: Client, path: string): Promise<number> => (await viewer.fetch(path)).status;
/** Where a size of the photo is served (docs/api/media.md). */
const image = (p: PhotoDetail, size: 's' | 'm' | 'l' = 'm') => `/media/${p.variants[size].key}`;
/** Every size of the photo loads for `viewer`; a private photo's are kept out of shared caches. */
async function sizesLoad(viewer: Client, p: PhotoDetail): Promise<void> {
  for (const size of ['s', 'm', 'l'] as const) {
    const res = await viewer.fetch(image(p, size));
    expect(res.status, `${p.id} ${size}`).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    if (p.visibility === 'private') expect(res.headers.get('cache-control')).toBe(NO_STORE);
  }
}

describe('POST /api/shares', () => {
  it('makes a link to one’s own entry, collection or project, with an sl_ id and a token of 24 base64url characters', async () => {
    const items: [ShareKind, string, string][] = [
      ['entry', (await entry(alice, { title: '断桥' })).id, '断桥'],
      ['theme', (await collection(alice, { title: '西湖' })).id, '西湖'],
      ['project', (await project(alice, { title: '学书法' })).id, '学书法']
    ];
    for (const [kind, id, title] of items) {
      const s = await share(alice, kind, id);
      expect(s).toEqual({
        id: expect.stringMatching(new RegExp(`^sl_${ULID}$`)),
        token: expect.stringMatching(TOKEN),
        kind,
        targetId: id,
        targetTitle: title,
        createdAt: expect.stringMatching(UTC),
        expiresAt: null
      });
      expect(Math.abs(Date.parse(s.createdAt) - Date.now()), kind).toBeLessThan(60_000);
      expect(await shares(alice, `kind=${kind}&id=${id}`)).toEqual([s]);
    }
  });

  it('makes a new link, with a token of its own, each time', async () => {
    const e = await entry(alice);
    const [a, b] = [await share(alice, 'entry', e.id), await share(alice, 'entry', e.id)];
    expect(b.id).not.toBe(a.id);
    expect(b.token).not.toBe(a.token);
    expect(sorted(ids(await shares(alice)))).toEqual(sorted([a.id, b.id]));
  });

  it('needs a kind of entry, theme or project and an id, and writes nothing without them', async () => {
    const e = await entry(alice);
    for (const body of [
      { id: e.id },
      { kind: null, id: e.id },
      { kind: 'photo', id: e.id },
      { kind: 'Entry', id: e.id },
      { kind: 'entry' },
      { kind: 'entry', id: null },
      { kind: 'entry', id: '' },
      { kind: 'entry', id: 42 },
      { kind: 'entry', id: [e.id] }
    ]) {
      const res = await alice.post('/api/shares', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toBe('invalid_input');
    }
    expect(await rows('SELECT id FROM share_links')).toEqual([]);
  });

  it('answers 404 for someone else’s entry, collection or project, and for one that is not there', async () => {
    const mine = await entry(alice);
    const cases: [ShareKind, string][] = [
      ['entry', (await entry(bob, { visibility: 'public' })).id],
      ['theme', (await collection(bob, { visibility: 'public' })).id],
      ['project', (await project(bob, { visibility: 'public' })).id],
      ['entry', 'en_missing'],
      ['theme', 'th_missing'],
      ['project', 'pj_missing'],
      // one's own entry is no collection or project
      ['theme', mine.id],
      ['project', mine.id]
    ];
    for (const [kind, id] of cases) {
      const res = await alice.post('/api/shares', { kind, id });
      expect(res.status, `${kind} ${id}`).toBe(404);
      expect(res.body.error).toBe('not_found');
    }
    expect(await rows('SELECT id FROM share_links')).toEqual([]);
  });

  it('runs for a whole number of days from 1 to 365, or until deleted when the days are null or left out', async () => {
    const e = await entry(alice);
    for (const expiresInDays of [0, -1, 366, 1.5, '7', '', true, [7]]) {
      const res = await alice.post('/api/shares', { kind: 'entry', id: e.id, expiresInDays });
      expect(res.status, JSON.stringify(expiresInDays)).toBe(400);
      expect(res.body.error).toBe('invalid_input');
    }
    expect(await rows('SELECT id FROM share_links')).toEqual([]);
    expect((await share(alice, 'entry', e.id)).expiresAt).toBeNull();
    expect((await share(alice, 'entry', e.id, { expiresInDays: null })).expiresAt).toBeNull();
    for (const days of [1, 30, 365]) {
      const { expiresAt } = await share(alice, 'entry', e.id, { expiresInDays: days });
      expect(expiresAt, String(days)).toMatch(UTC);
      expect(Math.abs(Date.parse(expiresAt as string) - (Date.now() + days * DAY)), String(days)).toBeLessThan(60_000);
    }
  });

  it('takes at most 20 links an item, and another once one of them is deleted', async () => {
    const e = await entry(alice);
    const made: ShareLink[] = [];
    for (let i = 0; i < SHARE_LIMITS.perItem; i++) made.push(await share(alice, 'entry', e.id));
    expect(expectStatus(await alice.post('/api/shares', { kind: 'entry', id: e.id }), 400).error).toBe('invalid_input');
    expect(await shares(alice, `kind=entry&id=${e.id}`)).toHaveLength(SHARE_LIMITS.perItem);
    // the limit is per item
    await share(alice, 'entry', (await entry(alice)).id);
    expectStatus(await alice.del(`/api/shares/${made[0].id}`), 200);
    await share(alice, 'entry', e.id);
  });

  it('takes at most 500 links a person, whatever they share', async () => {
    const own: string[] = [];
    for (let i = 0; i < 25; i++) own.push((await entry(alice)).id);
    // all but one written straight to D1: 20 on each of the first 24 entries, 19 on the last
    const seeded = Array.from({ length: SHARE_LIMITS.perOwner - 1 }, (_, i) => ({
      id: `sl_seed${i}`,
      token: String(i).padStart(24, '0'),
      entryId: own[i % own.length]
    }));
    await platform.env.DB.prepare(
      `INSERT INTO share_links (id, token, owner_id, entry_id)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.token'), ?1, json_extract(value, '$.entryId') FROM json_each(?2)`
    )
      .bind(alice.me.id, JSON.stringify(seeded))
      .run();
    await share(alice, 'entry', own[24]);
    const res = await alice.post('/api/shares', { kind: 'project', id: (await project(alice)).id });
    expect(expectStatus(res, 400).error).toBe('invalid_input');
    expect(await rows('SELECT COUNT(*) AS n FROM share_links WHERE owner_id = ?1', alice.me.id)).toEqual([{ n: SHARE_LIMITS.perOwner }]);
    // the limit is per person
    await share(bob, 'entry', (await entry(bob)).id);
  });

  it('makes a link to a draft, which opens once the entry is finished', async () => {
    const e = await entry(alice, { status: 'draft' });
    const s = await share(alice, 'entry', e.id);
    const b = browser();
    expect(expectStatus(await opening(b, s.token), 404)).toEqual(GONE);
    expectStatus(await alice.patch(`/api/entries/${e.id}`, { status: 'published' }), 200);
    expect(await open(b, s)).toEqual({ kind: 'entry', id: e.id });
    expect((await shared<EntryDetail>(b, `/api/entries/${e.id}`)).id).toBe(e.id);
  });

  it('needs a session, as listing and deleting links do', async () => {
    const anon = new Client(platform);
    const e = await entry(alice);
    const s = await share(alice, 'entry', e.id);
    expect((await anon.post('/api/shares', { kind: 'entry', id: e.id })).status).toBe(401);
    expect((await anon.get('/api/shares')).status).toBe(401);
    expect((await anon.del(`/api/shares/${s.id}`)).status).toBe(401);
    expect(await shares(alice)).toEqual([s]);
  });
});

describe('GET /api/shares', () => {
  /** When the link was made, set straight in D1: the clock has a one-second resolution. */
  const made = (link: ShareLink, at: string) =>
    platform.env.DB.prepare('UPDATE share_links SET created_at = ?1 WHERE id = ?2').bind(at, link.id).run();

  it('lists one’s own links, the latest made first, those past their end too', async () => {
    const e = await entry(alice, { title: '断桥' });
    const a = await share(alice, 'entry', e.id);
    const b = await share(alice, 'theme', (await collection(alice)).id, { expiresInDays: 30 });
    const c = await share(alice, 'project', (await project(alice)).id);
    const d = await share(alice, 'entry', e.id);
    const theirs = await share(bob, 'entry', (await entry(bob)).id);
    await made(a, '2019-03-01T00:00:00Z');
    await made(b, '2019-01-01T00:00:00Z');
    await made(c, '2019-04-01T00:00:00Z');
    await made(d, '2019-02-01T00:00:00Z');
    await expire(b);
    expect(await shares(alice)).toEqual([
      { ...c, createdAt: '2019-04-01T00:00:00Z' },
      { ...a, createdAt: '2019-03-01T00:00:00Z' },
      { ...d, createdAt: '2019-02-01T00:00:00Z' },
      { ...b, createdAt: '2019-01-01T00:00:00Z', expiresAt: PAST }
    ]);
    expect(await shares(bob)).toEqual([theirs]);
  });

  it('lists the links of one item, the latest first, given its kind and id, which go together', async () => {
    const e = await entry(alice);
    const t = await collection(alice);
    const older = await share(alice, 'entry', e.id);
    const newer = await share(alice, 'entry', e.id);
    await made(older, '2019-01-01T00:00:00Z');
    await share(alice, 'entry', (await entry(alice)).id);
    const ofTheme = await share(alice, 'theme', t.id);
    const theirs = await entry(bob, { visibility: 'public' });
    await share(bob, 'entry', theirs.id);

    expect(ids(await shares(alice, `kind=entry&id=${e.id}`))).toEqual([newer.id, older.id]);
    expect(await shares(alice, `kind=theme&id=${t.id}`)).toEqual([ofTheme]);
    // an id of another kind, or someone else's item: none of one's own links
    expect(await shares(alice, `kind=theme&id=${e.id}`)).toEqual([]);
    expect(await shares(alice, `kind=entry&id=${theirs.id}`)).toEqual([]);
    for (const query of ['kind=entry', `id=${e.id}`, `kind=photo&id=${e.id}`]) {
      expect(expectStatus(await alice.get(`/api/shares?${query}`), 400).error, query).toBe('invalid_input');
    }
  });

  it('names each item as its owner sees it, an entry without a title by the start of its text or else by its type', async () => {
    const photo = await upload(alice, { visibility: 'private' });
    const titled = await entry(alice, { title: '断桥残雪', body: '雪后的断桥。' });
    const untitled = await entry(alice, { body: '沿着湖走了一圈。' });
    const bare = await entry(alice, { type: 'trip', body: null, media: showing(photo) });
    const t = await collection(alice, { title: '西湖十景' });
    const p = await project(alice, { title: '学书法' });
    const named = async (kind: ShareKind, id: string) => (await share(alice, kind, id)).targetTitle;
    expect(await named('entry', titled.id)).toBe('断桥残雪');
    expect(await named('entry', untitled.id)).toBe('沿着湖走了一圈。');
    expect(await named('entry', bare.id)).toBe('旅行');
    expect(await named('theme', t.id)).toBe('西湖十景');
    expect(await named('project', p.id)).toBe('学书法');
    // as they are named now
    expectStatus(await alice.patch(`/api/entries/${titled.id}`, { title: '断桥' }), 200);
    expectStatus(await alice.patch(`/api/themes/${t.id}`, { title: '西湖' }), 200);
    expectStatus(await alice.patch(`/api/projects/${p.id}`, { title: '练字' }), 200);
    const titles = Object.fromEntries((await shares(alice)).map((s) => [s.targetId, s.targetTitle]));
    expect(titles).toEqual({ [titled.id]: '断桥', [untitled.id]: '沿着湖走了一圈。', [bare.id]: '旅行', [t.id]: '西湖', [p.id]: '练字' });
  });
});

describe('DELETE /api/shares/:id', () => {
  it('deletes one’s own link, which stops working at once, in a browser that opened it too', async () => {
    const e = await entry(alice);
    const gone = await share(alice, 'entry', e.id);
    const kept = await share(alice, 'entry', e.id);
    const b = browser();
    await open(b, gone);
    await shared(b, `/api/entries/${e.id}`);
    expect(expectStatus(await alice.del(`/api/shares/${gone.id}`), 200)).toEqual({ ok: true });
    expect(await shares(alice)).toEqual([kept]);
    expect(await statusAt(b, `/api/entries/${e.id}`)).toBe(404);
    expect(expectStatus(await opening(browser(), gone.token), 404)).toEqual(GONE);
  });

  it('answers 404 for someone else’s link and one that is not there, and leaves the link working', async () => {
    const e = await entry(alice);
    const s = await share(alice, 'entry', e.id);
    for (const [client, id] of [
      [bob, s.id],
      [alice, 'sl_missing']
    ] as const) {
      const res = await client.del(`/api/shares/${id}`);
      expect(res.status, id).toBe(404);
      expect(res.body.error).toBe('not_found');
    }
    expect(await shares(alice)).toEqual([s]);
    await open(browser(), s);
    expectStatus(await alice.del(`/api/shares/${s.id}`), 200);
    expect((await alice.del(`/api/shares/${s.id}`)).status).toBe(404);
  });
});

describe('deleting what a link shares', () => {
  it('deletes the links of a deleted entry, collection or project, and keeps the others', async () => {
    const e = await entry(alice);
    const t = await collection(alice);
    const p = await project(alice);
    // a collection holding the entry keeps a link of its own
    const holder = await collection(alice, { title: '收着它' });
    await setItems(alice, holder.id, [{ kind: 'entry', entryId: e.id }]);
    const kept = await share(alice, 'theme', holder.id);
    const gone = [await share(alice, 'entry', e.id), await share(alice, 'theme', t.id), await share(alice, 'project', p.id)];

    expectStatus(await alice.del(`/api/entries/${e.id}`), 200);
    expectStatus(await alice.del(`/api/themes/${t.id}`), 200);
    expectStatus(await alice.del(`/api/projects/${p.id}`), 200);
    expect(await shares(alice)).toEqual([kept]);
    expect(await rows('SELECT id FROM share_links')).toEqual([{ id: kept.id }]);
    for (const s of gone) expect(expectStatus(await opening(browser(), s.token), 404), s.kind).toEqual(GONE);
    expect(await open(browser(), kept)).toEqual({ kind: 'theme', id: holder.id });
  });
});

describe('POST /api/shares/open', () => {
  it('opens a working link for anyone, signed in or not, naming what it shares, and keeps it in an HttpOnly cookie', async () => {
    const items: [ShareKind, string][] = [
      ['entry', (await entry(alice)).id],
      ['theme', (await collection(alice)).id],
      ['project', (await project(alice)).id]
    ];
    for (const [kind, id] of items) {
      for (const link of [await share(alice, kind, id), await share(alice, kind, id, { expiresInDays: 1 })]) {
        for (const b of holders()) {
          const res = await opening(b, link.token);
          expect(expectStatus(res, 200)).toEqual({ kind, id });
          const cookie = res.headers.getSetCookie().find((line) => line.startsWith('living_shares='));
          expect(cookie, kind).toMatch(/;\s*HttpOnly\b/i);
          expect(b.shares, kind).toContain(link.token);
        }
      }
    }
  });

  it('answers 404 for a token of the wrong form, one that is not there, and a deleted or expired link, and keeps none', async () => {
    const e = await entry(alice);
    const deleted = await share(alice, 'entry', e.id);
    expectStatus(await alice.del(`/api/shares/${deleted.id}`), 200);
    const expired = await share(alice, 'entry', e.id, { expiresInDays: 30 });
    await expire(expired);
    const live = await share(alice, 'entry', e.id);
    const b = browser();
    for (const token of [
      undefined,
      null,
      42,
      '',
      'abc',
      '!'.repeat(24),
      `${live.token}A`,
      live.token.slice(1),
      'A'.repeat(24),
      deleted.token,
      expired.token
    ]) {
      expect(expectStatus(await opening(b, token), 404), JSON.stringify(token)).toEqual(GONE);
    }
    expect(b.shares).toBeNull();
    expect(await open(b, live)).toEqual({ kind: 'entry', id: e.id });
  });

  it('answers 404 while the shared entry is a draft or archived, and opens it again once it is finished', async () => {
    const e = await entry(alice);
    const s = await share(alice, 'entry', e.id);
    for (const status of ['draft', 'archived', 'published'] as EntryStatus[]) {
      expectStatus(await alice.patch(`/api/entries/${e.id}`, { status }), 200);
      const res = await opening(browser(), s.token);
      if (status === 'published') expect(expectStatus(res, 200)).toEqual({ kind: 'entry', id: e.id });
      else expect(expectStatus(res, 404), status).toEqual(GONE);
    }
  });
});

describe('the share cookie', () => {
  /** alice's private entries, each with a link of its own. */
  let items: { entry: EntryDetail; link: ShareLink }[];
  beforeEach(async () => {
    items = [];
    for (let i = 0; i < HELD + 2; i++) {
      const e = await entry(alice, { title: `第 ${i} 条` });
      items.push({ entry: e, link: await share(alice, 'entry', e.id) });
    }
  });

  /** The positions in `items` of the links `b`'s cookie holds, in the order it holds them. */
  function held(b: Browser): number[] {
    const jar = b.shares ?? '';
    return items
      .map((x, i) => [jar.indexOf(x.link.token), i] as const)
      .filter(([at]) => at >= 0)
      .sort(([x], [y]) => x - y)
      .map(([, i]) => i);
  }
  /** The positions in `items` of the entries `b` may open. */
  async function opens(b: Browser): Promise<number[]> {
    const out: number[] = [];
    for (const [i, x] of items.entries()) if ((await b.get(`/api/entries/${x.entry.id}`)).status === 200) out.push(i);
    return out;
  }
  const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
  const down = (from: number, to: number) => range(from, to).reverse();

  it('holds the links opened last, the latest first, at most 20: one more lets the one opened longest ago go', async () => {
    const b = browser();
    for (const x of items.slice(0, HELD)) await open(b, x.link);
    expect(held(b)).toEqual(down(0, HELD));
    expect(await opens(b)).toEqual(range(0, HELD));
    // opened again, the first comes first
    await open(b, items[0].link);
    await open(b, items[HELD].link);
    await open(b, items[HELD + 1].link);
    expect(held(b)).toEqual([HELD + 1, HELD, 0, ...down(3, HELD)]);
    expect(await opens(b)).toEqual([0, ...range(3, HELD + 2)]);
  });

  it('lets the links that stopped working go when another is opened, so they take no room', async () => {
    const b = browser();
    for (const x of items.slice(0, HELD)) await open(b, x.link);
    expectStatus(await alice.del(`/api/shares/${items[5].link.id}`), 200);
    await expire(items[6].link);
    await open(b, items[HELD].link);
    await open(b, items[HELD + 1].link);
    expect(held(b)).toEqual([HELD + 1, HELD, ...down(7, HELD), ...down(0, 5)]);
    expect(await opens(b)).toEqual([...range(0, 5), ...range(7, HELD + 2)]);
  });
});

describe('a link to an entry', () => {
  let photo: Record<'secret' | 'open' | 'linked' | 'unseen' | 'blurred' | 'elsewhere', PhotoDetail>;
  let e: EntryDetail;
  let link: ShareLink;
  let lake: string;
  /** Where the photos with a location were taken, a few hundred metres from the place. */
  const SPOT = { lat: 30.2468, lng: 120.1505, heading: 95, alt: 12, city: '杭州市', district: '西湖区' };
  beforeEach(async () => {
    lake = await place('西湖', 30.25);
    const located = { ...SPOT, poiId: lake, poiMethod: 'confirmed', visibility: 'private' };
    photo = {
      secret: await upload(alice, { visibility: 'private', note: '只写给自己' }),
      open: await upload(alice, { visibility: 'public' }),
      linked: await upload(alice, { visibility: 'unlisted' }),
      // its location is alice's alone
      unseen: await upload(alice, { ...located, geoPrivacy: 'hidden' }),
      // others get it rounded
      blurred: await upload(alice, { ...located, geoPrivacy: 'fuzzy' }),
      // in no entry
      elsewhere: await upload(alice, { visibility: 'private' })
    };
    e = await entry(alice, {
      title: '私下的一天',
      body: '只给你看。',
      poiId: lake,
      media: [{ photoId: photo.secret.id, caption: '第一张' }, ...showing(photo.open, photo.linked, photo.unseen, photo.blurred)]
    });
    link = await share(alice, 'entry', e.id);
  });
  const inEntry = () => [photo.secret, photo.open, photo.linked, photo.unseen, photo.blurred];

  it('opens the private entry with all its photos for whoever holds the link, signed in or not, and for nobody else', async () => {
    for (const b of holders()) {
      await open(b, link);
      const seen = await shared<EntryDetail>(b, `/api/entries/${e.id}`);
      expect(seen).toMatchObject({ id: e.id, title: '私下的一天', body: '只给你看。', visibility: 'private', status: 'published' });
      expect(seen.photoIds).toEqual(ids(inEntry()));
      expect(seen.media.map((m) => [m.photoId, m.caption])).toEqual([
        [photo.secret.id, '第一张'],
        [photo.open.id, null],
        [photo.linked.id, null],
        [photo.unseen.id, null],
        [photo.blurred.id, null]
      ]);
      expect(seen.poi?.id).toBe(lake);
    }
    for (const viewer of strangers()) expect(await statusAt(viewer, `/api/entries/${e.id}`)).toBe(404);
  });

  it('opens its photos and their sizes, private ones too, and no other private photo of its owner', async () => {
    for (const b of holders()) {
      await open(b, link);
      for (const p of [photo.secret, photo.unseen, photo.blurred]) {
        expect((await shared<PhotoDetail>(b, `/api/photos/${p.id}`)).id).toBe(p.id);
        await sizesLoad(b, p);
      }
      for (const p of [photo.open, photo.linked]) expect(await statusAt(b, `/api/photos/${p.id}`)).toBe(200);
      expect(await statusAt(b, `/api/photos/${photo.elsewhere.id}`)).toBe(404);
      expect(await statusAt(b, image(photo.elsewhere))).toBe(404);
      // the original stays its owner's alone
      expect(await statusAt(b, `/media/o/${alice.me.id}/${photo.secret.id}.jpg`)).toBe(404);
    }
    expect(await statusAt(alice, `/media/o/${alice.me.id}/${photo.secret.id}.jpg`)).toBe(200);
    for (const viewer of strangers()) {
      for (const p of [photo.secret, photo.unseen]) {
        expect(await statusAt(viewer, `/api/photos/${p.id}`)).toBe(404);
        expect(await statusAt(viewer, image(p))).toBe(404);
      }
    }
  });

  it('gives locations as to anyone else: none for a photo that hides it, a rounded one for a fuzzy photo', async () => {
    for (const p of [photo.unseen, photo.blurred]) {
      const own = expectStatus(await alice.get<PhotoDetail>(`/api/photos/${p.id}`), 200);
      expect(own, p.geoPrivacy).toMatchObject({
        lat: SPOT.lat,
        lng: SPOT.lng,
        heading: SPOT.heading,
        poiId: lake,
        district: SPOT.district
      });
    }
    // docs/api/conventions.md#位置精度对非所有者
    const hidden = { lat: null, lng: null, heading: null, poiId: null, district: null };
    const rounded = { lat: fuzz(SPOT.lat), lng: fuzz(SPOT.lng), heading: null, poiId: lake, district: SPOT.district };
    for (const b of holders()) {
      await open(b, link);
      expect(await shared<PhotoDetail>(b, `/api/photos/${photo.unseen.id}`)).toMatchObject({
        ...hidden,
        alt: null,
        poi: null,
        poiDistance: null,
        poiMethod: null
      });
      expect(await shared<PhotoDetail>(b, `/api/photos/${photo.blurred.id}`)).toMatchObject({
        ...rounded,
        alt: null,
        poi: expect.objectContaining({ id: lake }),
        poiDistance: null,
        poiMethod: 'confirmed'
      });
      const { media } = await shared<EntryDetail>(b, `/api/entries/${e.id}`);
      expect(media.find((m) => m.photoId === photo.unseen.id)?.photo).toMatchObject(hidden);
      expect(media.find((m) => m.photoId === photo.blurred.id)?.photo).toMatchObject(rounded);
    }
  });

  it('opens nothing while the entry is a draft or archived, and all of it again once it is finished', async () => {
    const b = browser();
    await open(b, link);
    for (const status of ['draft', 'archived'] as EntryStatus[]) {
      expectStatus(await alice.patch(`/api/entries/${e.id}`, { status }), 200);
      for (const path of [`/api/entries/${e.id}`, `/api/photos/${photo.secret.id}`, image(photo.secret)]) {
        expect(await statusAt(b, path), `${status}: ${path}`).toBe(404);
      }
    }
    expectStatus(await alice.patch(`/api/entries/${e.id}`, { status: 'published' }), 200);
    await shared(b, `/api/entries/${e.id}`);
    await shared(b, `/api/photos/${photo.secret.id}`);
    await sizesLoad(b, photo.secret);
  });
});

describe('a link to a collection', () => {
  type Shot = 'item' | 'unseen' | 'cover' | 'diary' | 'walk' | 'draft' | 'archived' | 'elsewhere';
  let photo: Record<Shot, PhotoDetail>;
  let entries: Record<'diary' | 'walk' | 'draft' | 'archived' | 'elsewhere', EntryDetail>;
  let places: Record<'A' | 'B' | 'C' | 'D', string>;
  let t: ThemeDetail;
  let link: ShareLink;
  beforeEach(async () => {
    places = { A: await place('甲', 30.21), B: await place('乙', 30.22), C: await place('丙', 30.23), D: await place('丁', 30.24) };
    const up = (meta: Json = {}) => upload(alice, { visibility: 'private', ...meta });
    photo = {
      item: await up({ poiId: places.A }),
      unseen: await up({ poiId: places.B, geoPrivacy: 'hidden' }),
      cover: await up(),
      diary: await up({ poiId: places.C }),
      walk: await up(),
      draft: await up({ poiId: places.D }),
      archived: await up(),
      elsewhere: await up()
    };
    entries = {
      diary: await entry(alice, { title: '日记', media: showing(photo.diary) }),
      // public, with a private photo
      walk: await entry(alice, { title: '散步', visibility: 'public', media: showing(photo.walk) }),
      draft: await entry(alice, { title: '草稿', status: 'draft', media: showing(photo.draft) }),
      archived: await entry(alice, { title: '归档', status: 'archived', media: showing(photo.archived) }),
      elsewhere: await entry(alice, { title: '别处', media: showing(photo.elsewhere) })
    };
    t = await collection(alice, { title: '私下的合集', coverPhotoId: photo.cover.id });
    await setItems(alice, t.id, [
      { kind: 'text', text: '序' },
      { kind: 'photo', photoId: photo.item.id },
      { kind: 'photo', photoId: photo.unseen.id },
      { kind: 'entry', entryId: entries.diary.id },
      { kind: 'entry', entryId: entries.draft.id },
      { kind: 'entry', entryId: entries.archived.id },
      { kind: 'entry', entryId: entries.walk.id },
      { kind: 'day', day: '2026-11-16' }
    ]);
    link = await share(alice, 'theme', t.id);
  });

  /** An item as what it shows: a photo item its photo, an entry item its entry and that entry's photos; null when hidden. */
  const shown = (i: ThemeItem): string => {
    if (i.kind === 'photo') return `photo ${i.photo?.id ?? null}`;
    if (i.kind === 'entry') return `entry ${i.entry ? [i.entry.id, ...ids(i.entry.photos)].join(' ') : null}`;
    return i.kind;
  };

  it('opens the private collection with its photos, its cover and its finished entries, and counts what it shows', async () => {
    for (const b of holders()) {
      await open(b, link);
      const seen = await shared<ThemeDetail>(b, `/api/themes/${t.id}`);
      expect(seen.items.map(shown)).toEqual([
        'text',
        `photo ${photo.item.id}`,
        `photo ${photo.unseen.id}`,
        `entry ${entries.diary.id} ${photo.diary.id}`,
        'entry null',
        'entry null',
        `entry ${entries.walk.id} ${photo.walk.id}`,
        'day'
      ]);
      // the two photo items and the photo of each finished entry
      expect(seen).toMatchObject({ id: t.id, visibility: 'private', photoCount: 4, entryCount: 2 });
      expect(seen.cover?.id).toBe(photo.cover.id);
      // places of the photos it shows, but not of the one hiding its location
      expect(ids(seen.pois)).toEqual([places.A, places.C]);
    }
    for (const viewer of strangers()) expect(await statusAt(viewer, `/api/themes/${t.id}`)).toBe(404);
  });

  it('takes for its cover the first photo it shows, a private one too, when none is chosen', async () => {
    expectStatus(await alice.patch(`/api/themes/${t.id}`, { coverPhotoId: null }), 200);
    for (const b of holders()) {
      await open(b, link);
      expect((await shared<ThemeDetail>(b, `/api/themes/${t.id}`)).cover?.id).toBe(photo.item.id);
    }
  });

  it('opens the finished entries in it, but not its drafts, its archived entries or entries outside it', async () => {
    for (const b of holders()) {
      await open(b, link);
      for (const x of [entries.diary, entries.walk]) {
        expect(
          (await shared<EntryDetail>(b, `/api/entries/${x.id}`)).media.map((m) => m.photoId),
          x.title ?? ''
        ).toEqual(x.photoIds);
      }
      for (const x of [entries.draft, entries.archived, entries.elsewhere]) {
        expect(await statusAt(b, `/api/entries/${x.id}`), x.title ?? '').toBe(404);
      }
    }
  });

  it('opens the photos it shows: its photo items, its cover and the photos of its finished entries, and no others', async () => {
    for (const b of holders()) {
      await open(b, link);
      for (const p of [photo.item, photo.unseen, photo.cover, photo.diary, photo.walk]) {
        expect((await shared<PhotoDetail>(b, `/api/photos/${p.id}`)).id).toBe(p.id);
        await sizesLoad(b, p);
      }
      // photos only in a draft or an archived entry of it, or outside it
      for (const p of [photo.draft, photo.archived, photo.elsewhere]) {
        expect(await statusAt(b, `/api/photos/${p.id}`)).toBe(404);
        expect(await statusAt(b, image(p))).toBe(404);
      }
    }
  });
});

describe('a link to a project', () => {
  let p: ProjectDetail;
  let milestone: Milestone;
  let photo: Record<'older' | 'newer' | 'draft' | 'elsewhere', PhotoDetail>;
  let entries: Record<'older' | 'newer' | 'draft' | 'archived' | 'elsewhere', EntryDetail>;
  let link: ShareLink;
  beforeEach(async () => {
    p = await project(alice, { title: '私下的项目' });
    milestone = expectStatus(
      await alice.post(`/api/projects/${p.id}/milestones`, { title: '临完《兰亭序》', date: '2026-04-15' }),
      201
    ).milestone;
    const up = () => upload(alice, { visibility: 'private' });
    photo = { older: await up(), newer: await up(), draft: await up(), elsewhere: await up() };
    const inIt = { projectIds: [p.id] };
    entries = {
      older: await entry(alice, { ...inIt, occurredAt: '2026-04-01T10:00:00', media: showing(photo.older) }),
      // public, with a private photo
      newer: await entry(alice, { ...inIt, occurredAt: '2026-04-02T10:00:00', visibility: 'public', media: showing(photo.newer) }),
      draft: await entry(alice, { ...inIt, occurredAt: '2026-04-03T10:00:00', status: 'draft', media: showing(photo.draft) }),
      archived: await entry(alice, { ...inIt, occurredAt: '2026-04-04', status: 'archived' }),
      elsewhere: await entry(alice, { occurredAt: '2026-04-05', media: showing(photo.elsewhere) })
    };
    link = await share(alice, 'project', p.id);
  });

  it('opens the private project with its milestones, counting its finished entries and their photos', async () => {
    for (const b of holders()) {
      await open(b, link);
      const seen = await shared<ProjectDetail>(b, `/api/projects/${p.id}`);
      expect(seen).toMatchObject({
        id: p.id,
        visibility: 'private',
        entryCount: 2,
        dayCount: 2,
        photoCount: 2,
        lastOccurredAt: '2026-04-02T10:00:00'
      });
      expect(seen.cover?.id).toBe(photo.newer.id);
      expect(seen.milestones).toEqual([milestone]);
      expect(sorted(ids(seen.photos))).toEqual(sorted([photo.older.id, photo.newer.id]));
    }
    for (const viewer of strangers()) expect(await statusAt(viewer, `/api/projects/${p.id}`)).toBe(404);
  });

  it('lists with project= its finished entries, private ones too, latest first, for whoever holds the link', async () => {
    for (const b of holders()) {
      await open(b, link);
      const res = await b.get(`/api/entries?project=${p.id}`);
      const got = expectStatus(res, 200).entries as EntrySummary[];
      expect(res.headers.get('cache-control')).toBe(NO_STORE);
      expect(ids(got)).toEqual([entries.newer.id, entries.older.id]);
      expect(got.map((x) => x.photoIds)).toEqual([[photo.newer.id], [photo.older.id]]);
    }
    for (const viewer of strangers()) {
      expect(expectStatus(await viewer.get(`/api/entries?project=${p.id}`), 200)).toEqual({ entries: [], truncated: false });
    }
  });

  it('opens the finished entries in it and their photos, but not its drafts or entries outside it', async () => {
    for (const b of holders()) {
      await open(b, link);
      for (const [x, shot] of [
        [entries.older, photo.older],
        [entries.newer, photo.newer]
      ] as const) {
        expect((await shared<EntryDetail>(b, `/api/entries/${x.id}`)).media.map((m) => m.photoId)).toEqual([shot.id]);
        expect((await shared<PhotoDetail>(b, `/api/photos/${shot.id}`)).id).toBe(shot.id);
        await sizesLoad(b, shot);
      }
      for (const x of [entries.draft, entries.archived, entries.elsewhere]) expect(await statusAt(b, `/api/entries/${x.id}`)).toBe(404);
      for (const shot of [photo.draft, photo.elsewhere]) {
        expect(await statusAt(b, `/api/photos/${shot.id}`)).toBe(404);
        expect(await statusAt(b, image(shot))).toBe(404);
      }
    }
  });
});

describe('a link that is deleted or past its end', () => {
  it('stops opening what it shares at the next request, in the browser that holds it', async () => {
    const shot = await upload(alice, { visibility: 'private' });
    const e = await entry(alice, { media: showing(shot) });
    const t = await collection(alice);
    await setItems(alice, t.id, [{ kind: 'photo', photoId: shot.id }]);
    const p = await project(alice);
    const inProject = await entry(alice, { projectIds: [p.id], media: showing(shot) });
    const photoReads = [`/api/photos/${shot.id}`, image(shot)];
    const cases: [ShareKind, string, string[]][] = [
      ['entry', e.id, [`/api/entries/${e.id}`, ...photoReads]],
      ['theme', t.id, [`/api/themes/${t.id}`, ...photoReads]],
      ['project', p.id, [`/api/projects/${p.id}`, `/api/entries/${inProject.id}`, ...photoReads]]
    ];
    for (const end of ['deleted', 'expired'] as const) {
      for (const [kind, id, reads] of cases) {
        const link = await share(alice, kind, id);
        const b = end === 'deleted' ? browser() : browser(bob);
        await open(b, link);
        for (const path of reads) expect(await statusAt(b, path), `${kind}: ${path}`).toBe(200);
        if (end === 'deleted') expectStatus(await alice.del(`/api/shares/${link.id}`), 200);
        else await expire(link);
        for (const path of reads) expect(await statusAt(b, path), `${kind}, ${end}: ${path}`).toBe(404);
      }
    }
  });

  it('no longer lists the private entries of the project it shared', async () => {
    const p = await project(alice);
    const e = await entry(alice, { projectIds: [p.id] });
    for (const end of ['deleted', 'expired'] as const) {
      const link = await share(alice, 'project', p.id);
      const b = browser();
      await open(b, link);
      expect(ids(expectStatus(await b.get(`/api/entries?project=${p.id}`), 200).entries), end).toEqual([e.id]);
      if (end === 'deleted') expectStatus(await alice.del(`/api/shares/${link.id}`), 200);
      else await expire(link);
      expect(expectStatus(await b.get(`/api/entries?project=${p.id}`), 200), end).toEqual({ entries: [], truncated: false });
    }
  });
});

describe('whose content a link opens', () => {
  it('only its own owner’s, in a browser holding links of several owners', async () => {
    /** An owner's private entry with a private photo, and another private entry and photo that no link shares. */
    const content = async (owner: Client) => {
      const shot = await upload(owner, { visibility: 'private' });
      const stray = await upload(owner, { visibility: 'private' });
      return {
        shot,
        stray,
        diary: await entry(owner, { media: showing(shot) }),
        other: await entry(owner, { media: showing(stray) })
      };
    };
    const ofAlice = await content(alice);
    const ofBob = await content(bob);
    // alice shares a collection holding her diary, bob his diary itself
    const t = await collection(alice);
    await setItems(alice, t.id, [{ kind: 'entry', entryId: ofAlice.diary.id }]);
    const unshared = { theme: await collection(bob), project: await project(alice) };
    const b = browser();
    await open(b, await share(alice, 'theme', t.id));
    await open(b, await share(bob, 'entry', ofBob.diary.id));

    await shared(b, `/api/themes/${t.id}`);
    for (const x of [ofAlice, ofBob]) {
      await shared(b, `/api/entries/${x.diary.id}`);
      await shared(b, `/api/photos/${x.shot.id}`);
      await sizesLoad(b, x.shot);
      for (const path of [`/api/entries/${x.other.id}`, `/api/photos/${x.stray.id}`, image(x.stray)]) {
        expect(await statusAt(b, path), path).toBe(404);
      }
    }
    expect(await statusAt(b, `/api/themes/${unshared.theme.id}`)).toBe(404);
    expect(await statusAt(b, `/api/projects/${unshared.project.id}`)).toBe(404);
  });
});

describe('lists, for whoever holds a link', () => {
  it('are what they are without it: what the links share stays out of the author’s lists, map and profile', async () => {
    const tag = expectStatus(await alice.post('/api/tags', { name: '西湖' }), 201).tag.id as string;
    const secret = await upload(alice, { visibility: 'private', poiId: await place('西湖', 30.25), tagIds: [tag] });
    const pub = await upload(alice, { visibility: 'public' });
    const e = await entry(alice, { media: showing(secret, pub), tagIds: [tag] });
    const shownEntry = await entry(alice, { visibility: 'public', media: showing(pub) });
    const t = await collection(alice);
    await setItems(alice, t.id, [
      { kind: 'photo', photoId: secret.id },
      { kind: 'entry', entryId: e.id }
    ]);
    const publicTheme = await collection(alice, { title: '公开的', visibility: 'public' });
    await setItems(alice, publicTheme.id, [
      { kind: 'photo', photoId: pub.id },
      { kind: 'photo', photoId: secret.id },
      { kind: 'entry', entryId: e.id }
    ]);
    const p = await project(alice);
    const publicProject = await project(alice, { title: '公开的', visibility: 'public' });
    await entry(alice, { projectIds: [p.id, publicProject.id], media: showing(secret) });
    const links = [await share(alice, 'entry', e.id), await share(alice, 'theme', t.id), await share(alice, 'project', p.id)];

    const paths = [
      '/api/entries',
      '/api/entries?owner=alice',
      '/api/themes',
      '/api/themes?owner=alice',
      '/api/projects',
      '/api/projects?owner=alice',
      '/api/photos?owner=alice',
      '/api/pois',
      '/api/pois?owner=alice',
      '/api/tags?owner=alice',
      '/api/users/alice'
    ];
    for (const [holder, stranger] of [
      [browser(), new Client(platform)],
      [browser(bob), bob]
    ] as const) {
      for (const l of links) await open(holder, l);
      for (const path of paths)
        expect(expectStatus(await holder.get(path), 200), path).toEqual(expectStatus(await stranger.get(path), 200));
    }

    const holder = browser();
    for (const l of links) await open(holder, l);
    const list = async (path: string, key: string): Promise<{ id: string }[]> => expectStatus(await holder.get(path), 200)[key];
    expect(ids(await list('/api/entries?owner=alice', 'entries'))).toEqual([shownEntry.id]);
    expect(await list('/api/themes?owner=alice', 'themes')).toEqual([
      expect.objectContaining({ id: publicTheme.id, photoCount: 1, entryCount: 0 })
    ]);
    expect(await list('/api/projects?owner=alice', 'projects')).toEqual([
      expect.objectContaining({ id: publicProject.id, entryCount: 0, photoCount: 0 })
    ]);
    expect(ids(await list('/api/photos?owner=alice', 'photos'))).toEqual([pub.id]);
    expect(await list('/api/pois?owner=alice', 'pois')).toEqual([]);
  });
});
