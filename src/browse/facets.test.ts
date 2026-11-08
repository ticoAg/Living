import { describe, expect, it } from 'vite-plus/test';
import type { Tag } from '../../shared/types';
import { buildTagTree } from '../lib/tags';
import { DAY_PARTS, SEASONS, lightTags, partOf, seasonOf } from './facets';

const tag = (id: string, name: string, parentId: string | null = null, sort = 0): Tag => ({
  id,
  name,
  parentId,
  ownerId: null,
  color: null,
  sort,
  count: 0
});
const at = (takenAt: string | null, tagIds: string[] = []) => ({ takenAt, tagIds });

describe('seasonOf', () => {
  describe('from the month of the capture date', () => {
    const season = (month: string) => seasonOf(at(`2026-${month}-15T12:00:00`), undefined);

    it('follows the northern-hemisphere calendar', () => {
      expect(['03', '04', '05'].map(season)).toEqual(['spring', 'spring', 'spring']);
      expect(['06', '07', '08'].map(season)).toEqual(['summer', 'summer', 'summer']);
      expect(['09', '10', '11'].map(season)).toEqual(['autumn', 'autumn', 'autumn']);
      expect(['12', '01', '02'].map(season)).toEqual(['winter', 'winter', 'winter']);
    });

    it('is empty without a usable date', () => {
      expect(seasonOf(at(null), undefined)).toBe('');
      expect(seasonOf(at(''), undefined)).toBe('');
      expect(seasonOf(at('2026-13-01T00:00:00'), undefined)).toBe('');
      expect(seasonOf(at('2026-00-01T00:00:00'), undefined)).toBe('');
      expect(seasonOf(at('not a date'), undefined)).toBe('');
    });
  });

  describe('from a season tag', () => {
    it('beats the month', () => {
      expect(seasonOf(at('2026-07-15T12:00:00', ['winter']), undefined)).toBe('winter');
      expect(seasonOf(at(null, ['autumn']), undefined)).toBe('autumn');
    });

    it('also counts a tag below a season, through the tag tree', () => {
      const tree = buildTagTree([tag('winter', '冬'), tag('snow', '雪', 'winter'), tag('lake', '湖')]);
      expect(seasonOf(at('2026-07-15T12:00:00', ['snow']), tree)).toBe('winter');
      expect(seasonOf(at('2026-07-15T12:00:00', ['lake']), tree)).toBe('summer');
    });

    it('ignores the tree’s ancestors when no tree is given: only the photo’s direct tags count', () => {
      expect(seasonOf(at('2026-07-15T12:00:00', ['snow']), undefined)).toBe('summer');
    });

    it('can be given the photo’s already-expanded tags', () => {
      expect(seasonOf(at('2026-07-15T12:00:00', []), undefined, new Set(['spring', 'blossom']))).toBe('spring');
    });

    it('takes the first season in spring, summer, autumn, winter order when a photo has several', () => {
      expect(seasonOf(at(null, ['winter', 'summer']), undefined)).toBe('summer');
      expect(seasonOf(at(null, ['autumn', 'spring']), undefined)).toBe('spring');
    });
  });

  it('knows exactly four seasons, in calendar order', () => {
    expect(SEASONS.map((s) => s.id)).toEqual(['spring', 'summer', 'autumn', 'winter']);
    expect(SEASONS.map((s) => s.label)).toEqual(['春', '夏', '秋', '冬']);
  });
});

describe('partOf', () => {
  it('names the part of the day from the capture hour', () => {
    expect(partOf({ takenAt: '2026-11-08T06:00:00' })).toBe('晨');
    expect(partOf({ takenAt: '2026-11-08T12:00:00' })).toBe('昼');
    expect(partOf({ takenAt: '2026-11-08T17:00:00' })).toBe('暮');
    expect(partOf({ takenAt: '2026-11-08T22:00:00' })).toBe('夜');
  });

  it('is empty without a time', () => {
    expect(partOf({ takenAt: null })).toBe('');
    expect(partOf({ takenAt: '2026-11-08' })).toBe('');
  });

  it('only gives names the filter bar offers', () => {
    for (const hour of ['00', '05', '08', '09', '15', '16', '18', '19', '23']) {
      expect(DAY_PARTS as readonly string[]).toContain(partOf({ takenAt: `2026-11-08T${hour}:00:00` }));
    }
  });
});

describe('lightTags', () => {
  it('is empty without a tree or without the 光与天气 root', () => {
    expect(lightTags(undefined)).toEqual([]);
    expect(lightTags(buildTagTree([tag('lake', '湖')]))).toEqual([]);
  });

  it('lists the leaf tags under the light root, in tree order', () => {
    const tree = buildTagTree([
      tag('light', '光与天气'),
      tag('sunrise', '日出', 'light', 2),
      tag('weather', '天气', 'light', 1),
      tag('fog', '雾', 'weather', 2),
      tag('rain', '雨', 'weather', 1),
      tag('night', '夜晚', 'light', 3),
      tag('lake', '湖')
    ]);
    // 天气 (sort 1) comes before 日出 and 夜晚; its own leaves are 雨 then 雾; groups themselves are not listed
    expect(lightTags(tree)).toEqual([
      { id: 'rain', name: '雨' },
      { id: 'fog', name: '雾' },
      { id: 'sunrise', name: '日出' },
      { id: 'night', name: '夜晚' }
    ]);
  });

  it('leaves out 白昼, the unmarked default', () => {
    const tree = buildTagTree([tag('light', '光与天气'), tag('daylight', '白昼', 'light', 1), tag('dusk', '黄昏', 'light', 2)]);
    expect(lightTags(tree)).toEqual([{ id: 'dusk', name: '黄昏' }]);
  });

  it('is empty when the light root has no children', () => {
    expect(lightTags(buildTagTree([tag('light', '光与天气')]))).toEqual([]);
  });
});
