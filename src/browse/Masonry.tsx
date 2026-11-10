import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useSearch } from 'wouter';
import { layoutMasonry, type MasonryItem } from './columns';
import { readShown, writeShown } from './shown';

// Photo masonry: tiles in reading order (DOM, Tab and screen-reader order are the list's order, newest first),
// each absolutely placed in the column that is shortest at that point (see columns.ts). Only the first PAGE tiles
// render at first; more are appended as the end comes near. How many were shown is kept in the history entry, so
// coming Back from a photo renders them all again and the remembered scroll offset (lib/scroll.ts) can be reached.

export const PAGE = 20;
// start appending this far before the end comes into view
const AHEAD = '0px 0px 800px 0px';

interface Props<T> {
  items: readonly T[];
  keyOf: (item: T) => string;
  /** aspect ratio and fixed caption height of an item */
  measure: (item: T) => MasonryItem;
  render: (item: T) => ReactNode;
  className?: string;
}

export default function Masonry<T>({ items, keyOf, measure, render, className }: Props<T>) {
  // the address (with its filters) the shown count belongs to; a new filter starts again from one page
  const [path] = useLocation();
  const search = useSearch();
  const listKey = `${path}?${search}`;
  const [shown, setShown] = useState(() => ({ key: listKey, n: Math.max(PAGE, readShown(listKey)) }));
  const n = Math.min(items.length, shown.key === listKey ? shown.n : PAGE);

  useEffect(() => {
    // only into this list's own entry, not one a navigation has just pushed
    if (window.location.pathname !== path) return;
    writeShown(listKey, shown.key === listKey ? shown.n : PAGE);
  }, [path, listKey, shown]);

  // the box's width and gaps; measured before paint so tiles never show unplaced
  const box = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ width: number; gap: number; rowGap: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measureBox = () => {
      const cs = getComputedStyle(el);
      const next = { width: el.clientWidth, gap: parseFloat(cs.columnGap) || 0, rowGap: parseFloat(cs.rowGap) || 0 };
      setFrame((f) => (f && f.width === next.width && f.gap === next.gap && f.rowGap === next.rowGap ? f : next));
    };
    measureBox();
    const ro = new ResizeObserver(measureBox);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visible = useMemo(() => items.slice(0, n), [items, n]);
  const layout = useMemo(() => (frame ? layoutMasonry(visible.map(measure), frame) : null), [visible, measure, frame]);

  // append the next page when the end of the list nears the viewport; observing afresh after each page asks again
  // at once, so a tall screen keeps filling until it is covered
  const end = useRef<HTMLDivElement>(null);
  const more = n < items.length;
  useEffect(() => {
    const el = end.current;
    if (!el || !more) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown({ key: listKey, n: n + PAGE });
      },
      { rootMargin: AHEAD }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [more, n, listKey, layout]);

  return (
    <div className={className}>
      <div ref={box} className="msn" style={{ height: layout ? layout.height : undefined }}>
        {layout &&
          visible.map((item, i) => {
            const t = layout.tiles[i];
            return (
              <div key={keyOf(item)} className="msn-cell" style={{ left: t.x, top: t.y, width: layout.colWidth }}>
                {render(item)}
              </div>
            );
          })}
      </div>
      {more && <div ref={end} className="msn-end" />}
    </div>
  );
}
