import { describe, expect, it } from 'vite-plus/test';
import { ApiError } from '../lib/api';
import { themeDetail } from '../test-utils';
import { dayIndex, dayOf, errorMessage, fmtDayHeading, fmtRange, unwrapTheme } from './util';

describe('dayOf', () => {
  it('takes the date from a date or date-time string', () => {
    expect(dayOf('2026-10-03')).toBe('2026-10-03');
    expect(dayOf('2026-10-03T14:05:09')).toBe('2026-10-03');
    expect(dayOf('2026-10-03T14:05:09+08:00')).toBe('2026-10-03');
  });

  it('is empty for anything that does not start with a date', () => {
    for (const bad of [null, undefined, '', '2026', '2026-10', '26-10-03', 'Oct 3', ' 2026-10-03', 'x2026-10-03']) {
      expect(dayOf(bad), String(bad)).toBe('');
    }
  });
});

describe('dayIndex', () => {
  it('counts whole days, so adjacent days differ by one across month, year and leap-day ends', () => {
    expect(dayIndex('1970-01-01')).toBe(0);
    expect(dayIndex('1970-01-02')).toBe(1);
    expect(dayIndex('2026-11-08') - dayIndex('2026-11-07')).toBe(1);
    expect(dayIndex('2026-03-01') - dayIndex('2026-02-28')).toBe(1);
    expect(dayIndex('2024-03-01') - dayIndex('2024-02-28')).toBe(2);
    expect(dayIndex('2027-01-01') - dayIndex('2026-12-31')).toBe(1);
    expect(dayIndex('2026-10-06') - dayIndex('2026-10-03')).toBe(3);
  });

  it('is a whole number, in any time zone', () => {
    for (const day of ['2026-03-08', '2026-03-29', '2026-10-25', '2026-11-01', '2026-12-31']) {
      expect(Number.isInteger(dayIndex(day)), day).toBe(true);
    }
  });
});

describe('fmtDayHeading', () => {
  it('names month, day and weekday', () => {
    expect(fmtDayHeading('2026-10-03')).toBe('10月3日 周六');
    expect(fmtDayHeading('2026-11-08')).toBe('11月8日 周日');
    expect(fmtDayHeading('2024-02-29')).toBe('2月29日 周四');
    expect(fmtDayHeading('2026-01-01')).toBe('1月1日 周四');
  });

  it('covers a full week', () => {
    const names = ['01', '02', '03', '04', '05', '06', '07'].map((d) => fmtDayHeading(`2026-11-${d}`).split(' ')[1]);
    expect(names).toEqual(['周日', '周一', '周二', '周三', '周四', '周五', '周六']);
  });
});

describe('fmtRange', () => {
  it('writes the end of a range within one year without repeating the year', () => {
    expect(fmtRange('2026-10-03', '2026-10-06')).toBe('2026.10.03 – 10.06');
  });

  it('writes both years when the range crosses a year', () => {
    expect(fmtRange('2026-10-03', '2027-01-02')).toBe('2026.10.03 – 2027.01.02');
  });

  it('writes a single day once', () => {
    expect(fmtRange('2026-10-03', '2026-10-03')).toBe('2026.10.03');
    expect(fmtRange('2026-10-03', null)).toBe('2026.10.03');
    expect(fmtRange(null, '2026-10-03')).toBe('2026.10.03');
    expect(fmtRange('2026-10-03', '')).toBe('2026.10.03');
  });

  it('is empty without dates, and accepts date-time strings', () => {
    expect(fmtRange(null, null)).toBe('');
    expect(fmtRange(undefined, undefined)).toBe('');
    expect(fmtRange('', '')).toBe('');
    expect(fmtRange('2026-10-03T08:00:00', '2026-10-06T20:00:00')).toBe('2026.10.03 – 10.06');
  });
});

describe('unwrapTheme', () => {
  const theme = themeDetail({ id: 'th_9', title: '专题' });

  it('accepts the bare theme the GET endpoint returns', () => {
    expect(unwrapTheme(theme)).toBe(theme);
  });

  it('accepts the { theme } wrapper the write endpoints return', () => {
    expect(unwrapTheme({ theme })).toBe(theme);
  });

  it('gives undefined for anything else', () => {
    for (const bad of [null, undefined, 'x', 5, {}, { theme: null }, { theme: {} }, { theme: { items: 'no' } }, []]) {
      expect(unwrapTheme(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });
});

describe('errorMessage', () => {
  it('shows the server’s own message for an API error', () => {
    expect(errorMessage(new ApiError(400, 'invalid_input', '标题不能为空'))).toBe('标题不能为空');
  });

  it('falls back to a network message for anything else', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe('网络不可用，请稍后再试');
    expect(errorMessage('boom')).toBe('网络不可用，请稍后再试');
    expect(errorMessage(undefined)).toBe('网络不可用，请稍后再试');
  });
});
