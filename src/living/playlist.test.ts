import { describe, expect, it } from 'vite-plus/test';
import type { PhotoSummary, Tag } from '../../shared/types';
import { buildTagTree } from '../lib/tags';
import { VARIANTS, photo } from '../test-utils';
import { buildPlaylist, isNearToday, shuffle, sortByTime } from './playlist';
import type { Source } from './settings';

const ids = (list: readonly PhotoSummary[]) => list.map((p) => p.id);
const source = (over: Partial<Source> = {}): Source => ({
  src: 'all',
  tags: [],
  match: 'any',
  place: '',
  city: '',
  theme: '',
  user: '',
  order: 'shuffle',
  ...over
});
/** 8 November 2026, local time. */
const TODAY = new Date(2026, 10, 8, 12, 0, 0);

describe('shuffle', () => {
  const photos = Array.from({ length: 30 }, (_, i) => photo(`ph_${String(i).padStart(2, '0')}`));

  it('returns the same photos in a different order, leaving the input alone', () => {
    const input = [...photos];
    const out = shuffle(input, 1);
    expect(input).toEqual(photos);
    expect([...ids(out)].sort()).toEqual(ids(photos));
    expect(ids(out)).not.toEqual(ids(photos));
  });

  it('gives the same order for the same seed, and a different one for another seed', () => {
    expect(ids(shuffle(photos, 42))).toEqual(ids(shuffle(photos, 42)));
    expect(ids(shuffle(photos, 42))).not.toEqual(ids(shuffle(photos, 43)));
  });

  it('keeps the relative order of what remains when the list is filtered', () => {
    const full = ids(shuffle(photos, 7));
    const subset = photos.filter((_, i) => i % 3 === 0);
    const wanted = new Set(ids(subset));
    expect(ids(shuffle(subset, 7))).toEqual(full.filter((id) => wanted.has(id)));
  });

  it('does not depend on the order the photos arrive in', () => {
    expect(ids(shuffle([...photos].reverse(), 5))).toEqual(ids(shuffle(photos, 5)));
  });

  it('handles empty and single lists', () => {
    expect(shuffle([], 1)).toEqual([]);
    const only = photo('ph_only');
    expect(shuffle([only], 1)).toEqual([only]);
  });

  it('puts every photo first about equally often', () => {
    const [a, b] = [photo('ph_a'), photo('ph_b')];
    let aFirst = 0;
    for (let seed = 1; seed <= 2000; seed++) if (shuffle([a, b], seed)[0] === a) aFirst++;
    expect(aFirst / 2000).toBeGreaterThan(0.46);
    expect(aFirst / 2000).toBeLessThan(0.54);
  });

  it('makes a favourite twice as likely as another photo to come first', () => {
    const fav = photo('ph_fav', { favorite: true });
    const plain = photo('ph_plain');
    let favFirst = 0;
    for (let seed = 1; seed <= 3000; seed++) if (shuffle([fav, plain], seed)[0] === fav) favFirst++;
    // 2 / (2 + 1)
    expect(favFirst / 3000).toBeGreaterThan(0.63);
    expect(favFirst / 3000).toBeLessThan(0.7);
  });
});

describe('sortByTime', () => {
  it('puts the oldest first and undated photos last', () => {
    const list = [
      photo('c', { takenAt: '2026-03-01T10:00:00' }),
      photo('x'),
      photo('a', { takenAt: '2024-12-31T23:59:59' }),
      photo('b', { takenAt: '2026-03-01T09:00:00' })
    ];
    expect(ids(sortByTime(list))).toEqual(['a', 'b', 'c', 'x']);
  });

  it('breaks ties by id, for photos taken at the same moment or both undated', () => {
    const same = [photo('b', { takenAt: '2026-01-01T00:00:00' }), photo('a', { takenAt: '2026-01-01T00:00:00' }), photo('z'), photo('y')];
    expect(ids(sortByTime(same))).toEqual(['a', 'b', 'y', 'z']);
  });

  it('returns a new list', () => {
    const list = [photo('b', { takenAt: '2026-01-02T00:00:00' }), photo('a', { takenAt: '2026-01-01T00:00:00' })];
    const sorted = sortByTime(list);
    expect(sorted).not.toBe(list);
    expect(ids(list)).toEqual(['b', 'a']);
  });
});

describe('isNearToday', () => {
  it('is true for this calendar day in an earlier year', () => {
    expect(isNearToday('2025-11-08T09:00:00', TODAY)).toBe(true);
    expect(isNearToday('2010-11-08T23:59:59', TODAY)).toBe(true);
  });

  it('allows ten days either side by default', () => {
    expect(isNearToday('2025-10-29T00:00:00', TODAY)).toBe(true);
    expect(isNearToday('2025-11-18T00:00:00', TODAY)).toBe(true);
    expect(isNearToday('2025-10-28T00:00:00', TODAY)).toBe(false);
    expect(isNearToday('2025-11-19T00:00:00', TODAY)).toBe(false);
  });

  it('takes a custom window', () => {
    expect(isNearToday('2025-11-11T00:00:00', TODAY, 3)).toBe(true);
    expect(isNearToday('2025-11-12T00:00:00', TODAY, 3)).toBe(false);
    expect(isNearToday('2025-11-08T00:00:00', TODAY, 0)).toBe(true);
    expect(isNearToday('2025-11-09T00:00:00', TODAY, 0)).toBe(false);
  });

  it('wraps over New Year', () => {
    const early = new Date(2026, 0, 3);
    expect(isNearToday('2025-12-28T00:00:00', early)).toBe(true);
    expect(isNearToday('2025-12-20T00:00:00', early)).toBe(false);
    const late = new Date(2026, 11, 30);
    expect(isNearToday('2025-01-04T00:00:00', late)).toBe(true);
    expect(isNearToday('2025-01-12T00:00:00', late)).toBe(false);
  });

  it('never counts this year, nor a future one', () => {
    expect(isNearToday('2026-11-08T00:00:00', TODAY)).toBe(false);
    expect(isNearToday('2026-11-01T00:00:00', TODAY)).toBe(false);
    expect(isNearToday('2027-11-08T00:00:00', TODAY)).toBe(false);
  });

  it('copes with a leap day', () => {
    const march = new Date(2026, 2, 2);
    expect(isNearToday('2024-02-29T12:00:00', march)).toBe(true);
    expect(isNearToday('2024-02-29T12:00:00', TODAY)).toBe(false);
  });

  it('is false for missing or malformed dates', () => {
    for (const bad of [
      null,
      '',
      '2025',
      '2025-11',
      '2025-13-08T00:00:00',
      '2025-00-08T00:00:00',
      '2025-11-00T00:00:00',
      '2025-11-32T00:00:00',
      'abcd-ef-gh'
    ]) {
      expect(isNearToday(bad, TODAY), String(bad)).toBe(false);
    }
  });
});

describe('buildPlaylist', () => {
  const build = (
    photos: PhotoSummary[],
    src: Partial<Source> = {},
    over: { seed?: number; startId?: string; tree?: ReturnType<typeof buildTagTree> | null } = {}
  ) =>
    buildPlaylist({
      photos,
      source: source(src),
      tree: over.tree ?? null,
      seed: over.seed ?? 1,
      today: TODAY,
      startId: over.startId ?? ''
    });

  describe('what can be played', () => {
    it('leaves out photos switched off for Living', () => {
      const list = build([photo('a'), photo('b', { inLiving: false }), photo('c')], { order: 'time' });
      expect(ids(list)).toEqual(['a', 'c']);
    });

    it('leaves out photos missing any of the three sizes', () => {
      const missing = { ...VARIANTS, m: undefined as unknown as typeof VARIANTS.m };
      const noVariants = photo('d', { variants: undefined as unknown as PhotoSummary['variants'] });
      const list = build(
        [
          photo('a'),
          photo('b', { variants: missing }),
          photo('c', { variants: { ...VARIANTS, l: undefined as unknown as typeof VARIANTS.l } }),
          noVariants
        ],
        { order: 'time' }
      );
      expect(ids(list)).toEqual(['a']);
    });

    it('lists a photo once, however often the API returned it', () => {
      expect(ids(build([photo('a'), photo('b'), photo('a')], { order: 'time' }))).toEqual(['a', 'b']);
    });

    it('is empty when there is nothing to play', () => {
      expect(build([])).toEqual([]);
      expect(build([photo('a', { inLiving: false })])).toEqual([]);
    });
  });

  describe('city', () => {
    const photos = [photo('a', { city: '杭州' }), photo('b', { city: '上海' }), photo('c', { city: null }), photo('d', { city: '杭州' })];

    it('keeps one city’s photos, for every source but a theme', () => {
      expect(ids(build(photos, { src: 'city', city: '杭州', order: 'time' }))).toEqual(['a', 'd']);
      expect(ids(build(photos, { src: 'all', city: '上海', order: 'time' }))).toEqual(['b']);
    });

    it('does not filter a theme, which plays its own photos', () => {
      expect(ids(build(photos, { src: 'theme', theme: 'th_1', city: '杭州', order: 'time' }))).toEqual(['a', 'b', 'c', 'd']);
    });
  });

  describe('tags', () => {
    const tags: Tag[] = [
      { id: 'nature', name: '自然', parentId: null, ownerId: null, color: null, sort: 1, count: 0 },
      { id: 'lake', name: '湖', parentId: 'nature', ownerId: null, color: null, sort: 1, count: 0 },
      { id: 'sunset', name: '夕阳', parentId: null, ownerId: null, color: null, sort: 2, count: 0 }
    ];
    const tree = buildTagTree(tags);
    const photos = [
      photo('a', { tagIds: ['lake'] }),
      photo('b', { tagIds: ['sunset'] }),
      photo('c', { tagIds: ['lake', 'sunset'] }),
      photo('d', { tagIds: [] })
    ];

    it('plays photos with any of the tags by default, descendants included', () => {
      expect(ids(build(photos, { src: 'tags', tags: ['nature'], order: 'time' }, { tree }))).toEqual(['a', 'c']);
      expect(ids(build(photos, { src: 'tags', tags: ['lake', 'sunset'], match: 'any', order: 'time' }, { tree }))).toEqual(['a', 'b', 'c']);
    });

    it('plays photos with all of the tags when asked to', () => {
      expect(ids(build(photos, { src: 'tags', tags: ['nature', 'sunset'], match: 'all', order: 'time' }, { tree }))).toEqual(['c']);
      expect(ids(build(photos, { src: 'tags', tags: ['lake', 'sunset'], match: 'all', order: 'time' }, { tree }))).toEqual(['c']);
    });

    it('matches direct tags only when the tag tree could not be loaded', () => {
      expect(ids(build(photos, { src: 'tags', tags: ['nature'], order: 'time' }, { tree: null }))).toEqual([]);
      expect(ids(build(photos, { src: 'tags', tags: ['lake'], order: 'time' }, { tree: null }))).toEqual(['a', 'c']);
    });

    it('plays everything for a tag source with no tags', () => {
      expect(ids(build(photos, { src: 'tags', tags: [], order: 'time' }, { tree }))).toEqual(['a', 'b', 'c', 'd']);
    });

    it('ignores tags for other sources', () => {
      expect(ids(build(photos, { src: 'all', tags: ['sunset'], order: 'time' }, { tree }))).toEqual(['a', 'b', 'c', 'd']);
    });
  });

  describe('today', () => {
    it('plays photos taken around this date in earlier years', () => {
      const photos = [
        photo('a', { takenAt: '2025-11-08T10:00:00' }),
        photo('b', { takenAt: '2025-06-01T10:00:00' }),
        photo('c', { takenAt: '2024-11-12T10:00:00' }),
        photo('d', { takenAt: '2026-11-08T10:00:00' }),
        photo('e')
      ];
      expect(ids(build(photos, { src: 'today', order: 'time' }))).toEqual(['c', 'a']);
    });
  });

  describe('order', () => {
    const photos = [
      photo('c', { takenAt: '2026-03-01T10:00:00' }),
      photo('a', { takenAt: '2024-01-01T10:00:00' }),
      photo('z'),
      photo('b', { takenAt: '2025-01-01T10:00:00' })
    ];

    it('plays by capture time, oldest first and undated last, when asked', () => {
      expect(ids(build(photos, { order: 'time' }))).toEqual(['a', 'b', 'c', 'z']);
    });

    it('plays a theme in the order of its items, even when asked for time', () => {
      expect(ids(build(photos, { src: 'theme', theme: 'th_1', order: 'time' }))).toEqual(['c', 'a', 'z', 'b']);
    });

    it('shuffles a theme when the link asks for it', () => {
      const many = Array.from({ length: 20 }, (_, i) => photo(`ph_${i}`));
      const list = build(many, { src: 'theme', theme: 'th_1', order: 'shuffle' }, { seed: 3 });
      expect(ids(list)).not.toEqual(ids(many));
      expect([...ids(list)].sort()).toEqual([...ids(many)].sort());
    });

    it('shuffles repeatably for one seed', () => {
      const many = Array.from({ length: 20 }, (_, i) => photo(`ph_${i}`));
      expect(ids(build(many, {}, { seed: 9 }))).toEqual(ids(build(many, {}, { seed: 9 })));
      expect(ids(build(many, {}, { seed: 9 }))).not.toEqual(ids(build(many, {}, { seed: 10 })));
    });
  });

  describe('starting photo', () => {
    const many = Array.from({ length: 12 }, (_, i) => photo(`ph_${i}`));
    const base = ids(build(many, {}, { seed: 4 }));

    it('rotates a shuffled list so it begins there, keeping the cycle', () => {
      const start = base[5];
      const rotated = ids(build(many, {}, { seed: 4, startId: start }));
      expect(rotated[0]).toBe(start);
      expect(rotated).toEqual([...base.slice(5), ...base.slice(0, 5)]);
    });

    it('leaves the list alone when the photo is already first, unknown, or not requested', () => {
      expect(ids(build(many, {}, { seed: 4, startId: base[0] }))).toEqual(base);
      expect(ids(build(many, {}, { seed: 4, startId: 'ph_nope' }))).toEqual(base);
      expect(ids(build(many, {}, { seed: 4, startId: '' }))).toEqual(base);
    });

    it('does not rotate a list played by time', () => {
      const timed = ids(build(many, { order: 'time' }, { startId: 'ph_5' }));
      expect(timed[0]).toBe('ph_0');
    });
  });
});
