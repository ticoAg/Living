import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';

// Small browser hooks used by the Living page. Everything that touches a browser API that may be
// missing or refuse (Wake Lock, Fullscreen, matchMedia) is guarded: Living must still play without it.

/** Always-current ref to a value, updated before effects and event handlers run. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** True while the tab is in the background; the slideshow holds still then. */
export function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  useEffect(() => {
    const on = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return hidden;
}

/** Wall clock, refreshed on every minute boundary and when the tab comes back to the foreground. */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let id = 0;
    const arm = () => {
      id = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 30);
    };
    function tick() {
      setNow(new Date());
      arm();
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      window.clearTimeout(id);
      tick();
    };
    arm();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return now;
}

/** Keep the screen on (Screen Wake Lock) and take the lock again whenever the tab becomes visible. */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    let pending = false;

    const acquire = async () => {
      if (cancelled || pending || sentinel || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          void lock.release().catch(() => {});
          return;
        }
        sentinel = lock;
        lock.addEventListener('release', () => {
          if (sentinel === lock) sentinel = null;
        });
      } catch {
        /* refused (battery saver, no permission): playback goes on without it */
      } finally {
        pending = false;
      }
    };
    const onVisible = () => void acquire();

    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    // Some browsers only grant the lock after a gesture; try again on the first one.
    window.addEventListener('pointerdown', onVisible, { once: true });
    window.addEventListener('keydown', onVisible, { once: true });
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pointerdown', onVisible);
      window.removeEventListener('keydown', onVisible);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [enabled]);
}

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const swallow = (r: unknown) => {
  if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {});
};

export interface FullscreenApi {
  supported: boolean;
  active: boolean;
  toggle: () => void;
  exit: () => void;
  /** true if fullscreen ended less than `ms` ago (the Esc that ended it must not also leave the page) */
  justExited: (ms?: number) => boolean;
}

export function useFullscreen(target: RefObject<HTMLElement | null>): FullscreenApi {
  const doc = document as FsDocument;
  const supported = !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  const exitedAt = useRef(0);

  useEffect(() => {
    const on = () => {
      const now = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
      if (activeRef.current && !now) exitedAt.current = Date.now();
      activeRef.current = now;
      setActive(now);
    };
    document.addEventListener('fullscreenchange', on);
    document.addEventListener('webkitfullscreenchange', on);
    return () => {
      document.removeEventListener('fullscreenchange', on);
      document.removeEventListener('webkitfullscreenchange', on);
    };
  }, [doc]);

  const exit = useCallback(() => {
    if (!(doc.fullscreenElement || doc.webkitFullscreenElement)) return;
    try {
      swallow(doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.());
    } catch {
      /* already leaving */
    }
  }, [doc]);

  const toggle = useCallback(() => {
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      exit();
      return;
    }
    const el = target.current as FsElement | null;
    if (!el) return;
    try {
      swallow(el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.());
    } catch {
      /* needs a user gesture, or not allowed here */
    }
  }, [doc, exit, target]);

  const justExited = useCallback((ms = 500) => Date.now() - exitedAt.current < ms, []);

  return useMemo(() => ({ supported, active, toggle, exit, justExited }), [supported, active, toggle, exit, justExited]);
}

export interface AutoHide {
  visible: boolean;
  /** show now and restart the countdown */
  poke: () => void;
  /** flip visibility (tap on the picture) */
  toggle: () => void;
}

/**
 * Controls that hide after `delay` ms without activity. While `hold` is true (paused, drawer open,
 * pointer on the bar, nothing to show) they stay up; once it clears they show and count down again.
 */
export function useAutoHide(hold: boolean, delay = 3000): AutoHide {
  const [visible, setVisible] = useState(true);
  const visibleRef = useRef(true);
  const holdRef = useRef(hold);
  const timer = useRef(0);

  const show = useCallback((v: boolean) => {
    visibleRef.current = v;
    setVisible(v);
  }, []);
  const arm = useCallback(() => {
    window.clearTimeout(timer.current);
    if (holdRef.current) return;
    timer.current = window.setTimeout(() => show(false), delay);
  }, [delay, show]);

  const poke = useCallback(() => {
    show(true);
    arm();
  }, [arm, show]);
  const toggle = useCallback(() => {
    if (visibleRef.current) {
      window.clearTimeout(timer.current);
      show(false);
    } else {
      poke();
    }
  }, [poke, show]);

  useEffect(() => {
    holdRef.current = hold;
    if (hold) window.clearTimeout(timer.current);
    else poke(); // released (resumed, drawer closed, pointer left the bar): show it, then count down
    return () => window.clearTimeout(timer.current);
  }, [hold, poke]);

  return useMemo(() => ({ visible, poke, toggle }), [visible, poke, toggle]);
}
