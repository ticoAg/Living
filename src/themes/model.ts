import { hasTime } from '../../shared/entries';
import type { PhotoSummary, Poi, ThemeDetail, ThemeEntry } from '../../shared/types';
import { fmtDay, fmtTime } from '../lib/format';
import { dayIndex, dayOf, fmtDayHeading } from './util';

export type NotedPhoto = PhotoSummary & { note: string | null };

/** What the reader renders, in item order. Photos and entries the viewer cannot open are already gone. */
export type Block =
  | { type: 'day'; key: string; n: number; label: string; text: string | null }
  | { type: 'photo'; key: string; photo: NotedPhoto; poi: Poi | null; when: string; text: string }
  | { type: 'text'; key: string; text: string }
  /** `text`: the theme's own words before the entry; `level`: its heading's, under a day section or not */
  | { type: 'entry'; key: string; entry: ThemeEntry; when: string; text: string; level: 2 | 3 };

export interface ReaderModel {
  blocks: Block[];
  /** visible photos, an entry's included, each time one shows */
  photoCount: number;
  entryCount: number;
  /** places the visible photos belong to, in order of first appearance */
  places: Poi[];
  /** [lat, lng] of every visible photo with a position, in item order */
  route: [number, number][];
  /** place id → id of the first item with a photo there (scroll target) */
  firstAt: Map<string, string>;
}

/** Inside a day section only the time; elsewhere the date and the time, when known. */
function whenOf(at: string | null, today: string, withTime: boolean): string {
  const day = dayOf(at);
  const time = withTime && at ? fmtTime(at) : '';
  if (day && day === today) return time;
  return [day ? fmtDay(day) : '', time].filter(Boolean).join(' ');
}

export function buildReaderModel(theme: ThemeDetail): ReaderModel {
  const poiById = new Map(theme.pois.map((p) => [p.id, p]));
  const dayItems = theme.items.flatMap((it) => (it.kind === 'day' ? [dayOf(it.day)] : [])).filter(Boolean);
  // "第 N 天" counts from the start date, or from the first day section when that comes earlier
  const base = [dayOf(theme.startDate), ...dayItems].filter(Boolean).sort()[0] ?? '';

  const blocks: Block[] = [];
  const places: Poi[] = [];
  const route: [number, number][] = [];
  const firstAt = new Map<string, string>();
  let photoCount = 0;
  let entryCount = 0;
  let today = '';

  const visit = (photo: PhotoSummary, itemId: string): Poi | null => {
    photoCount++;
    const poi = photo.poiId ? (poiById.get(photo.poiId) ?? null) : null;
    if (poi && !firstAt.has(poi.id)) {
      firstAt.set(poi.id, itemId);
      places.push(poi);
    }
    if (photo.lat != null && photo.lng != null) route.push([photo.lat, photo.lng]);
    return poi;
  };

  for (const item of theme.items) {
    if (item.kind === 'day') {
      const day = dayOf(item.day);
      if (!day) continue;
      today = day;
      blocks.push({
        type: 'day',
        key: item.id,
        n: base ? dayIndex(day) - dayIndex(base) + 1 : 1,
        label: fmtDayHeading(day),
        text: item.text
      });
    } else if (item.kind === 'text') {
      if (item.text.trim()) blocks.push({ type: 'text', key: item.id, text: item.text });
    } else if (item.kind === 'entry') {
      const entry = item.entry;
      if (!entry) continue;
      entryCount++;
      for (const p of entry.photos) visit(p, item.id);
      blocks.push({
        type: 'entry',
        key: item.id,
        entry,
        when: whenOf(entry.occurredAt, today, hasTime(entry.occurredAt)),
        text: item.text?.trim() ? item.text : '',
        level: today ? 3 : 2
      });
    } else if (item.photo) {
      const photo = item.photo;
      const poi = visit(photo, item.id);
      // the theme's own words win over the photo's note
      const written = item.text?.trim() ? item.text : (photo.note ?? '');
      const text = written.trim() ? written : '';
      blocks.push({ type: 'photo', key: item.id, photo, poi, when: whenOf(photo.takenAt, today, true), text });
    }
  }
  return { blocks, photoCount, entryCount, places, route, firstAt };
}

/** The photos Living plays for a theme: every visible photo in item order, an entry's included, each once. */
export function themePhotos(theme: ThemeDetail): PhotoSummary[] {
  const seen = new Set<string>();
  const out: PhotoSummary[] = [];
  const add = (p: PhotoSummary) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    out.push(p);
  };
  for (const it of theme.items) {
    if (it.kind === 'photo' && it.photo) add(it.photo);
    else if (it.kind === 'entry' && it.entry) it.entry.photos.forEach(add);
  }
  return out;
}
