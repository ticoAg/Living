import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from './api';

// Minimal shared GET cache: components asking for the same path share one request and one result.
// Call `invalidate(prefix)` after a mutation to refetch every cached path that starts with `prefix`.
//
// A result is fresh for STALE_MS. Older data is still shown, and refetched in the background when a component that
// reads it mounts, or when the tab becomes visible again while one is mounted. There is no polling: the lists
// (/api/photos, /api/tags, /api/pois) are read in full each time, and D1's free tier counts every row read.
// A failed request is kept until the next mount (or `reload`) asks again.

export const STALE_MS = 5 * 60_000;

interface Entry {
  data?: unknown;
  error?: unknown;
  promise?: Promise<void>;
  /** When `data` arrived (Date.now()). */
  at?: number;
}
const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function notify(path: string) {
  listeners.get(path)?.forEach((fn) => fn());
}

function load(path: string): Promise<void> {
  const entry = cache.get(path) ?? {};
  if (entry.promise) return entry.promise;
  const promise = api<unknown>(path)
    .then((data) => {
      cache.set(path, { data, at: Date.now() });
    })
    .catch((error: unknown) => {
      const prev = cache.get(path);
      // a failed background refetch keeps what is on screen; it stays stale, so it is tried again later
      cache.set(path, prev && 'data' in prev ? { data: prev.data, at: prev.at } : { error });
    })
    .finally(() => notify(path));
  cache.set(path, { ...entry, promise });
  return promise;
}

const isStale = (entry: Entry, now: number) => entry.at === undefined || now - entry.at >= STALE_MS;

/**
 * Load `path` unless the cache already has a fresh answer for it (or a request is under way): nothing cached,
 * a failed request, or data older than STALE_MS. Stale data stays readable while the new copy loads.
 */
export function revalidate(path: string, now = Date.now()): void {
  const entry = cache.get(path);
  if (entry?.promise) return;
  if (entry && 'data' in entry && !isStale(entry, now)) return;
  void load(path);
}

/** The cached entry for `path`, for tests. */
export function peek(path: string): Readonly<Entry> | undefined {
  return cache.get(path);
}

export function invalidate(prefix: string) {
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) {
      if (listeners.get(key)?.size) {
        // keep showing the previous data while the refetch runs
        const prev = cache.get(key);
        cache.set(key, prev && 'data' in prev ? { data: prev.data, at: prev.at } : {});
        void load(key);
      } else {
        cache.delete(key);
      }
    }
  }
}

/** Start loading `path` into the cache ahead of the component that will read it; no-op if fresh or in flight. */
export function prefetch(path: string) {
  revalidate(path);
}

/** Seed or replace a cached value without a request (e.g. after a mutation returns the new object). */
export function setCached<T>(path: string, data: T) {
  cache.set(path, { data, at: Date.now() });
  notify(path);
}

/** Back on a tab after a while: refresh what the mounted components show, if it has gone stale. */
export function revalidateMounted(now = Date.now()) {
  for (const [path, set] of listeners) if (set.size) revalidate(path, now);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revalidateMounted();
  });
}

function subscribe(path: string, fn: () => void): () => void {
  let set = listeners.get(path);
  if (!set) listeners.set(path, (set = new Set()));
  set.add(fn);
  return () => void set.delete(fn);
}
const noSubscription = () => () => {};

export function useApi<T>(path: string | null): { data: T | undefined; error: unknown; loading: boolean; reload: () => void } {
  // useSyncExternalStore reads the entry again right after it subscribes. A result that lands between the render and
  // the subscription is therefore not missed: a link's prefetch often finishes while its lazy page still waits in
  // Suspense, and a plain effect subscription then left the page on its loading state for good.
  const sub = useCallback((fn: () => void) => (path ? subscribe(path, fn) : noSubscription()), [path]);
  const entry = useSyncExternalStore(sub, () => (path ? cache.get(path) : undefined));
  useEffect(() => {
    if (path) revalidate(path);
  }, [path]);
  const reload = useCallback(() => {
    if (path) invalidate(path);
  }, [path]);
  return {
    data: entry?.data as T | undefined,
    error: entry?.error,
    loading: !!path && !!entry?.promise && entry.data === undefined && !entry.error,
    reload
  };
}
