import { serializeQuery } from './url';

// URLs other areas understand. Living parameters are documented in /docs/product/features/living-mode.md.

const q = (entries: [string, string | null | undefined][]) => {
  const s = serializeQuery(entries);
  return s ? `?${s}` : '';
};

/**
 * Living link that follows a gallery filter: nothing selected plays everything, a city alone plays
 * the city, tags (optionally with a city) play the tag selection. `match=all` keeps the gallery's AND.
 */
export function livingForFilter(f: { tags?: readonly string[]; city?: string; user?: string }): string {
  const tags = f.tags ?? [];
  if (tags.length) {
    return `/living${q([
      ['src', 'tags'],
      ['tags', tags.join(',')],
      ['match', tags.length > 1 ? 'all' : null],
      ['city', f.city],
      ['user', f.user]
    ])}`;
  }
  if (f.city) {
    return `/living${q([
      ['src', 'city'],
      ['city', f.city],
      ['user', f.user]
    ])}`;
  }
  return `/living${q([['user', f.user]])}`;
}

export const livingPlace = (poiId: string) =>
  `/living${q([
    ['src', 'place'],
    ['place', poiId]
  ])}`;

export const livingStart = (photoId: string) => `/living${q([['start', photoId]])}`;

/** Gallery link with a filter applied; `owner` targets that user's profile gallery. */
export const galleryLink = (f: { tags?: readonly string[]; city?: string }, owner?: string) =>
  `${owner ? `/@${owner}` : '/'}${q([
    ['tags', f.tags?.length ? f.tags.join(',') : null],
    ['city', f.city]
  ])}`;
