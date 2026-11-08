import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Env } from './env';
import app from './index';
import { fakeD1 } from './test-utils';

const SITE = 'https://living.example';

/** A Worker environment with only what the routes under test touch. */
function makeEnv(over: Partial<Env> = {}, siteRow: unknown = { registration: 'invite', users: 1 }): Env {
  const assets = { fetch: async () => new Response('<!doctype html><title>Living</title>', { headers: { 'content-type': 'text/html' } }) };
  return { DB: fakeD1(() => siteRow).db, SITE_NAME: 'Living', SITE_URL: SITE, ASSETS: assets, ...over } as unknown as Env;
}

const request = (path: string, init: RequestInit = {}, env: Env = makeEnv(), base = SITE) => app.request(`${base}${path}`, init, env);
const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/site', () => {
  it('describes the site', async () => {
    const res = await request('/api/site', {}, makeEnv({ SITE_NAME: '我的相册', AMAP_KEY: 'k' }, { registration: 'open', users: 3 }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ name: '我的相册', url: SITE, registration: 'open', hasAmap: true, needsSetup: false });
  });

  it('asks for the owner to be set up while there is no account', async () => {
    const res = await request('/api/site', {}, makeEnv({}, { registration: 'invite', users: 0 }));
    expect(await json(res)).toMatchObject({ needsSetup: true, hasAmap: false });
  });

  it('falls back to invite-only for a missing or unknown registration setting', async () => {
    for (const registration of [null, 'everyone', '']) {
      const res = await request('/api/site', {}, makeEnv({}, { registration, users: 1 }));
      expect(await json(res), String(registration)).toMatchObject({ registration: 'invite' });
    }
  });

  it('defaults the name to Living and the URL to the request origin', async () => {
    const res = await request('/api/site', {}, makeEnv({ SITE_NAME: '', SITE_URL: '' }), 'https://other.example');
    expect(await json(res)).toMatchObject({ name: 'Living', url: 'https://other.example' });
  });

  it('is never cached and is served without content sniffing', async () => {
    const res = await request('/api/site');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });
});

describe('unknown paths', () => {
  it('answer API paths with a JSON 404', async () => {
    for (const path of ['/api/nope', '/api/photos/../x/nope/deeper', '/api']) {
      const res = await request(path);
      expect(res.status, path).toBe(404);
      expect(await json(res), path).toEqual({ error: 'not_found', message: '接口不存在' });
      expect(res.headers.get('Cache-Control'), path).toBe('no-store');
    }
  });

  it('answer media paths with a JSON 404 of their own', async () => {
    const res = await request('/media/nothing/here');
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'not_found', message: '文件不存在' });
  });

  it('hand everything else to the single-page app', async () => {
    const res = await request('/map');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Living</title>');
  });
});

describe('cross-site request protection on /api', () => {
  const post = (init: RequestInit & { headers?: Record<string, string> }, env?: Env, base?: string) =>
    request('/api/nope', { method: 'POST', ...init }, env, base);
  const FORBIDDEN = { error: 'forbidden', message: '不允许跨站请求' };

  it('rejects a write from another origin with 403', async () => {
    const res = await post({ headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual(FORBIDDEN);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('checks every method that can change data', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await request('/api/nope', { method, headers: { origin: 'https://evil.example' } });
      expect(res.status, method).toBe(403);
    }
  });

  it('lets writes from the site itself through to the router', async () => {
    // 404 is the router’s answer; 403 would be the protection’s
    expect((await post({ headers: { origin: SITE } })).status).toBe(404);
  });

  it('also accepts the configured SITE_URL when the Worker is reached on another host', async () => {
    const env = makeEnv({ SITE_URL: SITE });
    expect((await post({ headers: { origin: SITE } }, env, 'https://living.workers.dev')).status).toBe(404);
    expect((await post({ headers: { origin: 'https://living.workers.dev' } }, env, 'https://living.workers.dev')).status).toBe(404);
    expect((await post({ headers: { origin: 'https://evil.example' } }, env, 'https://living.workers.dev')).status).toBe(403);
  });

  it('rejects unparseable origins, including the literal "null" browsers send from sandboxes', async () => {
    for (const origin of ['null', 'garbage', '://', 'https://']) {
      expect((await post({ headers: { origin } })).status, origin).toBe(403);
    }
  });

  it('does not accept a look-alike origin', async () => {
    for (const origin of [
      `${SITE}.evil.example`,
      'https://living.example:8443',
      'http://living.example',
      'https://evil.example/https://living.example'
    ]) {
      expect((await post({ headers: { origin } })).status, origin).toBe(403);
    }
  });

  it('trusts loopback origins only when the Worker itself is not on HTTPS (local development)', async () => {
    const local = 'http://localhost:8787';
    expect((await post({ headers: { origin: 'http://localhost:5173' } }, makeEnv({ SITE_URL: '' }), local)).status).toBe(404);
    expect((await post({ headers: { origin: 'http://127.0.0.1:5173' } }, makeEnv({ SITE_URL: '' }), local)).status).toBe(404);
    expect((await post({ headers: { origin: 'http://[::1]:5173' } }, makeEnv({ SITE_URL: '' }), local)).status).toBe(404);
    // …but never against the deployed, HTTPS site
    expect((await post({ headers: { origin: 'http://localhost:5173' } })).status).toBe(403);
    // and a local Worker still refuses a stranger
    expect((await post({ headers: { origin: 'https://evil.example' } }, makeEnv({ SITE_URL: '' }), local)).status).toBe(403);
  });

  it('without an Origin header, goes by Sec-Fetch-Site', async () => {
    expect((await post({ headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await post({ headers: { 'sec-fetch-site': 'same-site' } })).status).toBe(403);
    expect((await post({ headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(404);
    expect((await post({ headers: { 'sec-fetch-site': 'none' } })).status).toBe(404);
  });

  it('lets clients that are not browsers (no Origin, no Sec-Fetch-Site) through', async () => {
    expect((await post({})).status).toBe(404);
  });

  it('does not look at Sec-Fetch-Site when an Origin is present', async () => {
    expect((await post({ headers: { origin: SITE, 'sec-fetch-site': 'cross-site' } })).status).toBe(404);
    expect((await post({ headers: { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' } })).status).toBe(403);
  });

  it('leaves reads alone, whoever asks', async () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const res = await request('/api/nope', { method, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
      expect(res.status, method).toBe(404);
    }
  });

  it('only guards /api: other paths are not its business', async () => {
    const res = await request('/map', { method: 'POST', headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(200);
  });
});

describe('unexpected errors', () => {
  it('become a generic 500 that reveals nothing about the cause', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = fakeD1(() => {
      throw new Error('SQLITE_ERROR: no such table: secrets (at /srv/app/db.ts:42)');
    });
    const res = await request('/api/site', {}, makeEnv({ DB: failing.db }));
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({ error: 'internal', message: '服务器出错了，请稍后再试' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    // the details go to the log instead
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0].join(' '))).toContain('no such table: secrets');
    expect(String(error.mock.calls[0][0])).toBe('unhandled error');
  });

  it('keep the status and error code of an HttpError thrown by a route', async () => {
    // a write with a foreign origin makes the middleware throw forbidden(): the same mapping serves every route
    const res = await request('/api/photos', { method: 'POST', headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ error: 'forbidden' });
  });
});
