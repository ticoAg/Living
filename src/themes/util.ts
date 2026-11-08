import type { ThemeDetail, ThemeKind, Visibility } from '../../shared/types';
import { ApiError } from '../lib/api';
import { fmtDay } from '../lib/format';

export const KIND_LABEL: Record<ThemeKind, string> = { trip: '旅程', topic: '专题' };
export const VISIBILITY_LABEL: Record<Visibility, string> = { public: '公开', unlisted: '仅链接', private: '仅自己' };
export const VISIBILITY_HINT: Record<Visibility, string> = {
  public: '出现在主题列表，任何人都能阅读。',
  unlisted: '不进入列表，知道链接的人可以阅读。',
  private: '只有你能看到。'
};

/** Message for a failed request: the server's own (Chinese) message, or a network fallback. */
export function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : '网络不可用，请稍后再试';
}

/**
 * GET /api/themes/:id answers with the bare ThemeDetail while the write endpoints answer `{ theme }`.
 * Accept both so a change on the API side cannot blank the page.
 */
export function unwrapTheme(res: unknown): ThemeDetail | undefined {
  if (!res || typeof res !== 'object') return undefined;
  const r = res as { theme?: ThemeDetail; items?: unknown };
  if (Array.isArray(r.items)) return res as ThemeDetail;
  return r.theme && Array.isArray(r.theme.items) ? r.theme : undefined;
}

// ---- dates -------------------------------------------------------------------------------------

const DAY_RE = /^\d{4}-\d{2}-\d{2}/;
/** `YYYY-MM-DD` from a date or date-time string, or '' when it is not one. */
export const dayOf = (s: string | null | undefined): string => (s && DAY_RE.test(s) ? s.slice(0, 10) : '');

/** Whole days since the epoch for a `YYYY-MM-DD` string (timezone free). */
export const dayIndex = (day: string): number => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 86400000;

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
/** 10月3日 周六 */
export function fmtDayHeading(day: string): string {
  const d = new Date(dayIndex(day) * 86400000);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 周${WEEK[d.getUTCDay()]}`;
}

/** 2026.10.03 – 10.06 · 2026.10.03 – 2027.01.02 · 2026.10.03 */
export function fmtRange(start: string | null | undefined, end: string | null | undefined): string {
  const a = dayOf(start);
  const b = dayOf(end);
  if (a && b && a !== b) return `${fmtDay(a)} – ${a.slice(0, 4) === b.slice(0, 4) ? fmtDay(b).slice(5) : fmtDay(b)}`;
  const one = a || b;
  return one ? fmtDay(one) : '';
}
