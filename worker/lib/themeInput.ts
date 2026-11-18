// Validation of the JSON bodies of POST /api/themes, PATCH /api/themes/:id and PUT /api/themes/:id/items, and the
// statement that writes a collection's items. Also what an import checks a collection of an export against
// (routes/import.ts). Docs: /docs/api/themes.md

import { THEME_ITEM_LIMITS, THEME_LIMITS } from '../../shared/limits';
import type { ThemeItemKind, ThemeKind, Visibility } from '../../shared/types';
import { invalid } from './http';
import { newId } from './ids';
import { VISIBILITIES } from './photoInput';
import { prep } from './sql';
import { has, isDate, isPlainObject, optDate, optEnum, optText, reqStr, strArray, type Body } from './validate';

export const THEME_KINDS = ['trip', 'topic'] as const;

export interface ThemeFields {
  kind?: ThemeKind;
  title?: string;
  subtitle?: string | null;
  intro?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  visibility?: Visibility;
  coverPhotoId?: string | null;
  photoIds?: string[];
}

/** A collection's days run forwards: it may not start after it ends. */
export function assertRange(start: string | null | undefined, end: string | null | undefined): void {
  if (start && end && start > end) throw invalid('开始日期不能晚于结束日期');
}

export function parseThemeFields(body: Body, create: boolean): ThemeFields {
  const f: ThemeFields = {};
  const kind = optEnum<ThemeKind>(body.kind, '合集类型', THEME_KINDS);
  if (create && !kind) throw invalid('请选择合集类型：trip（旅程）或 topic（专题）');
  if (kind) f.kind = kind;
  if (create || has(body, 'title')) f.title = reqStr(body, 'title', '标题', 1, THEME_LIMITS.titleMax);
  if (has(body, 'subtitle')) f.subtitle = optText(body.subtitle, '副标题', THEME_LIMITS.subtitleMax);
  if (has(body, 'intro')) f.intro = optText(body.intro, '导语', THEME_LIMITS.introMax);
  if (has(body, 'startDate')) f.startDate = optDate(body.startDate, '开始日期');
  if (has(body, 'endDate')) f.endDate = optDate(body.endDate, '结束日期');
  assertRange(f.startDate, f.endDate);
  const visibility = optEnum<Visibility>(body.visibility, '公开范围', VISIBILITIES);
  if (visibility) f.visibility = visibility;
  if (has(body, 'coverPhotoId')) {
    if (body.coverPhotoId !== null && typeof body.coverPhotoId !== 'string') throw invalid('封面需要是照片 id 或 null');
    f.coverPhotoId = body.coverPhotoId as string | null;
  }
  if (create && has(body, 'photoIds')) {
    if (!Array.isArray(body.photoIds)) throw invalid('photoIds 需要是数组');
    f.photoIds = strArray(body.photoIds, '照片', THEME_LIMITS.itemCount);
  }
  return f;
}

export interface NewItem {
  kind: ThemeItemKind;
  photoId?: string | null;
  entryId?: string | null;
  text?: string | null;
  day?: string | null;
}

/** The items of `PUT /api/themes/:id/items`, in order, and the photos and entries they hold (to be checked by the caller). */
export function parseItems(raw: unknown): { items: NewItem[]; photoIds: string[]; entryIds: string[] } {
  if (!Array.isArray(raw)) throw invalid('items 需要是数组');
  if (raw.length > THEME_LIMITS.itemCount) throw invalid(`一个合集最多 ${THEME_LIMITS.itemCount} 个条目`);
  const items: NewItem[] = [];
  const photoIds: string[] = [];
  const entryIds: string[] = [];
  raw.forEach((it: unknown, i: number) => {
    const at = `第 ${i + 1} 个条目`;
    if (!isPlainObject(it)) throw invalid(`${at}格式不对`);
    if (it.kind === 'photo') {
      if (typeof it.photoId !== 'string' || !it.photoId) throw invalid(`${at}缺少 photoId`);
      photoIds.push(it.photoId);
      items.push({ kind: 'photo', photoId: it.photoId, text: optText(it.text, `${at}的说明`, THEME_ITEM_LIMITS.captionMax) });
    } else if (it.kind === 'text') {
      const text = optText(it.text, `${at}的文字`, THEME_ITEM_LIMITS.textMax);
      if (!text) throw invalid(`${at}的文字不能为空`);
      items.push({ kind: 'text', text });
    } else if (it.kind === 'day') {
      if (typeof it.day !== 'string' || !isDate(it.day)) throw invalid(`${at}的日期格式应为 YYYY-MM-DD`);
      items.push({ kind: 'day', day: it.day, text: optText(it.text, `${at}的说明`, THEME_ITEM_LIMITS.captionMax) });
    } else if (it.kind === 'entry') {
      if (typeof it.entryId !== 'string' || !it.entryId) throw invalid(`${at}缺少 entryId`);
      entryIds.push(it.entryId);
      items.push({ kind: 'entry', entryId: it.entryId, text: optText(it.text, `${at}的说明`, THEME_ITEM_LIMITS.captionMax) });
    } else {
      throw invalid(`${at}的类型需要是 photo、text、day 或 entry`);
    }
  });
  return { items, photoIds, entryIds };
}

/** One statement inserting all items; positions follow array order from 0. */
export function insertItems(db: D1Database, themeId: string, items: NewItem[]): D1PreparedStatement {
  const rows = items.map((it, i) => ({
    id: newId.item(),
    pos: i,
    kind: it.kind,
    photoId: it.photoId ?? null,
    entryId: it.entryId ?? null,
    text: it.text ?? null,
    day: it.day ?? null
  }));
  return prep(
    db,
    `INSERT INTO theme_items (id, theme_id, position, kind, photo_id, entry_id, text, day)
     SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.pos'), json_extract(value, '$.kind'),
            json_extract(value, '$.photoId'), json_extract(value, '$.entryId'), json_extract(value, '$.text'), json_extract(value, '$.day')
     FROM json_each(?2)`,
    themeId,
    JSON.stringify(rows)
  );
}
