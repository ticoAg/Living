import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { ApiError } from '../lib/api';
import { useSession } from '../lib/session';

/** User-facing text for a failed request. */
export function errMsg(e: unknown, fallback = '出错了，请稍后再试'): string {
  if (e instanceof ApiError) return e.status === 401 ? '登录已过期，请重新登录' : e.message || fallback;
  if (e instanceof DOMException && e.name === 'AbortError') return '已取消';
  if (e instanceof TypeError) return '网络不通，请检查网络后重试';
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/** Keep showing the last loaded value while a shared GET is being refetched after `invalidate()`. */
export function useKeep<T>(value: T | undefined): T | undefined {
  const ref = useRef<T | undefined>(value);
  if (value !== undefined) ref.current = value;
  return value !== undefined ? value : ref.current;
}

/** Set the tab title while the page is mounted. */
export function useTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · Living`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}

/** Only same-site paths are accepted as a post-login destination. */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (/^\/(login|register)(\/|\?|$)/.test(raw)) return null;
  return raw;
}

/** Studio pages need an account: wait for the session, then send guests to /login?next=<here>. */
export function useRequireLogin() {
  const { user, loading } = useSession();
  const [path, navigate] = useLocation();
  const search = useSearch();
  useEffect(() => {
    if (!loading && !user) {
      const here = search ? `${path}?${search}` : path;
      navigate(`/login?next=${encodeURIComponent(here)}`, { replace: true });
    }
  }, [loading, user, path, search, navigate]);
  return { user, loading, ready: !loading && !!user };
}

/** Copy to the clipboard; falls back to a hidden textarea where the async API is unavailable (http, old browsers). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

let counter = 0;
/** Local id for queue items. */
export const uid = () => `q${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Object URL for a blob that is revoked when the blob changes or the component unmounts. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/** `2026.11.08 14:22` from a local capture time. */
export function fmtStamp(t: string | null | undefined): string {
  if (!t) return '';
  return `${t.slice(0, 10).replace(/-/g, '.')} ${t.slice(11, 16)}`;
}
