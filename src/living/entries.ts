// What Living plays from entries (`src=entry`, `src=entries`): their photos in order, each once, and the name of the
// entry each one plays from, for the caption. The API already left out what the viewer may not open.
// Spec: docs/product/features/living-mode.md ("记录")

import { entryLabel, entryTypeLabel } from '../../shared/entries';
import type { EntryDetail, EntrySummary, PhotoSummary } from '../../shared/types';
import type { Source } from './settings';

export interface EntryPlay {
  photos: PhotoSummary[];
  /** photo id → the name of the entry it plays from */
  entryOf: ReadonlyMap<string, string>;
}

/** An entry's name: its title, else the start of its text, else its type. */
export const entryName = (e: Pick<EntrySummary, 'title' | 'type'>, text: string | null): string =>
  entryLabel(e.title, text) || entryTypeLabel(e.type);

/** The entries `entries` plays the photos of: everyone's public ones, or one person's, of some types. */
export function entriesPath(s: Source): string | null {
  if (s.src !== 'entries') return null;
  const q: string[] = [];
  if (s.user) q.push(`owner=${encodeURIComponent(s.user)}`);
  if (s.types.length) q.push(`type=${s.types.join(',')}`);
  return `/api/entries${q.length ? `?${q.join('&')}` : ''}`;
}

/** Only finished entries play: a draft or an archived one stays in its author's archive, here as on a profile. */
export const playableEntries = (entries: readonly EntrySummary[]): EntrySummary[] => entries.filter((e) => e.status === 'published');

/** The ids of the entries' photos that `listed` does not have, each once: to be asked for by id. */
export function missingPhotoIds(entries: readonly EntrySummary[], listed: ReadonlyMap<string, PhotoSummary>): string[] {
  return [...new Set(entries.flatMap((e) => e.photoIds))].filter((id) => !listed.has(id));
}

/** One entry's photos, in its order. */
export function photosOfEntry(e: EntryDetail): EntryPlay {
  const name = entryName(e, e.body);
  const photos = e.media.map((m) => m.photo);
  return { photos, entryOf: new Map(photos.map((p) => [p.id, name] as const)) };
}

/** The entries' photos in list order (newest entry first), each once, under the name of the first entry it is in. */
export function photosOfEntries(entries: readonly EntrySummary[], photo: (id: string) => PhotoSummary | undefined): EntryPlay {
  const photos: PhotoSummary[] = [];
  const entryOf = new Map<string, string>();
  for (const e of entries) {
    const name = entryName(e, e.excerpt);
    for (const id of e.photoIds) {
      const p = entryOf.has(id) ? undefined : photo(id);
      if (!p) continue;
      entryOf.set(id, name);
      photos.push(p);
    }
  }
  return { photos, entryOf };
}
