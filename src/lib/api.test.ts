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
