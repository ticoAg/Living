import type { PhotoSummary, PutThemeItemsBody, ThemeDetail, ThemeKind, UpdateThemeBody, Visibility } from '../../shared/types';
import { dayOf } from './util';

// The editor works on a draft: plain strings for every input, a client-side key per item (server item
// ids are regenerated on every PUT). `metaPayload` / `itemsPayload` turn it back into request bodies and
// double as the snapshots that decide whether anything is unsaved.

/** A photo as the editor knows it; `note` is only known for photos that came with the theme. */
export type EditorPhoto = PhotoSummary & { note?: string | null };

export type DraftItem =
  | { key: string; kind: 'photo'; photoId: string; text: string; photo: EditorPhoto | null }
  | { key: string; kind: 'text'; text: string }
  | { key: string; kind: 'day'; day: string; text: string };

export interface Draft {
  kind: ThemeKind;
  title: string;
  subtitle: string;
  intro: string;
  startDate: string;
  endDate: string;
  visibility: Visibility;
  coverPhotoId: string | null;
  items: DraftItem[];
}

/** What the API accepts in one theme (PUT /api/themes/:id/items). */
export const MAX_ITEMS = 1000;

let seq = 0;
export const nextKey = () => `k${++seq}`;

export const photoItem = (photo: EditorPhoto): DraftItem => ({ key: nextKey(), kind: 'photo', photoId: photo.id, text: '', photo });
export const textItem = (): DraftItem => ({ key: nextKey(), kind: 'text', text: '' });
export const dayItem = (day = ''): DraftItem => ({ key: nextKey(), kind: 'day', day, text: '' });

export const emptyDraft = (kind: ThemeKind = 'trip'): Draft => ({
  kind,
  title: '',
  subtitle: '',
  intro: '',
  startDate: '',
  endDate: '',
  visibility: 'private',
  coverPhotoId: null,
  items: []
});

export function draftFromTheme(t: ThemeDetail): Draft {
  return {
    kind: t.kind,
    title: t.title,
    subtitle: t.subtitle ?? '',
    intro: t.intro ?? '',
    startDate: dayOf(t.startDate),
    endDate: dayOf(t.endDate),
    visibility: t.visibility,
    coverPhotoId: t.coverPhotoId,
    items: t.items.map((it): DraftItem => {
      if (it.kind === 'photo') return { key: nextKey(), kind: 'photo', photoId: it.photoId, text: it.text ?? '', photo: it.photo };
      if (it.kind === 'text') return { key: nextKey(), kind: 'text', text: it.text };
      return { key: nextKey(), kind: 'day', day: dayOf(it.day), text: it.text ?? '' };
    })
  };
}

/** Body of POST / PATCH /api/themes. Topics carry no dates. */
export function metaPayload(d: Draft): Required<Omit<UpdateThemeBody, 'photoIds'>> {
  const trip = d.kind === 'trip';
  return {
    kind: d.kind,
    title: d.title.trim(),
    subtitle: d.subtitle.trim() || null,
    intro: d.intro.trim() ? d.intro.trimEnd() : null,
    startDate: trip && d.startDate ? d.startDate : null,
    endDate: trip && d.endDate ? d.endDate : null,
    visibility: d.visibility,
    coverPhotoId: d.coverPhotoId
  };
}

/** Body of PUT /api/themes/:id/items. Empty text blocks, undated day sections and photos that are gone are left out. */
export function itemsPayload(items: readonly DraftItem[]): PutThemeItemsBody['items'] {
  const out: PutThemeItemsBody['items'] = [];
  for (const it of items) {
    if (it.kind === 'photo') {
      if (it.photo) out.push({ kind: 'photo', photoId: it.photoId, text: it.text.trim() ? it.text.trimEnd() : null });
    } else if (it.kind === 'text') {
      if (it.text.trim()) out.push({ kind: 'text', text: it.text.trimEnd() });
    } else if (it.day) out.push({ kind: 'day', day: it.day, text: it.text.trim() ? it.text.trimEnd() : null });
  }
  return out;
}

/** First problem that blocks saving, as a message and the id of the field to look at. */
export function validate(d: Draft): { text: string; field: string } | null {
  if (!d.title.trim()) return { text: '请填写标题', field: 'th-title' };
  if (d.kind === 'trip' && d.startDate && d.endDate && d.endDate < d.startDate) return { text: '结束日期不能早于开始日期', field: 'th-end' };
  if (itemsPayload(d.items).length > MAX_ITEMS) return { text: `一个主题最多 ${MAX_ITEMS} 个条目，请先移除一些`, field: 'th-add-photo' };
  const undated = d.items.findIndex((it) => it.kind === 'day' && !it.day);
  if (undated >= 0) return { text: `第 ${undated + 1} 项是日期分段，请选择日期`, field: `th-day-${d.items[undated].key}` };
  return null;
}

/** Earliest and latest capture day among the photo items, if any have one. */
export function photoDayRange(items: readonly DraftItem[]): { start: string; end: string } | null {
  const days = items
    .flatMap((it) => (it.kind === 'photo' && it.photo ? [dayOf(it.photo.takenAt)] : []))
    .filter(Boolean)
    .sort();
  return days.length ? { start: days[0], end: days[days.length - 1] } : null;
}

/** Oldest first; photos without a time go last. */
export const byTaken = (a: PhotoSummary, b: PhotoSummary): number => {
  const x = a.takenAt ?? '￿';
  const y = b.takenAt ?? '￿';
  return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : 1;
};

/**
 * Add photos day by day. Each new day gets a day section ahead of its first photo; a day that already
 * has a section receives the new photos at the end of that section. Sections stay in date order.
 */
export function mergeByDay(items: readonly DraftItem[], photos: readonly EditorPhoto[]): DraftItem[] {
  const groups = new Map<string, EditorPhoto[]>();
  for (const p of [...photos].sort(byTaken)) {
    const day = dayOf(p.takenAt);
    if (!day) continue;
    const g = groups.get(day);
    if (g) g.push(p);
    else groups.set(day, [p]);
  }
  const out = items.slice();
  for (const day of [...groups.keys()].sort()) {
    const fresh = groups.get(day)!.map(photoItem);
    const head = out.findIndex((it) => it.kind === 'day' && it.day === day);
    if (head >= 0) {
      let end = out.findIndex((it, i) => i > head && it.kind === 'day');
      if (end < 0) end = out.length;
      out.splice(end, 0, ...fresh);
    } else {
      const later = out.findIndex((it) => it.kind === 'day' && it.day > day);
      out.splice(later < 0 ? out.length : later, 0, dayItem(day), ...fresh);
    }
  }
  return out;
}
