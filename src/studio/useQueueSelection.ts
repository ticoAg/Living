import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { pickRows, type Item, type PickHow } from './upload-model';

/**
 * Which photo is on screen and which are checked (in queue order; two or more are edited together). Clicks follow
 * `pickRows`: a plain click shows one photo, Ctrl/⌘ or the checkbox adds or drops one, Shift picks a run. Esc drops
 * the selection, except while typing in a field.
 */
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

  return { selected, checked, picked, pickedIds, selecting, setSelectedId, setChecked, onPickRow };
}
