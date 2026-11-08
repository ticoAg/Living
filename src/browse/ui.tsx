import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { ApiError } from '../lib/api';

// Small shared pieces for loading, failure and empty states.

export function Loading({ label = '加载中' }: { label?: string }) {
  return (
    <p className="loading" role="status">
      {label}
    </p>
  );
}

/** Failure state. A 404 is reported as "not found" instead of a generic error. */
export function LoadError({
  error,
  notFound,
  onRetry
}: {
  error: unknown;
  /** wording for a 404 */
  notFound?: { title: string; hint?: string; back?: { href: string; label: string } };
  onRetry?: () => void;
}) {
  const missing = error instanceof ApiError && error.status === 404 && notFound;
  return (
    <div className="bw-state" role="alert">
      <p className="bw-state-title">{missing ? notFound.title : '加载失败'}</p>
      <p className="bw-state-hint">{missing ? notFound.hint : error instanceof ApiError ? error.message : '网络不太顺畅，请稍后再试。'}</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        {missing
          ? notFound.back && (
              <Link href={notFound.back.href} className="btn">
                {notFound.back.label}
              </Link>
            )
          : onRetry && (
              <button type="button" className="btn" onClick={onRetry}>
                重试
              </button>
            )}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="bw-state">
      <p className="bw-state-title">{title}</p>
      {children && (
        <div className="row" style={{ justifyContent: 'center' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** "2026.10" / "2025.11 – 2026.10" for a set of capture times. */
export function spanText(times: readonly (string | null)[]): string {
  const ts = times.filter((t): t is string => !!t).sort();
  if (!ts.length) return '—';
  const a = ts[0];
  const b = ts[ts.length - 1];
  const day = (t: string) => t.slice(0, 10).replace(/-/g, '.');
  const month = (t: string) => t.slice(0, 7).replace('-', '.');
  if (a.slice(0, 10) === b.slice(0, 10)) return day(a);
  if (a.slice(0, 7) === b.slice(0, 7)) return month(a);
  return `${month(a)} – ${month(b)}`;
}

/** `+08:00` → `UTC+8`, `+05:30` → `UTC+5:30` */
export function fmtTz(tz: string | null | undefined): string {
  if (!tz) return '';
  const m = /^([+-])(\d{1,2}):?(\d{2})?$/.exec(tz.trim());
  if (!m) return tz;
  const mins = m[3] && m[3] !== '00' ? `:${m[3]}` : '';
  return `UTC${m[1]}${Number(m[2])}${mins}`;
}
