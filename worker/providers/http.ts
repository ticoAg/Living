// Shared plumbing for outbound provider calls: UA, 8 s timeout. The answer cache is in cache.ts.

export const USER_AGENT = 'Living/1.0 (+https://living.ticoag.fun)';
export const PROVIDER_TIMEOUT_MS = 8000;

export class UpstreamError extends Error {}

/** `fetch` + JSON with a hard timeout. Never include secrets in `label` (it ends up in logs). */
export async function fetchJson<T>(url: string, label: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    });
  } catch (e) {
    throw new UpstreamError(`${label}: ${e instanceof Error ? e.name : 'request failed'}`);
  }
  if (!res.ok) throw new UpstreamError(`${label}: HTTP ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new UpstreamError(`${label}: invalid JSON`);
  }
}

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

export function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  return p.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
}
