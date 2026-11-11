import type { Draft, DraftItem, EditorPhoto } from './draft';
import { dayIndex } from './util';

// Edits to the editor's item list. Each returns new arrays and leaves its input alone; where nothing changes
// the input comes back as is, so a state update can bail out.

export type DropPos = 'before' | 'after';

/** Day after the last day section before `index`, else the start date. */
export function suggestDay(items: readonly DraftItem[], index: number, start: string): string {
  for (let i = Math.min(index, items.length) - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'day' && it.day) return new Date((dayIndex(it.day) + 1) * 86400000).toISOString().slice(0, 10);
  }
  return start;
}

/** Drag and drop: put `fromKey` before or after `toKey`. */
export function moveItem(items: DraftItem[], fromKey: string, toKey: string, pos: DropPos): DraftItem[] {
  if (fromKey === toKey) return items;
  const from = items.findIndex((i) => i.key === fromKey);
  if (from < 0) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  const to = next.findIndex((i) => i.key === toKey);
  if (to < 0) return items;
  next.splice(pos === 'after' ? to + 1 : to, 0, moved);
  return next;
}

/** The up and down buttons: swap `key` with its neighbour. */
export function swapItem(items: DraftItem[], key: string, delta: -1 | 1): DraftItem[] {
  const i = items.findIndex((it) => it.key === key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= items.length) return items;
  const next = items.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Drop an item; a cover that is no longer in the theme falls back to the first photo. */
export function removeItem(d: Draft, key: string): Draft {
  const items = d.items.filter((it) => it.key !== key);
  const stillThere = d.coverPhotoId && items.some((it) => it.kind === 'photo' && it.photoId === d.coverPhotoId);
  return { ...d, items, coverPhotoId: stillThere ? d.coverPhotoId : null };
}

/** The row menu: `item` right after `key` (at the top when `key` is gone). */
export function insertAfter(items: readonly DraftItem[], key: string, item: DraftItem): DraftItem[] {
  const next = items.slice();
  next.splice(items.findIndex((it) => it.key === key) + 1, 0, item);
  return next;
}

/** The photo picker: new photo items after `after`, or at the end when there is no such item. */
export function insertPhotos(items: readonly DraftItem[], after: string | null, fresh: readonly DraftItem[]): DraftItem[] {
  const idx = after ? items.findIndex((it) => it.key === after) : -1;
  const next = items.slice();
  next.splice(idx >= 0 ? idx + 1 : next.length, 0, ...fresh);
  return next;
}

/** After a save: empty text blocks were not sent, so they leave the page too. */
export function dropEmptyText(d: Draft): Draft {
  const empty = (it: DraftItem) => it.kind === 'text' && !it.text.trim();
  return d.items.some(empty) ? { ...d, items: d.items.filter((it) => !empty(it)) } : d;
}

/** Photos that can be the cover: each photo once, in theme order, at most 300 buttons. */
export function coverChoices(items: readonly DraftItem[]): EditorPhoto[] {
  const seen = new Set<string>();
  const out: EditorPhoto[] = [];
  for (const it of items) {
    if (it.kind === 'photo' && it.photo && !seen.has(it.photoId)) {
      seen.add(it.photoId);
      out.push(it.photo);
    }
  }
  return out.slice(0, 300);
}
