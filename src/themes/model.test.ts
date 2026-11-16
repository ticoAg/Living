import { describe, expect, it } from 'vite-plus/test';
import type { ThemeItem } from '../../shared/types';
import { entry, photo, poi, themeDetail } from '../test-utils';
import { buildReaderModel, themePhotos, type Block } from './model';

type PhotoItem = Extract<ThemeItem, { kind: 'photo' }>;
type NotedPhoto = NonNullable<PhotoItem['photo']>;

const noted = (id: string, over: Partial<NotedPhoto> = {}): NotedPhoto => ({ ...photo(id), note: null, ...over });
const photoItem = (id: string, p: NotedPhoto | null, text: string | null = null): ThemeItem => ({
  id: `it_${id}`,
  kind: 'photo',
  photoId: id,
  text,
  photo: p
});
const dayItem = (id: string, day: string, text: string | null = null): ThemeItem => ({ id: `it_${id}`, kind: 'day', day, text });
const textItem = (id: string, text: string): ThemeItem => ({ id: `it_${id}`, kind: 'text', text });
const entryItem = (
  id: string,
  over: Parameters<typeof entry>[1] | null,
  photos: ReturnType<typeof photo>[] = [],
  text: string | null = null
): ThemeItem => ({ id: `it_${id}`, kind: 'entry', entryId: id, text, entry: over ? { ...entry(id, over), photos } : null });
const entryBlocks = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { type: 'entry' }> => b.type === 'entry');

const photoBlocks = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { type: 'photo' }> => b.type === 'photo');
const dayBlocks = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { type: 'day' }> => b.type === 'day');

describe('buildReaderModel', () => {
  it('turns an empty theme into an empty model', () => {
    expect(buildReaderModel(themeDetail())).toEqual({
      blocks: [],
      photoCount: 0,
      entryCount: 0,
      places: [],
      route: [],
      firstAt: new Map()
    });
  });

  it('keeps the order of the items and gives each block the key of its item', () => {
    const model = buildReaderModel(
      themeDetail({
        items: [
          textItem('1', '开场'),
          dayItem('2', '2026-10-03'),
          photoItem('a', noted('a', { takenAt: '2026-10-03T09:00:00' })),
          textItem('3', '结尾')
        ]
      })
    );
    expect(model.blocks.map((b) => [b.type, b.key])).toEqual([
      ['text', 'it_1'],
      ['day', 'it_2'],
      ['photo', 'it_a'],
      ['text', 'it_3']
    ]);
  });

  describe('photos the viewer cannot see', () => {
    it('are left out of the blocks and the count', () => {
      const model = buildReaderModel(
        themeDetail({ items: [photoItem('a', noted('a')), photoItem('gone', null), photoItem('b', noted('b'))] })
      );
      expect(photoBlocks(model.blocks).map((b) => b.photo.id)).toEqual(['a', 'b']);
      expect(model.photoCount).toBe(2);
    });
  });

  describe('text', () => {
    it('keeps text blocks with content and drops blank ones', () => {
      const model = buildReaderModel(themeDetail({ items: [textItem('1', '  '), textItem('2', ''), textItem('3', '真正的段落')] }));
      expect(model.blocks).toEqual([{ type: 'text', key: 'it_3', text: '真正的段落' }]);
    });

    it('prefers the theme’s words for a photo over the photo’s own note', () => {
      const model = buildReaderModel(
        themeDetail({
          items: [
            photoItem('a', noted('a', { note: '照片自己的笔记' }), '合集里写的话'),
            photoItem('b', noted('b', { note: '照片自己的笔记' }), null),
            photoItem('c', noted('c', { note: '照片自己的笔记' }), '   '),
            photoItem('d', noted('d', { note: '  ' }), null),
            photoItem('e', noted('e'), null)
          ]
        })
      );
      expect(photoBlocks(model.blocks).map((b) => b.text)).toEqual(['合集里写的话', '照片自己的笔记', '照片自己的笔记', '', '']);
    });
  });

  describe('days', () => {
    it('numbers the day sections from the first day of the trip', () => {
      const model = buildReaderModel(
        themeDetail({
          startDate: '2026-10-03',
          items: [dayItem('1', '2026-10-03'), dayItem('2', '2026-10-04'), dayItem('3', '2026-10-06')]
        })
      );
      expect(dayBlocks(model.blocks).map((b) => [b.n, b.label])).toEqual([
        [1, '10月3日 周六'],
        [2, '10月4日 周日'],
        [4, '10月6日 周二']
      ]);
    });

    it('counts from the earliest day section when the start date is missing or later', () => {
      const noStart = buildReaderModel(themeDetail({ items: [dayItem('1', '2026-10-04'), dayItem('2', '2026-10-05')] }));
      expect(dayBlocks(noStart.blocks).map((b) => b.n)).toEqual([1, 2]);
      const lateStart = buildReaderModel(
        themeDetail({ startDate: '2026-10-10', items: [dayItem('1', '2026-10-04'), dayItem('2', '2026-10-05')] })
      );
      expect(dayBlocks(lateStart.blocks).map((b) => b.n)).toEqual([1, 2]);
    });

    it('counts from the start date when it comes first, even before any section', () => {
      const model = buildReaderModel(themeDetail({ startDate: '2026-10-01', items: [dayItem('1', '2026-10-04')] }));
      expect(dayBlocks(model.blocks)[0].n).toBe(4);
    });

    it('carries a section’s text, and skips sections without a valid date', () => {
      const model = buildReaderModel(
        themeDetail({ items: [dayItem('1', '', '没有日期'), dayItem('2', 'sometime'), dayItem('3', '2026-10-03', '第一天去了西湖')] })
      );
      expect(dayBlocks(model.blocks)).toEqual([{ type: 'day', key: 'it_3', n: 1, label: '10月3日 周六', text: '第一天去了西湖' }]);
    });

    it('accepts a date-time in a section', () => {
      const model = buildReaderModel(themeDetail({ items: [dayItem('1', '2026-10-03T00:00:00')] }));
      expect(dayBlocks(model.blocks)[0].label).toBe('10月3日 周六');
    });
  });

  describe('when a photo was taken', () => {
    it('is shown as the time only inside the section for its own day', () => {
      const model = buildReaderModel(
        themeDetail({ items: [dayItem('d', '2026-10-03'), photoItem('a', noted('a', { takenAt: '2026-10-03T09:30:00' }))] })
      );
      expect(photoBlocks(model.blocks)[0].when).toBe('09:30');
    });

    it('is shown as date and time outside a section, or inside another day’s', () => {
      const model = buildReaderModel(
        themeDetail({
          items: [
            photoItem('before', noted('before', { takenAt: '2026-10-03T09:30:00' })),
            dayItem('d', '2026-10-04'),
            photoItem('other', noted('other', { takenAt: '2026-10-03T18:45:00' }))
          ]
        })
      );
      expect(photoBlocks(model.blocks).map((b) => b.when)).toEqual(['2026.10.03 09:30', '2026.10.03 18:45']);
    });

    it('is empty for a photo without a capture time, and has no date to show without a day', () => {
      const model = buildReaderModel(themeDetail({ items: [photoItem('a', noted('a', { takenAt: null }))] }));
      expect(photoBlocks(model.blocks)[0].when).toBe('');
    });
  });

  describe('places and route', () => {
    const lake = poi('poi_lake', { name: '西湖' });
    const pagoda = poi('poi_pagoda', { name: '雷峰塔' });

    it('lists each place once, in order of first appearance, and remembers where the story first gets there', () => {
      const model = buildReaderModel(
        themeDetail({
          pois: [lake, pagoda],
          items: [
            photoItem('a', noted('a', { poiId: 'poi_pagoda' })),
            photoItem('b', noted('b', { poiId: 'poi_lake' })),
            photoItem('c', noted('c', { poiId: 'poi_pagoda' }))
          ]
        })
      );
      expect(model.places.map((p) => p.name)).toEqual(['雷峰塔', '西湖']);
      expect([...model.firstAt]).toEqual([
        ['poi_pagoda', 'it_a'],
        ['poi_lake', 'it_b']
      ]);
    });

    it('gives a photo its place, and none for an unknown or hidden one', () => {
      const model = buildReaderModel(
        themeDetail({
          pois: [lake],
          items: [
            photoItem('a', noted('a', { poiId: 'poi_lake' })),
            photoItem('b', noted('b', { poiId: 'poi_unknown' })),
            photoItem('c', noted('c'))
          ]
        })
      );
      expect(photoBlocks(model.blocks).map((b) => b.poi?.name ?? null)).toEqual(['西湖', null, null]);
      expect(model.places).toHaveLength(1);
    });

    it('draws the route through the visible photos that have a position, in order', () => {
      const model = buildReaderModel(
        themeDetail({
          items: [
            photoItem('a', noted('a', { lat: 30.25, lng: 120.14 })),
            photoItem('hidden', noted('hidden', { lat: null, lng: null })),
            photoItem('gone', null),
            photoItem('b', noted('b', { lat: 30.26, lng: 120.15 }))
          ]
        })
      );
      expect(model.route).toEqual([
        [30.25, 120.14],
        [30.26, 120.15]
      ]);
    });

    it('ignores places that only belong to photos the viewer cannot see', () => {
      const model = buildReaderModel(
        themeDetail({ pois: [lake, pagoda], items: [photoItem('a', noted('a', { poiId: 'poi_lake' })), photoItem('gone', null)] })
      );
      expect(model.places.map((p) => p.id)).toEqual(['poi_lake']);
    });
  });

  describe('entries', () => {
    const lake = poi('poi_lake', { name: '西湖' });

    it('shows an entry the viewer may open, with the collection’s own words, and leaves out one they may not', () => {
      const model = buildReaderModel(
        themeDetail({ items: [entryItem('e1', { title: '断桥' }, [], '  那天的雪  '), entryItem('gone', null, [], '看不到的')] })
      );
      expect(model.blocks.map((b) => [b.type, b.key])).toEqual([['entry', 'it_e1']]);
      expect(entryBlocks(model.blocks)[0]).toMatchObject({ text: '  那天的雪  ', level: 2 });
      expect(model.entryCount).toBe(1);
      expect(entryBlocks(buildReaderModel(themeDetail({ items: [entryItem('e1', {}, [], '   ')] })).blocks)[0].text).toBe('');
    });

    it('counts its photos, adds their places and positions, and scrolls to the entry for a place first seen there', () => {
      const model = buildReaderModel(
        themeDetail({
          pois: [lake],
          items: [
            entryItem('e1', {}, [photo('a', { poiId: 'poi_lake', lat: 30.25, lng: 120.14 }), photo('b', { lat: null, lng: null })]),
            photoItem('c', noted('c', { poiId: 'poi_lake', lat: 30.26, lng: 120.15 }))
          ]
        })
      );
      expect(model.photoCount).toBe(3);
      expect(model.places.map((p) => p.id)).toEqual(['poi_lake']);
      expect(model.firstAt.get('poi_lake')).toBe('it_e1');
      expect(model.route).toEqual([
        [30.25, 120.14],
        [30.26, 120.15]
      ]);
    });

    it('under a day section, gives the time only on that day and a lower heading', () => {
      const model = buildReaderModel(
        themeDetail({
          items: [
            entryItem('before', { occurredAt: '2026-10-03' }),
            dayItem('d', '2026-10-03'),
            entryItem('same', { occurredAt: '2026-10-03T14:20:00' }),
            entryItem('dayonly', { occurredAt: '2026-10-03' }),
            entryItem('other', { occurredAt: '2026-10-05T08:05:00' })
          ]
        })
      );
      expect(entryBlocks(model.blocks).map((b) => [b.key, b.when, b.level])).toEqual([
        ['it_before', '2026.10.03', 2],
        ['it_same', '14:20', 3],
        ['it_dayonly', '', 3],
        ['it_other', '2026.10.05 08:05', 3]
      ]);
    });
  });
});

describe('themePhotos', () => {
  it('plays photo items and entries’ photos in order, each photo once, skipping what the viewer cannot see', () => {
    const theme = themeDetail({
      items: [
        photoItem('a', noted('a')),
        entryItem('e1', {}, [photo('b'), photo('a')]),
        photoItem('gone', null),
        entryItem('e2', null),
        photoItem('c', noted('c'))
      ]
    });
    expect(themePhotos(theme).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});
