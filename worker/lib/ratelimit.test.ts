import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { fakeKv } from '../test-utils';
import type { Ctx } from './http';
import { clear, clientIp, hit } from './ratelimit';

const NOW = new Date('2026-11-08T10:00:00Z');
const nowSec = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const advance = (seconds: number) => vi.setSystemTime(new Date(Date.now() + seconds * 1000));

describe('hit', () => {
  it('lets the first attempts through and reports when the window ends', async () => {
    const { kv } = fakeKv();
    expect(await hit(kv, 'login:1.2.3.4', 5, 900)).toEqual({ ok: true, retryAfter: 900 });
  });

  it('allows `limit` attempts per window and refuses the next one', async () => {
    const { kv } = fakeKv();
    const results = [];
    for (let i = 0; i < 6; i++) results.push((await hit(kv, 'k', 5, 900)).ok);
    expect(results).toEqual([true, true, true, true, true, false]);
    expect((await hit(kv, 'k', 5, 900)).ok).toBe(false);
  });

  it('tells a refused caller how long to wait, counting down as time passes', async () => {
    const { kv } = fakeKv();
    for (let i = 0; i < 3; i++) await hit(kv, 'k', 2, 600);
    expect(await hit(kv, 'k', 2, 600)).toEqual({ ok: false, retryAfter: 600 });
    advance(100);
    expect(await hit(kv, 'k', 2, 600)).toEqual({ ok: false, retryAfter: 500 });
    advance(499);
    expect(await hit(kv, 'k', 2, 600)).toEqual({ ok: false, retryAfter: 1 });
  });

  it('starts a fresh window once the old one is over', async () => {
    const { kv } = fakeKv();
    for (let i = 0; i < 4; i++) await hit(kv, 'k', 2, 600);
    expect((await hit(kv, 'k', 2, 600)).ok).toBe(false);
    advance(600);
    expect(await hit(kv, 'k', 2, 600)).toEqual({ ok: true, retryAfter: 600 });
    expect((await hit(kv, 'k', 2, 600)).ok).toBe(true);
    expect((await hit(kv, 'k', 2, 600)).ok).toBe(false);
  });

  it('keeps counting inside the window it started, however late the attempts come', async () => {
    const { kv } = fakeKv();
    await hit(kv, 'k', 2, 600);
    advance(590);
    await hit(kv, 'k', 2, 600);
    advance(5);
    expect(await hit(kv, 'k', 2, 600)).toEqual({ ok: false, retryAfter: 5 });
  });

  it('counts each key on its own', async () => {
    const { kv } = fakeKv();
    for (let i = 0; i < 3; i++) await hit(kv, 'login:1.1.1.1', 2, 600);
    expect((await hit(kv, 'login:1.1.1.1', 2, 600)).ok).toBe(false);
    expect((await hit(kv, 'login:2.2.2.2', 2, 600)).ok).toBe(true);
  });

  it('stores the count and the end of the window', async () => {
    const { kv, store } = fakeKv();
    await hit(kv, 'k', 5, 900);
    await hit(kv, 'k', 5, 900);
    expect(JSON.parse(store.get('k') ?? 'null')).toEqual({ count: 2, resetAt: nowSec() + 900 });
  });

  it('gives the KV entry an expiry no sooner than the window end and at least 60 seconds out', async () => {
    const { kv, puts } = fakeKv();
    await hit(kv, 'long', 5, 900);
    await hit(kv, 'short', 5, 10);
    expect(puts[0].options).toEqual({ expiration: nowSec() + 900 });
    expect(puts[1].options).toEqual({ expiration: nowSec() + 60 });
  });

  it('starts over when the stored value is damaged', async () => {
    for (const damaged of [{ count: 99, resetAt: 'soon' }, { count: 99 }, 'garbage', 42, [], { count: 99, resetAt: nowSec() - 1 }]) {
      const { kv } = fakeKv({ k: damaged });
      expect(await hit(kv, 'k', 5, 900), JSON.stringify(damaged)).toEqual({ ok: true, retryAfter: 900 });
    }
  });

  it('fails open when the KV cannot be read, so a KV outage does not lock everyone out', async () => {
    const kv = {
      get: async () => {
        throw new Error('KV down');
      },
      put: async () => {}
    } as unknown as KVNamespace;
    expect(await hit(kv, 'k', 1, 900)).toEqual({ ok: true, retryAfter: 900 });
  });

  it('carries on when the KV cannot be written', async () => {
    const kv = {
      get: async () => null,
      put: async () => {
        throw new Error('KV write limit');
      }
    } as unknown as KVNamespace;
    expect(await hit(kv, 'k', 1, 900)).toEqual({ ok: true, retryAfter: 900 });
  });
});

describe('clear', () => {
  it('forgets the attempts for a key', async () => {
    const { kv } = fakeKv();
    for (let i = 0; i < 3; i++) await hit(kv, 'k', 2, 600);
    expect((await hit(kv, 'k', 2, 600)).ok).toBe(false);
    await clear(kv, 'k');
    expect((await hit(kv, 'k', 2, 600)).ok).toBe(true);
  });

  it('does not fail when the KV cannot delete', async () => {
    const kv = {
      delete: async () => {
        throw new Error('KV down');
      }
    } as unknown as KVNamespace;
    await expect(clear(kv, 'k')).resolves.toBeUndefined();
  });
});

describe('clientIp', () => {
  const ctx = (headers: Record<string, string>) => ({ req: { header: (name: string) => headers[name.toLowerCase()] } }) as unknown as Ctx;

  it('is the address Cloudflare reports', () => {
    expect(clientIp(ctx({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('is "local" without it, as under wrangler dev', () => {
    expect(clientIp(ctx({}))).toBe('local');
  });

  it('ignores forwarding headers a client can set, so rotating them does not dodge the limit', () => {
    expect(clientIp(ctx({ 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2', forwarded: 'for=198.51.100.3' }))).toBe('local');
    expect(clientIp(ctx({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' }))).toBe('203.0.113.7');
  });
});
