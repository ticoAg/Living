import { describe, expect, it } from 'vite-plus/test';
import { destination } from '../../shared/geo';
import type { Env } from '../env';
import type { PoiRow } from '../lib/poi';
import { dedupe, fromExternal, fromPoiRow, providerFor, rank, score, type RawPlace } from './match';

const PHOTO = { lat: 30.25, lng: 120.14 };
const at = (heading: number | null = null) => ({ ...PHOTO, heading });

let counter = 0;
/** A place `meters` away from the photo in direction `bearingDeg`, from a provider unless overridden. */
function placeAt(bearingDeg: number, meters: number, over: Partial<RawPlace> = {}): RawPlace {
  const [lat, lng] = destination(PHOTO.lat, PHOTO.lng, bearingDeg, meters);
  const n = ++counter;
  return {
    key: `osm:${n}`,
    poiId: null,
    name: `地点${n}`,
    category: '景',
    lat,
    lng,
    source: 'osm',
    storedSource: 'osm',
    sourceId: String(n),
    city: null,
    district: null,
    extent: 120,
    ...over
  };
}

/** Same, but a place already stored in the site's own table. */
const localAt = (bearingDeg: number, meters: number, over: Partial<RawPlace> = {}) => {
  const n = ++counter;
  return placeAt(bearingDeg, meters, {
    key: `poi_${n}`,
    poiId: `poi_${n}`,
    source: 'local',
    storedSource: 'custom',
    sourceId: null,
    ...over
  });
};

describe('score', () => {
  it('reports distance, bearing and score for a place with no heading to go by', () => {
    const c = score(placeAt(90, 100), at());
    expect(c.distance).toBe(100);
    expect(c.bearing).toBe(90);
    expect(c.score).toBe(100);
    expect(c.inView).toBe(false);
    expect(c.area).toBe(false);
  });

  it('carries the place’s own fields over', () => {
    const place = placeAt(10, 50, {
      key: 'amap:B0FF',
      name: '断桥',
      category: '桥',
      sourceId: 'B0FF',
      city: '杭州',
      district: '西湖区',
      source: 'amap'
    });
    expect(score(place, at())).toMatchObject({
      key: 'amap:B0FF',
      poiId: null,
      name: '断桥',
      category: '桥',
      lat: place.lat,
      lng: place.lng,
      source: 'amap',
      sourceId: 'B0FF',
      city: '杭州',
      district: '西湖区'
    });
    expect(score(localAt(10, 50, { poiId: 'poi_9', key: 'poi_9' }), at())).toMatchObject({ poiId: 'poi_9', key: 'poi_9', source: 'local' });
  });

  it('rounds distance and score to a tenth of a metre', () => {
    const c = score(placeAt(45, 123.456), at());
    expect(c.distance).toBe(123.5);
    expect(c.score).toBe(123.5);
  });

  it('gives the bearing as a whole number of degrees in 0..359', () => {
    expect(score(placeAt(0.4, 80), at()).bearing).toBe(0);
    expect(score(placeAt(0.6, 80), at()).bearing).toBe(1);
    expect(score(placeAt(359.4, 80), at()).bearing).toBe(359);
    // 359.7 rounds to 360, which is north again
    expect(score(placeAt(359.7, 80), at()).bearing).toBe(0);
    expect(score(placeAt(180, 80), at()).bearing).toBe(180);
  });

  describe('camera heading', () => {
    it('takes 25 m off a place in front of the camera', () => {
      const c = score(placeAt(0, 100), at(0));
      expect(c.inView).toBe(true);
      expect(c.score).toBe(75);
      expect(c.distance).toBe(100);
    });

    it('counts places within 30 degrees either side, across north too', () => {
      expect(score(placeAt(0, 100), at(29)).inView).toBe(true);
      expect(score(placeAt(0, 100), at(331)).inView).toBe(true);
      expect(score(placeAt(350, 100), at(10)).inView).toBe(true);
      expect(score(placeAt(10, 100), at(350)).inView).toBe(true);
      expect(score(placeAt(0, 100), at(31)).inView).toBe(false);
      expect(score(placeAt(0, 100), at(329)).inView).toBe(false);
    });

    it('does not favour places behind the camera', () => {
      const c = score(placeAt(0, 100), at(180));
      expect(c.inView).toBe(false);
      expect(c.score).toBe(100);
    });

    it('does nothing without a heading', () => {
      expect(score(placeAt(0, 100), at(null)).inView).toBe(false);
      expect(score(placeAt(0, 100), at(null)).score).toBe(100);
    });

    it('does not apply to a place at the camera position itself', () => {
      const c = score(placeAt(0, 0), at(0));
      expect(c.distance).toBe(0);
      expect(c.inView).toBe(false);
      expect(c.score).toBe(0);
    });
  });

  describe('places already on the site', () => {
    it('take 10 off, and combine with the heading bonus', () => {
      expect(score(localAt(90, 100), at()).score).toBe(90);
      expect(score(localAt(0, 100), at(0)).score).toBe(65);
    });
  });

  describe('areas', () => {
    it('count as "inside" when the photo is within the place’s extent: distance 0 and ranked last', () => {
      const c = score(placeAt(0, 300, { category: '湖', extent: 600 }), at());
      expect(c.area).toBe(true);
      expect(c.distance).toBe(0);
      expect(c.score).toBe(10_300);
    });

    it('are never "in view", whichever way the camera points', () => {
      const c = score(placeAt(0, 300, { category: '湖', extent: 600 }), at(0));
      expect(c.inView).toBe(false);
      expect(c.score).toBe(10_300);
    });

    it('still get the site bonus', () => {
      expect(score(localAt(0, 300, { category: '湖', extent: 600 }), at()).score).toBe(10_290);
    });

    it('are plain points when the photo lies beyond their extent', () => {
      const c = score(placeAt(0, 700, { category: '湖', extent: 600 }), at(0));
      expect(c.area).toBe(false);
      expect(c.distance).toBe(700);
      expect(c.inView).toBe(true);
      expect(c.score).toBe(675);
    });

    it('apply to every area category and to nothing else', () => {
      for (const category of ['湖', '园', '岛', '村', '街区', '海岸', '山']) {
        expect(score(placeAt(0, 10, { category, extent: 100 }), at()).area, category).toBe(true);
      }
      for (const category of ['桥', '堤', '塔', '寺', '亭', '景', '建筑', '美术馆', '店', '道路']) {
        expect(score(placeAt(0, 10, { category, extent: 100 }), at()).area, category).toBe(false);
      }
    });
  });
});

describe('dedupe', () => {
  it('keeps everything when there is nothing local', () => {
    const external = [placeAt(0, 50, { name: '甲' }), placeAt(90, 60, { name: '乙' })];
    expect(dedupe([], external)).toEqual(external);
    expect(dedupe([], [])).toEqual([]);
  });

  it('drops a provider result that is already stored under the same source and id', () => {
    const stored = localAt(0, 40, { name: '断桥残雪', storedSource: 'amap', sourceId: 'B0FF1' });
    const same = placeAt(0, 400, { name: '完全不同的名字', source: 'amap', storedSource: 'amap', sourceId: 'B0FF1' });
    const other = placeAt(0, 400, { name: '另一处', source: 'amap', storedSource: 'amap', sourceId: 'B0FF2' });
    expect(dedupe([stored], [same, other])).toEqual([other]);
  });

  it('matches ids within one source only', () => {
    const stored = localAt(0, 40, { name: '甲', storedSource: 'osm', sourceId: '42' });
    const amap = placeAt(0, 900, { name: '乙', source: 'amap', storedSource: 'amap', sourceId: '42' });
    expect(dedupe([stored], [amap])).toEqual([amap]);
  });

  it('does not treat places without a source id as the same place', () => {
    const custom = localAt(0, 40, { name: '甲', sourceId: null });
    const external = placeAt(0, 900, { name: '乙', sourceId: '' });
    expect(dedupe([custom], [external])).toEqual([external]);
  });

  it('drops a provider result with the same name within 80 m of a local place', () => {
    const stored = localAt(0, 40, { name: '断桥' });
    expect(dedupe([stored], [placeAt(0, 40, { name: '断桥' })])).toEqual([]);
    expect(dedupe([stored], [placeAt(0, 110, { name: '断桥' })])).toEqual([]);
  });

  it('keeps a same-named result that is 80 m or further away', () => {
    const stored = localAt(0, 0, { name: '星巴克' });
    const far = placeAt(0, 120, { name: '星巴克' });
    expect(dedupe([stored], [far])).toEqual([far]);
  });

  it('keeps nearby places with different names', () => {
    const stored = localAt(0, 40, { name: '断桥' });
    const next = placeAt(0, 45, { name: '白堤' });
    expect(dedupe([stored], [next])).toEqual([next]);
  });

  it('compares names loosely: case, width, spaces and punctuation do not matter', () => {
    const pairs: [string, string][] = [
      ['断桥 残雪', '断桥残雪'],
      ['Starbucks', 'ＳＴＡＲＢＵＣＫＳ'],
      ['星巴克（西湖店）', '星巴克(西湖店)'],
      ['湖滨·银泰', '湖滨银泰'],
      ['湖滨・银泰', '湖滨银泰'],
      ['A-B_C', 'abc'],
      ['Café  Lakeside', 'café lakeside']
    ];
    for (const [a, b] of pairs) {
      expect(dedupe([localAt(0, 10, { name: a })], [placeAt(0, 12, { name: b })]), `${a} / ${b}`).toEqual([]);
      expect(dedupe([localAt(0, 10, { name: b })], [placeAt(0, 12, { name: a })]), `${b} / ${a}`).toEqual([]);
    }
  });

  it('drops twins among the provider results themselves, keeping the one nearest the photo', () => {
    const near = placeAt(0, 30, { name: '湖心亭', sourceId: 'near' });
    const far = placeAt(0, 60, { name: '湖心亭', sourceId: 'far' });
    expect(dedupe([], [far, near], PHOTO)).toEqual([near]);
    expect(dedupe([], [near, far], PHOTO)).toEqual([near]);
  });

  it('keeps the first of the twins when it has no photo position to measure from', () => {
    const first = placeAt(0, 60, { name: '湖心亭', sourceId: 'first' });
    const second = placeAt(0, 30, { name: '湖心亭', sourceId: 'second' });
    expect(dedupe([], [first, second])).toEqual([first]);
  });

  it('leaves the local list alone, duplicates and all', () => {
    const a = localAt(0, 10, { name: '同名' });
    const b = localAt(0, 10, { name: '同名' });
    expect(dedupe([a, b], [])).toEqual([]);
  });
});

describe('rank', () => {
  it('orders candidates by score, lowest first', () => {
    const ranked = rank([], [placeAt(0, 200, { name: '丙' }), placeAt(0, 50, { name: '甲' }), placeAt(0, 120, { name: '乙' })], at());
    expect(ranked.map((c) => c.name)).toEqual(['甲', '乙', '丙']);
    expect(ranked.map((c) => c.score)).toEqual([50, 120, 200]);
  });

  it('lets facing a place outweigh a little extra distance', () => {
    // 100 m ahead scores 75; 90 m behind scores 90
    const ranked = rank([], [placeAt(180, 90, { name: '身后' }), placeAt(0, 100, { name: '面前' })], at(0));
    expect(ranked.map((c) => c.name)).toEqual(['面前', '身后']);
  });

  it('lets a place the site already has beat a provider one a few metres closer', () => {
    // local 105 m scores 95; provider 100 m scores 100
    const ranked = rank([localAt(90, 105, { name: '站内' })], [placeAt(90, 100, { name: '外部' })], at());
    expect(ranked.map((c) => c.name)).toEqual(['站内', '外部']);
    expect(ranked.map((c) => c.source)).toEqual(['local', 'osm']);
  });

  it('puts a local place first on equal scores', () => {
    // local 110 m: 110 - 10 = 100; provider 100 m: 100
    const ranked = rank([localAt(90, 110, { name: '站内' })], [placeAt(270, 100, { name: '外部' })], at());
    expect(ranked.map((c) => c.score)).toEqual([100, 100]);
    expect(ranked.map((c) => c.name)).toEqual(['站内', '外部']);
  });

  it('then orders equal scores by name', () => {
    const [lat, lng] = destination(PHOTO.lat, PHOTO.lng, 0, 80);
    const twins = ['丙', '甲', '乙'].map((name, i) => placeAt(0, 80, { name, lat, lng, sourceId: `t${i}` }));
    expect(rank([], twins, at()).map((c) => c.name)).toEqual(twins.map((t) => t.name).sort((a, b) => a.localeCompare(b)));
  });

  it('ranks areas after every point candidate, however far the point is', () => {
    const lake = placeAt(0, 5, { name: '西湖', category: '湖', extent: 600 });
    const farBridge = placeAt(90, 900, { name: '远桥', category: '桥', extent: 60 });
    const ranked = rank([], [lake, farBridge], at());
    expect(ranked.map((c) => c.name)).toEqual(['远桥', '西湖']);
    expect(ranked[1]).toMatchObject({ area: true, distance: 0 });
  });

  it('puts the nearer area first among areas', () => {
    const near = placeAt(0, 100, { name: '近湖', category: '湖', extent: 600 });
    const far = placeAt(0, 400, { name: '远湖', category: '湖', extent: 600 });
    expect(rank([], [far, near], at()).map((c) => c.name)).toEqual(['近湖', '远湖']);
  });

  it('drops provider results that duplicate a local place before ranking', () => {
    const local = localAt(0, 30, { name: '断桥' });
    const twin = placeAt(0, 32, { name: '断桥' });
    const other = placeAt(90, 200, { name: '白堤' });
    const ranked = rank([local], [twin, other], at());
    expect(ranked.map((c) => c.name)).toEqual(['断桥', '白堤']);
    expect(ranked[0].source).toBe('local');
  });

  it('returns at most 40 candidates, the best ones', () => {
    const external = Array.from({ length: 60 }, (_, i) => placeAt(0, 10 * (i + 1), { name: `地点${String(i).padStart(2, '0')}` }));
    const ranked = rank([], [...external].reverse(), at());
    expect(ranked).toHaveLength(40);
    expect(ranked[0].name).toBe('地点00');
    expect(ranked[39].name).toBe('地点39');
  });

  it('has nothing to rank when there are no places', () => {
    expect(rank([], [], at())).toEqual([]);
  });
});

describe('providerFor', () => {
  const env = (AMAP_KEY?: string) => ({ AMAP_KEY }) as Env;

  it('uses OpenStreetMap when no AMap key is configured', () => {
    expect(providerFor(env(), 30.25, 120.14)).toBe('osm');
    expect(providerFor(env(''), 30.25, 120.14)).toBe('osm');
  });

  it('uses AMap inside China when a key is configured', () => {
    expect(providerFor(env('key'), 30.25, 120.14)).toBe('amap');
    expect(providerFor(env('key'), 39.9087, 116.3975)).toBe('amap');
  });

  it('uses OpenStreetMap abroad even with a key, since AMap only covers the mainland', () => {
    expect(providerFor(env('key'), 35.6762, 139.6503)).toBe('osm');
    expect(providerFor(env('key'), 51.5074, -0.1278)).toBe('osm');
  });
});

describe('fromPoiRow', () => {
  const row: PoiRow = {
    id: 'poi_01',
    name: '断桥',
    aliases: '断桥残雪',
    category: '桥',
    city: '杭州',
    district: '西湖区',
    lat: 30.2589,
    lng: 120.1494,
    radius: 60,
    source: 'amap',
    source_id: 'B0FF1',
    created_by: 'u_1',
    created_at: '2026-11-08T00:00:00Z'
  };

  it('turns a stored place into a local candidate that remembers where it came from', () => {
    expect(fromPoiRow(row)).toEqual({
      key: 'poi_01',
      poiId: 'poi_01',
      name: '断桥',
      category: '桥',
      lat: 30.2589,
      lng: 120.1494,
      source: 'local',
      storedSource: 'amap',
      sourceId: 'B0FF1',
      city: '杭州',
      district: '西湖区',
      extent: 60
    });
  });

  it('keeps null ids and areas as they are', () => {
    expect(fromPoiRow({ ...row, source: 'custom', source_id: null, city: null, district: null })).toMatchObject({
      storedSource: 'custom',
      sourceId: null,
      city: null,
      district: null
    });
  });
});

describe('fromExternal', () => {
  const external = {
    source: 'osm' as const,
    sourceId: 'way/123',
    name: '太子湾公园',
    category: '园',
    lat: 30.2,
    lng: 120.1,
    city: null,
    district: '西湖区'
  };

  it('keys a provider place by source and id, with the default radius of its category as extent', () => {
    expect(fromExternal(external, { city: '杭州', district: '上城区' })).toEqual({
      key: 'osm:way/123',
      poiId: null,
      name: '太子湾公园',
      category: '园',
      lat: 30.2,
      lng: 120.1,
      source: 'osm',
      storedSource: 'osm',
      sourceId: 'way/123',
      city: '杭州',
      district: '西湖区',
      extent: 200
    });
  });

  it('fills a missing city or district from the reverse geocode, but never overrides its own', () => {
    expect(fromExternal({ ...external, city: '自己的城市', district: null }, { city: '杭州', district: '上城区' })).toMatchObject({
      city: '自己的城市',
      district: '上城区'
    });
    expect(fromExternal({ ...external, city: null, district: null }, { city: null, district: null })).toMatchObject({
      city: null,
      district: null
    });
  });

  it('gives categories without a table entry the 120 m default', () => {
    expect(fromExternal({ ...external, category: '未知' }, { city: null, district: null }).extent).toBe(120);
  });
});
