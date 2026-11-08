import type { PhotoSummary } from '../../shared/types';

/** Newest capture first; photos without a capture time keep their server order at the end. */
export function byTakenDesc(a: Pick<PhotoSummary, 'takenAt'>, b: Pick<PhotoSummary, 'takenAt'>): number {
  if (a.takenAt === b.takenAt) return 0;
  if (!a.takenAt) return 1;
  if (!b.takenAt) return -1;
  return a.takenAt < b.takenAt ? 1 : -1;
}

/** Oldest first, for timelines of a single place. */
export const byTakenAsc = (a: Pick<PhotoSummary, 'takenAt'>, b: Pick<PhotoSummary, 'takenAt'>) => -byTakenDesc(a, b);
