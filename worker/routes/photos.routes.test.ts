// Upload, edit and delete against real D1 and R2: docs/api/photos.md.

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { PhotoDetail } from '../../shared/types';
import {
  Client,
  expectStatus,
  JPEG,
  newSha,
  newUser,
  PNG,
  upload,
  uploadForm,
  uploadRaw,
  usePlatform,
  WEBP,
  type Json
} from '../test-platform';

const platform = usePlatform();

let alice: Client;
let bob: Client;
beforeEach(async () => {
  alice = await newUser(platform, 'alice', 'owner');
  bob = await newUser(platform, 'bob');
});

const r2Keys = async () => (await platform.env.MEDIA.list()).objects.map((o) => o.key).sort();
const row = (sql: string, ...params: unknown[]) =>
  platform.env.DB.prepare(sql)
    .bind(...params)
    .first<Json>();
const rows = async (sql: string, ...params: unknown[]) =>
  (
    await platform.env.DB.prepare(sql)
      .bind(...params)
      .all<Json>()
  ).results;

describe('POST /api/photos', () => {
  it('stores the original and three sizes in R2 and the photo in D1', async () => {
    const sha = newSha();
    const res = await uploadRaw(
      alice,
      uploadForm({
        title: '断桥',
        note: '早上',
        takenAt: '2026-04-03T07:15:00',
        tz: '+08:00',
        lat: 30.2588,
        lng: 120.1512,
        heading: 270,
        camera: 'X100V',
        sha256: sha.toUpperCase(),
        tagIds: ['bridge', 'morning', 'no-such-tag'],
        visibility: 'unlisted'
      })
    );
    const photo = expectStatus(res, 201).photo as PhotoDetail;
    expect(photo.id).toMatch(/^ph_/);
    expect(photo).toMatchObject({
      ownerId: alice.me.id,
      ownerHandle: 'alice',
      title: '断桥',
      note: '早上',
      takenAt: '2026-04-03T07:15:00',
      tz: '+08:00',
      lat: 30.2588,
      lng: 120.1512,
      heading: 270,
      camera: 'X100V',
      width: 3000,
      height: 2000,
      visibility: 'unlisted',
      geoPrivacy: 'exact',
      inLiving: true,
      favorite: false,
      poi: null
    });
    // unknown tags are dropped
    expect(photo.tagIds.sort()).toEqual(['bridge', 'morning']);
    expect(photo.variants).toEqual({
      s: { key: `v/${photo.id}/s.webp`, w: 480, h: 320 },
      m: { key: `v/${photo.id}/m.webp`, w: 1600, h: 1067 },
      l: { key: `v/${photo.id}/l.webp`, w: 2560, h: 1707 }
    });

    const original = `o/${alice.me.id}/${photo.id}.jpg`;
    expect(await r2Keys()).toEqual([original, photo.variants.l.key, photo.variants.m.key, photo.variants.s.key].sort());
    const stored = await platform.env.MEDIA.get(original);
    expect(stored?.httpMetadata?.contentType).toBe('image/jpeg');
    expect(new Uint8Array(await (stored as R2ObjectBody).arrayBuffer())).toEqual(JPEG);
    expect((await platform.env.MEDIA.head(photo.variants.s.key))?.httpMetadata?.contentType).toBe('image/webp');

    // the hash is kept in lower case, so the same file in another case is still a duplicate
    expect(await row('SELECT sha256, file_size FROM photos WHERE id = ?1', photo.id)).toEqual({
      sha256: sha.toLowerCase(),
      file_size: JPEG.length
    });
    expect(await rows('SELECT tag_id, source FROM photo_tags WHERE photo_id = ?1 ORDER BY tag_id', photo.id)).toEqual([
      { tag_id: 'bridge', source: 'manual' },
      { tag_id: 'morning', source: 'manual' }
    ]);
  });

  it('accepts JPEG sizes and other original formats', async () => {
    const form = uploadForm(
      {},
      {
        original: new File([PNG], 'scan.png', { type: 'image/png' }),
        s: new File([JPEG], 's.jpg', { type: 'image/jpeg' }),
        m: new File([JPEG], 'm.jpg', { type: 'image/jpeg' }),
        l: new File([JPEG], 'l.jpg', { type: 'image/jpeg' })
      }
    );
    const photo = expectStatus(await uploadRaw(alice, form), 201).photo as PhotoDetail;
    expect(photo.variants.s.key).toBe(`v/${photo.id}/s.jpg`);
    expect(await r2Keys()).toContain(`o/${alice.me.id}/${photo.id}.png`);
  });

  it('answers a second upload of the same file with 409 and the existing photo', async () => {
    const sha = newSha();
    const first = await upload(alice, { sha256: sha });
    const again = await uploadRaw(alice, uploadForm({ sha256: sha }));
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: 'duplicate', photoId: first.id });
    expect(await r2Keys()).toHaveLength(4);
    // another user may upload the same file
    expectStatus(await uploadRaw(bob, uploadForm({ sha256: sha })), 201);
  });

  it('needs the original and all three sizes', async () => {
    for (const part of ['original', 's', 'm', 'l'] as const) {
      const res = await uploadRaw(alice, uploadForm({}, { [part]: null }));
      expect(res.status, part).toBe(400);
      expect(res.body).toMatchObject({ error: 'invalid_input' });
    }
    const empty = await uploadRaw(alice, uploadForm({}, { original: new File([], 'a.jpg', { type: 'image/jpeg' }) }));
    expect(empty.status).toBe(400);
    expect(await r2Keys()).toEqual([]);
  });

  it('refuses sizes that are not WebP or JPEG, or whose bytes do not match their type', async () => {
    const cases: Record<string, Blob> = {
      png: new File([PNG], 's.png', { type: 'image/png' }),
      'jpeg labelled webp': new File([JPEG], 's.webp', { type: 'image/webp' }),
      'webp labelled jpeg': new File([WEBP], 's.jpg', { type: 'image/jpeg' }),
      'not an image': new File(['<svg/>'], 's.webp', { type: 'image/webp' })
    };
    for (const [label, s] of Object.entries(cases)) {
      const res = await uploadRaw(alice, uploadForm({}, { s }));
      expect(res.status, label).toBe(400);
    }
    expect(await r2Keys()).toEqual([]);
    expect(await row('SELECT COUNT(*) AS n FROM photos')).toEqual({ n: 0 });
  });

  it('refuses an original that is not an image, and a request that is not multipart', async () => {
    const res = await uploadRaw(alice, uploadForm({}, { original: new File(['hello'], 'notes.txt', { type: 'text/plain' }) }));
    expect(res.status).toBe(400);
    expect((await alice.post('/api/photos', { width: 1 })).status).toBe(400);
  });

  it('checks the meta part', async () => {
    const bad: Json[] = [
      { width: null },
      { variantSizes: { s: [480, 320] } },
      { sha256: 'abc' },
      { visibility: 'friends' },
      { takenAt: 'yesterday' }
    ];
    for (const meta of bad) expect((await uploadRaw(alice, uploadForm(meta))).status, JSON.stringify(meta)).toBe(400);
    const form = uploadForm();
    form.set('meta', '{not json');
    expect((await uploadRaw(alice, form)).status).toBe(400);
  });

  it('needs a session', async () => {
    expect((await uploadRaw(new Client(platform), uploadForm())).status).toBe(401);
  });

  it('hides the location of a photo taken inside one of the uploader’s privacy zones', async () => {
    expectStatus(await alice.post('/api/privacy-zones', { name: '家', lat: 30.25, lng: 120.15, radius: 300 }), 201);
    const inside = await upload(alice, { lat: 30.251, lng: 120.151, geoPrivacy: 'exact' });
    expect(inside.geoPrivacy).toBe('hidden');
    const outside = await upload(alice, { lat: 30.3, lng: 120.15, geoPrivacy: 'exact' });
    expect(outside.geoPrivacy).toBe('exact');
    // someone else's zone does not apply
    const bobs = await upload(bob, { lat: 30.251, lng: 120.151, geoPrivacy: 'fuzzy' });
    expect(bobs.geoPrivacy).toBe('fuzzy');
  });

  it('creates the place given as newPoi, and computes the distance itself', async () => {
    const photo = await upload(alice, {
      lat: 30.2588,
      lng: 120.1512,
      poiDistance: 9999,
      newPoi: { name: '断桥', category: '桥', lat: 30.2593, lng: 120.1517, city: '杭州市', district: '西湖区' }
    });
    expect(photo.poi).toMatchObject({ name: '断桥', category: '桥', source: 'custom', lat: 30.2593, lng: 120.1517, radius: 60 });
    expect(photo.poiId).toBe(photo.poi?.id);
    expect(photo.poiMethod).toBe('manual');
    expect(photo.poiDistance).toBeGreaterThan(50);
    expect(photo.poiDistance).toBeLessThan(100);
    expect(await row('SELECT created_by FROM pois WHERE id = ?1', photo.poiId)).toEqual({ created_by: alice.me.id });
  });

  it('reuses a provider place with the same source id', async () => {
    const newPoi = { name: '西湖', category: '湖', lat: 30.24, lng: 120.14, source: 'osm', sourceId: 'way/123' };
    const a = await upload(alice, { lat: 30.24, lng: 120.14, newPoi });
    const b = await upload(bob, { lat: 30.241, lng: 120.141, newPoi: { ...newPoi, name: '西湖（另一个名字）' } });
    expect(b.poiId).toBe(a.poiId);
    expect(await row('SELECT COUNT(*) AS n FROM pois')).toEqual({ n: 1 });
  });

  it('refuses a poiId that does not exist', async () => {
    expect((await uploadRaw(alice, uploadForm({ poiId: 'poi_missing' }))).status).toBe(400);
  });

  it('appends the photo to the uploader’s own themes in themeIds', async () => {
    const first = await upload(alice);
    const mine = expectStatus(await alice.post('/api/themes', { kind: 'topic', title: '我的', photoIds: [first.id] }), 201).theme.id;
    const bobs = expectStatus(await bob.post('/api/themes', { kind: 'topic', title: '别人的' }), 201).theme.id;
    const photo = await upload(alice, { themeIds: [mine, bobs, 'th_missing'] });

    const items = await rows('SELECT photo_id, position FROM theme_items WHERE theme_id = ?1 ORDER BY position', mine);
    expect(items).toEqual([
      { photo_id: first.id, position: 0 },
      { photo_id: photo.id, position: 1 }
    ]);
    expect(await rows('SELECT * FROM theme_items WHERE theme_id = ?1', bobs)).toEqual([]);
    expect(photo.themes.map((t) => t.id)).toEqual([mine]);
  });

  it('answers 502 and writes nothing when R2 fails', async () => {
    const media = platform.env.MEDIA;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // the large size fails; everything else reaches the real bucket
    platform.env.MEDIA = {
      put: (key: string, value: Blob, options?: R2PutOptions) =>
        key.endsWith('/l.webp') ? Promise.reject(new Error('R2 is down')) : media.put(key, value, options),
      delete: (keys: string | string[]) => media.delete(keys)
    } as unknown as R2Bucket;
    try {
      const res = await uploadRaw(alice, uploadForm());
      expect(res.status).toBe(502);
      expect(res.body).toMatchObject({ error: 'upstream_failed' });
    } finally {
      platform.env.MEDIA = media;
      error.mockRestore();
    }
    expect(await row('SELECT COUNT(*) AS n FROM photos')).toEqual({ n: 0 });
    // the parts that did get stored are removed again
    expect(await r2Keys()).toEqual([]);
  });
});

describe('GET /api/photos ordering', () => {
  it('puts photos without a capture time after the dated ones', async () => {
    const undated = await upload(alice);
    const older = await upload(alice, { takenAt: '2025-01-01T00:00:00' });
    const newer = await upload(alice, { takenAt: '2026-01-01T00:00:00' });
    const undatedLater = await upload(alice);
    const list = expectStatus(await alice.get('/api/photos?mine=1'), 200).photos as PhotoDetail[];
    expect(list.slice(0, 2).map((p) => p.id)).toEqual([newer.id, older.id]);
    expect(
      list
        .slice(2)
        .map((p) => p.id)
        .sort()
    ).toEqual([undated.id, undatedLater.id].sort());
  });
});

describe('PATCH /api/photos/:id', () => {
  it('replaces the tags, keeping only presets and the owner’s own', async () => {
    const own = expectStatus(await alice.post('/api/tags', { name: '我的标签' }), 201).tag.id;
    const others = expectStatus(await bob.post('/api/tags', { name: '别人的标签' }), 201).tag.id;
    const photo = await upload(alice, { tagIds: ['lake'] });
    const updated = expectStatus(await alice.patch(`/api/photos/${photo.id}`, { tagIds: ['sea', own, others] }), 200).photo;
    expect([...updated.tagIds].sort((a: string, b: string) => a.localeCompare(b))).toEqual(
      ['sea', own as string].sort((a, b) => a.localeCompare(b))
    );
    expect(updated.updatedAt).toBeTruthy();
    expect(await rows('SELECT tag_id, source FROM photo_tags WHERE photo_id = ?1 ORDER BY tag_id', photo.id)).toEqual(
      [
        { tag_id: own, source: 'manual' },
        { tag_id: 'sea', source: 'manual' }
      ].sort((a, b) => a.tag_id.localeCompare(b.tag_id))
    );
    expect(expectStatus(await alice.patch(`/api/photos/${photo.id}`, { tagIds: [] }), 200).photo.tagIds).toEqual([]);
  });

  it('sets, changes and clears the place', async () => {
    const photo = await upload(alice, { lat: 30.2588, lng: 120.1512 });
    const place = expectStatus(await alice.post('/api/pois', { name: '断桥', category: '桥', lat: 30.2593, lng: 120.1517 }), 201).poi;

    const set = expectStatus(await alice.patch(`/api/photos/${photo.id}`, { poiId: place.id, poiMethod: 'confirmed' }), 200).photo;
    expect(set).toMatchObject({ poiId: place.id, poiMethod: 'confirmed' });
    expect(set.poiDistance).toBeGreaterThan(50);

    const created = expectStatus(
      await alice.patch(`/api/photos/${photo.id}`, { newPoi: { name: '白堤', category: '堤', lat: 30.257, lng: 120.148 } }),
      200
    ).photo;
    expect(created.poi).toMatchObject({ name: '白堤', category: '堤' });
    expect(created.poiMethod).toBe('manual');

    const cleared = expectStatus(await alice.patch(`/api/photos/${photo.id}`, { poiId: null }), 200).photo;
    expect(cleared).toMatchObject({ poiId: null, poi: null, poiDistance: null, poiMethod: null });

    expect((await alice.patch(`/api/photos/${photo.id}`, { poiId: 'poi_missing' })).status).toBe(400);
  });

  it('changes visibility and location precision, and others see the result', async () => {
    const photo = await upload(alice, { lat: 30.2588, lng: 120.1512 });
    const anon = new Client(platform);
    expectStatus(await alice.patch(`/api/photos/${photo.id}`, { visibility: 'private' }), 200);
    expect((await anon.get(`/api/photos/${photo.id}`)).status).toBe(404);
    expect(expectStatus(await anon.get('/api/photos'), 200).photos).toEqual([]);

    expectStatus(await alice.patch(`/api/photos/${photo.id}`, { visibility: 'public', geoPrivacy: 'hidden' }), 200);
    const seen = expectStatus(await anon.get(`/api/photos/${photo.id}`), 200);
    expect(seen).toMatchObject({ visibility: 'public', geoPrivacy: 'hidden', lat: null, lng: null });

    expect((await alice.patch(`/api/photos/${photo.id}`, { visibility: 'friends' })).status).toBe(400);
  });

  it('drops the edge copies when a photo becomes private', async () => {
    const photo = await upload(alice);
    const path = `/media/${photo.variants.m.key}`;
    const anon = new Client(platform);
    expect((await anon.fetch(path)).status).toBe(200);
    expect(await platform.cached(path)).toBe(true);
    expectStatus(await alice.patch(`/api/photos/${photo.id}`, { visibility: 'private' }), 200);
    expect(await platform.cached(path)).toBe(false);
    expect((await anon.fetch(path)).status).toBe(404);
    expect((await alice.fetch(path)).status).toBe(200);
  });

  it('cannot be done by anyone else', async () => {
    const pub = await upload(alice, { title: 'mine' });
    const priv = await upload(alice, { title: 'mine', visibility: 'private' });
    const res = await bob.patch(`/api/photos/${pub.id}`, { title: 'theirs' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden' });
    // a private photo of someone else does not exist, as far as others can tell
    expect((await bob.patch(`/api/photos/${priv.id}`, { title: 'theirs' })).status).toBe(404);
    expect((await new Client(platform).patch(`/api/photos/${pub.id}`, { title: 'theirs' })).status).toBe(401);
    expect(expectStatus(await alice.get(`/api/photos/${pub.id}`), 200).title).toBe('mine');
  });

  it('is a 404 for a photo that does not exist', async () => {
    expect((await alice.patch('/api/photos/ph_missing', { title: 'x' })).status).toBe(404);
  });
});

describe('DELETE /api/photos/:id', () => {
  it('removes the files, the row, its tags and theme items, and the references to it', async () => {
    const keep = await upload(alice);
    const photo = await upload(alice, { tagIds: ['lake'] });
    const theme = expectStatus(
      await alice.post('/api/themes', { kind: 'topic', title: '主题', photoIds: [keep.id, photo.id], coverPhotoId: photo.id }),
      201
    ).theme;
    expectStatus(await alice.patch('/api/me', { avatarPhotoId: photo.id }), 200);
    const anon = new Client(platform);
    const media = `/media/${photo.variants.s.key}`;
    expect((await anon.fetch(media)).status).toBe(200); // now in the edge cache too

    expect(expectStatus(await alice.del(`/api/photos/${photo.id}`), 200)).toEqual({ ok: true });

    expect((await alice.get(`/api/photos/${photo.id}`)).status).toBe(404);
    const left = await r2Keys();
    expect(left.some((k) => k.includes(photo.id))).toBe(false);
    expect(left.filter((k) => k.includes(keep.id))).toHaveLength(4);
    expect(await rows('SELECT * FROM photo_tags WHERE photo_id = ?1', photo.id)).toEqual([]);
    expect(await rows('SELECT * FROM theme_items WHERE photo_id = ?1', photo.id)).toEqual([]);
    expect(expectStatus(await alice.get('/api/auth/me'), 200).user.avatarPhotoId).toBeNull();
    const after = expectStatus(await alice.get(`/api/themes/${theme.id}`), 200);
    expect(after.coverPhotoId).toBeNull();
    expect(after.items.map((i: Json) => i.photoId)).toEqual([keep.id]);
    expect((await anon.fetch(media)).status).toBe(404);
  });

  it('cannot be done by anyone else', async () => {
    const pub = await upload(alice);
    const priv = await upload(alice, { visibility: 'private' });
    expect((await bob.del(`/api/photos/${pub.id}`)).status).toBe(403);
    expect((await bob.del(`/api/photos/${priv.id}`)).status).toBe(404);
    expect((await new Client(platform).del(`/api/photos/${pub.id}`)).status).toBe(401);
    expect(await r2Keys()).toHaveLength(8);
  });
});
