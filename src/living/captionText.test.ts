import { describe, expect, it } from 'vite-plus/test';
import { photo, photoDetail, poi } from '../test-utils';
import { announceText, buildCaption, exifLine, hasCaption, type CaptionContext } from './captionText';
import type { FieldKey } from './settings';

// 8 November 2026, local time
const TODAY = new Date(2026, 10, 8, 12, 0, 0);

const context = (fields: FieldKey[], over: Partial<CaptionContext> = {}): CaptionContext => ({
  fields: new Set(fields),
  poi: null,
  tagName: (id) => ({ lake: '湖', sunset: '夕阳' })[id] ?? null,
  detail: null,
  today: TODAY,
  ...over
});

const NOTHING = { big: '', icon: null, sub: '', meta: [], geo: [], exif: '', tags: '' };

describe('exifLine', () => {
  it('is empty without a detail', () => {
    expect(exifLine(null)).toBe('');
  });

  it('joins camera, focal length, aperture, shutter and ISO', () => {
    const d = photoDetail('ph_1', { camera: 'Sony ILCE-7M4', focal: 35, aperture: 1.8, shutter: '1/250', iso: 100 });
    expect(exifLine(d)).toBe('Sony ILCE-7M4 · 35 mm · f/1.8 · 1/250 s · ISO 100');
  });

  it('shows the lens only when the focal length is unknown', () => {
    expect(exifLine(photoDetail('ph_1', { camera: 'X100V', focal: 23, lens: 'Fixed 23mm' }))).toBe('X100V · 23 mm');
    expect(exifLine(photoDetail('ph_1', { camera: 'X100V', focal: null, lens: 'Fixed 23mm' }))).toBe('X100V · Fixed 23mm');
  });

  it('rounds to a tenth and drops a trailing .0', () => {
    expect(exifLine(photoDetail('ph_1', { focal: 50, aperture: 2.8 }))).toBe('50 mm · f/2.8');
    expect(exifLine(photoDetail('ph_1', { focal: 24.04, aperture: 4 }))).toBe('24 mm · f/4');
    expect(exifLine(photoDetail('ph_1', { focal: 8.76, aperture: 1.2 }))).toBe('8.8 mm · f/1.2');
  });

  it('writes the shutter once with an s, however the camera spelled it', () => {
    for (const shutter of ['1/250', '1/250 s', '1/250s', ' 1/250 S ']) {
      expect(exifLine(photoDetail('ph_1', { shutter })), shutter).toBe('1/250 s');
    }
    expect(exifLine(photoDetail('ph_1', { shutter: '2' }))).toBe('2 s');
  });

  it('leaves out what the photo does not have, and keeps zero values', () => {
    expect(exifLine(photoDetail('ph_1', { iso: 400 }))).toBe('ISO 400');
    expect(exifLine(photoDetail('ph_1'))).toBe('');
    expect(exifLine(photoDetail('ph_1', { iso: 0, aperture: 0 }))).toBe('f/0 · ISO 0');
  });
});

describe('buildCaption', () => {
  const lake = photo('ph_1', {
    title: '清晨的断桥',
    city: '杭州',
    takenAt: '2026-11-08T07:15:30',
    lat: 30.259167,
    lng: 120.1388,
    heading: 123.4,
    tagIds: ['lake', 'sunset']
  });

  it('shows nothing when no field is switched on', () => {
    expect(buildCaption(lake, context([]))).toEqual(NOTHING);
  });

  it('puts the place name large, with its category symbol', () => {
    const c = buildCaption(lake, context(['place'], { poi: poi('poi_1', { name: '断桥', category: '桥' }) }));
    expect(c).toMatchObject({ big: '断桥', icon: '桥', sub: '' });
  });

  it('puts the title under the place', () => {
    const c = buildCaption(lake, context(['place', 'title'], { poi: poi('poi_1') }));
    expect(c).toMatchObject({ big: '断桥', sub: '清晨的断桥' });
  });

  it('uses the title as the large text when the place is not shown or unknown', () => {
    expect(buildCaption(lake, context(['title']))).toMatchObject({ big: '清晨的断桥', icon: null, sub: '' });
    expect(buildCaption(photo('ph_2', { title: '无地点', city: null }), context(['place', 'title']))).toMatchObject({
      big: '无地点',
      icon: null,
      sub: ''
    });
  });

  it('falls back to the city as the place, without a category symbol', () => {
    const c = buildCaption(lake, context(['place']));
    expect(c).toMatchObject({ big: '杭州', icon: null });
  });

  it('does not repeat a city that is already the large text', () => {
    expect(buildCaption(lake, context(['place', 'city', 'date'])).meta).toEqual(['2026.11.08']);
    expect(buildCaption(lake, context(['place', 'city', 'date'], { poi: poi('poi_1') })).meta).toEqual(['杭州', '2026.11.08']);
    expect(buildCaption(lake, context(['city'])).meta).toEqual(['杭州']);
  });

  it('lists city, date, time and age in that order', () => {
    const c = buildCaption(lake, context(['ago', 'time', 'date', 'city']));
    expect(c.meta).toEqual(['杭州', '2026.11.08', '07:15', '今天']);
    expect(buildCaption(photo('p', { takenAt: '2025-11-08T07:15:30' }), context(['ago'])).meta).toEqual(['1 年前的今天']);
  });

  it('leaves out meta entries the photo lacks', () => {
    const bare = photo('ph_3');
    expect(buildCaption(bare, context(['city', 'date', 'time', 'ago']))).toEqual(NOTHING);
  });

  it('writes coordinates and the heading, as degrees with a compass name', () => {
    const c = buildCaption(lake, context(['coord', 'heading']));
    expect(c.geo).toEqual(['30°15′33″N  120°08′20″E', '123° 东偏南']);
  });

  it('wraps a heading that rounds up to 360', () => {
    expect(buildCaption(photo('p', { heading: 359.6 }), context(['heading'])).geo).toEqual(['0° 北']);
    expect(buildCaption(photo('p', { heading: 0 }), context(['heading'])).geo).toEqual(['0° 北']);
  });

  it('has no position or heading when the API withheld them for privacy', () => {
    const hidden = photo('ph_4', { lat: null, lng: null, heading: null });
    expect(buildCaption(hidden, context(['coord', 'heading'])).geo).toEqual([]);
    expect(buildCaption(photo('p', { lat: 30.25, lng: null }), context(['coord'])).geo).toEqual([]);
  });

  it('shows the camera line only when asked for and loaded', () => {
    const detail = photoDetail('ph_1', { camera: 'X100V', iso: 200 });
    expect(buildCaption(lake, context(['exif'], { detail })).exif).toBe('X100V · ISO 200');
    expect(buildCaption(lake, context(['exif'], { detail: null })).exif).toBe('');
    expect(buildCaption(lake, context([], { detail })).exif).toBe('');
  });

  it('joins tag names with a dot, skipping tags it cannot name', () => {
    expect(buildCaption(lake, context(['tags'])).tags).toBe('湖 · 夕阳');
    expect(buildCaption(photo('p', { tagIds: ['lake', 'deleted', 'sunset'] }), context(['tags'])).tags).toBe('湖 · 夕阳');
    expect(buildCaption(photo('p', { tagIds: [] }), context(['tags'])).tags).toBe('');
    expect(buildCaption(lake, context([])).tags).toBe('');
  });

  it('never shows the note, even when the detail carries one', () => {
    const detail = photoDetail('ph_1', { note: '这是一段私人的笔记', camera: 'X100V' });
    const all: FieldKey[] = ['place', 'title', 'city', 'date', 'time', 'ago', 'coord', 'heading', 'exif', 'tags'];
    const caption = buildCaption(photo('ph_1', { hasNote: true, title: '标题' }), context(all, { detail }));
    expect(JSON.stringify(caption)).not.toContain('私人的笔记');
  });
});

describe('hasCaption', () => {
  it('is false for nothing and for an empty caption', () => {
    expect(hasCaption(null)).toBe(false);
    expect(hasCaption(NOTHING)).toBe(false);
  });

  it('is true as soon as any part has content', () => {
    expect(hasCaption({ ...NOTHING, big: '断桥' })).toBe(true);
    expect(hasCaption({ ...NOTHING, sub: '标题' })).toBe(true);
    expect(hasCaption({ ...NOTHING, meta: ['2026.11.08'] })).toBe(true);
    expect(hasCaption({ ...NOTHING, geo: ['0° 北'] })).toBe(true);
    expect(hasCaption({ ...NOTHING, exif: 'X100V' })).toBe(true);
    expect(hasCaption({ ...NOTHING, tags: '湖' })).toBe(true);
  });

  it('does not count a lone category symbol', () => {
    expect(hasCaption({ ...NOTHING, icon: '桥' })).toBe(false);
  });
});

describe('announceText', () => {
  it('reads title, place and date for a screen reader, whichever fields are shown', () => {
    expect(announceText(photo('p', { title: '清晨的断桥', city: '杭州', takenAt: '2026-11-08T07:15:30' }), poi('poi_1'))).toBe(
      '清晨的断桥，断桥，2026.11.08'
    );
  });

  it('uses the city when there is no place, and skips what is missing', () => {
    expect(announceText(photo('p', { title: '清晨的断桥', city: '杭州' }), null)).toBe('清晨的断桥，杭州');
    expect(announceText(photo('p', { takenAt: '2026-11-08T07:15:30' }), null)).toBe('2026.11.08');
    expect(announceText(photo('p'), null)).toBe('');
  });
});
