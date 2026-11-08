// Display formatting. Capture times are local wall-clock strings `YYYY-MM-DDTHH:mm:ss`.
export { compass, fmtDistance, fmtLat, fmtLng } from '../../shared/geo';

export const fmtDay = (t: string | null | undefined) => (t ? t.slice(0, 10).replace(/-/g, '.') : '');
export const fmtTime = (t: string | null | undefined) => (t && t.length >= 16 ? t.slice(11, 16) : '');
export const fmtMonth = (t: string | null | undefined) => (t ? t.slice(0, 7).replace('-', '.') : '');

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
/** 11月8日 星期日 */
export function fmtLongDay(t: string): string {
  const d = new Date(`${t.slice(0, 10)}T00:00:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日 星期${WEEK[d.getDay()]}`;
}

/** Relative age of a capture date against today: 1 年前的今天 / 6 天前 / 3 个月前 / 2 年前 */
export function fmtAgo(t: string | null | undefined, today = new Date()): string {
  if (!t) return '';
  const day = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000;
  const days = now - day(t);
  const sameMd = t.slice(5, 10) === `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (days > 0 && sameMd) return `${Math.round(days / 365)} 年前的今天`;
  if (days < 1) return '今天';
  if (days < 31) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

/** 晨 / 昼 / 暮 / 夜 from the capture hour. */
export function dayPart(t: string | null | undefined): '晨' | '昼' | '暮' | '夜' | '' {
  if (!t || t.length < 13) return '';
  const h = +t.slice(11, 13);
  if (h >= 5 && h < 9) return '晨';
  if (h >= 9 && h < 16) return '昼';
  if (h >= 16 && h < 19) return '暮';
  return '夜';
}
