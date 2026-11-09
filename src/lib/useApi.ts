import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

// Minimal shared GET cache: components asking for the same path share one request and one result.
// Call `invalidate(prefix)` after a mutation to refetch every cached path that starts with `prefix`.

interface Entry {
  data?: unknown;
  error?: unknown;
  promise?: Promise<void>;
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
      cache.set(path, { data });
    })
    .catch((error) => {
      cache.set(path, { error });
    })
    .finally(() => notify(path));
  cache.set(path, { ...entry, promise });
  return promise;
}

export function invalidate(prefix: string) {
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) {
      if (listeners.get(key)?.size) {
        // keep showing the previous data while the refetch runs
        cache.set(key, { data: cache.get(key)?.data });
        void load(key);
      } else {
        cache.delete(key);
      }
    }
  }
}

/** Start loading `path` into the cache ahead of the component that will read it; no-op if cached or in flight. */
export function prefetch(path: string) {
  const entry = cache.get(path);
  if (entry && ('data' in entry || entry.promise)) return;
  void load(path);
}

/** Seed or replace a cached value without a request (e.g. after a mutation returns the new object). */
export function setCached<T>(path: string, data: T) {
  cache.set(path, { data });
  notify(path);
}

export function useApi<T>(path: string | null): { data: T | undefined; error: unknown; loading: boolean; reload: () => void } {
  const [, force] = useState(0);
  useEffect(() => {
    if (!path) return;
    const fn = () => force((n) => n + 1);
    let set = listeners.get(path);
    if (!set) listeners.set(path, (set = new Set()));
    set.add(fn);
    const entry = cache.get(path);
    if (!entry || (!('data' in entry) && !entry.error && !entry.promise)) void load(path);
    return () => {
      set!.delete(fn);
    };
  }, [path]);
  const reload = useCallback(() => {
    if (path) invalidate(path);
  }, [path]);
  const entry = path ? cache.get(path) : undefined;
  return {
    data: entry?.data as T | undefined,
    error: entry?.error,
    loading: !!path && !!entry?.promise && entry.data === undefined && !entry.error,
    reload
  };
}
