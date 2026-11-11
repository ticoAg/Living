// Accounts against real D1 and KV: docs/api/auth.md.

import { describe, expect, it } from 'vite-plus/test';
import { addInvite, Client, expectStatus, newUser, PASSWORD, usePlatform } from '../test-platform';

const platform = usePlatform();

const signUp = (client: Client, handle: string, invite?: string, password = PASSWORD) =>
  client.post('/api/auth/register', { handle, displayName: `${handle} 的名字`, password, invite });

const daysFromNow = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

describe('POST /api/auth/register', () => {
  it('creates the first account, as site owner, from an owner invite', async () => {
    await addInvite(platform, 'OWNERCODE1', 'owner');
    expect(expectStatus(await new Client(platform).get('/api/site'), 200).needsSetup).toBe(true);

    const client = new Client(platform);
    const res = await signUp(client, 'Alice', 'ownercode1'); // codes are case-insensitive
    const user = expectStatus(res, 201).user;
    expect(user).toMatchObject({ handle: 'Alice', displayName: 'Alice 的名字', role: 'owner', bio: null, avatarPhotoId: null });
    expect(user.id).toMatch(/^u_/);
    expect(user).not.toHaveProperty('passwordHash');

    // signed in right away, with the documented cookie
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^living_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(expectStatus(await client.get('/api/auth/me'), 200).user).toEqual(user);

    // the session lives in KV
    const stored = await platform.env.KV.get<{ userId: string }>(`sess:${client.cookie}`, 'json');
    expect(stored?.userId).toBe(user.id);
    // the invite is spent
    const invite = await platform.env.DB.prepare('SELECT used_by, used_at FROM invites WHERE code = ?1').bind('OWNERCODE1').first();
    expect(invite).toMatchObject({ used_by: user.id });
    expect(invite?.used_at).toBeTruthy();
    expect(expectStatus(await new Client(platform).get('/api/site'), 200).needsSetup).toBe(false);
  });

  it('requires an owner invite while there is no account', async () => {
    await addInvite(platform, 'MEMBERCODE', 'member');
    expect((await signUp(new Client(platform), 'alice')).status).toBe(400);
    expect((await signUp(new Client(platform), 'alice', 'MEMBERCODE')).status).toBe(400);
    expect((await signUp(new Client(platform), 'alice', 'NOSUCHCODE')).status).toBe(400);
    expect(expectStatus(await new Client(platform).get('/api/site'), 200).needsSetup).toBe(true);
  });

  it('gives a later account the role of its invite', async () => {
    await newUser(platform, 'site_owner', 'owner');
    await addInvite(platform, 'MEMBER1', 'member');
    await addInvite(platform, 'ADMIN1', 'admin');
    expect(expectStatus(await signUp(new Client(platform), 'bob', 'MEMBER1'), 201).user.role).toBe('member');
    expect(expectStatus(await signUp(new Client(platform), 'carol', 'ADMIN1'), 201).user.role).toBe('admin');
  });

  it('turns down used and expired invites, and asks for one in invite mode', async () => {
    await newUser(platform, 'site_owner', 'owner');
    await addInvite(platform, 'ONCE', 'member');
    await addInvite(platform, 'EXPIRED', 'member', daysFromNow(-1));
    await addInvite(platform, 'LATER', 'member', daysFromNow(1));
    expectStatus(await signUp(new Client(platform), 'bob', 'ONCE'), 201);

    const used = await signUp(new Client(platform), 'carol', 'ONCE');
    expect(used.status).toBe(400);
    expect(used.body).toMatchObject({ error: 'invalid_input' });
    expect((await signUp(new Client(platform), 'carol', 'EXPIRED')).status).toBe(400);
    expect((await signUp(new Client(platform), 'carol')).status).toBe(400);
    expectStatus(await signUp(new Client(platform), 'carol', 'LATER'), 201);
  });

  it('keeps handles unique regardless of case', async () => {
    await newUser(platform, 'site_owner', 'owner');
    await addInvite(platform, 'A1', 'member');
    await addInvite(platform, 'A2', 'member');
    expectStatus(await signUp(new Client(platform), 'Bob', 'A1'), 201);
    const res = await signUp(new Client(platform), 'bob', 'A2');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'conflict' });
    // the invite is still unused after the refusal
    expectStatus(await signUp(new Client(platform), 'bobby', 'A2'), 201);
  });

  it('checks handle, display name and password', async () => {
    await newUser(platform, 'site_owner', 'owner');
    await platform.env.DB.prepare(`UPDATE settings SET value = 'open' WHERE key = 'registration'`).run();
    for (const handle of ['ab', '_bob', 'bob!', 'a'.repeat(25), 'admin', 'Settings', 'www']) {
      expect((await signUp(new Client(platform), handle)).status, handle).toBe(400);
    }
    expect((await signUp(new Client(platform), 'bob', undefined, 'short')).status).toBe(400);
    const noName = await new Client(platform).post('/api/auth/register', { handle: 'bob', displayName: ' ', password: PASSWORD });
    expect(noName.status).toBe(400);
  });

  it('follows the registration setting once the site is set up', async () => {
    await newUser(platform, 'site_owner', 'owner');
    const setMode = (mode: string) => platform.env.DB.prepare(`UPDATE settings SET value = ?1 WHERE key = 'registration'`).bind(mode).run();

    await setMode('open');
    expect(expectStatus(await signUp(new Client(platform), 'bob'), 201).user.role).toBe('member');
    await addInvite(platform, 'ADMINOPEN', 'admin');
    expect(expectStatus(await signUp(new Client(platform), 'carol', 'ADMINOPEN'), 201).user.role).toBe('admin');

    await setMode('closed');
    await addInvite(platform, 'CLOSED1', 'member');
    const closed = await signUp(new Client(platform), 'dave', 'CLOSED1');
    expect(closed.status).toBe(403);
    expect(closed.body).toMatchObject({ error: 'forbidden' });
  });

  it('does not give new users copies of the preset tags', async () => {
    const owner = await newUser(platform, 'site_owner', 'owner');
    const tags = expectStatus(await owner.get('/api/tags'), 200).tags as { ownerId: string | null }[];
    expect(tags.every((t) => t.ownerId === null)).toBe(true);
  });
});

describe('POST /api/auth/login', () => {
  it('signs in with the right password, and fails the same way for a wrong one or an unknown user', async () => {
    const alice = await newUser(platform, 'alice', 'owner');
    const client = new Client(platform);
    const ok = await client.post('/api/auth/login', { handle: 'ALICE', password: PASSWORD });
    expect(expectStatus(ok, 200).user).toMatchObject({ id: alice.me.id, handle: 'alice' });
    expect(client.cookie).toBeTruthy();
    expect(client.cookie).not.toBe(alice.cookie); // a fresh session per sign-in
    expect(expectStatus(await client.get('/api/auth/me'), 200).user.id).toBe(alice.me.id);

    const FAILED = { error: 'unauthenticated', message: '用户名或密码不对' };
    const wrong = await new Client(platform).post('/api/auth/login', { handle: 'alice', password: 'not the password' });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual(FAILED);
    const unknown = await new Client(platform).post('/api/auth/login', { handle: 'nobody', password: PASSWORD });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(FAILED);
  });

  it('allows 5 attempts a minute per address and handle, then answers 429', async () => {
    await newUser(platform, 'alice', 'owner');
    const attacker = new Client(platform, '198.51.100.7');
    for (let i = 1; i <= 5; i++) {
      expect((await attacker.post('/api/auth/login', { handle: 'alice', password: `guess ${i}` })).status, `attempt ${i}`).toBe(401);
    }
    const limited = await attacker.post('/api/auth/login', { handle: 'alice', password: PASSWORD });
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ error: 'rate_limited' });
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(limited.headers.get('retry-after'))).toBeLessThanOrEqual(60);

    // another address is counted separately
    expectStatus(await new Client(platform, '198.51.100.8').post('/api/auth/login', { handle: 'alice', password: PASSWORD }), 200);
  });

  it('starts counting again after a successful sign-in', async () => {
    await newUser(platform, 'alice', 'owner');
    const client = new Client(platform, '198.51.100.9');
    for (let i = 0; i < 4; i++) await client.post('/api/auth/login', { handle: 'alice', password: 'wrong password' });
    expectStatus(await client.post('/api/auth/login', { handle: 'alice', password: PASSWORD }), 200);
    for (let i = 0; i < 5; i++) {
      expect((await client.post('/api/auth/login', { handle: 'alice', password: 'wrong password' })).status).toBe(401);
    }
  });

  it('asks for both fields', async () => {
    expect((await new Client(platform).post('/api/auth/login', { handle: 'alice' })).status).toBe(400);
  });
});

describe('POST /api/auth/logout', () => {
  it('ends the session in KV and clears the cookie', async () => {
    const alice = await newUser(platform, 'alice', 'owner');
    const token = alice.cookie as string;
    const res = await alice.fetch('/api/auth/logout', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(alice.cookie).toBeNull();
    expect(await platform.env.KV.get(`sess:${token}`)).toBeNull();

    // the old token no longer signs anyone in
    const stale = new Client(platform);
    stale.cookie = token;
    expect(expectStatus(await stale.get('/api/auth/me'), 200).user).toBeNull();
    expect((await stale.get('/api/photos?mine=1')).status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('is null without a session, never 401', async () => {
    expect(expectStatus(await new Client(platform).get('/api/auth/me'), 200)).toEqual({ user: null });
    const forged = new Client(platform);
    forged.cookie = 'a'.repeat(43);
    expect(expectStatus(await forged.get('/api/auth/me'), 200)).toEqual({ user: null });
  });
});

describe('POST /api/me/password', () => {
  it('changes the password when the current one is right, without signing out other sessions', async () => {
    const alice = await newUser(platform, 'alice', 'owner');
    const elsewhere = new Client(platform);
    expectStatus(await elsewhere.post('/api/auth/login', { handle: 'alice', password: PASSWORD }), 200);

    const wrong = await alice.post('/api/me/password', { current: 'not it at all', next: 'a brand new password' });
    expect(wrong.status).toBe(400);
    expect((await alice.post('/api/me/password', { current: PASSWORD, next: 'short' })).status).toBe(400);

    expect(expectStatus(await alice.post('/api/me/password', { current: PASSWORD, next: 'a brand new password' }), 200)).toEqual({
      ok: true
    });
    expect((await new Client(platform).post('/api/auth/login', { handle: 'alice', password: PASSWORD })).status).toBe(401);
    expectStatus(await new Client(platform).post('/api/auth/login', { handle: 'alice', password: 'a brand new password' }), 200);
    expect(expectStatus(await elsewhere.get('/api/auth/me'), 200).user?.id).toBe(alice.me.id);
  });

  it('needs a session', async () => {
    expect((await new Client(platform).post('/api/me/password', { current: PASSWORD, next: 'a brand new password' })).status).toBe(401);
  });
});

describe('PATCH /api/me', () => {
  it('updates the profile; the avatar must be one of the user’s own photos', async () => {
    const alice = await newUser(platform, 'alice', 'owner');
    const res = await alice.patch('/api/me', { displayName: '爱丽丝', bio: '拍照的人' });
    expect(expectStatus(res, 200).user).toMatchObject({ displayName: '爱丽丝', bio: '拍照的人' });
    expect((await alice.patch('/api/me', { avatarPhotoId: 'ph_not_mine' })).status).toBe(400);
  });
});

describe('cross-site writes', () => {
  it('are refused even with a valid session', async () => {
    const alice = await newUser(platform, 'alice', 'owner');
    const res = await alice.fetch('/api/me', {
      method: 'PATCH',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'pwned' })
    });
    expect(res.status).toBe(403);
    expect(expectStatus(await alice.get('/api/auth/me'), 200).user.displayName).toBe('alice');
  });
});
