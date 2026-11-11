import { useEffect, useRef } from 'react';
import type { DraftItem } from './draft';

/**
 * Where focus goes once the item list has re-rendered: `act` keeps keyboard focus on the same button of a moved row
 * (or of the row that took a removed one's place); otherwise the row is scrolled into view and, with `focus`, its
 * first field is focused.
 */
export interface FocusRequest {
  key: string;
  focus: boolean;
  act?: 'up' | 'down' | 'remove';
}

/** Set `.current` before changing the items; the request is carried out after the next render of the list. */
export function useItemFocus(items: readonly DraftItem[]) {
  const pending = useRef<FocusRequest | null>(null);
  useEffect(() => {
    const want = pending.current;
    if (!want) return;
    pending.current = null;
    const el = document.querySelector<HTMLElement>(`[data-item-key="${want.key}"]`);
    if (!el) return;
    if (want.act) {
      // keep keyboard focus on the same kind of button (the other direction if this one is now disabled)
      const pick = (act: string) => el.querySelector<HTMLButtonElement>(`[data-act="${act}"]:not(:disabled)`);
      (pick(want.act) ?? pick(want.act === 'up' ? 'down' : 'up'))?.focus();
      return;
    }
    el.scrollIntoView({ block: 'center' });
    if (want.focus) el.querySelector<HTMLElement>('textarea, input')?.focus({ preventScroll: true });
  }, [items]);
  return pending;
}
