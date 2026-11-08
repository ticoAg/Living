import type { PhotoSummary } from '../../shared/types';
import type { TagTree } from '../lib/tags';
import type { Source } from './settings';

// Turning the photos the API returned into the ordered list Living plays.
// The API already applied visibility and location privacy; this module only narrows and orders.

/** Seeded 32-bit string hash (FNV-1a with a finaliser), so a photo's rank depends only on id and seed. */
function hash(s: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Weighted shuffle without replacement: each photo draws an exponential "waiting time" with rate
 * equal to its weight (favourites 2, others 1) and the list is sorted by that time. A favourite is
 * therefore twice as likely to come next at every step. The draw only depends on (seed, id), so the
 * order is stable for the whole session and filtering keeps the relative order of what remains.
 */
export function shuffle(photos: readonly PhotoSummary[], seed: number): PhotoSummary[] {
  const keyed = photos.map((p) => {
    const u = (hash(p.id, seed) + 0.5) / 4294967296;
    return { p, k: -Math.log(u) / (p.favorite ? 2 : 1) };
  });
  keyed.sort((a, b) => a.k - b.k || (a.p.id < b.p.id ? -1 : 1));
  return keyed.map((x) => x.p);
}

/** Oldest first; photos without a capture time go last. */
export function sortByTime(photos: readonly PhotoSummary[]): PhotoSummary[] {
  return photos.slice().sort((a, b) => {
    if (a.takenAt === b.takenAt) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    if (a.takenAt === null) return 1;
    if (b.takenAt === null) return -1;
    return a.takenAt < b.takenAt ? -1 : 1;
  });
}

const dayOfYear = (month: number, day: number) => Date.UTC(2001, month - 1, day) / 86400000; // 2001 has no Feb 29

/** Same calendar day ±`window` days (wrapping over New Year), in an earlier year than `today`. */
export function isNearToday(takenAt: string | null, today: Date, window = 10): boolean {
  if (!takenAt || takenAt.length < 10) return false;
  const year = Number(takenAt.slice(0, 4));
  const month = Number(takenAt.slice(5, 7));
  const day = Number(takenAt.slice(8, 10));
  if (!(year < today.getFullYear()) || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return false;
  const diff = Math.abs(dayOfYear(month, day) - dayOfYear(today.getMonth() + 1, today.getDate()));
  return Math.min(diff, 365 - diff) <= window;
}

export interface PlaylistInput {
  /** photos as returned for the source (list, place list or theme items in order) */
  photos: readonly PhotoSummary[];
  source: Source;
  /** tag tree, or null when it could not be loaded (tags then match directly) */
  tree: TagTree | null;
  seed: number;
  today: Date;
  /** shuffled lists are rotated to begin here; '' for none */
  startId: string;
}

export function buildPlaylist({ photos, source, tree, seed, today, startId }: PlaylistInput): PhotoSummary[] {
  const seen = new Set<string>();
  let list = photos.filter((p) => {
    if (!p.inLiving || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  if (source.city && source.src !== 'theme') list = list.filter((p) => p.city === source.city);

  if (source.src === 'tags' && source.tags.length) {
    const wanted = source.tags;
    list = list.filter((p) => {
      const have = tree ? tree.expand(p.tagIds) : new Set(p.tagIds);
      return source.match === 'all' ? wanted.every((id) => have.has(id)) : wanted.some((id) => have.has(id));
    });
  }

  if (source.src === 'today') list = list.filter((p) => isNearToday(p.takenAt, today));

  if (source.order === 'time') {
    // A theme's "time" order is the order of its items; everything else is chronological.
    return source.src === 'theme' ? list : sortByTime(list);
  }
  list = shuffle(list, seed);
  const at = startId ? list.findIndex((p) => p.id === startId) : -1;
  return at > 0 ? [...list.slice(at), ...list.slice(0, at)] : list;
}
