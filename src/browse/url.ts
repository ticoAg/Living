import { useMemo } from 'react';
import { useSearch } from 'wouter';

// Filter state lives in the address bar (?tags=a,b&city=杭州&sort=shuffle). Reads go through wouter's
// useSearch so components re-render on change; writes use history.replaceState (wouter patches it to
// notify subscribers) so filtering does not pile up history entries.

/** Current query string as URLSearchParams. Reads the raw `location.search`: wouter's copy is URI-decoded. */
export function useQuery(): URLSearchParams {
  const search = useSearch();
  // `search` only serves as the change signal
  return useMemo(() => new URLSearchParams(window.location.search), [search]);
}

export const splitIds = (v: string | null | undefined): string[] =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];

/** key=value pairs joined with &, commas kept readable. */
export function serializeQuery(entries: Iterable<readonly [string, string | null | undefined]>): string {
  const parts: string[] = [];
  for (const [k, v] of entries) {
    if (v == null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%2C/gi, ',')}`);
  }
  return parts.join('&');
}

/** Merge `patch` into the current query string without adding a history entry. null/'' removes a key. */
export function replaceQuery(patch: Record<string, string | null | undefined>): void {
  const sp = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === '') sp.delete(k);
    else sp.set(k, v);
  }
  const qs = serializeQuery(sp.entries());
  history.replaceState(history.state, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
}
