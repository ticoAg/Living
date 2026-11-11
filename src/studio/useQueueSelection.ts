import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { pickRows, stepRow, type Item, type PickHow } from './upload-model';

/**
 * Which photo is on screen and which are checked (in queue order; two or more are edited together). Clicks follow
 * `pickRows`: a plain click shows one photo, Ctrl/⌘ or the checkbox adds or drops one, Shift picks a run. Esc drops
 * the selection, except while typing in a field. ↑ and ↓ step through the queue where it is a column beside the
 * photo (the three-column layout), as ← → step through photos on the photo page.
 */

/** The window is wide enough for the queue to be a column that scrolls on its own (studio.css, min-width: 1180px). */
const COLUMNS = '(min-width: 1180px)';
/** Where an arrow key already means something: fields, the candidates' radio buttons, a map, a dialog on top. */
const ARROWS_TAKEN = 'input, textarea, select, [contenteditable], [role=radiogroup], .map-frame, dialog';

export function useQueueSelection(items: Item[], itemsRef: RefObject<Item[]>) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const rangeFrom = useRef<string | null>(null);

  const onPickRow = useCallback(
    (id: string, how: PickHow) => {
      const order = itemsRef.current.map((i) => i.id);
      const cur = itemsRef.current.some((i) => i.id === selectedId) ? selectedId : (order[0] ?? null);
      const next = pickRows(order, checked, cur, id, how, rangeFrom.current);
      if (how !== 'range') rangeFrom.current = id;
      setChecked(next.checked);
      setSelectedId(next.current);
    },
    [itemsRef, checked, selectedId]
  );

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? items[0] ?? null, [items, selectedId]);
  const picked = useMemo(() => {
    const ids = new Set(checked);
    return items.filter((i) => ids.has(i.id));
  }, [items, checked]);
  const pickedIds = useMemo(() => new Set(picked.map((i) => i.id)), [picked]);

  const selecting = picked.length > 0;
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest('input:not([type=checkbox]), textarea, select, [contenteditable]')) return;
      setChecked([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.target instanceof Element && e.target.closest(ARROWS_TAKEN)) return;
      // in the narrower layouts the queue is a strip above the photo and the arrows scroll the page
      if (!window.matchMedia(COLUMNS).matches) return;
      const order = itemsRef.current.map((i) => i.id);
      if (order.length < 2) return;
      e.preventDefault();
      setSelectedId((cur) => stepRow(order, cur, e.key === 'ArrowDown' ? 1 : -1) ?? cur ?? order[0]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [itemsRef]);

  return { selected, checked, picked, pickedIds, selecting, setSelectedId, setChecked, onPickRow };
}
