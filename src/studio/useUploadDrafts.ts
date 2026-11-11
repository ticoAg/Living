import { useCallback, useEffect, useMemo, useRef } from 'react';
import { DraftStore, browserStorage, draftOf, fileKey, restoreDraft, type Draft } from './upload-drafts';
import type { Item } from './upload-model';

/** Typing settles for this long before the queue's drafts are written. */
const SAVE_DELAY = 400;

/**
 * Keeps what was filled in for the photos in the queue in this browser, per signed-in user, and hands it back when a
 * file is added again. Saves shortly after each change and at once when the tab is hidden or closed.
 * Docs: /docs/product/features/upload.md#草稿
 */
export function useUploadDrafts(userId: string | null, items: Item[]) {
  const store = useMemo(() => (userId ? new DraftStore(browserStorage(), `living:upload-drafts:${userId}`) : null), [userId]);
  const latest = useRef(items);
  latest.current = items;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (!store) return;
    const now = Date.now();
    const changes = new Map<string, Draft | null>();
    // an unreadable file shows no form: whatever was kept for it stays for the next try
    for (const it of latest.current) if (it.stage !== 'error') changes.set(fileKey(it.file), draftOf(it, now));
    if (changes.size) store.update(changes);
  }, [store]);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY);
  }, [items, flush]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && timer.current !== undefined) flush();
    };
    const onLeave = () => timer.current !== undefined && flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onLeave);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onLeave);
      // leaving the page inside the app: write what is pending
      if (timer.current !== undefined) flush();
    };
  }, [flush]);

  /** What was kept for this file, ready to spread over a new queue item; null when there is nothing. */
  const take = useCallback(
    (file: File): Partial<Item> | null => {
      const d = store?.get(fileKey(file));
      return d ? restoreDraft(d) : null;
    },
    [store]
  );

  /** Forget these files (removed from the queue by hand). */
  const forget = useCallback((files: readonly File[]) => store?.forget(files.map(fileKey)), [store]);

  return useMemo(() => ({ take, forget }), [take, forget]);
}
