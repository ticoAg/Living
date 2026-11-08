import { invalid } from './http';

export type Body = Record<string, unknown>;

/** The key is present with a defined value (so `null` counts: it means "clear"). */
export const has = (o: Body, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

/** Length in Unicode code points, so Chinese and emoji count as one. */
export const cpLen = (s: string): number => [...s].length;

export function isPlainObject(v: unknown): v is Body {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Required string, trimmed, with a code-point length range. */
export function reqStr(o: Body, key: string, label: string, min: number, max: number): string {
  const v = o[key];
  if (typeof v !== 'string') throw invalid(`请填写${label}`);
  const s = v.trim();
  const n = cpLen(s);
  if (n < min || n > max) throw invalid(min <= 1 ? `${label}不能为空，且最多 ${max} 个字符` : `${label}需要 ${min} 到 ${max} 个字符`);
  return s;
}

/** Optional text: null/undefined/blank → null, otherwise trimmed and length-checked. */
export function optText(v: unknown, label: string, max: number): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw invalid(`${label}需要是文字`);
  const s = v.trim();
  if (s === '') return null;
  if (cpLen(s) > max) throw invalid(`${label}最多 ${max} 个字符`);
  return s;
}

export interface NumOpts {
  min?: number;
  max?: number;
  int?: boolean;
}

/** Optional number: null/undefined → null; anything that is not a finite number in range is a 400. */
export function optNum(v: unknown, label: string, opts: NumOpts = {}): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw invalid(`${label}需要是数字`);
  if (opts.int && !Number.isInteger(v)) throw invalid(`${label}需要是整数`);
  if (opts.min !== undefined && v < opts.min) throw invalid(`${label}不能小于 ${opts.min}`);
  if (opts.max !== undefined && v > opts.max) throw invalid(`${label}不能大于 ${opts.max}`);
  return v;
}

export function reqNum(v: unknown, label: string, opts: NumOpts = {}): number {
  const n = optNum(v, label, opts);
  if (n === null) throw invalid(`请填写${label}`);
  return n;
}

export function optEnum<T extends string>(v: unknown, label: string, values: readonly T[]): T | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) throw invalid(`${label}需要是 ${values.join(' / ')} 之一`);
  return v as T;
}

export function optBool(v: unknown, label: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw invalid(`${label}需要是 true 或 false`);
  return v;
}

export function strArray(v: unknown, label: string, maxItems: number, maxLen = 64): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw invalid(`${label}需要是数组`);
  if (v.length > maxItems) throw invalid(`${label}最多 ${maxItems} 项`);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x !== 'string' || x.length === 0 || x.length > maxLen) throw invalid(`${label}里有无效的值`);
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/** `YYYY-MM-DD` that is a real calendar date. */
export function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function optDate(v: unknown, label: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !isDate(v)) throw invalid(`${label}格式应为 YYYY-MM-DD`);
  return v;
}

/** Local capture time `YYYY-MM-DDTHH:mm:ss`; tolerates a missing seconds part or a fractional/zone suffix. */
export function optTakenAt(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(v.trim());
    if (m && isDate(m[1]) && +m[2] < 24 && +m[3] < 60 && +(m[4] ?? 0) < 60) return `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? '00'}`;
  }
  throw invalid('拍摄时间格式应为 YYYY-MM-DDTHH:mm:ss');
}

export function optTz(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string' && /^(Z|[+-]\d{2}(?::?\d{2})?)$/.test(v.trim())) return v.trim();
  throw invalid('时区格式应为 +08:00');
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export function optColor(v: unknown, label = '颜色'): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string' && (v === 'mono' || HEX_COLOR.test(v))) return v;
  throw invalid(`${label}需要是 #RRGGBB 或 mono`);
}

export function optPalette(v: unknown): string[] | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) throw invalid('主色需要是颜色数组');
  const out = v.filter((x): x is string => typeof x === 'string' && HEX_COLOR.test(x)).slice(0, 8);
  return out.length ? out : null;
}

export function optFocus(v: unknown): [number, number] | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v) || v.length !== 2 || v.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)) {
    throw invalid('焦点需要是 [x, y]，取值 0 到 1');
  }
  return [v[0] as number, v[1] as number];
}

/** Heading in degrees, normalised to [0, 360). */
export function optHeading(v: unknown): number | null {
  const n = optNum(v, '朝向', { min: -360, max: 720 });
  return n === null ? null : ((n % 360) + 360) % 360;
}
