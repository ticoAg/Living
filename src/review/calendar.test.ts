import { describe, expect, it } from 'vite-plus/test';
import { addDays, dayOf, daysBetween, endOfDay, isDay, monthDays, monthSpan, parseMonth, weekday } from '../../shared/days';
import type { PhotoSummary } from '../../shared/types';
import { entry, photo } from '../test-utils';
import {
  calendarHref,
  dayMarks,
  fmtAmount,
  heatScale,
  holdsText,
  monthsBetween,
  monthWeeks,
  perMonth,
  rhythm,
  shiftMonth,
  streaks
} from './calendar';

describe('days', () => {
  it('counts on the calendar, across months, years and leap days', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('0050-01-01', 1)).toBe('0050-01-02');
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
    expect(daysBetween('2026-01-02', '2026-01-01')).toBe(-1);
  });

  it('starts weeks on Monday', () => {
    expect(weekday('2026-11-16')).toBe(0);
    expect(weekday('2026-11-22')).toBe(6);
  });

  it('knows how long each month is', () => {
    expect([1, 2, 4, 12].map((m) => monthDays(2026, m))).toEqual([31, 28, 30, 31]);
    expect(monthDays(2024, 2)).toBe(29);
    expect(monthDays(1900, 2)).toBe(28);
    expect(monthDays(2000, 2)).toBe(29);
  });

  it('takes only real dates', () => {
    expect(['2026-02-28', '2024-02-29', '0050-12-31'].every(isDay)).toBe(true);
    expect(['2026-02-29', '2026-13-01', '2026-1-1', '2026-01-01T00:00', ''].some(isDay)).toBe(false);
    expect(dayOf(2026, 3, 5)).toBe('2026-03-05');
  });

  it('bounds every value of a day, day-only or timed, and nothing of the next', () => {
    const bound = endOfDay('2026-12-31');
    for (const v of ['2026-12-31', '2026-12-31T00:00:00', '2026-12-31T23:59:59']) expect(v < bound, v).toBe(true);
    for (const v of ['2027-01-01', '2027-01-01T00:00:00']) expect(v < bound, v).toBe(false);
  });
});

describe('monthWeeks', () => {
  it('lays a month out in weeks from Monday, padded at both ends', () => {
    const weeks = monthWeeks(2026, 11);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    // 1 November 2026 is a Sunday
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(weeks[5]).toEqual(['2026-11-30', null, null, null, null, null, null]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
  });

  it('needs only four weeks for a February from Monday to Sunday', () => {
    expect(monthWeeks(2021, 2)).toHaveLength(4);
  });
});

describe('heatScale', () => {
  it('draws nothing as 0, one thing lightest and the most darkest', () => {
    const level = heatScale(300);
    expect([0, 1, 300].map(level)).toEqual([0, 1, 4]);
    expect(level(20)).toBe(2);
    expect(level(100)).toBe(3);
  });

  it('draws every day darkest when each holds one thing', () => {
    expect([0, 1].map(heatScale(1))).toEqual([0, 4]);
    expect([0, 1, 2].map(heatScale(2))).toEqual([0, 1, 4]);
  });
});

describe('streaks', () => {
  it('finds the longest run and the one still going', () => {
    const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-10', '2026-11-15', '2026-11-16'];
    expect(streaks(days, '2026-11-16')).toEqual({ longest: 3, current: 2 });
    // today not written yet: the run up to yesterday still counts
    expect(streaks(days, '2026-11-17')).toEqual({ longest: 3, current: 2 });
    expect(streaks(days, '2026-11-18')).toEqual({ longest: 3, current: 0 });
  });

  it('runs across months and years, and is nothing without days', () => {
    expect(streaks(['2025-12-31', '2026-01-01', '2026-01-01'], '2026-01-01')).toEqual({ longest: 2, current: 2 });
    expect(streaks([], '2026-01-01')).toEqual({ longest: 0, current: 0 });
  });
});

describe('months', () => {
  it('lists the months a span covers', () => {
    expect(monthsBetween('2025-11-20', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthsBetween('2026-02-01', '2026-02-28')).toEqual(['2026-02']);
    expect(monthsBetween('2026-03-01', '2026-02-28')).toEqual([]);
  });

  it('steps a month back and forth across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-06', 1)).toBe('2026-07');
  });

  it('reads a month from the address, and spans it', () => {
    expect(parseMonth('2026-11')).toBe('2026-11');
    expect(['2026-13', '2026-00', '2026-1', '26-11', '', null].map(parseMonth)).toEqual([null, null, null, null, null, null]);
    expect(monthSpan('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthSpan('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('dayMarks', () => {
  const byId = (...ps: PhotoSummary[]) => new Map(ps.map((p) => [p.id, p]));

  it('counts each day and shows a favourite taken that day first', () => {
    const shot = [
      photo('a', { takenAt: '2026-11-16T08:00:00' }),
      photo('b', { takenAt: '2026-11-16T09:00:00', favorite: true }),
      photo('c', { takenAt: '2026-11-16T10:00:00', favorite: true }),
      photo('loose')
    ];
    const marks = dayMarks([entry('e', { occurredAt: '2026-11-16', photoIds: ['a'] })], shot, byId(...shot));
    expect([...marks.keys()]).toEqual(['2026-11-16']);
    expect(marks.get('2026-11-16')).toMatchObject({ entries: 1, photos: 3, cover: { id: 'b' } });
  });

  it("else an entry's first drawn photo, in time order, else the day's first photo", () => {
    const a = photo('a', { takenAt: '2026-11-15T09:00:00' });
    const b = photo('b', { takenAt: '2026-11-16T09:00:00' });
    const c = photo('c', { takenAt: '2026-11-16T07:00:00' });
    const marks = dayMarks(
      [
        entry('late', { occurredAt: '2026-11-16T20:00:00', photoIds: ['c'] }),
        entry('early', { occurredAt: '2026-11-16T08:00:00', photoIds: ['gone', 'b'] }),
        entry('bare', { occurredAt: '2026-11-14' })
      ],
      [b, a, c],
      byId(a, b, c)
    );
    expect(marks.get('2026-11-16')).toMatchObject({ entries: 2, photos: 2, cover: { id: 'b' } });
    expect(marks.get('2026-11-15')).toMatchObject({ entries: 0, photos: 1, cover: { id: 'a' } });
    expect(marks.get('2026-11-14')).toEqual({ entries: 1, photos: 0, cover: null });
  });

  it('takes the first photo taken when no entry shows one', () => {
    const later = photo('later', { takenAt: '2026-11-16T18:00:00' });
    const first = photo('first', { takenAt: '2026-11-16T06:00:00' });
    expect(dayMarks([], [later, first], byId(later, first)).get('2026-11-16')?.cover?.id).toBe('first');
  });
});

describe('counts', () => {
  it('tells what a day holds, leaving out what it has none of', () => {
    expect(holdsText({ entries: 2, photos: 5 })).toBe('2 条记录 · 5 张照片');
    expect(holdsText({ entries: 0, photos: 5 })).toBe('5 张照片');
    expect(holdsText({ entries: 8, photos: 120 }, true)).toBe('8 条 · 120 张');
    expect(holdsText({ entries: 0, photos: 0 })).toBe('');
  });

  it('reads tens of thousands as 万', () => {
    expect([0, 999, 8532, 9999].map(fmtAmount)).toEqual(['0', '999', '8,532', '9,999']);
    expect([10_000, 12_345, 105_000, 1_234_567].map(fmtAmount)).toEqual(['1万', '1.2万', '10.5万', '123万']);
  });

  it('addresses a month and a day on the calendar', () => {
    expect(calendarHref('2026-03')).toBe('/archive/calendar?month=2026-03');
    expect(calendarHref('2026-03', '2026-03-08')).toBe('/archive/calendar?month=2026-03&day=2026-03-08');
  });
});

describe('rhythm', () => {
  it('counts distinct days a week over the span, at least a week', () => {
    const days = ['2026-11-01', '2026-11-02', '2026-11-02', '2026-11-09'];
    expect(rhythm(days, '2026-11-01', '2026-11-14', '2026-11-14')).toEqual({ longest: 2, current: 0, perWeek: 1.5 });
    expect(rhythm(['2026-11-13', '2026-11-14'], '2026-11-13', '2026-11-14', '2026-11-14')).toEqual({ longest: 2, current: 2, perWeek: 2 });
  });

  it('counts entries by month, the empty months too', () => {
    const entries = [
      entry('a', { occurredAt: '2026-01-05' }),
      entry('b', { occurredAt: '2026-01-20T08:00:00' }),
      entry('c', { occurredAt: '2026-03-01' }),
      entry('out', { occurredAt: '2026-05-01' })
    ];
    expect(perMonth(entries, ['2026-01', '2026-02', '2026-03'])).toEqual([
      { month: '2026-01', count: 2 },
      { month: '2026-02', count: 0 },
      { month: '2026-03', count: 1 }
    ]);
  });
});
