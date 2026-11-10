import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { invalidate } from '../lib/useApi';
import { uploadPhoto } from './publish';
import { buildForm, bulkSendable, inBulk, runSummary, type Item } from './upload-model';
import type { UploadQueue } from './useUploadQueue';
import { errMsg } from './util';

const EMPTY_BLOB = new Blob([]);

interface Options {
  /** the line under the drop zone; a run leaves its summary there */
  setNotice: (notice: string | null) => void;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
}

/**
 * Publishing: one photo by hand (then on to the next that needs attention), or a run over several (全部发布,
 * 发布所选) that sends them one after another, waits for photos still being read or matched, and can be stopped.
 */
export function usePublishing(
  { itemsRef, alive, patch, wake, changed }: Pick<UploadQueue, 'itemsRef' | 'alive' | 'patch' | 'wake' | 'changed'>,
  { setNotice, setSelectedId }: Options
) {
  const inflight = useRef(new Set<string>());
  const bulkOn = useRef(false);
  const stopBulk = useRef(false);
  /** a run in progress: photos done (sent, skipped or gone) out of the total */
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);

  const publishOne = useCallback(
    async (id: string): Promise<void> => {
      const it = itemsRef.current.find((i) => i.id === id);
      if (!it || !it.p || inflight.current.has(id)) return;
      inflight.current.add(id);
      patch(id, { publish: { state: 'sending', progress: 0 } });
      try {
        let last = 0;
        const r = await uploadPhoto(buildForm(it, itemsRef.current), (f) => {
          if (f - last >= 0.01 || f === 1) {
            last = f;
            if (alive.current) patch(id, { publish: { state: 'sending', progress: f } });
          }
        });
        if (!alive.current) return;
        if (r.ok) {
          patch(id, (cur) => ({
            publish: { state: 'done', progress: 1, photoId: r.photo.id },
            // the 2560 px copy is no longer needed in memory
            p: cur.p ? { ...cur.p, variants: { ...cur.p.variants, l: { ...cur.p.variants.l, blob: EMPTY_BLOB } } } : cur.p
          }));
          invalidate('/api/photos');
          invalidate('/api/tags');
          invalidate('/api/pois');
          invalidate('/api/themes');
        } else if (r.status === 409 && r.code === 'duplicate') {
          patch(id, { publish: { state: 'duplicate', progress: 0, photoId: r.photoId } });
        } else {
          patch(id, { publish: { state: 'failed', progress: 0, error: r.message } });
        }
      } catch (e) {
        if (alive.current) patch(id, { publish: { state: 'failed', progress: 0, error: errMsg(e, '发布失败，请重试') } });
      } finally {
        inflight.current.delete(id);
      }
    },
    [itemsRef, alive, patch]
  );

  /** After a manual publish, move on to the next photo that still needs attention. */
  const publishAndAdvance = useCallback(
    async (id: string) => {
      await publishOne(id);
      if (!alive.current) return;
      const list = itemsRef.current;
      // A duplicate stays selected: its explanation and the link to the existing photo are on this panel.
      if (list.find((i) => i.id === id)?.publish.state !== 'done') return;
      const at = list.findIndex((i) => i.id === id);
      const open = (i: Item) => i.publish.state !== 'done' && i.publish.state !== 'duplicate';
      const nxt = list.slice(at + 1).find(open) ?? list.find(open);
      setSelectedId((cur) => (cur === id && nxt ? nxt.id : cur));
      // One column on a phone: bring the next photo's preview back into view.
      if (nxt && window.matchMedia('(max-width: 759px)').matches) {
        requestAnimationFrame(() => document.querySelector('.up-col-match')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      }
    },
    [publishOne, itemsRef, alive, setSelectedId]
  );

  /**
   * Publish these photos as they are, one after another. Photos still being read or matched are waited for; each
   * photo is tried once, and one sent by hand meanwhile is left alone.
   */
  const publishMany = useCallback(
    async (ids: readonly string[]) => {
      if (bulkOn.current) return;
      const left = new Set(ids.filter((id) => itemsRef.current.some((i) => i.id === id && inBulk(i))));
      const total = left.size;
      if (!total) return;
      bulkOn.current = true;
      stopBulk.current = false;
      const tally = { done: 0, duplicate: 0, failed: 0 };
      setBulk({ done: 0, total });
      setNotice(null);
      try {
        while (left.size && !stopBulk.current && alive.current) {
          const list = itemsRef.current;
          let next: string | null = null;
          for (const id of left) {
            const it = list.find((i) => i.id === id);
            if (!it || !inBulk(it)) left.delete(id); // removed, unreadable, or sent by hand
            else if (!next && bulkSendable(it, list)) next = id;
          }
          if (next) {
            left.delete(next);
            await publishOne(next);
            const state = itemsRef.current.find((i) => i.id === next)?.publish.state;
            if (state === 'done') tally.done++;
            else if (state === 'duplicate') tally.duplicate++;
            else if (state === 'failed') tally.failed++;
          } else if (left.size) {
            await changed();
          }
          if (alive.current) setBulk({ done: total - left.size, total });
        }
      } finally {
        bulkOn.current = false;
        if (alive.current) {
          setBulk(null);
          setNotice(runSummary(tally, left.size > 0));
        }
      }
    },
    [publishOne, itemsRef, alive, changed, setNotice]
  );

  const stopPublishing = useCallback(() => {
    stopBulk.current = true;
    wake();
  }, [wake]);

  return { bulk, publishAndAdvance, publishMany, stopPublishing };
}
