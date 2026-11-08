import type { Variants } from '../../shared/types';

/** Cache API key for a public media object: the full URL without query or fragment. */
export function mediaCacheKey(origin: string, r2Key: string): Request {
  return new Request(`${origin}/media/${r2Key}`, { method: 'GET' });
}

/**
 * Best-effort purge of the edge-cached sizes of a photo (only the current data centre is reachable).
 * Called when a photo goes private or is deleted.
 */
export async function purgeVariantCache(origin: string, variants: Variants | null): Promise<void> {
  if (!variants) return;
  try {
    const cache = caches.default;
    await Promise.all(Object.values(variants).map((v) => cache.delete(mediaCacheKey(origin, v.key))));
  } catch {
    // the Cache API is unavailable in some contexts; entries then simply expire
  }
}
