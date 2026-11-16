// The entry editor's state and what it sends. The draft holds the fields as the form shows them; the payload is the
// request body they make. Two drafts with the same payload are the same entry, so a changed payload is what needs
// saving. Docs: /docs/product/features/entries.md

import { hasTime } from '../../shared/entries';
import { ENTRY_LIMITS } from '../../shared/limits';
import {
  ENTRY_TYPES,
  VISIBILITIES,
  type CreateEntryBody,
  type EntryDetail,
  type EntryType,
  type PhotoSummary,
  type Visibility
} from '../../shared/types';
import { DEVICE_DRAFT_PREFIX } from '../lib/deviceDrafts';
import { localDateTime } from '../lib/format';

export interface DraftMedia {
  photoId: string;
  caption: string;
  /** for the thumbnail */
  photo: PhotoSummary | null;
}

export interface EntryDraft {
  type: EntryType;
  title: string;
  body: string;
  /** YYYY-MM-DD; '' while not chosen */
  date: string;
  /** HH:mm, or '' for the whole day */
  time: string;
  /** HH:mm:ss the entry had, so saving the same minute keeps its seconds; '' for none */
  heldTime: string;
  visibility: Visibility;
  media: DraftMedia[];
  tagIds: string[];
}

/** What a request sets; `status` is the editor's actions' to set. */
export type EntryPayload = Required<Omit<CreateEntryBody, 'status'>>;

/** A new entry: a note of this moment, for the author alone. */
export function emptyDraft(now = new Date(), body = ''): EntryDraft {
  const at = localDateTime(now);
  return {
    type: 'note',
    title: '',
    body,
    date: at.slice(0, 10),
    time: at.slice(11, 16),
    heldTime: at.slice(11),
    visibility: 'private',
    media: [],
    tagIds: []
  };
}

export function draftFromEntry(e: EntryDetail): EntryDraft {
  const time = hasTime(e.occurredAt) ? e.occurredAt.slice(11, 19) : '';
  return {
    type: e.type,
    title: e.title ?? '',
    body: e.body ?? '',
    date: e.occurredAt.slice(0, 10),
    time: time.slice(0, 5),
    heldTime: time,
    visibility: e.visibility,
    media: e.media.map((m) => ({ photoId: m.photoId, caption: m.caption ?? '', photo: m.photo })),
    tagIds: [...e.tagIds]
  };
}

export function occurredAtOf(d: EntryDraft): string {
  if (!d.time) return d.date;
  return d.heldTime.startsWith(`${d.time}:`) ? `${d.date}T${d.heldTime}` : `${d.date}T${d.time}:00`;
}

export function payloadOf(d: EntryDraft): EntryPayload {
  return {
    type: d.type,
    title: d.title.trim() || null,
    // as typed: the server trims it, and the comparison with what was sent stays exact
    body: d.body.trim() ? d.body : null,
    occurredAt: occurredAtOf(d),
    visibility: d.visibility,
    media: d.media.map((m) => ({ photoId: m.photoId, caption: m.caption.trim() || null })),
    tagIds: d.tagIds
  };
}

/** The fields of `next` that differ from `prev`; all of them without a `prev`. */
export function changedFields(next: EntryPayload, prev: EntryPayload | null): Partial<EntryPayload> {
  if (!prev) return next;
  const out: Partial<EntryPayload> = {};
  for (const k of Object.keys(next) as (keyof EntryPayload)[]) {
    if (JSON.stringify(next[k]) !== JSON.stringify(prev[k])) Object.assign(out, { [k]: next[k] });
  }
  return out;
}

/** Nothing written and no photo: the server takes no such entry. */
export const isEmptyDraft = (d: EntryDraft): boolean => !d.title.trim() && !d.body.trim() && d.media.length === 0;

const cps = (s: string) => [...s].length;

/** Why the draft cannot be saved as it is, or null. */
export function draftProblem(d: EntryDraft): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return '请填写日期';
  if (d.time && !/^\d{2}:\d{2}$/.test(d.time)) return '时间格式应为 时:分';
  if (cps(d.title.trim()) > ENTRY_LIMITS.titleMax) return `标题最多 ${ENTRY_LIMITS.titleMax} 个字符`;
  if (cps(d.body.trimEnd()) > ENTRY_LIMITS.bodyMax) return `正文最多 ${ENTRY_LIMITS.bodyMax} 个字符`;
  if (d.media.length > ENTRY_LIMITS.mediaCount) return `一条记录最多 ${ENTRY_LIMITS.mediaCount} 张照片`;
  const long = d.media.findIndex((m) => cps(m.caption.trim()) > ENTRY_LIMITS.captionMax);
  if (long >= 0) return `第 ${long + 1} 张照片的说明最多 ${ENTRY_LIMITS.captionMax} 个字符`;
  return null;
}

// ---- photos -------------------------------------------------------------------------------------------------------

/** Photos added at the end, in the order picked; one already there stays where it is. */
export function addMedia(media: readonly DraftMedia[], photos: readonly PhotoSummary[]): DraftMedia[] {
  const have = new Set(media.map((m) => m.photoId));
  const out = [...media];
  for (const p of photos) {
    if (have.has(p.id)) continue;
    have.add(p.id);
    out.push({ photoId: p.id, caption: '', photo: p });
  }
  return out;
}

/** The photo at `from` moved by `by` places, kept within the list. */
export function moveMedia(media: readonly DraftMedia[], from: number, by: number): DraftMedia[] {
  const to = Math.min(media.length - 1, Math.max(0, from + by));
  if (to === from || !media[from]) return [...media];
  const out = [...media];
  const [m] = out.splice(from, 1);
  out.splice(to, 0, m);
  return out;
}

// ---- this device's copy -------------------------------------------------------------------------------------------

/** A draft kept on this device until the server has it. */
export interface Backup {
  draft: EntryDraft;
  /** when it was written, ISO */
  at: string;
}

const str = (v: unknown): v is string => typeof v === 'string';

/** A stored backup read back, or null when it is missing or not one (another version, edited by hand). */
export function parseBackup(raw: string | null): Backup | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const { draft: d, at } = v as { draft?: Record<string, unknown>; at?: unknown };
  if (!d || typeof d !== 'object' || !str(at)) return null;
  if (![d.title, d.body, d.date, d.time, d.heldTime].every(str)) return null;
  if (!(ENTRY_TYPES as readonly unknown[]).includes(d.type) || !(VISIBILITIES as readonly unknown[]).includes(d.visibility)) return null;
  if (!Array.isArray(d.media) || !Array.isArray(d.tagIds) || !d.tagIds.every(str)) return null;
  const media: DraftMedia[] = [];
  for (const m of d.media as unknown[]) {
    if (!m || typeof m !== 'object') return null;
    const { photoId, caption, photo } = m as Record<string, unknown>;
    if (!str(photoId) || !str(caption)) return null;
    media.push({ photoId, caption, photo: photo && typeof photo === 'object' ? (photo as PhotoSummary) : null });
  }
  return { draft: { ...(d as unknown as EntryDraft), media, tagIds: [...(d.tagIds as string[])] }, at };
}

/** The storage slot of a backup: the author's, for an entry or (`new`) for one not yet created. */
export const backupKey = (userId: string, id: string | null) => `${DEVICE_DRAFT_PREFIX}${userId}.${id ?? 'new'}`;

// Storage can be missing or refuse (a private window, a full quota); a backup is a convenience, never a requirement.
export function readBackup(userId: string, id: string | null): Backup | null {
  try {
    return parseBackup(localStorage.getItem(backupKey(userId, id)));
  } catch {
    return null;
  }
}

export function writeBackup(userId: string, id: string | null, draft: EntryDraft): void {
  try {
    localStorage.setItem(backupKey(userId, id), JSON.stringify({ draft, at: new Date().toISOString() } satisfies Backup));
  } catch {
    // nothing to do: the server copy is the real one
  }
}

export function clearBackup(userId: string, id: string | null): void {
  try {
    localStorage.removeItem(backupKey(userId, id));
  } catch {
    // as above
  }
}
