// The library page's lists: which of one's photos or attachments a tab and filter show, what a row says of where one
// is or when it goes, and what a selection starts a new entry with. Docs: /docs/product/features/library.md

import { ATTACHMENT_LIMITS, ENTRY_LIMITS } from '../../shared/limits';
import {
  ATTACHMENT_KINDS,
  VISIBILITIES,
  type Attachment,
  type AttachmentKind,
  type LibraryAttachment,
  type PhotoSummary,
  type Visibility
} from '../../shared/types';
import { byTakenDesc } from '../browse/sort';

/** The tabs: one's photos, then each kind of attachment. */
export const LIBRARY_KINDS = ['photos', ...ATTACHMENT_KINDS] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];
export const LIBRARY_KIND_LABEL: Record<LibraryKind, string> = { photos: '照片', video: '视频', audio: '音频', file: '文件' };

/** `?kind=`: photos unless it names another tab. */
export const kindParam = (v: string | null): LibraryKind =>
  (LIBRARY_KINDS as readonly (string | null)[]).includes(v) ? (v as LibraryKind) : 'photos';

/** `?show=`: in no entry, or (photos) by who may see them; anything else is all of them. */
export type Show = 'all' | 'loose' | Visibility;
export function showParam(v: string | null, kind: LibraryKind): Show {
  if (v === 'loose') return v;
  if (kind === 'photos' && (VISIBILITIES as readonly (string | null)[]).includes(v)) return v as Visibility;
  return 'all';
}

/** Newest capture first, undated last in the server's order (newest upload first). */
export function photosShown(photos: readonly PhotoSummary[], show: Show, inEntries: ReadonlySet<string>): PhotoSummary[] {
  const kept = show === 'all' ? photos : photos.filter((p) => (show === 'loose' ? !inEntries.has(p.id) : p.visibility === show));
  return kept.slice().sort(byTakenDesc);
}

/** One kind's attachments, as the server lists them (newest first); `loose`: those in no entry, still uploading too. */
export function attachmentsShown(list: readonly LibraryAttachment[], kind: AttachmentKind, show: Show): LibraryAttachment[] {
  return list.filter((a) => a.kind === kind && (show !== 'loose' || a.state !== 'attached'));
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** When one in no entry goes, from now: in so many hours within the day, else so many days. */
export function purgeText(purgeAt: string, now = Date.now()): string {
  const left = Date.parse(purgeAt) - now;
  if (left <= 0) return '即将删去';
  if (left < DAY - HOUR / 2) return `${Math.max(1, Math.round(left / HOUR))} 小时后删去`;
  return `${Math.max(1, Math.round(left / DAY))} 天后删去`;
}

/** Only an attachment uploaded whole and in no entry can go into a new one; any photo can. */
export const selectable = (a: LibraryAttachment): boolean => a.state === 'loose';

/** The editor's start for what is selected: photos in capture order, then attachments as listed; the day of the first photo. */
export interface EntryStart {
  photos: PhotoSummary[];
  attachments: Attachment[];
  /** YYYY-MM-DD: the earliest capture among the photos; null when none is dated */
  date: string | null;
  /** why it cannot start one, or null */
  problem: string | null;
}

/** Capture order, undated last. */
const byTaken = (a: PhotoSummary, b: PhotoSummary): number => {
  const x = a.takenAt ?? '\uffff';
  const y = b.takenAt ?? '\uffff';
  return x < y ? -1 : x > y ? 1 : 0;
};

export function entryStart(
  selected: ReadonlySet<string>,
  photos: readonly PhotoSummary[],
  attachments: readonly LibraryAttachment[]
): EntryStart {
  const picked = photos.filter((p) => selected.has(p.id)).sort(byTaken);
  const files = attachments.filter((a) => selected.has(a.id) && selectable(a)).map(asAttachment);
  const first = picked.find((p) => p.takenAt !== null)?.takenAt ?? null;
  const problem =
    picked.length > ENTRY_LIMITS.mediaCount
      ? `一条记录最多 ${ENTRY_LIMITS.mediaCount} 张照片`
      : files.length > ATTACHMENT_LIMITS.perEntry
        ? `一条记录最多 ${ATTACHMENT_LIMITS.perEntry} 个附件`
        : null;
  return { photos: picked, attachments: files, date: first ? first.slice(0, 10) : null, problem };
}

/** The attachment itself, without what the library says of it. */
export const asAttachment = ({ id, kind, name, mime, size, duration, width, height, poster, createdAt }: Attachment): Attachment => ({
  id,
  kind,
  name,
  mime,
  size,
  duration,
  width,
  height,
  poster,
  createdAt
});
