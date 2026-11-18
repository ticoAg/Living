import { occurredDay } from '../../shared/entries';
import type { EntrySummary, EntryType } from '../../shared/types';

// What a person shows as their work: finished entries of two types. A work (作品) is a creation, an article (文章) is
// long writing; both show to others only once their author made them public, like any entry. Docs:
// /docs/product/features/showcase.md

export const WORK_TYPE: EntryType = 'creation';
export const ARTICLE_TYPE: EntryType = 'article';

/** Works and articles a profile shows before its link to all of them. */
export const PROFILE_WORKS = 8;
export const PROFILE_ARTICLES = 5;
/** Works a page draws at a time, and asks the photos of in one request (at most 200 by id). */
export const WORK_STEP = 48;

/** A person's entries split for their profile: finished works, finished articles, and every other finished entry. */
export interface Shelves {
  works: EntrySummary[];
  articles: EntrySummary[];
  rest: EntrySummary[];
}

/** Drafts and archived entries stay in their author's archive; the rest go on the shelf of their type, in list order. */
export function shelve(entries: readonly EntrySummary[]): Shelves {
  const out: Shelves = { works: [], articles: [], rest: [] };
  for (const e of entries) {
    if (e.status !== 'published') continue;
    if (e.type === WORK_TYPE) out.works.push(e);
    else if (e.type === ARTICLE_TYPE) out.articles.push(e);
    else out.rest.push(e);
  }
  return out;
}

/** A person's works or articles alone, as their pages ask for them (src/routes.ts prefetches the same). */
export const shelfPath = (handle: string, type: EntryType): string => `/api/entries?owner=${encodeURIComponent(handle)}&type=${type}`;

/**
 * A profile's shelves, from the person's list of entries. That list holds the newest entries only, up to its cap; past
 * it the works and articles may be more than it holds, so the profile asks for them by type too, as their pages do,
 * and once those lists are here they take the place of what the first one had.
 */
export function profileShelves(
  entries: readonly EntrySummary[],
  typed: { works?: readonly EntrySummary[]; articles?: readonly EntrySummary[] } = {}
): Shelves {
  const s = shelve(entries);
  return {
    works: typed.works ? shelve(typed.works).works : s.works,
    articles: typed.articles ? shelve(typed.articles).articles : s.articles,
    rest: s.rest
  };
}

/** Entries of one year after another, in list order (latest first): the years of an article list. */
export function byYear<T extends Pick<EntrySummary, 'occurredAt'>>(entries: readonly T[]): { year: string; entries: T[] }[] {
  const out: { year: string; entries: T[] }[] = [];
  for (const e of entries) {
    const year = occurredDay(e.occurredAt).slice(0, 4);
    const last = out[out.length - 1];
    if (last?.year === year) last.entries.push(e);
    else out.push({ year, entries: [e] });
  }
  return out;
}

/** How long a text is: "860 字", "2,300 字", "1.2万字". */
export function fmtLength(chars: number): string {
  if (chars < 10_000) return `${chars.toLocaleString('en-US')} 字`;
  const wan = chars / 10_000;
  return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1).replace(/\.0$/, '')}万字`;
}

/** The photo ids to ask for: the first photo of each, each once, at most 200 (the limit of a request by id). */
export const coverIds = (entries: readonly Pick<EntrySummary, 'photoIds'>[]): string[] =>
  [...new Set(entries.flatMap((e) => (e.photoIds.length ? [e.photoIds[0]] : [])))].slice(0, 200);
