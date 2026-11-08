import { useEffect, useLayoutEffect, useState } from 'react';

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

/** Jump to the top when `dep` changes (route changes keep the previous scroll offset otherwise). */
export function useScrollTop(dep: unknown): void {
  useEffect(() => {
    window.scrollTo(0, 0);
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
