import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { fakeD1, fakePlaceCache, type DbCall } from '../test-utils';
import { CACHE_TTL, placeCached, purgePlaceCache } from './cache';
import { UpstreamError } from './http';

// The place providers' answer cache in D1: docs/data/place-cache.md.

const NOW = 1_790_000_000; // seconds

function makeDb() {
  const cache = fakePlaceCache();
  const d1 = fakeD1(cache.wrap());
  return { db: d1.db, calls: d1.calls, rows: cache.rows };
}

/** A database where the statements `failOn` picks throw. */
function brokenDb(failOn: (call: DbCall) => boolean) {
  const cache = fakePlaceCache();
  const answer = cache.wrap();
  return fakeD1((call) => {
    if (failOn(call)) throw new Error('D1 unavailable');
    return answer(call);
  }).db;
}

afterEach(() => {
  vi.useRealTimers();
});

const at = (seconds: number) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(seconds * 1000);
};

describe('placeCached', () => {
  it('returns a cached value without loading', async () => {
    at(NOW);
    const { db, rows } = makeDb();
    rows.set('poi:near', { value: '[{"id":1}]', expiresAt: NOW + 60 });
    const load = vi.fn(async () => [{ id: 2 }]);
    expect(await placeCached(db, 'poi:near', load)).toEqual([{ id: 1 }]);
    expect(load).not.toHaveBeenCalled();
  });

  it('loads on a miss and stores the value as JSON with the seven day expiry', async () => {
    at(NOW);
    const { db, rows } = makeDb();
    const load = vi.fn(async () => ({ city: '杭州' }));
    expect(await placeCached(db, 'geo:rev', load)).toEqual({ city: '杭州' });
    expect(load).toHaveBeenCalledTimes(1);
    expect(CACHE_TTL).toBe(7 * 24 * 60 * 60);
    expect([...rows]).toEqual([['geo:rev', { value: '{"city":"杭州"}', expiresAt: NOW + CACHE_TTL }]]);
  });

  it('serves the second request from the cache', async () => {
    const { db } = makeDb();
    const load = vi.fn(async () => 'fresh');
    await placeCached(db, 'k', load);
    await placeCached(db, 'k', load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('takes a custom lifetime', async () => {
    at(NOW);
    const { db, rows } = makeDb();
    await placeCached(db, 'k', async () => 1, 60);
    expect(rows.get('k')?.expiresAt).toBe(NOW + 60);
  });

  it('treats an expired row as a miss and replaces it', async () => {
    at(NOW);
    const { db, rows } = makeDb();
    rows.set('k', { value: '"stale"', expiresAt: NOW });
    expect(await placeCached(db, 'k', async () => 'fresh')).toBe('fresh');
    expect(rows.get('k')).toEqual({ value: '"fresh"', expiresAt: NOW + CACHE_TTL });
  });

  it('counts empty and falsy values as cached', async () => {
    for (const value of [[], 0, '', false, null]) {
      const { db } = makeDb();
      await placeCached(db, 'k', async () => value);
      const load = vi.fn(async () => 'loaded');
      expect(await placeCached<unknown>(db, 'k', load), JSON.stringify(value)).toEqual(value);
      expect(load).not.toHaveBeenCalled();
    }
  });

  it('does not cache a failed load, and lets the error through', async () => {
    const { db, rows } = makeDb();
    await expect(
      placeCached(db, 'k', async () => {
        throw new UpstreamError('overpass: HTTP 500');
      })
    ).rejects.toThrow('overpass: HTTP 500');
    expect(rows.size).toBe(0);
    expect(await placeCached(db, 'k', async () => 'second try')).toBe('second try');
  });

  it('reloads when a row cannot be parsed', async () => {
    at(NOW);
    const { db, rows } = makeDb();
    rows.set('k', { value: '{not json', expiresAt: NOW + 60 });
    expect(await placeCached(db, 'k', async () => 'loaded')).toBe('loaded');
  });

  it('survives a cache that cannot be read', async () => {
    const db = brokenDb((call) => call.sql.startsWith('SELECT'));
    expect(await placeCached(db, 'k', async () => 'loaded')).toBe('loaded');
  });

  it('survives a cache that cannot be written', async () => {
    const db = brokenDb((call) => call.sql.startsWith('INSERT'));
    expect(await placeCached(db, 'k', async () => 'loaded')).toBe('loaded');
  });
});

describe('purgePlaceCache', () => {
  it('deletes the rows whose expiry has passed', async () => {
    at(NOW);
    const { db, calls, rows } = makeDb();
    rows.set('old', { value: '1', expiresAt: NOW - 1 });
    rows.set('now', { value: '1', expiresAt: NOW });
    rows.set('fresh', { value: '1', expiresAt: NOW + 1 });
    await purgePlaceCache(db);
    expect([...rows.keys()]).toEqual(['fresh']);
    expect(calls.at(-1)?.sql).toBe('DELETE FROM place_cache WHERE expires_at <= ?1');
  });
});
