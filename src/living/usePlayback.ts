import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PhotoSummary } from '../../shared/types';
import { useLatest } from './hooks';
import { maySkip, positionOf, stepId } from './playback';
import { preloadPhoto } from './preload';

interface Options {
  playlist: PhotoSummary[];
  /** photo to open with (`start=`), or ''; read on the first render only */
  firstId: string;
  everySec: number;
  /** the tab is in the background: hold still like a pause */
  hidden: boolean;
}

/**
 * The slideshow's position and clock: the current photo, pausing, moving by hand or automatically every
 * `everySec`, skipping photos whose image fails, and warming the cache with the next one.
 */
export function usePlayback({ playlist, firstId, everySec, hidden }: Options) {
  const [curId, setCurId] = useState<string | null>(firstId || null);
  // Bumps on every move (auto, manual or restart): restarts the progress line and the 6 s caption window.
  const [run, setRun] = useState(0);
  const [paused, setPaused] = useState(false);

  const n = playlist.length;
  const idx = useMemo(() => positionOf(playlist, curId), [playlist, curId]);
  const cur = n ? playlist[idx] : null;
  const next = n > 1 ? playlist[(idx + 1) % n] : null;

  const go = useCallback(
    (delta: number) => {
      const id = stepId(playlist, idx, delta);
      if (id === null) return;
      setCurId(id);
      setRun((r) => r + 1);
    },
    [idx, playlist]
  );
  const goRef = useLatest(go);

  /** A new source: back to the start of the new list. */
  const restart = useCallback(() => {
    setCurId(null);
    setRun((r) => r + 1);
  }, []);
  const togglePause = useCallback(() => setPaused((p) => !p), []);

  // Auto-advance. Time spent on the current photo survives pausing and the tab going to the
  // background; a move or a new interval starts the count again.
  const everyMs = everySec * 1000;
  const holding = paused || hidden;
  const elapsed = useRef(0);
  const lastSig = useRef('');
  const sig = `${run}:${everyMs}`;
  useEffect(() => {
    if (lastSig.current !== sig) {
      lastSig.current = sig;
      elapsed.current = 0;
    }
    if (holding || n < 2) return;
    const started = performance.now();
    const base = elapsed.current;
    const id = window.setTimeout(() => goRef.current(1), Math.max(0, everyMs - base));
    return () => {
      window.clearTimeout(id);
      elapsed.current = base + (performance.now() - started);
    };
  }, [sig, holding, n, everyMs, goRef]);

  // A photo whose image cannot be fetched is skipped, unless every photo is failing (offline).
  const failures = useRef(0);
  const live = useLatest({ curId: cur?.id ?? null, n });
  const onBroken = useCallback(
    (id: string) => {
      if (id !== live.current.curId || !maySkip(++failures.current, live.current.n)) return;
      window.setTimeout(() => {
        if (live.current.curId === id) goRef.current(1);
      }, 600);
    },
    [live, goRef]
  );
  const onShown = useCallback(() => {
    failures.current = 0;
  }, []);

  // Warm the cache with the next photo.
  const preloaded = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (next) preloaded.current = preloadPhoto(next);
  }, [next]);

  return { cur, next, idx, n, run, sig, paused, holding, go, restart, togglePause, onBroken, onShown };
}
