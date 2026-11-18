// Days as `YYYY-MM-DD` strings, the form entries and photos are dated in: arithmetic on the calendar alone, with no
// time zone, so a day is the same day wherever the code runs. The Worker bounds date ranges with them; the SPA lays
// out calendars. Docs: /docs/api/review.md

/** `YYYY-MM-DD` that is a real calendar date. */
export function isDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// parsed from the ISO form, which reads every four-digit year as itself (Date.UTC would take 0050 for 1950)
const utc = (day: string) => Date.parse(`${day}T00:00:00Z`);
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The day `n` days after `day` (before it when `n` is negative). */
export const addDays = (day: string, n: number): string => fromUtc(utc(day) + n * 86_400_000);

/** Whole days from `a` to `b`: 1 from a day to the next, negative when `b` comes first. */
export const daysBetween = (a: string, b: string): number => Math.round((utc(b) - utc(a)) / 86_400_000);

/** 0 for Monday through 6 for Sunday: weeks here start on Monday. */
export const weekday = (day: string): number => (new Date(utc(day)).getUTCDay() + 6) % 7;

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of a year, month (1–12) and day. */
export const dayOf = (year: number, month: number, date: number): string => `${String(year).padStart(4, '0')}-${pad(month)}-${pad(date)}`;

/** Days in a month, `month` from 1 to 12. */
export const monthDays = (year: number, month: number): number =>
  daysBetween(dayOf(year, month, 1), month === 12 ? dayOf(year + 1, 1, 1) : dayOf(year, month + 1, 1));

/** `YYYY-MM` given in an address, or null. */
export const parseMonth = (v: string | null | undefined): string | null => (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null);

/** The first and last day of a month `YYYY-MM`. */
export function monthSpan(ym: string): { from: string; to: string } {
  const y = +ym.slice(0, 4);
  const m = +ym.slice(5, 7);
  return { from: dayOf(y, m, 1), to: dayOf(y, m, monthDays(y, m)) };
}

/**
 * The bound just past every time of `day`, for `column < bound`. Each value of that day is the day itself or the day
 * followed by `T…`, and both sort before `day~`; a later day is greater already within its date.
 */
export const endOfDay = (day: string): string => `${day}~`;
