import type { PhotoDetail, PhotoSummary, Poi } from '../../shared/types';
import { compass, fmtLat, fmtLng } from '../../shared/geo';
import { fmtAgo, fmtDay, fmtTime } from '../lib/format';
import type { FieldKey } from './settings';

// What the caption says about one photo, given the fields the viewer switched on.
// Notes are never shown in Living. Coordinates and heading appear only when the API supplied them
// (location privacy has already blanked them for other people's fuzzy and hidden photos).

export interface CaptionData {
  /** the large spaced line: place name, else city, else title */
  big: string;
  /** POI category for the symbol next to `big`; only set when `big` is a real place */
  icon: string | null;
  /** title under the place name */
  sub: string;
  /** mono line: city, date, time, age */
  meta: string[];
  /** mono line: coordinates, heading */
  geo: string[];
  exif: string;
  tags: string;
}

export interface CaptionContext {
  fields: ReadonlySet<FieldKey>;
  poi: Poi | null;
  tagName: (id: string) => string | null;
  /** loaded lazily; only needed for the camera line */
  detail: PhotoDetail | null;
  today: Date;
}

const trim1 = (v: number) => String(Math.round(v * 10) / 10);

export function exifLine(d: PhotoDetail | null): string {
  if (!d) return '';
  const shutter = d.shutter ? `${d.shutter.trim().replace(/\s*s$/i, '')} s` : '';
  return [
    d.camera,
    d.focal == null ? d.lens : null,
    d.focal != null ? `${trim1(d.focal)} mm` : null,
    d.aperture != null ? `f/${trim1(d.aperture)}` : null,
    shutter,
    d.iso != null ? `ISO ${d.iso}` : null
  ]
    .filter(Boolean)
    .join(' · ');
}

export function buildCaption(p: PhotoSummary, ctx: CaptionContext): CaptionData {
  const f = ctx.fields;
  const place = f.has('place') ? (ctx.poi?.name ?? p.city ?? '') : '';
  const title = f.has('title') ? (p.title ?? '') : '';
  const cityIsBig = !!place && !ctx.poi && place === p.city;

  return {
    big: place || title,
    icon: place && ctx.poi ? ctx.poi.category : null,
    sub: place && title ? title : '',
    meta: [
      f.has('city') && p.city && !cityIsBig ? p.city : '',
      f.has('date') ? fmtDay(p.takenAt) : '',
      f.has('time') ? fmtTime(p.takenAt) : '',
      f.has('ago') ? fmtAgo(p.takenAt, ctx.today) : ''
    ].filter(Boolean),
    geo: [
      f.has('coord') && p.lat != null && p.lng != null ? `${fmtLat(p.lat)}  ${fmtLng(p.lng)}` : '',
      f.has('heading') && p.heading != null ? `${Math.round(p.heading) % 360}° ${compass(p.heading)}` : ''
    ].filter(Boolean),
    exif: f.has('exif') ? exifLine(ctx.detail) : '',
    tags: f.has('tags')
      ? p.tagIds
          .map(ctx.tagName)
          .filter((n): n is string => !!n)
          .join(' · ')
      : ''
  };
}

export const hasCaption = (c: CaptionData | null): c is CaptionData =>
  !!c && !!(c.big || c.sub || c.meta.length || c.geo.length || c.exif || c.tags);

/** One sentence for the screen-reader live region, independent of which fields are shown. */
export function announceText(p: PhotoSummary, poi: Poi | null): string {
  return [p.title, poi?.name ?? p.city, fmtDay(p.takenAt)].filter(Boolean).join('，');
}
