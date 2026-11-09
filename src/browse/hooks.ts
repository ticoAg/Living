import { useEffect, useLayoutEffect, useState } from 'react';
import { startScroll } from '../lib/scroll';

/** Set the tab title while the page is mounted. */
export function useDocTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = `${title} · Living`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}

/** Start at the top when `dep` changes, or where the page was left when it is reached with Back/Forward. */
export function useScrollTop(dep?: unknown): void {
  useEffect(() => {
    startScroll();
  }, [dep]);
}

/**
 * Measured size of an element; null until it has been laid out. Returns a callback ref, so it also works for
 * an element that only appears after loading (pages return early while their data is on the way).
 */
export function useBoxSize<T extends HTMLElement>(): [(el: T | null) => void, { w: number; h: number } | null] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      setSize((s) => (s && Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size];
}
