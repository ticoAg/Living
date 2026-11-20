// Projects against real D1: docs/api/projects.md, and how entries join them (`projectIds`, `GET /api/entries?project=`).
// Who sees what follows the documented rules (a project shows only the entries and photos its reader could open, and
// counts only the finished ones), never the implementation.

import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { MILESTONE_LIMITS, PROJECT_LIMITS } from '../../shared/limits';
import {
  PROJECT_STATUSES,
  PROJECT_TYPES,
  type EntryDetail,
  type EntryStatus,
  type EntrySummary,
  type Milestone,
  type PhotoDetail,
  type ProjectDetail,
  type ProjectSummary,
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

const START = '2026-03-01';
const AT = '2026-11-16T08:30:00';
const ULID = '[0-9A-HJKMNP-TV-Z]{26}';
const VIS: Visibility[] = ['public', 'unlisted', 'private'];

const create = async (client: Client, body: Json = {}): Promise<ProjectDetail> =>
  expectStatus(await client.post('/api/projects', { title: '学书法', startDate: START, ...body }), 201).project;
const list = async (client: Client, query = ''): Promise<ProjectSummary[]> =>
  expectStatus(await client.get(`/api/projects${query ? `?${query}` : ''}`), 200).projects;
const detail = async (client: Client, id: string): Promise<ProjectDetail> =>
  expectStatus(await client.get<ProjectDetail>(`/api/projects/${id}`), 200);
const patch = async (client: Client, id: string, body: Json): Promise<ProjectDetail> =>
  expectStatus(await client.patch(`/api/projects/${id}`, body), 200).project;
const msUrl = (projectId: string, milestoneId = '') => `/api/projects/${projectId}/milestones${milestoneId ? `/${milestoneId}` : ''}`;
const milestone = async (client: Client, projectId: string, body: Json = {}): Promise<Milestone> =>
  expectStatus(await client.post(msUrl(projectId), { title: '临完《兰亭序》', date: '2026-05-01', ...body }), 201).milestone;
const entry = async (client: Client, body: Json): Promise<EntryDetail> =>
  expectStatus(await client.post('/api/entries', { occurredAt: AT, body: 'x', ...body }), 201).entry;
const entries = async (client: Client, query: string): Promise<EntrySummary[]> =>
  expectStatus(await client.get(`/api/entries?${query}`), 200).entries;
const rows = async (sql: string, ...params: unknown[]) =>
  (
    await platform.env.DB.prepare(sql)
      .bind(...params)
      .all()
  ).results;
/** The projects an entry is linked to in D1, whoever may see them. */
const linked = async (entryId: string) =>
  sorted((await rows('SELECT project_id FROM entry_projects WHERE entry_id = ?1', entryId)).map((r) => String(r.project_id)));

/** updatedAt has a one-second resolution: set it back instead of waiting. */
const OLD = '2020-01-01T00:00:00Z';
const age = async (projectId: string, at = OLD) => {
  await platform.env.DB.prepare('UPDATE projects SET updated_at = ?1 WHERE id = ?2').bind(at, projectId).run();
};

const ids = (items: { id: string }[]) => items.map((x) => x.id);
const sorted = (items: string[]) => [...items].sort((a, b) => a.localeCompare(b));
/** Each photo once, in a fixed order: the documented `photos` is a set of photos, in no stated order. */
const photoSet = (photos: { id: string }[]) => sorted([...new Set(ids(photos))]);

describe('POST /api/projects', () => {
  it('starts a private, active project of type other from a title and a start day alone', async () => {
    const p = await create(alice);
    expect(p.id).toMatch(new RegExp(`^pj_${ULID}$`));
    expect(p).toMatchObject({
      ownerId: alice.me.id,
      ownerHandle: 'alice',
      type: 'other',
      title: '学书法',
      description: null,
      startDate: START,
      endDate: null,
      status: 'active',
      visibility: 'private',
      entryCount: 0,
      dayCount: 0,
      photoCount: 0,
      lastOccurredAt: null,
      cover: null,
      milestones: [],
      photos: []
    });
    expect(p.createdAt).toBe(p.updatedAt);
    expect(ids(await list(alice, 'mine=1'))).toEqual([p.id]);
  });

  it('keeps the type, description, end day, status and visibility it is given', async () => {
    const p = await create(alice, {
      type: 'reading',
      description: '每月读两本。',
      endDate: '2026-12-31',
      status: 'paused',
      visibility: 'unlisted'
    });
    expect(p).toMatchObject({
      type: 'reading',
      description: '每月读两本。',
      startDate: START,
      endDate: '2026-12-31',
      status: 'paused',
      visibility: 'unlisted'
    });
    for (const type of PROJECT_TYPES) expect((await create(alice, { type })).type).toBe(type);
    for (const status of PROJECT_STATUSES) expect((await create(alice, { status })).status).toBe(status);
  });

  it('trims the title and turns each run of spaces inside it into one', async () => {
    expect((await create(alice, { title: '  一年   读完  二十四史 ' })).title).toBe('一年 读完 二十四史');
  });

  it('takes a title of 100 characters, a Chinese character or an emoji counting as one', async () => {
    const max = PROJECT_LIMITS.titleMax;
    expect((await create(alice, { title: ` ${'字'.repeat(max)} ` })).title).toBe('字'.repeat(max));
    expect((await create(alice, { title: '😀'.repeat(max) })).title).toBe('😀'.repeat(max));
    expect((await alice.post('/api/projects', { title: '字'.repeat(max + 1), startDate: START })).status).toBe(400);
  });

  it('needs a title and a start day, and writes nothing without them', async () => {
    for (const body of [
      { startDate: START },
      { title: '   ', startDate: START },
      { title: '学书法' },
      { title: '学书法', startDate: '' }
    ]) {
      const res = await alice.post('/api/projects', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toBe('invalid_input');
    }
    expect(await rows('SELECT id FROM projects')).toEqual([]);
  });

  it('checks the fields, and writes nothing when one is wrong', async () => {
    for (const body of [
      { title: '字'.repeat(PROJECT_LIMITS.titleMax + 1) },
      { startDate: '2026-02-30' },
      { startDate: '2026/03/01' },
      { startDate: '2026-03-01T08:00:00' },
      { endDate: '2026-04-31' },
      { endDate: 'someday' },
      // the day before the start
      { endDate: '2026-02-28' },
      { type: 'hobby' },
      { status: 'done' },
      { visibility: 'friends' },
      { description: '字'.repeat(PROJECT_LIMITS.descriptionMax + 1) }
    ]) {
      const res = await alice.post('/api/projects', { title: '学书法', startDate: START, ...body });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await rows('SELECT id FROM projects')).toEqual([]);
  });

  it('lets the end be the start day, and reads null or an empty end day as none', async () => {
    expect((await create(alice, { endDate: START })).endDate).toBe(START);
    expect((await create(alice, { endDate: null })).endDate).toBeNull();
    expect((await create(alice, { endDate: '' })).endDate).toBeNull();
  });

  it('keeps the description as Markdown, by the rules of an entry’s body', async () => {
    const p = await create(alice, { description: '\n\n　　每天临一页《兰亭序》。\n\n- 先楷后行  \n\n' });
    expect(p.description).toBe('　　每天临一页《兰亭序》。\n\n- 先楷后行');
    expect((await create(alice, { description: ' \n\t\n ' })).description).toBeNull();
    const longest = '字'.repeat(PROJECT_LIMITS.descriptionMax);
    expect((await create(alice, { description: longest })).description).toBe(longest);
  });

  it('needs a session', async () => {
    expect((await anon.post('/api/projects', { title: '学书法', startDate: START })).status).toBe(401);
    expect(await rows('SELECT id FROM projects')).toEqual([]);
  });
});

describe('GET /api/projects', () => {
  let own: Record<Visibility, ProjectDetail>;
  let bobs: { public: ProjectDetail; private: ProjectDetail };
  beforeEach(async () => {
    own = {
      public: await create(alice, { title: '学书法', visibility: 'public' }),
      unlisted: await create(alice, { title: '练琴', visibility: 'unlisted' }),
      private: await create(alice, { title: '减重', visibility: 'private' })
    };
    bobs = { public: await create(bob, { title: '读书', visibility: 'public' }), private: await create(bob, { title: '日记' }) };
  });

  it('lists everyone’s public projects when unscoped, and only those, for their authors too', async () => {
    for (const viewer of [alice, bob, anon]) {
      const got = await list(viewer);
      expect(sorted(ids(got))).toEqual(sorted([own.public.id, bobs.public.id]));
      expect(got.find((p) => p.id === bobs.public.id)).toMatchObject({ ownerId: bob.me.id, ownerHandle: 'bob', title: '读书' });
    }
  });

  it('lists every project of an author for them, and only the public ones for anyone else', async () => {
    expect(sorted(ids(await list(alice, 'owner=alice')))).toEqual(sorted(VIS.map((v) => own[v].id)));
    for (const viewer of [bob, anon]) expect(ids(await list(viewer, 'owner=alice'))).toEqual([own.public.id]);
    expect(sorted(ids(await list(bob, 'owner=bob')))).toEqual(sorted([bobs.public.id, bobs.private.id]));
    expect(ids(await list(alice, 'owner=bob'))).toEqual([bobs.public.id]);
  });

  it('lists all of one’s own projects with mine=1, which needs a session', async () => {
    expect(sorted(ids(await list(alice, 'mine=1')))).toEqual(sorted(VIS.map((v) => own[v].id)));
    expect(sorted(ids(await list(bob, 'mine=1')))).toEqual(sorted([bobs.public.id, bobs.private.id]));
    expect((await anon.get('/api/projects?mine=1')).status).toBe(401);
  });

  it('has nothing for an unknown owner', async () => {
    for (const viewer of [alice, anon]) expect(await list(viewer, 'owner=nobody')).toEqual([]);
  });

  it('never hides a project for its status', async () => {
    const paused = await create(alice, { title: '暂停的', visibility: 'public', status: 'paused' });
    const done = await create(alice, { title: '做完的', visibility: 'public', status: 'completed' });
    const shown = [own.public.id, paused.id, done.id];
    for (const viewer of [bob, anon]) {
      expect(sorted(ids(await list(viewer, 'owner=alice')))).toEqual(sorted(shown));
      expect(sorted(ids(await list(viewer)))).toEqual(sorted([...shown, bobs.public.id]));
      for (const p of [paused, done]) expect((await viewer.get(`/api/projects/${p.id}`)).status).toBe(200);
      expect(expectStatus(await viewer.get('/api/users/alice'), 200).projectCount).toBe(shown.length);
    }
  });

  it('lists the most recently changed first', async () => {
    await age(own.public.id, '2020-01-02T00:00:00Z');
    await age(own.unlisted.id, '2020-01-03T00:00:00Z');
    await age(own.private.id, '2020-01-01T00:00:00Z');
    const order = async () => ids(await list(alice, 'mine=1'));
    expect(await order()).toEqual([own.unlisted.id, own.public.id, own.private.id]);
    await patch(alice, own.private.id, { status: 'paused' });
    expect(await order()).toEqual([own.private.id, own.unlisted.id, own.public.id]);
  });

  it('lets anonymous lists be cached briefly, and never a signed-in one', async () => {
    for (const query of ['', '?owner=alice']) {
      expect((await anon.get(`/api/projects${query}`)).headers.get('cache-control'), query).toBe('public, max-age=30');
    }
    for (const query of ['', '?owner=alice', '?mine=1']) {
      expect((await alice.get(`/api/projects${query}`)).headers.get('cache-control'), query).toBe('private, no-store');
    }
  });

  it('counts on a profile the projects the viewer may see listed', async () => {
    const count = async (viewer: Client, handle: string) => expectStatus(await viewer.get(`/api/users/${handle}`), 200).projectCount;
    expect(await count(alice, 'alice')).toBe(3);
    expect(await count(bob, 'alice')).toBe(1);
    expect(await count(anon, 'alice')).toBe(1);
    expect(await count(bob, 'bob')).toBe(2);
    expect(await count(alice, 'bob')).toBe(1);
  });
});

describe('GET /api/projects/:id', () => {
  it('opens a public or unlisted project for anyone, and a private one for its author only', async () => {
    for (const visibility of VIS) {
      const p = await create(alice, { visibility });
      expect((await detail(alice, p.id)).visibility).toBe(visibility);
      for (const viewer of [bob, anon]) {
        expect((await viewer.get(`/api/projects/${p.id}`)).status, visibility).toBe(visibility === 'private' ? 404 : 200);
      }
    }
    expect((await alice.get('/api/projects/pj_missing')).status).toBe(404);
  });

  it('lists the milestones by day, and those of one day in the order they were added', async () => {
    const p = await create(alice, { visibility: 'public' });
    const june1 = await milestone(alice, p.id, { title: '乙', date: '2026-06-01' });
    const march = await milestone(alice, p.id, { title: '三月', date: '2026-03-01' });
    const june2 = await milestone(alice, p.id, { title: '甲', date: '2026-06-01' });
    const january = await milestone(alice, p.id, { title: '一月', date: '2026-01-15' });
    const june3 = await milestone(alice, p.id, { title: '丙', date: '2026-06-01' });
    const order = [january.id, march.id, june1.id, june2.id, june3.id];
    for (const viewer of [alice, bob, anon]) expect(ids((await detail(viewer, p.id)).milestones)).toEqual(order);
  });
});

describe('what a project counts and shows', () => {
  type Key = 'lake' | 'unlisted' | 'hidden' | 'bridge' | 'inPrivate' | 'inDraft' | 'inArchived';
  let project: ProjectDetail;
  let photo: Record<Key, PhotoDetail>;
  beforeEach(async () => {
    project = await create(alice, { visibility: 'public' });
    const up = (visibility: Visibility) => upload(alice, { visibility, note: '只写给自己' });
    photo = {
      lake: await up('public'),
      unlisted: await up('unlisted'),
      hidden: await up('private'),
      bridge: await up('public'),
      inPrivate: await up('public'),
      inDraft: await up('public'),
      inArchived: await up('public')
    };
    const add = (occurredAt: string, visibility: Visibility, status: EntryStatus, shown: PhotoDetail[]) =>
      entry(alice, { occurredAt, visibility, status, media: shown.map((p) => ({ photoId: p.id })), projectIds: [project.id] });
    // 1 April twice, with a time and without one, both showing the lake
    await add('2026-04-01T10:00:00', 'public', 'published', [photo.lake, photo.unlisted]);
    await add('2026-04-01', 'unlisted', 'published', [photo.lake]);
    // a private photo before a public one
    await add('2026-04-02T10:00:00', 'public', 'published', [photo.hidden, photo.bridge]);
    // only the author may open this one
    await add('2026-04-03T10:00:00', 'private', 'published', [photo.inPrivate]);
    // never counted, by anyone
    await add('2026-04-04T10:00:00', 'public', 'draft', [photo.inDraft]);
    await add('2026-04-05', 'public', 'archived', [photo.inArchived]);
  });

  it('counts for its author every finished entry of theirs in it, the days they happened on, and their photos once each', async () => {
    const counts = { entryCount: 4, dayCount: 3, photoCount: 5, lastOccurredAt: '2026-04-03T10:00:00' };
    expect(await detail(alice, project.id)).toMatchObject(counts);
    expect(await list(alice, 'mine=1')).toEqual([expect.objectContaining(counts)]);
  });

  it('counts for others only the finished entries they may open, and of those the photos they may open', async () => {
    const counts = { entryCount: 3, dayCount: 2, photoCount: 3, lastOccurredAt: '2026-04-02T10:00:00' };
    for (const viewer of [bob, anon]) {
      expect(await detail(viewer, project.id)).toMatchObject(counts);
      expect(await list(viewer, 'owner=alice')).toEqual([expect.objectContaining(counts)]);
      expect(await list(viewer)).toEqual([expect.objectContaining(counts)]);
    }
  });

  it('takes as cover the first photo the viewer may open of the latest entry with one, without its note', async () => {
    const own = await detail(alice, project.id);
    expect(own.cover?.id).toBe(photo.inPrivate.id);
    expect(own.cover).not.toHaveProperty('note');
    for (const viewer of [bob, anon]) {
      const seen = await detail(viewer, project.id);
      expect(seen.cover?.id).toBe(photo.bridge.id);
      expect(seen.cover).not.toHaveProperty('note');
      expect((await list(viewer, 'owner=alice'))[0].cover?.id).toBe(photo.bridge.id);
    }
  });

  it('gives its author the photos of every entry of theirs in it, drafts and archived ones too, without notes', async () => {
    const d = await detail(alice, project.id);
    expect(photoSet(d.photos)).toEqual(photoSet(Object.values(photo)));
    for (const p of d.photos) expect(p).not.toHaveProperty('note');
  });

  it('gives others only the photos they may open of the entries they may open, unlisted photos of a public entry included', async () => {
    for (const viewer of [bob, anon]) {
      const d = await detail(viewer, project.id);
      expect(photoSet(d.photos)).toEqual(photoSet([photo.lake, photo.unlisted, photo.bridge]));
      for (const p of d.photos) expect(p).not.toHaveProperty('note');
    }
  });
});

describe('a project’s days and cover', () => {
  it('counts the days its entries happened on, a day without a time being the same day as one with', async () => {
    const p = await create(alice);
    for (const occurredAt of ['2026-05-01T08:00:00', '2026-05-01T21:00:00', '2026-05-01', '2026-05-02T07:00:00']) {
      await entry(alice, { occurredAt, projectIds: [p.id] });
    }
    expect(await detail(alice, p.id)).toMatchObject({ entryCount: 4, dayCount: 2, lastOccurredAt: '2026-05-02T07:00:00', cover: null });
  });

  it('takes the cover from the latest entry that has photos, and its first one', async () => {
    const p = await create(alice);
    const [p1, p2, p3] = [await upload(alice, { visibility: 'private' }), await upload(alice), await upload(alice)];
    await entry(alice, { occurredAt: '2026-05-01T08:00:00', media: [{ photoId: p1.id }, { photoId: p2.id }], projectIds: [p.id] });
    await entry(alice, { occurredAt: '2026-05-01T21:00:00', media: [{ photoId: p3.id }, { photoId: p1.id }], projectIds: [p.id] });
    await entry(alice, { occurredAt: '2026-05-02T07:00:00', body: '没有照片', projectIds: [p.id] });
    const d = await detail(alice, p.id);
    expect(d).toMatchObject({ entryCount: 3, dayCount: 2, photoCount: 3 });
    expect(d.cover?.id).toBe(p3.id);
  });

  it('has no cover for a viewer while no entry shows a photo they may open', async () => {
    const p = await create(alice, { visibility: 'public' });
    const hidden = await upload(alice, { visibility: 'private' });
    await entry(alice, { visibility: 'public', media: [{ photoId: hidden.id }], projectIds: [p.id] });
    expect((await detail(alice, p.id)).cover?.id).toBe(hidden.id);
    expect(await detail(bob, p.id)).toMatchObject({ entryCount: 1, photoCount: 0, cover: null, photos: [] });
  });
});

describe('PATCH /api/projects/:id', () => {
  it('changes what is given and keeps the rest', async () => {
    const p = await create(alice, { type: 'learning', description: '每天一页', endDate: '2026-06-30' });
    expect(await patch(alice, p.id, { status: 'paused' })).toMatchObject({
      title: '学书法',
      type: 'learning',
      description: '每天一页',
      startDate: START,
      endDate: '2026-06-30',
      status: 'paused',
      visibility: 'private'
    });
    const body = { title: '  学  行书 ', type: 'practice', startDate: '2026-02-01', endDate: '2026-12-31', visibility: 'public' };
    expect(await patch(alice, p.id, body)).toMatchObject({
      title: '学 行书',
      type: 'practice',
      description: '每天一页',
      startDate: '2026-02-01',
      endDate: '2026-12-31',
      status: 'paused',
      visibility: 'public'
    });
    expect(await detail(bob, p.id)).toMatchObject({ title: '学 行书', visibility: 'public' });
  });

  it('clears the description and the end day with null', async () => {
    const p = await create(alice, { description: '每天一页', endDate: '2026-06-30' });
    expect(await patch(alice, p.id, { description: null, endDate: null })).toMatchObject({
      title: '学书法',
      description: null,
      startDate: START,
      endDate: null
    });
  });

  it('will not clear the title or the start day', async () => {
    const p = await create(alice);
    for (const body of [{ title: null }, { title: '  ' }, { startDate: null }, { startDate: '' }]) {
      expect((await alice.patch(`/api/projects/${p.id}`, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await detail(alice, p.id)).toMatchObject({ title: '学书法', startDate: START });
  });

  it('keeps the end on or after the start, against what is stored', async () => {
    const p = await create(alice, { endDate: '2026-06-30' });
    for (const body of [{ endDate: '2026-02-28' }, { startDate: '2026-07-01' }, { startDate: '2026-05-01', endDate: '2026-04-30' }]) {
      expect((await alice.patch(`/api/projects/${p.id}`, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await detail(alice, p.id)).toMatchObject({ startDate: START, endDate: '2026-06-30' });
    expect(await patch(alice, p.id, { endDate: START })).toMatchObject({ startDate: START, endDate: START });
    expect(await patch(alice, p.id, { startDate: '2026-07-01', endDate: '2026-08-01' })).toMatchObject({
      startDate: '2026-07-01',
      endDate: '2026-08-01'
    });
    // without an end, any start will do
    expect(await patch(alice, p.id, { endDate: null })).toMatchObject({ endDate: null });
    expect(await patch(alice, p.id, { startDate: '2027-01-01' })).toMatchObject({ startDate: '2027-01-01', endDate: null });
  });

  it('checks the fields', async () => {
    const p = await create(alice);
    for (const body of [
      { title: '字'.repeat(PROJECT_LIMITS.titleMax + 1) },
      { startDate: '2026-02-30' },
      { endDate: 'next year' },
      { type: 'hobby' },
      { status: 'done' },
      { visibility: 'friends' },
      { description: '字'.repeat(PROJECT_LIMITS.descriptionMax + 1) }
    ]) {
      expect((await alice.patch(`/api/projects/${p.id}`, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await detail(alice, p.id)).toMatchObject({
      title: '学书法',
      type: 'other',
      status: 'active',
      visibility: 'private',
      description: null
    });
  });

  it('moves updatedAt on when something changes, and not otherwise', async () => {
    const p = await create(alice);
    await age(p.id);
    expect((await patch(alice, p.id, {})).updatedAt).toBe(OLD);
    const changed = await patch(alice, p.id, { status: 'completed' });
    expect(changed.updatedAt > OLD).toBe(true);
    expect(changed.createdAt).toBe(p.createdAt);
  });

  it('lets only its author change it: 403 where others can open it, 404 where they cannot', async () => {
    for (const visibility of VIS) {
      const p = await create(alice, { visibility });
      const res = await bob.patch(`/api/projects/${p.id}`, { title: '他的' });
      expect(res.status, visibility).toBe(visibility === 'private' ? 404 : 403);
      expect(res.body.error, visibility).toBe(visibility === 'private' ? 'not_found' : 'forbidden');
      expect((await anon.patch(`/api/projects/${p.id}`, { title: '他的' })).status, visibility).toBe(401);
      expect((await detail(alice, p.id)).title).toBe('学书法');
    }
  });

  it('answers 404 for a project that is not there', async () => {
    expect((await alice.patch('/api/projects/pj_missing', { title: '学书法' })).status).toBe(404);
  });
});

describe('DELETE /api/projects/:id', () => {
  it('removes the project with its milestones and its links to entries, and keeps the entries', async () => {
    const p = await create(alice, { visibility: 'public' });
    const other = await create(alice, { title: '练琴' });
    await milestone(alice, p.id);
    const kept = await milestone(alice, other.id);
    const both = await entry(alice, { projectIds: [p.id, other.id] });
    const only = await entry(alice, { projectIds: [p.id] });
    expect(expectStatus(await alice.del(`/api/projects/${p.id}`), 200)).toEqual({ ok: true });

    expect((await alice.get(`/api/projects/${p.id}`)).status).toBe(404);
    expect(ids(await list(alice, 'mine=1'))).toEqual([other.id]);
    expect(await rows('SELECT id FROM milestones WHERE project_id = ?1', p.id)).toEqual([]);
    expect(await rows('SELECT entry_id FROM entry_projects WHERE project_id = ?1', p.id)).toEqual([]);
    expect((await detail(alice, other.id)).milestones).toEqual([kept]);
    const projectsOf = async (id: string) => (expectStatus(await alice.get(`/api/entries/${id}`), 200) as EntryDetail).projectIds;
    expect(await projectsOf(both.id)).toEqual([other.id]);
    expect(await projectsOf(only.id)).toEqual([]);
    expect(await entries(alice, `project=${p.id}`)).toEqual([]);
  });

  it('lets only its author delete it: 403 where others can open it, 404 where they cannot', async () => {
    for (const visibility of VIS) {
      const p = await create(alice, { visibility });
      expect((await bob.del(`/api/projects/${p.id}`)).status, visibility).toBe(visibility === 'private' ? 404 : 403);
      expect((await anon.del(`/api/projects/${p.id}`)).status, visibility).toBe(401);
      expect((await alice.get(`/api/projects/${p.id}`)).status, visibility).toBe(200);
    }
    expect((await alice.del('/api/projects/pj_missing')).status).toBe(404);
  });
});

describe('milestones', () => {
  let project: ProjectDetail;
  beforeEach(async () => {
    project = await create(alice, { visibility: 'public' });
  });

  it('adds a milestone with an ms_ id, a tidied title, its day and no body', async () => {
    const m = expectStatus(await alice.post(msUrl(project.id), { title: '  临完   《兰亭序》 ', date: '2026-05-01' }), 201)
      .milestone as Milestone;
    expect(m.id).toMatch(new RegExp(`^ms_${ULID}$`));
    expect(m).toMatchObject({ projectId: project.id, title: '临完 《兰亭序》', body: null, date: '2026-05-01' });
    expect((await detail(alice, project.id)).milestones).toEqual([m]);
  });

  it('keeps a Markdown body as written', async () => {
    const body = '## 第一阶段\n\n- 每天一页，坚持了 **90** 天\n- 下一步：行书';
    expect((await milestone(alice, project.id, { body })).body).toBe(body);
    const longest = '字'.repeat(MILESTONE_LIMITS.bodyMax);
    expect((await milestone(alice, project.id, { body: longest })).body).toBe(longest);
  });

  it('needs a title and a day, and checks them', async () => {
    for (const body of [
      { date: '2026-05-01' },
      { title: '   ', date: '2026-05-01' },
      { title: '字'.repeat(MILESTONE_LIMITS.titleMax + 1), date: '2026-05-01' },
      { title: '临完' },
      { title: '临完', date: '2026-5-1' },
      { title: '临完', date: '2026-02-30' },
      { title: '临完', date: '2026-05-01', body: '字'.repeat(MILESTONE_LIMITS.bodyMax + 1) }
    ]) {
      expect((await alice.post(msUrl(project.id), body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await rows('SELECT id FROM milestones')).toEqual([]);
  });

  it('changes what is given, and clears the body with null', async () => {
    const m = await milestone(alice, project.id, { title: '临完兰亭', date: '2026-05-01', body: '小结' });
    const edit = async (body: Json) => expectStatus(await alice.patch(msUrl(project.id, m.id), body), 200).milestone as Milestone;
    expect(await edit({ title: ' 临完  《兰亭序》 ' })).toMatchObject({
      id: m.id,
      projectId: project.id,
      title: '临完 《兰亭序》',
      date: '2026-05-01',
      body: '小结'
    });
    expect(await edit({ date: '2026-05-08', body: null })).toMatchObject({ title: '临完 《兰亭序》', date: '2026-05-08', body: null });
    for (const body of [{ title: '  ' }, { date: 'soon' }, { body: '字'.repeat(MILESTONE_LIMITS.bodyMax + 1) }]) {
      expect((await alice.patch(msUrl(project.id, m.id), body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await detail(alice, project.id)).milestones).toEqual([
      expect.objectContaining({ id: m.id, title: '临完 《兰亭序》', date: '2026-05-08', body: null })
    ]);
  });

  it('deletes a milestone', async () => {
    const gone = await milestone(alice, project.id, { title: '一' });
    const kept = await milestone(alice, project.id, { title: '二' });
    expect(expectStatus(await alice.del(msUrl(project.id, gone.id)), 200)).toEqual({ ok: true });
    expect((await detail(alice, project.id)).milestones).toEqual([kept]);
    expect((await alice.del(msUrl(project.id, gone.id))).status).toBe(404);
  });

  it('answers 404 for a milestone of another project, or one that is not there', async () => {
    const other = await create(alice, { title: '练琴' });
    const m = await milestone(alice, project.id);
    expect((await alice.patch(msUrl(other.id, m.id), { title: '改' })).status).toBe(404);
    expect((await alice.del(msUrl(other.id, m.id))).status).toBe(404);
    expect((await alice.patch(msUrl(project.id, 'ms_missing'), { title: '改' })).status).toBe(404);
    expect((await alice.post(msUrl('pj_missing'), { title: '改', date: '2026-05-01' })).status).toBe(404);
    expect((await detail(alice, project.id)).milestones).toEqual([m]);
  });

  it('lets only the project’s author write them: 403 where others can open the project, 404 where they cannot', async () => {
    for (const visibility of VIS) {
      const p = await create(alice, { visibility });
      const m = await milestone(alice, p.id);
      const expected = visibility === 'private' ? 404 : 403;
      expect((await bob.post(msUrl(p.id), { title: '他的', date: '2026-05-01' })).status, visibility).toBe(expected);
      expect((await bob.patch(msUrl(p.id, m.id), { title: '他的' })).status, visibility).toBe(expected);
      expect((await bob.del(msUrl(p.id, m.id))).status, visibility).toBe(expected);
      expect((await anon.post(msUrl(p.id), { title: '他的', date: '2026-05-01' })).status, visibility).toBe(401);
      expect((await anon.patch(msUrl(p.id, m.id), { title: '他的' })).status, visibility).toBe(401);
      expect((await anon.del(msUrl(p.id, m.id))).status, visibility).toBe(401);
      expect((await detail(alice, p.id)).milestones).toEqual([m]);
    }
  });

  it('moves the project’s updatedAt with every write', async () => {
    const updatedAt = async () => (await detail(alice, project.id)).updatedAt;
    await age(project.id);
    const m = await milestone(alice, project.id);
    expect(await updatedAt()).not.toBe(OLD);
    await age(project.id);
    expectStatus(await alice.patch(msUrl(project.id, m.id), { title: '改过' }), 200);
    expect(await updatedAt()).not.toBe(OLD);
    await age(project.id);
    expectStatus(await alice.del(msUrl(project.id, m.id)), 200);
    expect(await updatedAt()).not.toBe(OLD);
  });

  it('takes at most 500 milestones a project', async () => {
    // all but one written straight to D1
    const seeded = Array.from({ length: MILESTONE_LIMITS.count - 1 }, (_, i) => i);
    await platform.env.DB.prepare(
      `INSERT INTO milestones (id, project_id, title, date) SELECT 'ms_seed' || value, ?1, '阶段 ' || value, '2026-01-01' FROM json_each(?2)`
    )
      .bind(project.id, JSON.stringify(seeded))
      .run();
    await milestone(alice, project.id, { title: `第 ${MILESTONE_LIMITS.count} 个` });
    const res = await alice.post(msUrl(project.id), { title: '再来一个', date: '2026-12-31' });
    expect(expectStatus(res, 400).error).toBe('invalid_input');
    expect(await rows('SELECT COUNT(*) AS n FROM milestones WHERE project_id = ?1', project.id)).toEqual([{ n: MILESTONE_LIMITS.count }]);
    // the cap is per project
    await milestone(alice, (await create(alice, { title: '练琴' })).id);
  });
});

describe('entries in projects', () => {
  it('keeps its author’s own projects and drops the rest without an error', async () => {
    const first = await create(alice, { title: '学书法' });
    const second = await create(alice, { title: '练琴' });
    const theirs = await create(bob, { title: '读书', visibility: 'public' });
    const e = await entry(alice, { visibility: 'public', projectIds: [second.id, theirs.id, 'pj_missing', first.id] });
    expect(sorted(e.projectIds)).toEqual(sorted([first.id, second.id]));
    expect(await linked(e.id)).toEqual(sorted([first.id, second.id]));
    expect((await detail(bob, theirs.id)).entryCount).toBe(0);
    expect(await entries(bob, `project=${theirs.id}`)).toEqual([]);
    expect((await entry(alice, {})).projectIds).toEqual([]);
  });

  it('lists them in the order the projects were created, whatever the order given', async () => {
    const first = await create(alice, { title: '先建的' });
    const second = await create(alice, { title: '后建的' });
    const e = await entry(alice, { projectIds: [second.id, first.id] });
    expect(e.projectIds).toEqual([first.id, second.id]);
    expect((expectStatus(await alice.get(`/api/entries/${e.id}`), 200) as EntryDetail).projectIds).toEqual([first.id, second.id]);
  });

  it('replaces them as a whole on PATCH and moves the revision on, and keeps them when they are not given', async () => {
    const [one, two, three] = [
      await create(alice, { title: '一' }),
      await create(alice, { title: '二' }),
      await create(alice, { title: '三' })
    ];
    const theirs = await create(bob, { title: '读书', visibility: 'public' });
    const e = await entry(alice, { projectIds: [one.id, two.id] });
    expect(e.revision).toBe(1);
    const edit = async (body: Json) => expectStatus(await alice.patch(`/api/entries/${e.id}`, body), 200).entry as EntryDetail;

    const a = await edit({ projectIds: [three.id, theirs.id, 'pj_missing', two.id] });
    expect(sorted(a.projectIds)).toEqual(sorted([two.id, three.id]));
    expect(a.revision).toBe(2);
    expect(await linked(e.id)).toEqual(sorted([two.id, three.id]));
    expect((await detail(alice, one.id)).entryCount).toBe(0);
    expect((await detail(alice, three.id)).entryCount).toBe(1);
    expect((await detail(bob, theirs.id)).entryCount).toBe(0);

    const b = await edit({ title: '换个标题' });
    expect(sorted(b.projectIds)).toEqual(sorted([two.id, three.id]));

    const c = await edit({ projectIds: [] });
    expect(c).toMatchObject({ projectIds: [], revision: 4 });
    expect(await linked(e.id)).toEqual([]);
  });

  it('takes at most 50 projects, as a list', async () => {
    const p = await create(alice);
    const many = (n: number) => [p.id, ...Array.from({ length: n - 1 }, (_, i) => `pj_missing${i}`)];
    for (const projectIds of [p.id, many(PROJECT_LIMITS.perEntry + 1)]) {
      expect((await alice.post('/api/entries', { occurredAt: AT, body: 'x', projectIds })).status).toBe(400);
    }
    expect(await entries(alice, 'mine=1')).toEqual([]);
    expect((await entry(alice, { projectIds: many(PROJECT_LIMITS.perEntry) })).projectIds).toEqual([p.id]);
  });

  it('takes a deleted entry out of its projects', async () => {
    const p = await create(alice, { visibility: 'public' });
    const gone = await entry(alice, { visibility: 'public', projectIds: [p.id] });
    const kept = await entry(alice, { visibility: 'public', occurredAt: '2026-11-15', projectIds: [p.id] });
    expect((await detail(bob, p.id)).entryCount).toBe(2);
    expect(expectStatus(await alice.del(`/api/entries/${gone.id}`), 200)).toEqual({ ok: true });
    expect(await linked(gone.id)).toEqual([]);
    expect((await detail(bob, p.id)).entryCount).toBe(1);
    expect(ids(await entries(alice, `project=${p.id}`))).toEqual([kept.id]);
  });
});

describe('GET /api/entries?project=', () => {
  const STATUS: EntryStatus[] = ['published', 'draft', 'archived'];
  const matrix = VIS.flatMap((visibility) => STATUS.map((status) => ({ visibility, status, occurredAt: '', id: '' })));
  type Cell = (typeof matrix)[number];
  const key = (e: { visibility: string; status: string }) => `${e.visibility}/${e.status}`;
  /** The rule for others: finished entries they could open by link. */
  const byLink = (m: Cell) => m.visibility !== 'private' && m.status === 'published';
  const latestFirst = (cells: Cell[]) => [...cells].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map(key);
  let projects: Record<Visibility, ProjectDetail>;

  beforeEach(async () => {
    projects = {
      public: await create(alice, { title: '公开的', visibility: 'public' }),
      unlisted: await create(alice, { title: '凭链接的', visibility: 'unlisted' }),
      private: await create(alice, { title: '自己的', visibility: 'private' })
    };
    const all = VIS.map((v) => projects[v].id);
    // a different day for each, written down out of order
    for (const [i, m] of matrix.entries()) {
      m.occurredAt = `2026-04-${10 + ((i * 4) % 9)}`;
      m.id = (
        await entry(alice, { body: key(m), visibility: m.visibility, status: m.status, occurredAt: m.occurredAt, projectIds: all })
      ).id;
    }
  });

  it('lists for its author every entry of theirs in the project, drafts and archived ones too, latest first', async () => {
    for (const v of VIS) expect((await entries(alice, `project=${projects[v].id}`)).map(key), v).toEqual(latestFirst(matrix));
  });

  it('lists for others the finished entries they could open by link, of a public or an unlisted project, latest first', async () => {
    for (const v of ['public', 'unlisted'] as const) {
      for (const viewer of [bob, anon]) {
        expect((await entries(viewer, `project=${projects[v].id}`)).map(key), v).toEqual(latestFirst(matrix.filter(byLink)));
      }
    }
  });

  it('shows others nothing of a private project, and nobody anything of one that is not there', async () => {
    const none = { entries: [], truncated: false };
    for (const viewer of [bob, anon]) {
      expect(expectStatus(await viewer.get(`/api/entries?project=${projects.private.id}`), 200)).toEqual(none);
    }
    for (const viewer of [alice, bob, anon]) {
      expect(expectStatus(await viewer.get('/api/entries?project=pj_missing'), 200)).toEqual(none);
    }
  });

  it('names on an entry only the projects the viewer may see in lists', async () => {
    const all = sorted(VIS.map((v) => projects[v].id));
    const shared = matrix.find((m) => key(m) === 'public/published')?.id;
    const named = async (viewer: Client) => (expectStatus(await viewer.get(`/api/entries/${shared}`), 200) as EntryDetail).projectIds;
    expect(sorted(await named(alice))).toEqual(all);
    for (const e of await entries(alice, 'mine=1')) expect(sorted(e.projectIds), key(e)).toEqual(all);
    for (const viewer of [bob, anon]) {
      expect(await named(viewer)).toEqual([projects.public.id]);
      expect((await entries(viewer, 'owner=alice')).map((e) => e.projectIds)).toEqual([[projects.public.id]]);
      for (const e of await entries(viewer, `project=${projects.unlisted.id}`)) expect(e.projectIds, key(e)).toEqual([projects.public.id]);
    }
  });
});
