// What a picked or recorded file is as an attachment, and how one reads in a list. A picture is not attached: it goes
// with the photos, where its position is handled. Docs: /docs/product/features/attachments.md

import { ATTACHMENT_LIMITS } from '../../shared/limits';
import { ATTACHMENT_KINDS, type Attachment, type AttachmentKind } from '../../shared/types';
import type { IconName } from '../components/icons';
import { fmtBytes } from '../lib/format';

/** Types by extension, for a file the browser names no type for, or only `application/octet-stream`. */
const BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  avi: 'video/x-msvideo',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  weba: 'audio/webm',
  flac: 'audio/flac',
  amr: 'audio/amr',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  pdf: 'application/pdf'
};
const IMAGE_EXT = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'heif',
  'avif',
  'bmp',
  'tif',
  'tiff',
  'dng',
  'cr2',
  'cr3',
  'nef',
  'arw',
  'raf',
  'orf',
  'rw2'
]);

/** The extension of a name, in lower case; '' for none. */
export const extension = (name: string): string => /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1].toLowerCase() ?? '';

/** A file's type: the browser's, without parameters, unless it names none or a vague one; then by its extension. */
export function typeOf(file: { type: string; name: string }): string {
  const t = file.type.split(';')[0].trim().toLowerCase();
  if (t && t !== 'application/octet-stream') return t;
  return BY_EXT[extension(file.name)] ?? t;
}

/** A file as an attachment: a video, a recording or any other file; or a picture, which is a photo's to be. */
export function kindOf(file: { type: string; name: string }): AttachmentKind | 'image' {
  const t = typeOf(file);
  if (t.startsWith('image/') || IMAGE_EXT.has(extension(file.name))) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  return 'file';
}

/** Why a file cannot be attached, or null. */
export function attachProblem(file: { size: number; type: string; name: string }): string | null {
  if (kindOf(file) === 'image') return '图片请在「照片」里添加';
  if (file.size === 0) return '文件是空的';
  if (file.size > ATTACHMENT_LIMITS.maxBytes) return `一个附件最多 ${ATTACHMENT_LIMITS.maxBytes / 1024 ** 3} GB`;
  return null;
}

/** A name the Worker takes: at most `nameMax` characters, cut before its extension. */
export function fitName(name: string): string {
  const cps = [...name.trim()];
  if (!cps.length) return '附件';
  if (cps.length <= ATTACHMENT_LIMITS.nameMax) return cps.join('');
  const ext = extension(name);
  const tail = ext ? [...name.trim()].slice(-(ext.length + 1)) : [];
  return cps.slice(0, ATTACHMENT_LIMITS.nameMax - tail.length).join('') + tail.join('');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A length in seconds as a clock shows it: 0:07, 3:05, 1:02:03. */
export function fmtDuration(seconds: number): string {
  const t = Math.max(0, Math.round(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(t % 60)}` : `${m}:${pad(t % 60)}`;
}

/** Its length, for a video or recording the browser could time, and its size. */
export const attachmentFacts = (a: Pick<Attachment, 'size' | 'duration'>): string =>
  [a.duration !== null ? fmtDuration(a.duration) : '', fmtBytes(a.size)].filter(Boolean).join(' · ');

export const KIND_LABEL: Record<AttachmentKind, string> = { video: '视频', audio: '音频', file: '文件' };
const MEASURE: Record<AttachmentKind, string> = { video: '个', audio: '段', file: '个' };

/** How many of each kind, for a screen reader: 2 个视频，1 段音频. */
export function attachmentsLabel(list: readonly Pick<Attachment, 'kind'>[]): string {
  return ATTACHMENT_KINDS.map((k) => [k, list.filter((a) => a.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${MEASURE[k]}${KIND_LABEL[k]}`)
    .join('，');
}
export const KIND_ICON = { video: 'video', audio: 'wave', file: 'file' } as const satisfies Record<AttachmentKind, IconName>;

/** Where its file is played or opened; with `download`, saved under its own name. */
export const fileUrl = (id: string, download = false): string => `/media/a/${encodeURIComponent(id)}${download ? '?download' : ''}`;
export const posterUrl = (id: string): string => `/media/a/${encodeURIComponent(id)}/poster`;
