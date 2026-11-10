// Privacy zones, invites and the registration setting against real D1: docs/api/users-admin.md.

import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { destination } from '../../shared/geo';
import type { Invite, PhotoDetail } from '../../shared/types';
import { Client, expectStatus, newUser, PASSWORD, upload, usePlatform } from '../test-platform';

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

describe('privacy zones', () => {
  it('are created, listed and deleted by their owner only', async () => {
    const home = expectStatus(await alice.post('/api/privacy-zones', { name: '家', lat: 30.25, lng: 120.15 }), 201).zone;
    expect(home).toMatchObject({ name: '家', lat: 30.25, lng: 120.15, radius: 300 });
    expect(home.id).toMatch(/^pz_/);
    const work = expectStatus(await alice.post('/api/privacy-zones', { name: '公司', lat: 30.3, lng: 120.2, radius: 50 }), 201).zone;

    expect(expectStatus(await alice.get('/api/privacy-zones'), 200).zones).toEqual([home, work]);
    expect(expectStatus(await bob.get('/api/privacy-zones'), 200).zones).toEqual([]);

    // someone else's zone looks like a missing one
    expect((await bob.del(`/api/privacy-zones/${home.id}`)).status).toBe(404);
    expect(expectStatus(await alice.del(`/api/privacy-zones/${home.id}`), 200)).toEqual({ ok: true });
    expect(expectStatus(await alice.get('/api/privacy-zones'), 200).zones).toEqual([work]);
    expect((await alice.del(`/api/privacy-zones/${home.id}`)).status).toBe(404);
  });

  it('hide the position of the creator’s photos already inside the new zone', async () => {
    const HOME = { lat: 30.25, lng: 120.15 };
    const near = (bearing: number, meters: number) => {
      const [lat, lng] = destination(HOME.lat, HOME.lng, bearing, meters);
      return { lat, lng };
    };
    const place = expectStatus(await alice.post('/api/pois', { name: '楼下', category: '景', ...near(0, 40) }), 201).poi;
    const inside = await upload(alice, { ...near(90, 120), poiId: place.id, visibility: 'public', geoPrivacy: 'exact', heading: 45 });
    const fuzzy = await upload(alice, { ...near(200, 250), visibility: 'public', geoPrivacy: 'fuzzy' });
    const outside = await upload(alice, { ...near(45, 320), visibility: 'public', geoPrivacy: 'exact' });
    const bobs = await upload(bob, { ...near(0, 10), visibility: 'public', geoPrivacy: 'exact' });
    // placed inside only through its place: no coordinates of its own to hide
    const viaPlace = await upload(alice, { poiId: place.id, visibility: 'public', geoPrivacy: 'exact' });

    const visitor = new Client(platform);
    const seen = async (id: string) => expectStatus(await visitor.get<PhotoDetail>(`/api/photos/${id}`), 200);
    expect((await seen(inside.id)).lat).not.toBeNull();

    const res = expectStatus(await alice.post('/api/privacy-zones', { name: '家', ...HOME, radius: 300 }), 201);
    expect(res.hiddenPhotos).toBe(2);

    for (const id of [inside.id, fuzzy.id]) {
      const p = await seen(id);
      expect(p, id).toMatchObject({ geoPrivacy: 'hidden', lat: null, lng: null, heading: null, poiId: null, poi: null, district: null });
    }
    // the gallery agrees
    const gallery = expectStatus(await visitor.get<{ photos: PhotoDetail[] }>('/api/photos'), 200).photos;
    expect(gallery.find((p) => p.id === inside.id)).toMatchObject({ geoPrivacy: 'hidden', lat: null, poiId: null });
    // the owner still sees everything, and the photo says it is hidden now
    expect(expectStatus(await alice.get<PhotoDetail>(`/api/photos/${inside.id}`), 200)).toMatchObject({
      geoPrivacy: 'hidden',
      lat: inside.lat,
      poiId: place.id
    });
    for (const id of [outside.id, bobs.id, viaPlace.id]) expect((await seen(id)).geoPrivacy, id).toBe('exact');

    // a wider zone over the same spot hides only what is not hidden yet; deleting the zones restores nothing
    const again = expectStatus(await alice.post('/api/privacy-zones', { name: '还是家', ...HOME, radius: 500 }), 201);
    expect(again.hiddenPhotos).toBe(1);
    for (const z of expectStatus(await alice.get('/api/privacy-zones'), 200).zones) await alice.del(`/api/privacy-zones/${z.id}`);
    expect((await seen(inside.id)).geoPrivacy).toBe('hidden');
    expect((await seen(outside.id)).geoPrivacy).toBe('hidden');
  });

  it('check name, coordinates and radius (50 to 5000 m), and need a session', async () => {
    for (const body of [
      { lat: 30, lng: 120 },
      { name: '家', lat: 91, lng: 120 },
      { name: '家', lat: 30 },
      { name: '家', lat: 30, lng: 120, radius: 49 },
      { name: '家', lat: 30, lng: 120, radius: 5001 }
    ]) {
      expect((await alice.post('/api/privacy-zones', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await new Client(platform).get('/api/privacy-zones')).status).toBe(401);
  });
});

describe('invites', () => {
  it('are managed by the site owner and admins only', async () => {
    expect((await alice.get('/api/admin/invites')).status).toBe(403);
    expect((await alice.post('/api/admin/invites', {})).status).toBe(403);
    expect((await new Client(platform).get('/api/admin/invites')).status).toBe(401);
    expect((await new Client(platform).post('/api/admin/invites', {})).status).toBe(401);
  });

  it('are created with the documented code, role, note and expiry, and listed newest first', async () => {
    const first = expectStatus(await admin.post('/api/admin/invites', { note: '给小王' }), 201).invite as Invite;
    expect(first.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/);
    expect(first).toMatchObject({ role: 'member', note: '给小王', usedBy: null, usedByHandle: null, usedAt: null, expiresAt: null });

    const second = expectStatus(await owner.post('/api/admin/invites', { role: 'admin', expiresInDays: 7 }), 201).invite as Invite;
    expect(second.role).toBe('admin');
    const days = (Date.parse(second.expiresAt as string) - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    const list = expectStatus(await owner.get('/api/admin/invites'), 200).invites as Invite[];
    expect(list.map((i) => i.code)).toEqual([second.code, first.code]);
  });

  it('for admins can only be made by the site owner', async () => {
    const res = await admin.post('/api/admin/invites', { role: 'admin' });
    expect(res.status).toBe(403);
    expect((await owner.post('/api/admin/invites', { role: 'owner' })).status).toBe(400);
    expect((await owner.post('/api/admin/invites', { expiresInDays: 0 })).status).toBe(400);
  });

  it('register a user once, show who used them, and cannot be deleted after use', async () => {
    const invite = expectStatus(await owner.post('/api/admin/invites', {}), 201).invite as Invite;
    const carol = expectStatus(
      await new Client(platform).post('/api/auth/register', {
        handle: 'carol',
        displayName: 'Carol',
        password: PASSWORD,
        invite: invite.code.toLowerCase()
      }),
      201
    ).user;
    const used = (expectStatus(await owner.get('/api/admin/invites'), 200).invites as Invite[]).find((i) => i.code === invite.code);
    expect(used).toMatchObject({ usedBy: carol.id, usedByHandle: 'carol' });
    expect(used?.usedAt).toBeTruthy();

    const res = await owner.del(`/api/admin/invites/${invite.code}`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'conflict' });
  });

  it('can be deleted while unused', async () => {
    const invite = expectStatus(await owner.post('/api/admin/invites', {}), 201).invite as Invite;
    expect((await alice.del(`/api/admin/invites/${invite.code}`)).status).toBe(403);
    expect(expectStatus(await admin.del(`/api/admin/invites/${invite.code}`), 200)).toEqual({ ok: true });
    expect(expectStatus(await owner.get('/api/admin/invites'), 200).invites).toEqual([]);
    expect((await owner.del(`/api/admin/invites/${invite.code}`)).status).toBe(404);
  });
});

describe('registration setting', () => {
  it('is read and changed by the site owner and admins only', async () => {
    expect(expectStatus(await owner.get('/api/admin/settings'), 200)).toEqual({ registration: 'invite' });
    expect(expectStatus(await admin.patch('/api/admin/settings', { registration: 'open' }), 200)).toEqual({ registration: 'open' });
    expect(expectStatus(await new Client(platform).get('/api/site'), 200).registration).toBe('open');

    expect((await alice.get('/api/admin/settings')).status).toBe(403);
    expect((await alice.patch('/api/admin/settings', { registration: 'closed' })).status).toBe(403);
    for (const body of [{}, { registration: 'everyone' }, { registration: null }]) {
      expect((await owner.patch('/api/admin/settings', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(expectStatus(await owner.get('/api/admin/settings'), 200)).toEqual({ registration: 'open' });
  });

  it('closes registration', async () => {
    expectStatus(await owner.patch('/api/admin/settings', { registration: 'closed' }), 200);
    const res = await new Client(platform).post('/api/auth/register', { handle: 'dave', displayName: 'Dave', password: PASSWORD });
    expect(res.status).toBe(403);
  });
});
