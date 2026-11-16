import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePaged } from '../lib/usePaged';
import { layoutMasonry, type MasonryItem } from './columns';

// Photo masonry: tiles in reading order (DOM, Tab and screen-reader order are the list's order, newest first),
// each absolutely placed in the column that is shortest at that point (see columns.ts). Only the first PAGE tiles
// render at first; more are appended as the end comes near (lib/usePaged.ts), and coming Back from a photo renders
// as many as were shown.

export const PAGE = 20;

interface Props<T> {
  items: readonly T[];
  keyOf: (item: T) => string;
  /** aspect ratio and fixed caption height of an item */
  measure: (item: T) => MasonryItem;
  render: (item: T) => ReactNode;
  className?: string;
}

export default function Masonry<T>({ items, keyOf, measure, render, className }: Props<T>) {
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

  // a new frame lays the tiles out again: the end is asked again, so a tall screen keeps filling
  const { n, more, end } = usePaged(items.length, PAGE, frame);
  const visible = useMemo(() => items.slice(0, n), [items, n]);
  const layout = useMemo(() => (frame ? layoutMasonry(visible.map(measure), frame) : null), [visible, measure, frame]);

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
