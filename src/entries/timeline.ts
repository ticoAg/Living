// The archive as one line of days, latest first: an entry on the day it happened (occurredAt), a photo on the day it
// was taken. Within a day, entries and runs of photos alternate in time order, latest first; an entry with a day but
// no time closes its day. A photo that an entry of the same day already shows is not shown again beside it. Photos
// with no capture time have no day and are listed apart. Docs: /docs/product/features/archive.md

import { occurredDay } from '../../shared/entries';
import type { EntrySummary, EntryType, PhotoSummary } from '../../shared/types';

/** What the archive shows: everything, one type of entry, or the photos alone. */
export type Kind = 'all' | EntryType | 'photos';

export type Segment = { kind: 'entry'; entry: EntrySummary } | { kind: 'photos'; photos: PhotoSummary[] };

export interface TimelineDay {
  /** YYYY-MM-DD */
  day: string;
  segments: Segment[];
}

export interface Timeline {
  days: TimelineDay[];
  /** photos with no capture time */
  undated: PhotoSummary[];
}

/** The entries a view keeps: none for the photos alone, archived ones only on request. */
export function keepEntries(entries: readonly EntrySummary[], kind: Kind, archived: boolean): EntrySummary[] {
  if (kind === 'photos') return [];
  return entries.filter((e) => (archived || e.status !== 'archived') && (kind === 'all' || e.type === kind));
}

/** Photos belong to the whole view and to the photos alone, not to one type of entry. */
export const showsPhotos = (kind: Kind): boolean => kind === 'all' || kind === 'photos';

const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

/** Photo ids each day's entries show. */
function shownByDay(entries: readonly EntrySummary[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const e of entries) {
    const day = occurredDay(e.occurredAt);
    let set = out.get(day);
    if (!set) out.set(day, (set = new Set()));
    for (const id of e.photoIds) set.add(id);
  }
  return out;
}

/** Photos taken on a day that its entries do not already show, in the order given. */
export function loosePhotos(photos: readonly PhotoSummary[], entries: readonly EntrySummary[]): PhotoSummary[] {
  const shown = shownByDay(entries);
  return photos.filter((p) => !p.takenAt || !shown.get(p.takenAt.slice(0, 10))?.has(p.id));
}

export function buildTimeline(entries: readonly EntrySummary[], photos: readonly PhotoSummary[]): Timeline {
  type Item = { at: string; entry: EntrySummary } | { at: string; photo: PhotoSummary };
  const days = new Map<string, Item[]>();
  const add = (day: string, item: Item) => {
    const list = days.get(day);
    if (list) list.push(item);
    else days.set(day, [item]);
  };
  for (const entry of entries) add(occurredDay(entry.occurredAt), { at: entry.occurredAt, entry });
  const undated: PhotoSummary[] = [];
  for (const photo of loosePhotos(photos, entries)) {
    if (photo.takenAt) add(photo.takenAt.slice(0, 10), { at: photo.takenAt, photo });
    else undated.push(photo);
  }

  const out = [...days.entries()]
    .sort(([a], [b]) => desc(a, b))
    .map(([day, items]): TimelineDay => {
      // the sort is stable: equal times keep the order they came in, the server's latest first
      items.sort((a, b) => desc(a.at, b.at));
      const segments: Segment[] = [];
      for (const it of items) {
        if ('entry' in it) {
          segments.push({ kind: 'entry', entry: it.entry });
          continue;
        }
        const last = segments[segments.length - 1];
        if (last?.kind === 'photos') last.photos.push(it.photo);
        else segments.push({ kind: 'photos', photos: [it.photo] });
      }
      return { day, segments };
    });
  return { days: out, undated };
}

export interface YearMark {
  year: string;
  /** index of the year's first (latest) day */
  index: number;
}

/** Where each year starts in a list of days, latest first. */
export function yearMarks(days: readonly TimelineDay[]): YearMark[] {
  const out: YearMark[] = [];
  days.forEach((d, index) => {
    const year = d.day.slice(0, 4);
    if (out[out.length - 1]?.year !== year) out.push({ year, index });
  });
  return out;
}

export interface TodayView {
  /** finished entries of the day, latest first */
  entries: EntrySummary[];
  /** every draft, last edited first */
  drafts: EntrySummary[];
  /** photos taken that day that its entries do not show, latest first */
  photos: PhotoSummary[];
  /** the same day of earlier years, the latest year first */
  past: { year: number; entries: EntrySummary[]; photos: PhotoSummary[] }[];
}

/** The Today page: what a day holds so far, what is unfinished, and the same day in years before. */
export function todayView(entries: readonly EntrySummary[], photos: readonly PhotoSummary[], today: string): TodayView {
  const finished = entries.filter((e) => e.status === 'published');
  const ofToday = finished.filter((e) => occurredDay(e.occurredAt) === today);
  const drafts = entries.filter((e) => e.status === 'draft').sort((a, b) => desc(a.updatedAt, b.updatedAt));
  const taken = (p: PhotoSummary) => (p.takenAt ? p.takenAt.slice(0, 10) : '');
  const byTime = (a: PhotoSummary, b: PhotoSummary) => desc(a.takenAt ?? '', b.takenAt ?? '');
  const todayPhotos = loosePhotos(
    photos.filter((p) => taken(p) === today),
    ofToday
  ).sort(byTime);

  const md = today.slice(4);
  const year = Number(today.slice(0, 4));
  const past = new Map<number, { year: number; entries: EntrySummary[]; photos: PhotoSummary[] }>();
  const slot = (y: number) => {
    let s = past.get(y);
    if (!s) past.set(y, (s = { year: y, entries: [], photos: [] }));
    return s;
  };
  const earlier = (day: string) => day.slice(4) === md && Number(day.slice(0, 4)) < year;
  const pastEntries = finished.filter((e) => earlier(occurredDay(e.occurredAt)));
  for (const e of pastEntries) slot(Number(e.occurredAt.slice(0, 4))).entries.push(e);
  for (const p of loosePhotos(
    photos.filter((p) => earlier(taken(p))),
    pastEntries
  ).sort(byTime)) {
    slot(Number(taken(p).slice(0, 4))).photos.push(p);
  }

  return { entries: ofToday, drafts, photos: todayPhotos, past: [...past.values()].sort((a, b) => b.year - a.year) };
}
