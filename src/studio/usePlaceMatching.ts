import { useCallback, useEffect, useRef } from 'react';
import { DEFAULT_RADIUS, initialMatch, matchPois } from './match';
import { applyMatch, coordsOf } from './upload-model';
import type { UploadQueue } from './useUploadQueue';
import { errMsg } from './util';

/**
 * Place matching for the queued photos. First matches run one after another so a big batch does not hammer the map
 * providers; a new radius re-queries after a short pause; the last request for a photo wins.
 */
export function usePlaceMatching({ itemsRef, alive, patch }: Pick<UploadQueue, 'itemsRef' | 'alive' | 'patch'>) {
  const matchChain = useRef<Promise<void>>(Promise.resolve());
  const matchSeq = useRef(new Map<string, number>());
  const radiusTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = radiusTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const runMatch = useCallback(
    async (id: string, radius: number) => {
      const it = itemsRef.current.find((i) => i.id === id);
      const at = it && coordsOf(it);
      if (!it || !it.p || !at) return;
      const mine = (matchSeq.current.get(id) ?? 0) + 1;
      matchSeq.current.set(id, mine);
      patch(id, (cur) => ({ match: { ...(cur.match ?? initialMatch()), radius, loading: true, error: null } }));
      try {
        const res = await matchPois(at.lat, at.lng, it.p.exif.heading, radius);
        if (!alive.current || matchSeq.current.get(id) !== mine) return;
        patch(id, (cur) => applyMatch(cur, res, radius));
      } catch (e) {
        if (!alive.current || matchSeq.current.get(id) !== mine) return;
        patch(id, (cur) => ({ match: { ...(cur.match ?? initialMatch()), radius, loading: false, error: errMsg(e, '地点匹配失败') } }));
      }
    },
    [itemsRef, alive, patch]
  );

  /** The first match of a photo that has just been read: queued behind the others. */
  const enqueueMatch = useCallback(
    (id: string) => {
      matchChain.current = matchChain.current.then(() => runMatch(id, DEFAULT_RADIUS)).catch(() => {});
    },
    [runMatch]
  );

  const onRadius = useCallback(
    (id: string, radius: number) => {
      patch(id, (cur) => ({ match: { ...(cur.match ?? initialMatch()), radius } }));
      clearTimeout(radiusTimers.current.get(id));
      radiusTimers.current.set(
        id,
        setTimeout(() => void runMatch(id, radius), 350)
      );
    },
    [patch, runMatch]
  );

  const onRetryMatch = useCallback(
    (id: string) => {
      const it = itemsRef.current.find((i) => i.id === id);
      void runMatch(id, it?.match?.radius ?? DEFAULT_RADIUS);
    },
    [itemsRef, runMatch]
  );

  /** A photo left the queue: drop its pending radius change. */
  const forget = useCallback((id: string) => clearTimeout(radiusTimers.current.get(id)), []);

  return { enqueueMatch, onRadius, onRetryMatch, forget };
}
