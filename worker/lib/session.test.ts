import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { AppEnv, Env } from '../env';
import { fakeD1, fakeKv } from '../test-utils';
import { HttpError } from './http';
import {
  SESSION_COOKIE,
  SESSION_TTL,
  currentUser,
  endSession,
  isStaff,
  requireRole,
  requireUser,
  startSession,
  toSessionUser,
  viewerId
} from './session';

const USER_ROW = { id: 'u_1', handle: 'ada', display_name: 'Ada', bio: '拍照的人', avatar_photo_id: 'ph_9', role: 'admin' as const };
const TOKEN = 'A'.repeat(43);

/** The app's session helpers behind four tiny routes. */
function makeApp() {
  const app = new Hono<AppEnv>();
  app.post('/login', async (c) => {
    await startSession(c, 'u_1');
    return c.json({ ok: true });
  });
  app.post('/logout', async (c) => {
    await endSession(c);
    return c.json({ ok: true });
  });
  app.get('/who', async (c) => c.json({ viewer: await viewerId(c), user: await currentUser(c) }));
  app.get('/private', async (c) => c.json(await requireUser(c)));
  app.onError((err, c) =>
    err instanceof HttpError ? c.json({ error: err.code, message: err.message }, err.status as ContentfulStatusCode) : c.text('boom', 500)
  );
  return app;
}

function setup(sessions: Record<string, unknown> = {}, userRow: unknown = USER_ROW) {
  const kv = fakeKv(sessions);
  const get = vi.spyOn(kv.kv, 'get');
  const d1 = fakeD1(() => userRow);
  const env = { KV: kv.kv, DB: d1.db } as unknown as Env;
  const app = makeApp();
  const call = (path: string, method = 'GET', cookie?: string) =>
    app.request(path, { method, headers: cookie === undefined ? {} : { cookie } }, env);
  return { call, kv, kvGet: get, d1 };
}

const setCookie = (res: Response) => res.headers.get('set-cookie') ?? '';
const tokenOf = (cookie: string) => /living_session=([^;]*)/.exec(cookie)?.[1] ?? '';

describe('constants', () => {
  it('match the documented cookie name and 30 day lifetime', () => {
    expect(SESSION_COOKIE).toBe('living_session');
    expect(SESSION_TTL).toBe(30 * 24 * 60 * 60);
  });
});

describe('startSession', () => {
  it('sets a hardened cookie holding a 32-byte url-safe random token', async () => {
    const { call } = setup();
    const res = await call('/login', 'POST');
    const cookie = setCookie(res);
    expect(tokenOf(cookie)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain(`Max-Age=${SESSION_TTL}`);
  });

  it('stores the session in KV under the token, expiring with the cookie', async () => {
    const { call, kv } = setup();
    const token = tokenOf(setCookie(await call('/login', 'POST')));
    expect(kv.puts).toHaveLength(1);
    expect(kv.puts[0].key).toBe(`sess:${token}`);
    expect(kv.puts[0].options).toEqual({ expirationTtl: SESSION_TTL });
    const stored = JSON.parse(kv.puts[0].value) as { userId: string; createdAt: string };
    expect(stored.userId).toBe('u_1');
    expect(stored.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('issues a different token for every sign-in', async () => {
    const { call } = setup();
    const a = tokenOf(setCookie(await call('/login', 'POST')));
    const b = tokenOf(setCookie(await call('/login', 'POST')));
    expect(a).not.toBe(b);
  });

  it('retires the session the browser presented, so a stale token cannot be reused after signing in again', async () => {
    const { call, kv } = setup({ [`sess:${TOKEN}`]: { userId: 'u_1' } });
    const token = tokenOf(setCookie(await call('/login', 'POST', `${SESSION_COOKIE}=${TOKEN}`)));
    expect(kv.store.has(`sess:${TOKEN}`)).toBe(false);
    expect(kv.store.has(`sess:${token}`)).toBe(true);
  });

  it('does not let a malformed cookie value choose which KV key gets deleted', async () => {
    const { call, kv } = setup({ 'sess:short': { userId: 'u_other' }, 'sess:': { userId: 'u_other' } });
    await call('/login', 'POST', `${SESSION_COOKIE}=short`);
    await call('/login', 'POST', `${SESSION_COOKIE}=`);
    expect(kv.store.has('sess:short')).toBe(true);
    expect(kv.store.has('sess:')).toBe(true);
  });
});

describe('viewerId', () => {
  it('is the user id stored for the session token in the cookie', async () => {
    const { call } = setup({ [`sess:${TOKEN}`]: { userId: 'u_7', createdAt: '2026-11-08T00:00:00Z' } });
    const res = await call('/who', 'GET', `${SESSION_COOKIE}=${TOKEN}`);
    expect((await res.json()) as { viewer: string }).toMatchObject({ viewer: 'u_7' });
  });

  it('is null without a cookie, with an unknown token, or with a session that names no user', async () => {
    const { call } = setup({ [`sess:${TOKEN}`]: { createdAt: 'x' }, ['sess:' + 'B'.repeat(43)]: { userId: 42 } });
    for (const cookie of [
      undefined,
      `${SESSION_COOKIE}=${'C'.repeat(43)}`,
      `${SESSION_COOKIE}=${TOKEN}`,
      `${SESSION_COOKIE}=${'B'.repeat(43)}`
    ]) {
      const res = await call('/who', 'GET', cookie);
      expect(((await res.json()) as { viewer: unknown }).viewer, String(cookie)).toBeNull();
    }
  });

  it('does not even consult KV for a cookie that cannot be a token', async () => {
    const { call, kvGet } = setup({ 'sess:short': { userId: 'u_x' } });
    for (const value of ['short', 'x'.repeat(65), 'has space ', '../etc/passwd', 'a%2Fb'.padEnd(30, 'a')]) {
      const res = await call('/who', 'GET', `${SESSION_COOKIE}=${encodeURIComponent(value)}`);
      expect(((await res.json()) as { viewer: unknown }).viewer, value).toBeNull();
    }
    expect(kvGet).not.toHaveBeenCalled();
  });

  it('is null when KV cannot be read', async () => {
    const { call, kv } = setup({ [`sess:${TOKEN}`]: { userId: 'u_7' } });
    vi.spyOn(kv.kv, 'get').mockRejectedValue(new Error('KV down'));
    const res = await call('/who', 'GET', `${SESSION_COOKIE}=${TOKEN}`);
    expect(((await res.json()) as { viewer: unknown }).viewer).toBeNull();
  });

  it('is looked up once per request, however often it is asked', async () => {
    const { call, kvGet, d1 } = setup({ [`sess:${TOKEN}`]: { userId: 'u_1' } });
    // /who asks for the viewer and then for the user, which needs the viewer again
    await call('/who', 'GET', `${SESSION_COOKIE}=${TOKEN}`);
    expect(kvGet).toHaveBeenCalledTimes(1);
    expect(d1.calls).toHaveLength(1);
  });
});

describe('currentUser / requireUser', () => {
  it('loads the signed-in user from the database as a SessionUser', async () => {
    const { call, d1 } = setup({ [`sess:${TOKEN}`]: { userId: 'u_1' } });
    const res = await call('/private', 'GET', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: 'u_1',
      handle: 'ada',
      displayName: 'Ada',
      bio: '拍照的人',
      avatarPhotoId: 'ph_9',
      role: 'admin'
    });
    expect(d1.calls[0].params).toEqual(['u_1']);
  });

  it('answers 401 in Chinese when nobody is signed in', async () => {
    const { call, d1 } = setup();
    const res = await call('/private');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthenticated', message: '请先登录' });
    // no session, no database lookup
    expect(d1.calls).toEqual([]);
  });

  it('treats a session whose user no longer exists as signed out', async () => {
    const { call } = setup({ [`sess:${TOKEN}`]: { userId: 'u_gone' } }, null);
    const res = await call('/who', 'GET', `${SESSION_COOKIE}=${TOKEN}`);
    expect(await res.json()).toEqual({ viewer: 'u_gone', user: null });
    expect((await call('/private', 'GET', `${SESSION_COOKIE}=${TOKEN}`)).status).toBe(401);
  });
});

describe('endSession', () => {
  it('forgets the session in KV and clears the cookie', async () => {
    const { call, kv } = setup({ [`sess:${TOKEN}`]: { userId: 'u_1' } });
    const res = await call('/logout', 'POST', `${SESSION_COOKIE}=${TOKEN}`);
    expect(kv.store.has(`sess:${TOKEN}`)).toBe(false);
    const cookie = setCookie(res);
    expect(cookie).toContain(`${SESSION_COOKIE}=;`);
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Secure');
    // and the old token is useless afterwards
    const after = await call('/who', 'GET', `${SESSION_COOKIE}=${TOKEN}`);
    expect(((await after.json()) as { viewer: unknown }).viewer).toBeNull();
  });

  it('is harmless without a session', async () => {
    const { call } = setup();
    expect((await call('/logout', 'POST')).status).toBe(200);
  });

  it('leaves other sessions alone', async () => {
    const other = 'D'.repeat(43);
    const { call, kv } = setup({ [`sess:${TOKEN}`]: { userId: 'u_1' }, [`sess:${other}`]: { userId: 'u_1' } });
    await call('/logout', 'POST', `${SESSION_COOKIE}=${TOKEN}`);
    expect(kv.store.has(`sess:${other}`)).toBe(true);
  });
});

describe('toSessionUser / isStaff / requireRole', () => {
  it('maps a user row to the API shape', () => {
    expect(toSessionUser(USER_ROW)).toEqual({
      id: 'u_1',
      handle: 'ada',
      displayName: 'Ada',
      bio: '拍照的人',
      avatarPhotoId: 'ph_9',
      role: 'admin'
    });
    expect(toSessionUser({ ...USER_ROW, bio: null, avatar_photo_id: null })).toMatchObject({ bio: null, avatarPhotoId: null });
  });

  it('counts owners and admins as staff, and members as not', () => {
    expect(isStaff({ role: 'owner' })).toBe(true);
    expect(isStaff({ role: 'admin' })).toBe(true);
    expect(isStaff({ role: 'member' })).toBe(false);
  });

  it('requireRole lets the listed roles through and answers 403 to the rest', () => {
    const member = toSessionUser({ ...USER_ROW, role: 'member' });
    const owner = toSessionUser({ ...USER_ROW, role: 'owner' });
    expect(() => requireRole(owner, 'owner', 'admin')).not.toThrow();
    expect(() => requireRole(toSessionUser(USER_ROW), 'owner', 'admin')).not.toThrow();
    let error: unknown;
    try {
      requireRole(member, 'owner', 'admin');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 403, code: 'forbidden', message: '只有站长或管理员可以执行这个操作' });
    expect(() => requireRole(owner)).toThrow(HttpError);
  });
});
