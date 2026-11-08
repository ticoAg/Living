import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { fakeKv } from '../test-utils';
import { CACHE_TTL, PROVIDER_TIMEOUT_MS, USER_AGENT, UpstreamError, fetchJson, kvCached, settle } from './http';

afterEach(() => {
  vi.unstubAllGlobals();
});

type FetchStub = (url: string, init?: RequestInit) => Promise<Response>;

function stubFetch(impl: FetchStub) {
  const stub = vi.fn(impl);
  vi.stubGlobal('fetch', stub);
  return stub;
}

describe('provider constants', () => {
  it('match what the documentation promises', () => {
    // docs/api/pois.md: 8 s timeout, 7 day cache, identifying User-Agent
    expect(PROVIDER_TIMEOUT_MS).toBe(8000);
    expect(CACHE_TTL).toBe(7 * 24 * 60 * 60);
    expect(USER_AGENT).toBe('Living/1.0 (+https://living.ticoag.fun)');
  });
});

describe('fetchJson', () => {
  it('returns the parsed JSON body', async () => {
    stubFetch(async () => Response.json({ ok: true, items: [1, 2] }));
    expect(await fetchJson<{ ok: boolean; items: number[] }>('https://x.example/a', 'x')).toEqual({ ok: true, items: [1, 2] });
  });

  it('identifies the app, asks for JSON, and lets the caller add or override headers', async () => {
    const fetchStub = stubFetch(async () => Response.json({}));
    await fetchJson('https://x.example/a', 'x', { headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/plain' } });
    const init = fetchStub.mock.calls[0][1];
    expect(init?.headers).toEqual({ 'user-agent': USER_AGENT, accept: 'text/plain', 'content-type': 'application/x-www-form-urlencoded' });
  });

  it('passes the request options through and always sets a timeout signal', async () => {
    const fetchStub = stubFetch(async () => Response.json({}));
    await fetchJson('https://x.example/a', 'x', { method: 'POST', body: 'data=1' });
    const init = fetchStub.mock.calls[0][1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('data=1');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchStub.mock.calls[0][0]).toBe('https://x.example/a');
  });

  it('turns an HTTP error status into an UpstreamError that names the label and the status', async () => {
    stubFetch(async () => new Response('busy', { status: 503 }));
    const error = await fetchJson('https://x.example/a', 'overpass').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as Error).message).toBe('overpass: HTTP 503');
  });

  it('turns an unparseable body into an UpstreamError', async () => {
    stubFetch(async () => new Response('<html>not json</html>', { status: 200 }));
    await expect(fetchJson('https://x.example/a', 'amap')).rejects.toThrow(new UpstreamError('amap: invalid JSON'));
  });

  it('turns a network failure into an UpstreamError that names only the error type', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed: https://restapi.amap.com/v3/place/around?key=SECRET-KEY');
    });
    const error = await fetchJson('https://restapi.amap.com/v3/place/around?key=SECRET-KEY', 'amap around').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as Error).message).toBe('amap around: TypeError');
    // the key, and the URL it travels in, stay out of logs
    expect((error as Error).message).not.toContain('SECRET-KEY');
  });

  it('reports a timeout as such', async () => {
    stubFetch(async () => {
      throw new DOMException('The operation timed out', 'TimeoutError');
    });
    await expect(fetchJson('https://x.example/a', 'nominatim')).rejects.toThrow('nominatim: TimeoutError');
  });

  it('says "request failed" when the thrown value is not an Error', async () => {
    stubFetch(async () => Promise.reject('plain string'));
    await expect(fetchJson('https://x.example/a', 'x')).rejects.toThrow('x: request failed');
  });
});

describe('kvCached', () => {
  it('returns a cached value without loading', async () => {
    const { kv } = fakeKv({ 'poi:near': [{ id: 1 }] });
    const load = vi.fn(async () => [{ id: 2 }]);
    expect(await kvCached(kv, 'poi:near', load)).toEqual([{ id: 1 }]);
    expect(load).not.toHaveBeenCalled();
  });

  it('loads on a miss and stores the value as JSON with the seven day expiry', async () => {
    const { kv, puts } = fakeKv();
    const load = vi.fn(async () => ({ city: '杭州' }));
    expect(await kvCached(kv, 'geo:rev', load)).toEqual({ city: '杭州' });
    expect(load).toHaveBeenCalledTimes(1);
    expect(puts).toEqual([{ key: 'geo:rev', value: '{"city":"杭州"}', options: { expirationTtl: 604_800 } }]);
  });

  it('serves the second request from the cache', async () => {
    const { kv } = fakeKv();
    const load = vi.fn(async () => 'fresh');
    await kvCached(kv, 'k', load);
    await kvCached(kv, 'k', load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('takes a custom lifetime', async () => {
    const { kv, puts } = fakeKv();
    await kvCached(kv, 'k', async () => 1, 60);
    expect(puts[0].options).toEqual({ expirationTtl: 60 });
  });

  it('counts empty and falsy values as cached', async () => {
    for (const value of [[], 0, '', false]) {
      const { kv } = fakeKv({ k: value });
      const load = vi.fn(async () => 'loaded');
      expect(await kvCached<unknown>(kv, 'k', load), JSON.stringify(value)).toEqual(value);
      expect(load).not.toHaveBeenCalled();
    }
  });

  it('does not cache a failed load, and lets the error through', async () => {
    const { kv, puts } = fakeKv();
    await expect(
      kvCached(kv, 'k', async () => {
        throw new UpstreamError('overpass: HTTP 500');
      })
    ).rejects.toThrow('overpass: HTTP 500');
    expect(puts).toEqual([]);
    expect(await kvCached(kv, 'k', async () => 'second try')).toBe('second try');
  });

  it('survives a KV that cannot be read', async () => {
    const kv = {
      get: async () => {
        throw new Error('KV unavailable');
      },
      put: async () => {}
    } as unknown as KVNamespace;
    expect(await kvCached(kv, 'k', async () => 'loaded')).toBe('loaded');
  });

  it('survives a KV that cannot be written', async () => {
    const kv = {
      get: async () => null,
      put: async () => {
        throw new Error('KV write limit');
      }
    } as unknown as KVNamespace;
    expect(await kvCached(kv, 'k', async () => 'loaded')).toBe('loaded');
  });
});

describe('settle', () => {
  it('wraps a fulfilled promise', async () => {
    expect(await settle(Promise.resolve(42))).toEqual({ ok: true, value: 42 });
  });

  it('wraps a rejection instead of throwing', async () => {
    const error = new UpstreamError('down');
    expect(await settle(Promise.reject(error))).toEqual({ ok: false, error });
  });

  it('keeps the failure of one lookup from sinking the others', async () => {
    const [a, b, c] = await Promise.all([
      settle(Promise.resolve('a')),
      settle(Promise.reject(new Error('b'))),
      settle(Promise.resolve('c'))
    ]);
    expect(a).toEqual({ ok: true, value: 'a' });
    expect(b.ok).toBe(false);
    expect(c).toEqual({ ok: true, value: 'c' });
  });
});
