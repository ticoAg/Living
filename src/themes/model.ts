import type { PhotoSummary, Poi, ThemeDetail } from '../../shared/types';
import { fmtDay, fmtTime } from '../lib/format';
import { dayIndex, dayOf, fmtDayHeading } from './util';

export type NotedPhoto = PhotoSummary & { note: string | null };

/** What the reader renders, in item order. Photos the viewer cannot see are already gone. */
export type Block =
  | { type: 'day'; key: string; n: number; label: string; text: string | null }
  | { type: 'photo'; key: string; photo: NotedPhoto; poi: Poi | null; when: string; text: string }
  | { type: 'text'; key: string; text: string };

export interface ReaderModel {
  blocks: Block[];
  photoCount: number;
  /** places the visible photos belong to, in order of first appearance */
  places: Poi[];
  /** [lat, lng] of every visible photo with a position, in item order */
  route: [number, number][];
  /** place id → id of the first photo item there (scroll target) */
  firstAt: Map<string, string>;
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
  let today = '';

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
    } else if (item.photo) {
      const photo = item.photo;
      photoCount++;
      const poi = photo.poiId ? (poiById.get(photo.poiId) ?? null) : null;
      if (poi && !firstAt.has(poi.id)) {
        firstAt.set(poi.id, item.id);
        places.push(poi);
      }
      if (photo.lat != null && photo.lng != null) route.push([photo.lat, photo.lng]);
      const day = dayOf(photo.takenAt);
      // inside a day section only the time; elsewhere date and time
      const when =
        day && day === today ? fmtTime(photo.takenAt) : [day ? fmtDay(day) : '', fmtTime(photo.takenAt)].filter(Boolean).join(' ');
      // the theme's own words win over the photo's note
      const written = item.text?.trim() ? item.text : (photo.note ?? '');
      const text = written.trim() ? written : '';
      blocks.push({ type: 'photo', key: item.id, photo, poi, when, text });
    }
  }
  return { blocks, photoCount, places, route, firstAt };
}
