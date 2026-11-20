import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { api, ApiError, onSessionLost } from './api';

const answer = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a 401 from the API', () => {
  it('tells the session layer, and still rejects with the server message', async () => {
    const lost = vi.fn();
    const off = onSessionLost(lost);
    answer(401, { error: 'unauthenticated', message: '请先登录' });
    const err = await api('/api/me', { method: 'PATCH', json: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('请先登录');
    expect(lost).toHaveBeenCalledTimes(1);
    off();
    await api('/api/me').catch(() => {});
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('from /api/auth/* (a wrong password) says nothing about the session', async () => {
    const lost = vi.fn();
    const off = onSessionLost(lost);
    answer(401, { error: 'unauthenticated', message: '用户名或密码不对' });
    await api('/api/auth/login', { json: { handle: 'song', password: 'x' } }).catch(() => {});
    expect(lost).not.toHaveBeenCalled();
    off();
  });

  it('other failures do not count', async () => {
    const lost = vi.fn();
    const off = onSessionLost(lost);
    answer(403, { error: 'forbidden', message: '没有权限' });
    await api('/api/photos/x', { method: 'DELETE' }).catch(() => {});
    expect(lost).not.toHaveBeenCalled();
    off();
  });
});

describe('a request as a visitor', () => {
  it('goes without cookies and past the browser cache; a plain one sends cookies and may use the cache', async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_path: string, init: RequestInit) => {
      seen.push(init);
      return new Response('{}', { status: 200 });
    });
    await api('/api/entries?owner=song', { anonymous: true });
    await api('/api/entries?owner=song');
    expect(seen.map((i) => [i.credentials, i.cache])).toEqual([
      ['omit', 'no-store'],
      ['same-origin', undefined]
    ]);
  });

  it('says nothing about the session when refused for want of one', async () => {
    const lost = vi.fn();
    const off = onSessionLost(lost);
    answer(401, { error: 'unauthenticated', message: '请先登录' });
    const err = await api('/api/entries?mine=1', { anonymous: true }).catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(401);
    expect(lost).not.toHaveBeenCalled();
    off();
  });
});
