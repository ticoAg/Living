import { useCallback, useEffect, useRef, useState } from 'react';
import type { Item } from './upload-model';
import { useUploadDrafts } from './useUploadDrafts';

/**
 * The upload page's queue. Every change goes through `update`/`patch`, which keep `itemsRef` current for the async
 * work (reading, matching, publishing) and wake whatever waits on `changed()`. `alive` turns false when the page goes
 * away; the photos' object URLs are revoked then. What was typed for each photo is kept as a draft (useUploadDrafts).
 */
export function useUploadQueue(userId: string | null) {
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef<Item[]>([]);
  const drafts = useUploadDrafts(userId, items);

  const alive = useRef(true);
  /** a publishing run waiting for photos to be processed or matched */
  const waiters = useRef<(() => void)[]>([]);

  const wake = useCallback(() => {
    const ws = waiters.current;
    waiters.current = [];
    for (const w of ws) w();
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const it of itemsRef.current) if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
      wake();
    };
  }, [wake]);

  const update = useCallback(
    (fn: (prev: Item[]) => Item[]) => {
      const next = fn(itemsRef.current);
      itemsRef.current = next;
      setItems(next);
      wake();
    },
    [wake]
  );
  const patch = useCallback(
    (id: string, p: Partial<Item> | ((cur: Item) => Partial<Item>)) =>
      update((prev) => prev.map((it) => (it.id === id ? { ...it, ...(typeof p === 'function' ? p(it) : p) } : it))),
    [update]
  );
  /** Resolves at the next change of the queue, or when the page goes away. */
  const changed = useCallback(() => new Promise<void>((resolve) => waiters.current.push(resolve)), []);

  return { items, itemsRef, alive, drafts, update, patch, wake, changed };
}

export type UploadQueue = ReturnType<typeof useUploadQueue>;
