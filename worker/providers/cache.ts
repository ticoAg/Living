// The place providers' answer cache, in the D1 table `place_cache` (docs/data/place-cache.md). It used to be in KV, but
// KV's free plan has 1000 writes a day for everything, sessions included: a big upload could use them up, and sign-in
// failed until midnight UTC. D1's free plan allows 100,000 row writes a day.

export const CACHE_TTL = 7 * 24 * 60 * 60; // seconds

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Reads a JSON value from the cache, or loads and stores it. An expired row counts as a miss. Failed loads are not
 * cached; cache errors never fail the request (a lost cache only means asking the provider again).
 */
export async function placeCached<T>(db: D1Database, key: string, load: () => Promise<T>, ttl = CACHE_TTL): Promise<T> {
  try {
    const hit = await db
      .prepare('SELECT value FROM place_cache WHERE key = ?1 AND expires_at > ?2')
      .bind(key, nowSeconds())
      .first<{ value: string }>();
    if (hit) return JSON.parse(hit.value) as T;
  } catch {
    // unreadable row or database hiccup: fall through and reload
  }
  const value = await load();
  try {
    await db
      .prepare(
        `INSERT INTO place_cache (key, value, expires_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`
      )
      .bind(key, JSON.stringify(value), nowSeconds() + ttl)
      .run();
  } catch {
    // cache write failures are not worth failing the request for
  }
  return value;
}

/** Deletes the expired rows (the hourly job, worker/index.ts) and returns how many there were. */
export async function purgePlaceCache(db: D1Database): Promise<number> {
  const res = await db.prepare('DELETE FROM place_cache WHERE expires_at <= ?1').bind(nowSeconds()).run();
  return res.meta?.changes ?? 0;
}
