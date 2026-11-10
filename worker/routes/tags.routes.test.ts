// The tag tree against real D1: docs/api/tags.md.

import { beforeEach, describe, expect, it } from 'vite-plus/test';
import type { Tag } from '../../shared/types';
import { Client, expectStatus, newUser, upload, usePlatform } from '../test-platform';

const platform = usePlatform();

let owner: Client;
let admin: Client;
let alice: Client;
let bob: Client;
beforeEach(async () => {
  owner = await newUser(platform, 'site_owner', 'owner');
  admin = await newUser(platform, 'staff', 'admin');
  alice = await newUser(platform, 'alice');
  bob = await newUser(platform, 'bob');
});

const createTag = async (client: Client, body: Record<string, unknown>): Promise<Tag> =>
  expectStatus(await client.post('/api/tags', body), 201).tag;
const tagRow = (id: string) => platform.env.DB.prepare('SELECT id, name, parent_id, owner_id FROM tags WHERE id = ?1').bind(id).first();

describe('POST /api/tags', () => {
  it('creates a tag owned by the requester, under a preset or at the root, sorted last among its siblings', async () => {
    const root = await createTag(alice, { name: '旅行', color: '#336699' });
    expect(root).toMatchObject({ name: '旅行', parentId: null, ownerId: alice.me.id, color: '#336699', count: 0 });
    expect(root.id).toMatch(/^t_/);

    const under = await createTag(alice, { name: '水库', parentId: 'nature' });
    // nature's preset children are sorted 10…60
    expect(under).toMatchObject({ parentId: 'nature', sort: 70 });
    const next = await createTag(alice, { name: '瀑布', parentId: 'nature' });
    expect(next.sort).toBe(80);

    const tags = expectStatus(await alice.get('/api/tags'), 200).tags as Tag[];
    expect(tags.map((t) => t.id)).toEqual(expect.arrayContaining([root.id, under.id, next.id]));
    // others do not see it
    expect((expectStatus(await bob.get('/api/tags'), 200).tags as Tag[]).some((t) => t.id === root.id)).toBe(false);
  });

  it('refuses a sibling with the same name, ignoring case and width, including preset names', async () => {
    await createTag(alice, { name: 'Film', parentId: 'subject' });
    for (const name of ['film', 'ＦＩＬＭ', '自然']) {
      const res = await alice.post('/api/tags', { name, parentId: 'subject' });
      expect(res.status, name).toBe(409);
      expect(res.body).toMatchObject({ error: 'conflict' });
    }
    // fine under another parent, or for another user
    await createTag(alice, { name: 'film', parentId: 'life' });
    await createTag(bob, { name: 'film', parentId: 'subject' });
  });

  it('only hangs tags under presets or the requester’s own tags', async () => {
    const bobs = await createTag(bob, { name: 'bob 的' });
    expect((await alice.post('/api/tags', { name: 'x', parentId: bobs.id })).status).toBe(400);
    expect((await alice.post('/api/tags', { name: 'x', parentId: 't_missing' })).status).toBe(400);
  });

  it('checks the name and colour, and needs a session', async () => {
    for (const body of [{}, { name: '' }, { name: 'x'.repeat(25) }, { name: 'x', color: 'red' }]) {
      expect((await alice.post('/api/tags', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await new Client(platform).post('/api/tags', { name: 'x' })).status).toBe(401);
  });
});

describe('PATCH /api/tags/:id', () => {
  it('renames, recolours, sorts and moves the requester’s tag', async () => {
    const a = await createTag(alice, { name: 'a' });
    const b = await createTag(alice, { name: 'b' });
    const res = await alice.patch(`/api/tags/${a.id}`, { name: 'A2', color: '#112233', sort: 5, parentId: b.id });
    expect(expectStatus(res, 200).tag).toMatchObject({ id: a.id, name: 'A2', color: '#112233', sort: 5, parentId: b.id });
    expect(await tagRow(a.id)).toMatchObject({ name: 'A2', parent_id: b.id });
    expect(expectStatus(await alice.patch(`/api/tags/${a.id}`, { parentId: null }), 200).tag.parentId).toBeNull();
  });

  it('refuses to move a tag under itself or one of its descendants', async () => {
    const a = await createTag(alice, { name: 'a' });
    const b = await createTag(alice, { name: 'b', parentId: a.id });
    const c = await createTag(alice, { name: 'c', parentId: b.id });
    for (const target of [a.id, b.id, c.id]) {
      const res = await alice.patch(`/api/tags/${a.id}`, { parentId: target });
      expect(res.status, target).toBe(400);
    }
    expect(await tagRow(a.id)).toMatchObject({ parent_id: null });
    // moving a leaf up is fine
    expect(expectStatus(await alice.patch(`/api/tags/${c.id}`, { parentId: a.id }), 200).tag.parentId).toBe(a.id);
  });

  it('refuses a name or move that clashes with a sibling', async () => {
    const a = await createTag(alice, { name: 'a', parentId: 'nature' });
    await createTag(alice, { name: 'b', parentId: 'nature' });
    await createTag(alice, { name: 'a' });
    expect((await alice.patch(`/api/tags/${a.id}`, { name: 'B' })).status).toBe(409);
    expect((await alice.patch(`/api/tags/${a.id}`, { name: '湖' })).status).toBe(409); // a preset sibling
    expect((await alice.patch(`/api/tags/${a.id}`, { parentId: null })).status).toBe(409);
    // its own name in another case is not a clash with itself
    expect(expectStatus(await alice.patch(`/api/tags/${a.id}`, { name: 'A' }), 200).tag.name).toBe('A');
  });

  it('lets only the site owner and admins change presets', async () => {
    const denied = await alice.patch('/api/tags/lake', { name: '湖泊' });
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ error: 'forbidden' });
    expectStatus(await owner.patch('/api/tags/lake', { name: '湖泊' }), 200);
    expectStatus(await admin.patch('/api/tags/lake', { color: '#2255aa' }), 200);
    expect(await tagRow('lake')).toMatchObject({ name: '湖泊', owner_id: null });
  });

  it('does not let anyone change another user’s tag, staff included', async () => {
    const bobs = await createTag(bob, { name: 'bob 的' });
    expect((await alice.patch(`/api/tags/${bobs.id}`, { name: 'x' })).status).toBe(403);
    expect((await owner.patch(`/api/tags/${bobs.id}`, { name: 'x' })).status).toBe(403);
    expect((await alice.patch('/api/tags/t_missing', { name: 'x' })).status).toBe(404);
  });
});

describe('DELETE /api/tags/:id', () => {
  it('removes the subtree and the photos’ links to it', async () => {
    const a = await createTag(alice, { name: 'a' });
    const b = await createTag(alice, { name: 'b', parentId: a.id });
    const c = await createTag(alice, { name: 'c', parentId: b.id });
    const keep = await createTag(alice, { name: 'keep' });
    const photo = await upload(alice, { tagIds: [b.id, c.id, keep.id, 'lake'] });

    expect(expectStatus(await alice.del(`/api/tags/${a.id}`), 200)).toEqual({ ok: true, deleted: 3 });
    for (const id of [a.id, b.id, c.id]) expect(await tagRow(id)).toBeNull();
    expect(expectStatus(await alice.get(`/api/photos/${photo.id}`), 200).tagIds.sort()).toEqual([keep.id, 'lake'].sort());
    const links = await platform.env.DB.prepare('SELECT tag_id FROM photo_tags WHERE photo_id = ?1 ORDER BY tag_id').bind(photo.id).all();
    expect(links.results.map((r) => r.tag_id)).toEqual([keep.id, 'lake'].sort());
  });

  it('deleting a preset (staff only) takes other users’ tags under it along', async () => {
    const mine = await createTag(alice, { name: '雾凇', parentId: 'snow' });
    const photo = await upload(alice, { tagIds: ['snow', mine.id] });
    expect((await alice.del('/api/tags/weather')).status).toBe(403);
    // weather, fog, rain, snow and alice's tag under snow
    expect(expectStatus(await admin.del('/api/tags/weather'), 200)).toEqual({ ok: true, deleted: 5 });
    expect(await tagRow(mine.id)).toBeNull();
    expect(expectStatus(await alice.get(`/api/photos/${photo.id}`), 200).tagIds).toEqual([]);
  });

  it('does not let anyone delete another user’s tag', async () => {
    const bobs = await createTag(bob, { name: 'bob 的' });
    expect((await alice.del(`/api/tags/${bobs.id}`)).status).toBe(403);
    expect((await owner.del(`/api/tags/${bobs.id}`)).status).toBe(403);
    expect(await tagRow(bobs.id)).not.toBeNull();
  });
});
