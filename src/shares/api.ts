import type { CreateShareBody, ShareKind, ShareLink } from '../../shared/types';
import { api } from '../lib/api';
import { fmtDay, fmtTime, localDateTime } from '../lib/format';
import { invalidate, useApi } from '../lib/useApi';

// Share links (分享链接) as their author handles them: one item's links, all of one's links, making and deleting
// them. Opening one is the /s/:token page's. Docs: /docs/product/features/sharing.md, /docs/api/shares.md

export const MY_SHARES = '/api/shares';
export const sharesOf = (kind: ShareKind, id: string) => `/api/shares?kind=${kind}&id=${encodeURIComponent(id)}`;

export function useShares(path: string | null) {
  const r = useApi<{ shares: ShareLink[] }>(path);
  return { shares: r.data?.shares, error: r.error, reload: r.reload };
}

export async function createShare(body: CreateShareBody): Promise<ShareLink> {
  const { share } = await api<{ share: ShareLink }>('/api/shares', { json: body });
  invalidate('/api/shares');
  return share;
}

export async function deleteShare(id: string): Promise<void> {
  await api(`/api/shares/${encodeURIComponent(id)}`, { method: 'DELETE' });
  invalidate('/api/shares');
}

/** The address to hand out. */
export const shareUrl = (token: string, origin = location.origin) => `${origin}/s/${token}`;

/** Where the shared item is read. */
export function targetPath(kind: ShareKind, id: string): string {
  const e = encodeURIComponent(id);
  return kind === 'entry' ? `/e/${e}` : kind === 'theme' ? `/t/${e}` : `/projects/${e}`;
}

/** The GET requests that page makes which a link changes the answer of: read before the link, they are stale. */
export function targetReads(kind: ShareKind, id: string): string[] {
  const e = encodeURIComponent(id);
  if (kind === 'entry') return [`/api/entries/${e}`];
  if (kind === 'theme') return [`/api/themes/${e}`];
  return [`/api/projects/${e}`, `/api/entries?project=${e}`];
}

export const KIND_LABEL: Record<ShareKind, string> = { entry: '记录', theme: '合集', project: '项目' };

/** Choices for a new link's lifetime, in days; null for none. */
export const EXPIRY_CHOICES: { days: number | null; label: string }[] = [
  { days: 1, label: '1 天' },
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
  { days: null, label: '不过期' }
];

/** Until when the link opens, or that it no longer does. */
export function expiryText(expiresAt: string | null, now = Date.now()): { text: string; expired: boolean } {
  if (!expiresAt) return { text: '不过期', expired: false };
  const at = Date.parse(expiresAt);
  if (!(at > now)) return { text: '已过期', expired: true };
  const local = localDateTime(new Date(at));
  return { text: `${fmtDay(local)} ${fmtTime(local)} 前有效`, expired: false };
}

/** Copies `text`; false when the browser would not. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
