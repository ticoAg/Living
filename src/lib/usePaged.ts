import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { readShown, writeShown } from './shown';

// A long list shown a page at a time: the first `page` items render at once, and the next page is added as the end of
// the list comes near the viewport. How many were shown is kept in the history entry (lib/shown.ts), so coming Back
// renders them all again and the remembered scroll offset (lib/scroll.ts) can be reached. A new address (another
// filter) starts again from one page.

// start adding this far before the end comes into view
const AHEAD = '0px 0px 800px 0px';

/**
 * How many of `total` items to render, and the element to put after them that asks for more. `relayout` re-observes
 * the end after the list has been laid out again: a tall screen keeps filling until it is covered.
 */
export function usePaged(total: number, page: number, relayout?: unknown) {
  const [path] = useLocation();
  const search = useSearch();
  const listKey = `${path}?${search}`;
  const [shown, setShown] = useState(() => ({ key: listKey, n: Math.max(page, readShown(listKey)) }));
  const count = shown.key === listKey ? shown.n : page;
  const n = Math.min(total, count);

  useEffect(() => {
    // only into this list's own entry, not one a navigation has just pushed
    if (window.location.pathname !== path) return;
    writeShown(listKey, count);
  }, [path, listKey, count]);

  const end = useRef<HTMLDivElement>(null);
  const more = n < total;
  useEffect(() => {
    const el = end.current;
    if (!el || !more) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown({ key: listKey, n: n + page });
      },
      { rootMargin: AHEAD }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [more, n, listKey, page, relayout]);

  /** Render at least `m` items (to jump to one further down). */
  const showAtLeast = useCallback(
    (m: number) => setShown((s) => ({ key: listKey, n: Math.max(s.key === listKey ? s.n : page, m) })),
    [listKey, page]
  );

  return { n, more, end, showAtLeast };
}
