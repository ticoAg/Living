import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { processFile } from './process';
import { deviceHints, nextToProcess, processLimit } from './process-queue';
import { freshMatch, type Item } from './upload-model';
import type { UploadQueue } from './useUploadQueue';
import { errMsg } from './util';

/**
 * Reads and resizes the queued photos in the browser, a few at a time (process-queue.ts sets how many and which
 * next). A file identical to one already in the queue is skipped. A photo with a position goes on to `onLocated`
 * (place matching). Nothing starts before `ready` (signed in).
 */
export function useProcessQueue(
  { items, itemsRef, alive, patch }: Pick<UploadQueue, 'items' | 'itemsRef' | 'alive' | 'patch'>,
  ready: boolean,
  onLocated: (id: string) => void
) {
  /** photos being read and resized right now */
  const running = useRef(new Set<string>());
  const limit = useMemo(() => processLimit(deviceHints()), []);
  // a finished photo frees a place: look for the next one even if the queue itself did not change
  const [kick, setKick] = useState(0);

  const processOne = useCallback(
    async (next: Item) => {
      running.current.add(next.id);
      patch(next.id, { stage: 'processing', error: null });
      try {
        const p = await processFile(next.file, (phase) => {
          if (alive.current) patch(next.id, { phase });
        });
        if (!alive.current) return;
        if (!itemsRef.current.some((i) => i.id === next.id)) return; // removed while processing
        const twin = p.sha256 ? itemsRef.current.find((o) => o.id !== next.id && o.p?.sha256 === p.sha256) : undefined;
        if (twin) {
          patch(next.id, { stage: 'error', error: `和「${twin.file.name}」是同一个文件，已跳过。` });
          return;
        }
        const positioned = p.exif.lat != null && p.exif.lng != null;
        patch(next.id, { stage: 'ready', p, thumbUrl: URL.createObjectURL(p.variants.s.blob), match: positioned ? freshMatch() : null });
        if (positioned) onLocated(next.id);
      } catch (e) {
        if (alive.current) patch(next.id, { stage: 'error', phase: null, error: errMsg(e, '处理失败') });
      } finally {
        running.current.delete(next.id);
        if (alive.current) setKick((k) => k + 1);
      }
    },
    [itemsRef, alive, patch, onLocated]
  );

  useEffect(() => {
    if (!ready) return;
    for (const next of nextToProcess(items, running.current, limit)) void processOne(next);
  }, [items, ready, kick, limit, processOne]);
}
