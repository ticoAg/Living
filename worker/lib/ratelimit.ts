import type { Ctx } from './http';

/** Best-effort client address for rate limiting. */
export function clientIp(c: Ctx): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

interface Counter {
  count: number;
  resetAt: number; // epoch seconds
}

/**
 * Fixed-window counter in KV. Counts this attempt and returns whether it is within `limit`.
 * KV is eventually consistent, so this is a deterrent, not an exact gate.
 */
export async function hit(kv: KVNamespace, key: string, limit: number, windowSec: number): Promise<{ ok: boolean; retryAfter: number }> {
  const now = Math.floor(Date.now() / 1000);
  let cur: Counter | null = null;
  try {
    cur = await kv.get<Counter>(key, 'json');
  } catch {
    cur = null;
  }
  if (!cur || typeof cur.resetAt !== 'number' || cur.resetAt <= now) cur = { count: 0, resetAt: now + windowSec };
  cur.count += 1;
  // KV needs an expiry at least 60 s ahead; the stored resetAt is what the logic trusts.
  await kv.put(key, JSON.stringify(cur), { expiration: Math.max(cur.resetAt, now + 60) }).catch(() => {});
  return { ok: cur.count <= limit, retryAfter: Math.max(1, cur.resetAt - now) };
}

export async function clear(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(key).catch(() => {});
}
