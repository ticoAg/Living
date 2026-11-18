// The calendar of one's archive: the weeks of a month, how dark a day is drawn, runs of days, the months a span covers.
// Days are `YYYY-MM-DD` strings (shared/days.ts); weeks start on Monday. Docs: /docs/product/features/calendar.md

import { addDays, dayOf, daysBetween, monthDays, weekday } from '../../shared/days';
import { occurredDay } from '../../shared/entries';
import type { EntrySummary, PhotoSummary } from '../../shared/types';

/** The weeks of a month, each seven days from Monday: null before the 1st and after the last day. */
export function monthWeeks(year: number, month: number): (string | null)[][] {
  const lead = weekday(dayOf(year, month, 1));
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: monthDays(year, month) }, (_, i) => dayOf(year, month, i + 1))
  ];
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The address of a month `YYYY-MM` on the calendar, and of a day in it. */
export const calendarHref = (month: string, day?: string) => `/archive/calendar?month=${month}${day ? `&day=${day}` : ''}`;

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/**
 * How dark a day is drawn, 1 to 4, for amounts up to `max`; nothing is 0. Steps grow by ratio, not difference, so a day
 * of 300 photos does not wash out the days of a few: 1 is drawn lightest, `max` darkest. When every day holds one
 * thing, each is drawn darkest.
 */
export function heatScale(max: number): (n: number) => HeatLevel {
  if (max <= 1) return (n) => (n > 0 ? 4 : 0);
  const top = Math.log(max);
  return (n) => (n <= 0 ? 0 : (Math.min(4, 1 + Math.floor((3 * Math.log(n)) / top)) as HeatLevel));
}

/**
 * The longest run of consecutive days among `days`, and the run still going: the one that reaches today, or
 * yesterday while today is not over.
 */
export function streaks(days: Iterable<string>, today: string): { longest: number; current: number } {
  const set = new Set(days);
  let longest = 0;
  for (const d of set) {
    if (set.has(addDays(d, -1))) continue;
    let n = 1;
    while (set.has(addDays(d, n))) n++;
    longest = Math.max(longest, n);
  }
  let current = 0;
  for (let d = set.has(today) ? today : addDays(today, -1); set.has(d); d = addDays(d, -1)) current++;
  return { longest, current };
}

/** `YYYY-MM` of every month from the one of `from` to the one of `to`, in order; none when `to` comes first. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = +from.slice(0, 4);
  let m = +from.slice(5, 7);
  const end = to.slice(0, 7);
  for (let ym = dayOf(y, m, 1).slice(0, 7); ym <= end; ym = dayOf(y, m, 1).slice(0, 7)) {
    out.push(ym);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** The month before or after `YYYY-MM`. */
export function shiftMonth(ym: string, by: -1 | 1): string {
  const y = +ym.slice(0, 4);
  const m = +ym.slice(5, 7) + by;
  return m < 1 ? dayOf(y - 1, 12, 1).slice(0, 7) : m > 12 ? dayOf(y + 1, 1, 1).slice(0, 7) : dayOf(y, m, 1).slice(0, 7);
}

/** What a day holds, for its cell: how many entries and photos, and the photo it shows. */
export interface DayMark {
  entries: number;
  photos: number;
  cover: PhotoSummary | null;
}

/**
 * Each day's mark from the entries and photos of a span. A day shows a favourite photo taken on it, else the first
 * photo of its first entry that has one drawn, else the first photo taken that day.
 */
export function dayMarks(
  entries: readonly EntrySummary[],
  photos: readonly PhotoSummary[],
  byId: ReadonlyMap<string, PhotoSummary>
): Map<string, DayMark> {
  const out = new Map<string, DayMark & { favorite: boolean }>();
  const at = (day: string) => {
    let m = out.get(day);
    if (!m) out.set(day, (m = { entries: 0, photos: 0, cover: null, favorite: false }));
    return m;
  };
  const byTime = [...entries].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0));
  for (const e of byTime) {
    const m = at(occurredDay(e.occurredAt));
    m.entries++;
    if (!m.cover) m.cover = e.photoIds.map((id) => byId.get(id)).find((p) => p !== undefined) ?? null;
  }
  const taken = [...photos].filter((p) => p.takenAt).sort((a, b) => (a.takenAt! < b.takenAt! ? -1 : a.takenAt! > b.takenAt! ? 1 : 0));
  for (const p of taken) {
    const m = at(p.takenAt!.slice(0, 10));
    m.photos++;
    if (p.favorite && !m.favorite) {
      m.cover = p;
      m.favorite = true;
    } else if (!m.cover) m.cover = p;
  }
  return new Map([...out].map(([day, { favorite: _favorite, ...m }]) => [day, m]));
}

/** 8 条记录 · 120 张照片, leaving out what there is none of; `short` for 8 条 · 120 张. */
export function holdsText(n: { entries: number; photos: number }, short = false): string {
  return [n.entries ? `${n.entries} 条${short ? '' : '记录'}` : '', n.photos ? `${n.photos} 张${short ? '' : '照片'}` : '']
    .filter(Boolean)
    .join(' · ');
}

/** A count as it reads best: 8,532, then 1.2万 from ten thousand. */
export function fmtAmount(n: number): string {
  if (n < 10_000) return n.toLocaleString('en-US');
  const wan = n / 10_000;
  return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1).replace(/\.0$/, '')}万`;
}

/**
 * How a project has been kept up: its runs of days, and on how many days a week over its span from `from` to `to`
 * (at least a week, so a first day does not read as seven a week).
 */
export function rhythm(
  days: Iterable<string>,
  from: string,
  to: string,
  today: string
): { longest: number; current: number; perWeek: number } {
  const set = new Set(days);
  const weeks = Math.max(1, (daysBetween(from, to) + 1) / 7);
  return { ...streaks(set, today), perWeek: set.size / weeks };
}

/** Entries counted by the month they happened in, for every month of `months`. */
export function perMonth(entries: readonly EntrySummary[], months: readonly string[]): { month: string; count: number }[] {
  const counts = new Map(months.map((m) => [m, 0]));
  for (const e of entries) {
    const m = e.occurredAt.slice(0, 7);
    const n = counts.get(m);
    if (n !== undefined) counts.set(m, n + 1);
  }
  return months.map((month) => ({ month, count: counts.get(month)! }));
}
