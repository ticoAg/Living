// Validation of the JSON bodies of POST /api/entries and PATCH /api/entries/:id (CreateEntryBody, UpdateEntryBody).
// Docs: /docs/api/entries.md

import { ENTRY_LIMITS } from '../../shared/limits';
import { ENTRY_STATUSES, ENTRY_TYPES, VISIBILITIES, type EntryStatus, type EntryType, type Visibility } from '../../shared/types';
import { ID_RE, invalid } from './http';
import { cpLen, has, isPlainObject, optEnum, optNum, optOccurredAt, optText, strArray, type Body } from './validate';

export interface MediaField {
  photoId: string;
  caption: string | null;
}

/** What a request sets; a key that is absent stays as it is. */
export interface EntryFields {
  type?: EntryType;
  title?: string | null;
  body?: string | null;
  occurredAt?: string;
  visibility?: Visibility;
  status?: EntryStatus;
  media?: MediaField[];
  tagIds?: string[];
  /** PATCH only: the revision the edit started from */
  revision?: number;
}

/**
 * The body as written, Markdown. Blank lines before it and whitespace after it go; the first line keeps its own
 * indentation (a paragraph may open with full-width spaces). Blank → null.
 */
export function optBody(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw invalid('正文需要是文字');
  const s = v
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:[ \t　]*\n)+/, '')
    .replace(/\s+$/, '');
  if (!s.trim()) return null;
  if (cpLen(s) > ENTRY_LIMITS.bodyMax) throw invalid(`正文最多 ${ENTRY_LIMITS.bodyMax} 个字符`);
  return s;
}

/** The photos of an entry, in order. A photo listed twice counts once, where it first appears. */
export function parseMedia(v: unknown): MediaField[] {
  if (!Array.isArray(v)) throw invalid('照片需要是数组');
  if (v.length > ENTRY_LIMITS.mediaCount) throw invalid(`一条记录最多 ${ENTRY_LIMITS.mediaCount} 张照片`);
  const out: MediaField[] = [];
  const seen = new Set<string>();
  v.forEach((raw: unknown, i) => {
    const at = `第 ${i + 1} 张照片`;
    if (!isPlainObject(raw) || typeof raw.photoId !== 'string' || !ID_RE.test(raw.photoId)) throw invalid(`${at}格式不对`);
    if (seen.has(raw.photoId)) return;
    seen.add(raw.photoId);
    out.push({ photoId: raw.photoId, caption: optText(raw.caption, `${at}的说明`, ENTRY_LIMITS.captionMax) });
  });
  return out;
}

export function parseEntryFields(body: Body, create: boolean): EntryFields {
  const f: EntryFields = {};
  const type = optEnum<EntryType>(body.type, '记录类型', ENTRY_TYPES);
  if (type) f.type = type;
  if (has(body, 'title')) f.title = optText(body.title, '标题', ENTRY_LIMITS.titleMax);
  if (has(body, 'body')) f.body = optBody(body.body);
  if (create || has(body, 'occurredAt')) {
    const at = optOccurredAt(body.occurredAt);
    if (!at) throw invalid('请填写发生时间，格式为 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ss');
    f.occurredAt = at;
  }
  const visibility = optEnum<Visibility>(body.visibility, '公开范围', VISIBILITIES);
  if (visibility) f.visibility = visibility;
  const status = optEnum<EntryStatus>(body.status, '状态', ENTRY_STATUSES);
  if (status) f.status = status;
  if (has(body, 'media')) f.media = parseMedia(body.media);
  if (has(body, 'tagIds')) {
    if (!Array.isArray(body.tagIds)) throw invalid('标签需要是数组');
    f.tagIds = strArray(body.tagIds, '标签', ENTRY_LIMITS.tagCount);
  }
  if (!create && has(body, 'revision')) {
    const rev = optNum(body.revision, 'revision', { int: true, min: 1 });
    if (rev !== null) f.revision = rev;
  }
  return f;
}

/** An entry says something: a title, some text, or a photo. */
export function assertNotEmpty(title: string | null | undefined, body: string | null | undefined, mediaCount: number): void {
  if (!title && !body && mediaCount === 0) throw invalid('记录不能是空的：写点文字，或者加一张照片');
}
