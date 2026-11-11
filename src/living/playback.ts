// Position in the playlist. The current photo is kept by id, so the list may be rebuilt (a new day, a reloaded
// list) without the slideshow jumping; an id that is no longer listed falls back to the first photo.

/** Index of `curId` in the list; 0 when there is none or it is gone. */
export function positionOf(playlist: readonly { id: string }[], curId: string | null): number {
  if (!curId) return 0;
  const i = playlist.findIndex((p) => p.id === curId);
  return i < 0 ? 0 : i;
}

/** The photo `delta` steps from `idx`, wrapping around both ends; null for an empty list. */
export function stepId(playlist: readonly { id: string }[], idx: number, delta: number): string | null {
  const n = playlist.length;
  if (!n) return null;
  return playlist[(((idx + delta) % n) + n) % n].id;
}

/**
 * A photo whose image fails is skipped, but only while failures in a row stay at most the playlist's length (and
 * at least 2): when every photo fails (offline) the slideshow stays put instead of spinning.
 */
export const maySkip = (failuresInARow: number, count: number): boolean => failuresInARow <= Math.max(2, count);
