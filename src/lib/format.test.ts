import { describe, expect, it } from 'vite-plus/test';
import * as geo from '../../shared/geo';
import { compass, dayPart, fmtAgo, fmtDay, fmtDistance, fmtLat, fmtLng, fmtLongDay, fmtMonth, fmtTime } from './format';

// Capture times are local wall-clock strings (`YYYY-MM-DDTHH:mm:ss`, no offset). Nothing here may depend on the
// machine's time zone, so every Date below is built from local calendar fields (`new Date(y, m, d)`), never from an
// instant such as `new Date('2026-11-08T12:00:00Z')`, and the suite is also run under several TZ settings.

describe('fmtDay / fmtTime / fmtMonth', () => {
  it('slice the wall-clock string without any time zone conversion', () => {
    expect(fmtDay('2026-11-08T14:05:09')).toBe('2026.11.08');
    expect(fmtTime('2026-11-08T14:05:09')).toBe('14:05');
    expect(fmtMonth('2026-11-08T14:05:09')).toBe('2026.11');
    // the hour is left alone, even right after midnight or just before it
    expect(fmtTime('2026-11-08T00:00:00')).toBe('00:00');
    expect(fmtTime('2026-11-08T23:59:59')).toBe('23:59');
    expect(fmtDay('2026-01-01T00:00:00')).toBe('2026.01.01');
  });

  it('accept a bare date', () => {
    expect(fmtDay('2026-11-08')).toBe('2026.11.08');
    expect(fmtMonth('2026-11-08')).toBe('2026.11');
  });

  it('return an empty string for missing or too-short values', () => {
    for (const empty of [null, undefined, '']) {
      expect(fmtDay(empty)).toBe('');
      expect(fmtTime(empty)).toBe('');
      expect(fmtMonth(empty)).toBe('');
    }
    expect(fmtTime('2026-11-08')).toBe('');
    expect(fmtTime('2026-11-08T14')).toBe('');
    expect(fmtTime('2026-11-08T14:05')).toBe('14:05');
  });
});

describe('fmtLongDay', () => {
  it('names the month, day and weekday of the calendar date', () => {
    expect(fmtLongDay('2026-11-08T14:05:09')).toBe('11月8日 星期日');
    expect(fmtLongDay('2026-01-01')).toBe('1月1日 星期四');
    expect(fmtLongDay('2024-02-29')).toBe('2月29日 星期四');
    expect(fmtLongDay('2000-01-01')).toBe('1月1日 星期六');
    expect(fmtLongDay('1999-12-31')).toBe('12月31日 星期五');
  });

  it('ignores the time of day, so late evenings stay on their own date', () => {
    expect(fmtLongDay('2026-11-08T00:00:00')).toBe('11月8日 星期日');
    expect(fmtLongDay('2026-11-08T23:59:59')).toBe('11月8日 星期日');
  });

  it('covers every weekday', () => {
    // 1 November 2026 is a Sunday
    const names = [1, 2, 3, 4, 5, 6, 7].map((d) => fmtLongDay(`2026-11-0${d}`).split(' ')[1]);
    expect(names).toEqual(['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']);
  });

  it('is not thrown off by a spring-forward day', () => {
    // clocks jump over midnight in some zones (for example Havana); the date must still be the 8th
    expect(fmtLongDay('2026-03-08')).toBe('3月8日 星期日');
  });
});

describe('fmtAgo', () => {
  // Sunday 8 November 2026, mid-afternoon, local time
  const today = new Date(2026, 10, 8, 15, 30, 0);

  it('is empty without a capture time', () => {
    expect(fmtAgo(null, today)).toBe('');
    expect(fmtAgo(undefined, today)).toBe('');
    expect(fmtAgo('', today)).toBe('');
  });

  it('says 今天 for today and for dates in the future', () => {
    expect(fmtAgo('2026-11-08T09:00:00', today)).toBe('今天');
    expect(fmtAgo('2026-11-08T23:59:59', today)).toBe('今天');
    expect(fmtAgo('2026-11-09T09:00:00', today)).toBe('今天');
  });

  it('counts whole days up to a month', () => {
    expect(fmtAgo('2026-11-07T23:00:00', today)).toBe('1 天前');
    expect(fmtAgo('2026-11-02', today)).toBe('6 天前');
    expect(fmtAgo('2026-10-09', today)).toBe('30 天前');
  });

  it('switches to months from 31 days', () => {
    expect(fmtAgo('2026-10-08', today)).toBe('1 个月前');
    expect(fmtAgo('2026-08-10', today)).toBe('3 个月前');
    expect(fmtAgo('2026-02-08', today)).toBe('9 个月前');
    expect(fmtAgo('2025-11-09', today)).toBe('12 个月前');
  });

  it('counts years once a year has passed', () => {
    expect(fmtAgo('2025-11-07', today)).toBe('1 年前');
    expect(fmtAgo('2023-06-15', today)).toBe('3 年前');
  });

  it('marks the same calendar day in an earlier year as 的今天', () => {
    expect(fmtAgo('2025-11-08', today)).toBe('1 年前的今天');
    expect(fmtAgo('2024-11-08T08:00:00', today)).toBe('2 年前的今天');
    // leap days in between do not turn 6 years into 5 or 7
    expect(fmtAgo('2020-11-08', today)).toBe('6 年前的今天');
  });

  it('works from the local calendar day, not the time of day', () => {
    const justAfterMidnight = new Date(2026, 10, 8, 0, 0, 1);
    const justBeforeMidnight = new Date(2026, 10, 8, 23, 59, 59);
    for (const now of [justAfterMidnight, justBeforeMidnight]) {
      expect(fmtAgo('2026-11-08T12:00:00', now)).toBe('今天');
      expect(fmtAgo('2026-11-07T12:00:00', now)).toBe('1 天前');
      expect(fmtAgo('2025-11-08T12:00:00', now)).toBe('1 年前的今天');
    }
  });

  it('defaults to the current date', () => {
    expect(fmtAgo('2000-01-01T00:00:00')).toMatch(/^\d+ 年前$/);
  });
});

describe('dayPart', () => {
  const at = (time: string) => dayPart(`2026-11-08T${time}:00`);

  it('splits the day into 晨 昼 暮 夜 at 05, 09, 16 and 19 o’clock', () => {
    expect(at('04:59')).toBe('夜');
    expect(at('05:00')).toBe('晨');
    expect(at('08:59')).toBe('晨');
    expect(at('09:00')).toBe('昼');
    expect(at('15:59')).toBe('昼');
    expect(at('16:00')).toBe('暮');
    expect(at('18:59')).toBe('暮');
    expect(at('19:00')).toBe('夜');
    expect(at('23:59')).toBe('夜');
    expect(at('00:00')).toBe('夜');
  });

  it('is empty when there is no hour to read', () => {
    expect(dayPart(null)).toBe('');
    expect(dayPart(undefined)).toBe('');
    expect(dayPart('')).toBe('');
    expect(dayPart('2026-11-08')).toBe('');
    expect(dayPart('2026-11-08T0')).toBe('');
    expect(dayPart('2026-11-08T14')).toBe('昼');
  });
});

describe('re-exports', () => {
  it('are the shared geo helpers', () => {
    expect(compass).toBe(geo.compass);
    expect(fmtDistance).toBe(geo.fmtDistance);
    expect(fmtLat).toBe(geo.fmtLat);
    expect(fmtLng).toBe(geo.fmtLng);
  });
});
