// Themes against real D1: docs/api/themes.md.

import { beforeEach, describe, expect, it } from 'vite-plus/test';
import type { PhotoDetail, ThemeDetail } from '../../shared/types';
import { Client, expectStatus, newUser, upload, usePlatform, type Json } from '../test-platform';

const platform = usePlatform();

let alice: Client;
let bob: Client;
let photos: PhotoDetail[];
beforeEach(async () => {
  alice = await newUser(platform, 'alice', 'owner');
  bob = await newUser(platform, 'bob');
  // uploaded out of capture order, one without a capture time
  photos = [];
  for (const takenAt of ['2026-03-02T09:00:00', '2026-03-01T18:00:00', null, '2026-03-01T08:00:00', '2026-03-04T12:00:00']) {
    photos.push(await upload(alice, { takenAt }));
  }
});

const create = async (client: Client, body: Json): Promise<ThemeDetail> => expectStatus(await client.post('/api/themes', body), 201).theme;
const shape = (t: ThemeDetail) =>
  t.items.map((i) =>
    i.kind === 'photo' ? `photo:${photos.findIndex((p) => p.id === i.photoId)}` : i.kind === 'day' ? `day:${i.day}` : `text:${i.text}`
  );

describe('POST /api/themes', () => {
  it('seeds a trip in capture order with a day before the first photo of each date, undated photos last', async () => {
    const t = await create(alice, { kind: 'trip', title: '杭州三日', photoIds: photos.map((p) => p.id) });
    expect(t.id).toMatch(/^th_/);
    expect(shape(t)).toEqual(['day:2026-03-01', 'photo:3', 'photo:1', 'day:2026-03-02', 'photo:0', 'day:2026-03-04', 'photo:4', 'photo:2']);
    expect(t).toMatchObject({ kind: 'trip', title: '杭州三日', startDate: '2026-03-01', endDate: '2026-03-04', photoCount: 5 });
    // private by default, not published
    expect(t).toMatchObject({ visibility: 'private', publishedAt: null, ownerId: alice.me.id, ownerHandle: 'alice' });
  });

  it('keeps given dates for a trip', async () => {
    const t = await create(alice, { kind: 'trip', title: 't', photoIds: [photos[0].id], startDate: '2026-02-28', endDate: '2026-03-05' });
    expect(t).toMatchObject({ startDate: '2026-02-28', endDate: '2026-03-05' });
  });

  it('keeps the given order for a topic, with no day items', async () => {
    const t = await create(alice, { kind: 'topic', title: '桥', photoIds: [photos[4].id, photos[2].id, photos[0].id] });
    expect(shape(t)).toEqual(['photo:4', 'photo:2', 'photo:0']);
    expect(t).toMatchObject({ startDate: null, endDate: null });
  });

  it('publishes a theme created public', async () => {
    const t = await create(alice, { kind: 'topic', title: '公开', visibility: 'public' });
    expect(t.publishedAt).toBeTruthy();
    expect(t.items).toEqual([]);
  });

  it('only takes the creator’s own photos, as items and as cover', async () => {
    const bobs = await upload(bob);
    expect((await alice.post('/api/themes', { kind: 'topic', title: 't', photoIds: [photos[0].id, bobs.id] })).status).toBe(400);
    expect((await alice.post('/api/themes', { kind: 'topic', title: 't', coverPhotoId: bobs.id })).status).toBe(400);
    expect((await alice.post('/api/themes', { kind: 'topic', title: 't', photoIds: ['ph_missing'] })).status).toBe(400);
    expect(expectStatus(await alice.get('/api/themes?mine=1'), 200).themes).toEqual([]);
  });

  it('checks the fields', async () => {
    for (const body of [
      { title: 'no kind' },
      { kind: 'album', title: 'x' },
      { kind: 'trip' },
      { kind: 'trip', title: '   ' },
      { kind: 'trip', title: 'x', startDate: '2026-03-05', endDate: '2026-03-01' },
      { kind: 'trip', title: 'x', startDate: '5 March' },
      { kind: 'trip', title: 'x', visibility: 'friends' },
      { kind: 'trip', title: 'x', photoIds: 'ph_1' }
    ]) {
      expect((await alice.post('/api/themes', body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('needs a session', async () => {
    expect((await new Client(platform).post('/api/themes', { kind: 'trip', title: 'x' })).status).toBe(401);
  });
});

describe('PATCH /api/themes/:id', () => {
  it('moves an edited theme to the front of the list', async () => {
    const first = await create(alice, { kind: 'topic', title: '一' });
    const second = await create(alice, { kind: 'topic', title: '二' });
    const order = async () => (expectStatus(await alice.get('/api/themes?mine=1'), 200).themes as Json[]).map((t) => t.id);
    expect(await order()).toEqual([second.id, first.id]);
    // updatedAt has a one-second resolution: age both instead of waiting
    await platform.env.DB.prepare(`UPDATE themes SET updated_at = '2020-01-01T00:00:00Z'`).run();
    expectStatus(await alice.patch(`/api/themes/${first.id}`, { subtitle: '改过' }), 200);
    expect(await order()).toEqual([first.id, second.id]);
  });

  it('updates fields and keeps the first publication date', async () => {
    const t = await create(alice, { kind: 'trip', title: '草稿', photoIds: [photos[0].id] });
    const published = expectStatus(
      await alice.patch(`/api/themes/${t.id}`, { title: '杭州', subtitle: '春', visibility: 'public' }),
      200
    ).theme;
    expect(published).toMatchObject({ title: '杭州', subtitle: '春', visibility: 'public' });
    expect(published.publishedAt).toBeTruthy();
    expect(published.updatedAt >= t.updatedAt).toBe(true);

    const hidden = expectStatus(await alice.patch(`/api/themes/${t.id}`, { visibility: 'private' }), 200).theme;
    const again = expectStatus(await alice.patch(`/api/themes/${t.id}`, { visibility: 'public', kind: 'topic' }), 200).theme;
    expect(hidden.publishedAt).toBe(published.publishedAt);
    expect(again.publishedAt).toBe(published.publishedAt);
    expect(again.kind).toBe('topic');
  });

  it('sets and clears the cover, which must be the owner’s photo', async () => {
    const t = await create(alice, { kind: 'topic', title: 't', photoIds: [photos[0].id, photos[1].id] });
    expect(expectStatus(await alice.patch(`/api/themes/${t.id}`, { coverPhotoId: photos[1].id }), 200).theme.coverPhotoId).toBe(
      photos[1].id
    );
    expect(expectStatus(await alice.patch(`/api/themes/${t.id}`, { coverPhotoId: null }), 200).theme.coverPhotoId).toBeNull();
    const bobs = await upload(bob);
    expect((await alice.patch(`/api/themes/${t.id}`, { coverPhotoId: bobs.id })).status).toBe(400);
  });

  it('cannot be done by anyone else', async () => {
    const pub = await create(alice, { kind: 'topic', title: 'mine', visibility: 'public' });
    const priv = await create(alice, { kind: 'topic', title: 'mine' });
    const res = await bob.patch(`/api/themes/${pub.id}`, { title: 'theirs' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden' });
    expect((await bob.patch(`/api/themes/${priv.id}`, { title: 'theirs' })).status).toBe(404);
    expect((await new Client(platform).patch(`/api/themes/${pub.id}`, { title: 'theirs' })).status).toBe(401);
    expect(expectStatus(await alice.get(`/api/themes/${pub.id}`), 200).title).toBe('mine');
  });
});

describe('PUT /api/themes/:id/items', () => {
  it('replaces all items, in order, with new ids', async () => {
    const t = await create(alice, { kind: 'trip', title: 't', photoIds: photos.map((p) => p.id) });
    const oldIds = new Set(t.items.map((i) => i.id));
    const res = await alice.put(`/api/themes/${t.id}/items`, {
      items: [
        { kind: 'text', text: '序' },
        { kind: 'day', day: '2026-03-04', text: '最后一天' },
        { kind: 'photo', photoId: photos[4].id, text: '湖边' },
        { kind: 'photo', photoId: photos[0].id }
      ]
    });
    const after = expectStatus(res, 200).theme as ThemeDetail;
    expect(shape(after)).toEqual(['text:序', 'day:2026-03-04', 'photo:4', 'photo:0']);
    expect(after.items.some((i) => oldIds.has(i.id))).toBe(false);
    expect(after.items[1]).toMatchObject({ kind: 'day', text: '最后一天' });
    expect(after.items[2]).toMatchObject({ kind: 'photo', text: '湖边' });
    expect(after.photoCount).toBe(2);
    const positions = await platform.env.DB.prepare('SELECT position FROM theme_items WHERE theme_id = ?1 ORDER BY position')
      .bind(t.id)
      .all<{ position: number }>();
    expect(positions.results.map((r) => r.position)).toEqual([0, 1, 2, 3]);

    expect(shape(expectStatus(await alice.put(`/api/themes/${t.id}/items`, { items: [] }), 200).theme)).toEqual([]);
  });

  it('refuses malformed items and leaves the theme as it was', async () => {
    const bobs = await upload(bob);
    const t = await create(alice, { kind: 'topic', title: 't', photoIds: [photos[0].id] });
    for (const items of [
      'nope',
      [{ kind: 'video', url: 'x' }],
      [{ kind: 'photo' }],
      [{ kind: 'photo', photoId: bobs.id }],
      [{ kind: 'photo', photoId: 'ph_missing' }],
      [{ kind: 'text', text: '   ' }],
      [{ kind: 'day', day: '2026-02-30' }],
      [{ kind: 'day', day: 'tomorrow' }],
      ['photo']
    ]) {
      expect((await alice.put(`/api/themes/${t.id}/items`, { items })).status, JSON.stringify(items)).toBe(400);
    }
    expect(shape(expectStatus(await alice.get(`/api/themes/${t.id}`), 200))).toEqual(['photo:0']);
  });

  it('cannot be done by anyone else', async () => {
    const t = await create(alice, { kind: 'topic', title: 't', visibility: 'public', photoIds: [photos[0].id] });
    expect((await bob.put(`/api/themes/${t.id}/items`, { items: [] })).status).toBe(403);
    expect(shape(expectStatus(await alice.get(`/api/themes/${t.id}`), 200))).toEqual(['photo:0']);
  });
});

describe('DELETE /api/themes/:id', () => {
  it('removes the theme and its items, not the photos', async () => {
    const t = await create(alice, { kind: 'trip', title: 't', photoIds: photos.map((p) => p.id) });
    expect(expectStatus(await alice.del(`/api/themes/${t.id}`), 200)).toEqual({ ok: true });
    expect((await alice.get(`/api/themes/${t.id}`)).status).toBe(404);
    const left = await platform.env.DB.prepare('SELECT COUNT(*) AS n FROM theme_items WHERE theme_id = ?1').bind(t.id).first();
    expect(left).toEqual({ n: 0 });
    expect(expectStatus(await alice.get('/api/photos?mine=1'), 200).photos).toHaveLength(photos.length);
  });

  it('cannot be done by anyone else', async () => {
    const pub = await create(alice, { kind: 'topic', title: 't', visibility: 'public' });
    const priv = await create(alice, { kind: 'topic', title: 't' });
    expect((await bob.del(`/api/themes/${pub.id}`)).status).toBe(403);
    expect((await bob.del(`/api/themes/${priv.id}`)).status).toBe(404);
    expect(expectStatus(await alice.get('/api/themes?mine=1'), 200).themes).toHaveLength(2);
  });
});
