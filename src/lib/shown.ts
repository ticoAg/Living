// How many tiles a paged list has shown, kept in the current history entry's state. A new entry (a link) has none and
// starts at one page; Back and Forward bring the entry's own count back, so the list is as long as when it was left.
// The address is stored with it, because filters change the address with replaceState inside the same entry.

const FIELD = 'livingShown';

interface Shown {
  key: string;
  n: number;
}

/** The count stored for `key` in this history state, or 0. */
export function shownIn(state: unknown, key: string): number {
  const s = state && typeof state === 'object' ? (state as Record<string, unknown>)[FIELD] : undefined;
  if (!s || typeof s !== 'object') return 0;
  const { key: k, n } = s as Partial<Shown>;
  return k === key && typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** `state` with the count for `key` merged in, other fields kept. */
export function withShown(state: unknown, key: string, n: number): Record<string, unknown> {
  const base = state && typeof state === 'object' ? (state as Record<string, unknown>) : {};
  return { ...base, [FIELD]: { key, n } satisfies Shown };
}

export const readShown = (key: string): number => shownIn(history.state, key);

export function writeShown(key: string, n: number): void {
  if (shownIn(history.state, key) === n) return;
  history.replaceState(withShown(history.state, key, n), '');
}
