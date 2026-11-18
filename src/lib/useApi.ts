import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import { useVisitor } from './visitor';

// Minimal shared GET cache: components asking for the same path share one request and one result.
// Call `invalidate(prefix)` after a mutation to refetch every cached path that starts with `prefix`.
//
// A result is fresh for STALE_MS. Older data is still shown, and refetched in the background when a component that
// reads it mounts, or when the tab becomes visible again while one is mounted. There is no polling: the lists
// (/api/photos, /api/tags, /api/pois) are read in full each time, and D1's free tier counts every row read.
// A failed request is kept until the next mount (or `reload`) asks again.
//
// Inside the visitor view (lib/visitor.ts) each path is cached under its visitor key and asked for without cookies.
// Any change the author makes (anything invalidated, forgotten or replaced) drops every visitor copy: what a visitor
// sees depends on more than the paths the author's own pages refresh (a photo made public changes the entries it is
// in, though the author's copy of them stays the same), so the view never shows what was there before a change.

export const STALE_MS = 5 * 60_000;

interface Entry {
  data?: unknown;
  error?: unknown;
  promise?: Promise<void>;
  /** When `data` arrived (Date.now()). */
  at?: number;
}
const cache = new Map<string, Entry>();

const VISITOR = 'visitor:';
/** The cache key of `path` as a visitor asks for it. */
export const visitorKey = (path: string): string => VISITOR + path;
const listeners = new Map<string, Set<() => void>>();

function notify(path: string) {
  listeners.get(path)?.forEach((fn) => fn());
}

function load(path: string): Promise<void> {
  const entry = cache.get(path) ?? {};
  if (entry.promise) return entry.promise;
  const promise = (path.startsWith(VISITOR) ? api<unknown>(path.slice(VISITOR.length), { anonymous: true }) : api<unknown>(path))
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

/**
 * Answers counted from others: a path invalidated under one of `from` invalidates every path under `path` too, so the
 * pages that write entries, photos and the rest need not know what is counted from them.
 */
const DERIVED: readonly { path: string; from: readonly string[] }[] = [
  // the year in review counts one's entries, photos, projects, collections, places and tags
  { path: '/api/review', from: ['/api/entries', '/api/photos', '/api/projects', '/api/themes', '/api/pois', '/api/tags'] },
  // a profile counts the person's photos, collections, entries and projects
  { path: '/api/users/', from: ['/api/entries', '/api/photos', '/api/projects', '/api/themes'] }
];

export function invalidate(prefix: string) {
  const under = [prefix, VISITOR];
  for (const d of DERIVED) {
    if (d.from.some((f) => prefix.startsWith(f))) under.push(d.path);
  }
  drop(under);
}

/** Drop every path under one of `prefixes`: a mounted one is refetched (once), the rest go. */
function drop(prefixes: readonly string[]) {
  for (const key of Array.from(cache.keys())) {
    if (!prefixes.some((p) => key.startsWith(p))) continue;
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

/** Start loading `path` into the cache ahead of the component that will read it; no-op if fresh or in flight. */
export function prefetch(path: string) {
  revalidate(path);
}

/** Drop a cached path, read or not: what it held is gone (a deleted entry), and nothing should show it again. */
export function forget(path: string) {
  cache.delete(path);
  drop([VISITOR]);
}

/** Seed or replace a cached value without a request (e.g. after a mutation returns the new object). */
export function setCached<T>(path: string, data: T) {
  cache.set(path, { data, at: Date.now() });
  notify(path);
  drop([VISITOR]);
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
  const visitor = useVisitor();
  const key = path && visitor ? VISITOR + path : path;
  // useSyncExternalStore reads the entry again right after it subscribes. A result that lands between the render and
  // the subscription is therefore not missed: a link's prefetch often finishes while its lazy page still waits in
  // Suspense, and a plain effect subscription then left the page on its loading state for good.
  const sub = useCallback((fn: () => void) => (key ? subscribe(key, fn) : noSubscription()), [key]);
  const entry = useSyncExternalStore(sub, () => (key ? cache.get(key) : undefined));
  useEffect(() => {
    if (key) revalidate(key);
  }, [key]);
  const reload = useCallback(() => {
    if (key) invalidate(key);
  }, [key]);
  return {
    data: entry?.data as T | undefined,
    error: entry?.error,
    loading: !!key && !!entry?.promise && entry.data === undefined && !entry.error,
    reload
  };
}
