import { describe, expect, it } from 'vite-plus/test';
import type { PhotoSummary, Poi } from '../../shared/types';
import { photo, poi } from '../test-utils';
import {
  albumOf,
  anchorOf,
  areaOfRef,
  buildIndex,
  coversOf,
  describe as describeAlbum,
  layoutAt,
  layoutZoom,
  levelAt,
  mercX,
  mercY,
  overview,
  partsOf,
  refOfArea,
  unMercX,
  unMercY,
  zoomTarget,
  type Album,
  type AlbumIndex
} from './albums';

// A small library: Hangzhou (two places on the lake, a street in another district, Qiandao Lake far to the west),
// Ningbo, two cities in Guangxi, Kyoto, and a photo nobody has placed yet. Pixel distances at the zooms used below
// are noted where a test depends on them (albums merge closer than 116 × 92 px, single photos 60 × 56 px).

const ZJ = { province: '浙江省', city: '杭州市' };
const DUANQIAO = poi('poi_dq', { name: '断桥', category: '桥', city: '杭州市', district: '西湖区', lat: 30.2589, lng: 120.1494 });
const BAIDI = poi('poi_bd', { name: '白堤', category: '堤', city: '杭州市', district: '西湖区', lat: 30.259, lng: 120.148 });
const POIS = new Map<string, Poi>([DUANQIAO, BAIDI].map((p) => [p.id, p]));

const at = (id: string, lat: number, lng: number, over: Partial<PhotoSummary> = {}) => photo(id, { lat, lng, ...over });

const LIBRARY: PhotoSummary[] = [
  at('dq1', 30.2589, 120.1494, { ...ZJ, district: '西湖区', poiId: 'poi_dq', takenAt: '2026-03-01T08:00:00' }),
  at('dq2', 30.2588, 120.1495, { ...ZJ, district: '西湖区', poiId: 'poi_dq', takenAt: '2026-03-02T08:00:00' }),
  at('dq3', 30.259, 120.1493, { ...ZJ, district: '西湖区', poiId: 'poi_dq', takenAt: '2026-03-03T08:00:00', favorite: true }),
  at('bd1', 30.259, 120.148, { ...ZJ, district: '西湖区', poiId: 'poi_bd', takenAt: '2026-04-01T08:00:00' }),
  at('bd2', 30.2591, 120.1479, { ...ZJ, district: '西湖区', poiId: 'poi_bd', takenAt: '2026-04-02T08:00:00' }),
  at('hf1', 30.242, 120.17, { ...ZJ, district: '上城区', takenAt: '2026-05-01T08:00:00' }),
  at('qd1', 29.6025, 118.996, { ...ZJ, district: '淳安县', takenAt: '2026-06-01T08:00:00' }),
  at('nb1', 29.8683, 121.544, { province: '浙江省', city: '宁波市', district: '海曙区', takenAt: '2026-07-01T08:00:00' }),
  at('yl1', 22.6006, 110.1437, { province: '广西壮族自治区', city: '玉林市', district: '玉州区' }),
  at('gl1', 25.2678, 110.297, { province: '广西壮族自治区', city: '桂林市', district: '七星区' }),
  at('kt1', 35.0116, 135.7681, { province: '京都府', city: '京都市', district: '中京区' }),
  at('nm1', 43, 115)
];

const index = (photos: PhotoSummary[] = LIBRARY, pois: ReadonlyMap<string, Poi> = POIS) => buildIndex(photos, pois);
const ids = (a: Album) => a.spots.map((s) => s.photo.id).sort();
const find = (albums: Album[], id: string) => albums.find((a) => a.spots.some((s) => s.photo.id === id)) as Album;
const labels = (albums: Album[]) => albums.map((a) => a.label).sort();

describe('levelAt and layoutZoom', () => {
  it('give each zoom its level: province, city from 6, county from 9, place from 12, photo from 16', () => {
    const at = (z: number) => levelAt(z);
    expect([0, 5.99, 6, 8.99, 9, 11.99, 12, 15.99, 16, 22].map(at)).toEqual([
      'province',
      'province',
      'city',
      'city',
      'county',
      'county',
      'place',
      'place',
      'photo',
      'photo'
    ]);
  });

  it('lay out whole zooms only, from 0 to 18', () => {
    expect([3.7, -1, 6, 21].map(layoutZoom)).toEqual([3, 0, 6, 18]);
  });
});

describe('the mercator helpers', () => {
  it('round-trip a position', () => {
    expect(unMercX(mercX(120.15))).toBeCloseTo(120.15, 9);
    expect(unMercY(mercY(30.25))).toBeCloseTo(30.25, 9);
    expect(mercY(0)).toBeCloseTo(0.5, 12);
  });
});

describe('buildIndex', () => {
  it('keeps photos with a position of their own or a place, best cover first', () => {
    const idx = index([
      at('a', 30, 120, { takenAt: '2026-01-01T00:00:00' }),
      photo('no-position'),
      photo('by-place', { poiId: 'poi_dq', takenAt: '2026-02-01T00:00:00' }),
      photo('missing-place', { poiId: 'poi_gone' }),
      at('fav', 30, 120, { favorite: true, takenAt: '2020-01-01T00:00:00' })
    ]);
    expect(idx.spots.map((s) => s.photo.id)).toEqual(['fav', 'by-place', 'a']);
    const byPlace = idx.byId.get('by-place');
    expect(byPlace).toMatchObject({ lat: DUANQIAO.lat, lng: DUANQIAO.lng, city: '杭州市', county: '西湖区' });
  });

  it('fills a city’s province, and a county’s city within its province, from photos that have them', () => {
    const idx = index([
      at('full', 22.6, 110.14, { province: '广西壮族自治区', city: '玉林市', district: '玉州区' }),
      at('no-province', 22.61, 110.15, { city: '玉林市' }),
      at('no-city', 22.62, 110.16, { province: '广西壮族自治区', district: '玉州区' })
    ]);
    expect(idx.byId.get('no-province')?.province).toBe('广西壮族自治区');
    expect(idx.byId.get('no-city')?.city).toBe('玉林市');
    expect(idx.unitSize.get('co:广西,玉林,玉州区')).toBe(2);
    expect(idx.unitSize.get('ct:广西,玉林')).toBe(3);
  });

  it('treats 杭州 and 杭州市 as one city', () => {
    const idx = index([
      at('a', 30.25, 120.15, { province: '浙江省', city: '杭州市' }),
      at('b', 30.26, 120.16, { province: '浙江省', city: '杭州' })
    ]);
    expect(idx.unitSize.get('ct:浙江,杭州')).toBe(2);
  });
});

describe('anchorOf', () => {
  it('sits where most of the photos are, not halfway between groups', () => {
    const idx = index([at('a', 30.2589, 120.1494), at('b', 30.2588, 120.1495), at('c', 30.259, 120.1493), at('far', 29.6025, 118.996)]);
    const a = anchorOf(idx.spots);
    expect(unMercY(a.y)).toBeCloseTo(30.2589, 3);
    expect(unMercX(a.x)).toBeCloseTo(120.1494, 3);
  });
});

describe('layoutAt', () => {
  it('shows provinces when zoomed out: 浙江, 广西 and 京都府 apart at zoom 4, the unplaced photo on its own', () => {
    const albums = layoutAt(index(), 4);
    expect(labels(albums)).toEqual(['', '京都府', '广西', '浙江']);
    const zj = find(albums, 'dq1');
    expect(zj).toMatchObject({
      key: 'pv:浙江',
      ref: 'pv:浙江',
      type: 'province',
      name: '浙江省',
      label: '浙江',
      merged: false,
      parents: []
    });
    expect(ids(zj)).toEqual(['bd1', 'bd2', 'dq1', 'dq2', 'dq3', 'hf1', 'nb1', 'qd1']);
    // the album sits on the lake, where most of the photos are
    expect(zj.lat).toBeCloseTo(30.259, 2);
    expect(zj.lng).toBeCloseTo(120.149, 2);
    // Guilin and Yulin are 300 km apart, but one province
    expect(ids(find(albums, 'yl1'))).toEqual(['gl1', 'yl1']);
    expect(find(albums, 'nm1')).toMatchObject({ key: 'ph:nm1', ref: 'ph:nm1', type: 'spot', name: '', label: '' });
  });

  it('merges provinces whose albums would overlap into a region named after the largest', () => {
    // zoom 2: 浙江 to 广西 is 57 × 49 px, to Kyoto 89 × 32 px
    const albums = layoutAt(index(), 2);
    const region = find(albums, 'dq1');
    expect(region).toMatchObject({ type: 'region', merged: true, name: '浙江等地', label: '浙江等地', ref: '' });
    expect(ids(region)).toEqual(expect.arrayContaining(['yl1', 'kt1']));
    expect(region.key).toBe('region~pv:浙江');
  });

  it('shows cities from zoom 6, with all of a city in one album', () => {
    const albums = layoutAt(index(), 7);
    const hz = find(albums, 'dq1');
    expect(hz).toMatchObject({ key: 'ct:浙江,杭州', type: 'city', name: '杭州市', label: '杭州', parents: ['浙江省'] });
    // Qiandao Lake is 200 px west at zoom 7, but in Hangzhou
    expect(ids(hz)).toContain('qd1');
    expect(find(albums, 'nb1')).toMatchObject({ type: 'city', label: '宁波' });
    expect(find(albums, 'yl1').label).toBe('玉林');
    expect(find(albums, 'gl1').label).toBe('桂林');
  });

  it('keeps the same key for a city through its zooms', () => {
    const idx = index();
    for (const z of [6, 7, 8]) expect(find(layoutAt(idx, z), 'dq1').key, String(z)).toBe('ct:浙江,杭州');
  });

  it('shows counties from zoom 9 and names a merge after its largest county when it is not all of the city', () => {
    // zoom 9: 西湖区 to 上城区 is 15 × 14 px; 淳安县 is 840 px away
    const albums = layoutAt(index(), 9);
    const lake = find(albums, 'dq1');
    expect(lake).toMatchObject({ type: 'county', merged: true, name: '西湖区等地', ref: '', parents: ['浙江省', '杭州市'] });
    expect(ids(lake)).toEqual(['bd1', 'bd2', 'dq1', 'dq2', 'dq3', 'hf1']);
    expect(find(albums, 'qd1')).toMatchObject({ key: 'co:浙江,杭州,淳安县', type: 'county', name: '淳安县', label: '淳安县' });
  });

  it('names a merge after the city when it is all of the city, with the city’s key', () => {
    const idx = index(LIBRARY.filter((p) => p.id !== 'qd1'));
    const lake = find(layoutAt(idx, 9), 'dq1');
    expect(lake).toMatchObject({ key: 'ct:浙江,杭州', ref: 'ct:浙江,杭州', type: 'city', merged: false, name: '杭州市', label: '杭州' });
  });

  it('shows places from zoom 12; two places that make up their whole county are named after it', () => {
    // zoom 12: 断桥 to 白堤 is 8 px, to 河坊街 120 × 114 px
    const albums = layoutAt(index(), 12);
    const lake = find(albums, 'dq1');
    expect(ids(lake)).toEqual(['bd1', 'bd2', 'dq1', 'dq2', 'dq3']);
    expect(lake).toMatchObject({ key: 'co:浙江,杭州,西湖区', type: 'county', name: '西湖区', parents: ['浙江省', '杭州市'] });
    // a photo without a place is unnamed at this level
    expect(find(albums, 'hf1')).toMatchObject({ key: 'ph:hf1', ref: 'ph:hf1', type: 'spot', label: '' });
  });

  it('names a merge of places after the largest place when they are not a whole county', () => {
    const extra = at('xh9', 30.2, 120.1, { ...ZJ, district: '西湖区' });
    const lake = find(layoutAt(index([...LIBRARY, extra]), 12), 'dq1');
    expect(lake).toMatchObject({ type: 'place', merged: true, name: '断桥等地', label: '断桥等地', ref: '' });
    expect(lake.key).toBe('place~pl:poi_dq');
  });

  it('shows a lone place as itself', () => {
    const albums = layoutAt(index(LIBRARY.filter((p) => !p.id.startsWith('bd'))), 13);
    expect(find(albums, 'dq1')).toMatchObject({ key: 'pl:poi_dq', ref: 'pl:poi_dq', type: 'place', name: '断桥', label: '断桥' });
    expect(find(albums, 'dq1').parents).toEqual(['浙江省', '杭州市', '西湖区']);
  });

  it('shows single photos from zoom 16, merged only where they would overlap', () => {
    // zoom 16: 断桥 to 白堤 is 130 px; the three shots of 断桥 are a few metres apart
    const albums = layoutAt(index(), 16);
    const bridge = find(albums, 'dq1');
    expect(ids(bridge)).toEqual(['dq1', 'dq2', 'dq3']);
    expect(bridge).toMatchObject({ type: 'place', name: '断桥', ref: 'pl:poi_dq' });
    const alone = layoutAt(index(), 18).find((a) => a.key === 'ph:hf1');
    expect(alone).toMatchObject({ type: 'photo', ref: 'ph:hf1', label: '' });
  });

  it('gives every album a key of its own', () => {
    const idx = index();
    for (let z = 0; z <= 18; z++) {
      const keys = layoutAt(idx, z).map((a) => a.key);
      expect(new Set(keys).size, String(z)).toBe(keys.length);
    }
  });

  it('places every located photo in exactly one album at every zoom', () => {
    const idx = index();
    for (let z = 0; z <= 18; z++) {
      const all = layoutAt(idx, z).flatMap(ids);
      expect(all.sort(), String(z)).toEqual(idx.spots.map((s) => s.photo.id).sort());
    }
  });

  it('caches each zoom', () => {
    const idx = index();
    expect(layoutAt(idx, 7)).toBe(layoutAt(idx, 7));
  });
});

describe('describe', () => {
  const spots = (idx: AlbumIndex, ...want: string[]) => idx.spots.filter((s) => want.includes(s.photo.id));

  it('needs at least half of the photos to know their unit', () => {
    const idx = index([
      at('p', 30.2589, 120.1494, { poiId: 'poi_dq' }),
      at('u1', 30.2589, 120.1494),
      at('u2', 30.2589, 120.1494),
      at('u3', 30.2589, 120.1494)
    ]);
    expect(describeAlbum(idx, spots(idx, 'p', 'u1', 'u2', 'u3'), 'place').type).toBe('spot');
    expect(describeAlbum(idx, spots(idx, 'p', 'u1'), 'place')).toMatchObject({ type: 'place', name: '断桥' });
  });
});

describe('selection', () => {
  it('turns refs into whole units', () => {
    const idx = index();
    expect(ids(albumOf(idx, 'ct:浙江,杭州') as Album)).toEqual(['bd1', 'bd2', 'dq1', 'dq2', 'dq3', 'hf1', 'qd1']);
    expect(albumOf(idx, 'pv:广西')).toMatchObject({ type: 'province', name: '广西壮族自治区', label: '广西' });
    expect(albumOf(idx, 'co:浙江,杭州,淳安县')).toMatchObject({ type: 'county', parents: ['浙江省', '杭州市'] });
    expect(albumOf(idx, 'pl:poi_bd')).toMatchObject({ type: 'place', name: '白堤' });
    expect(albumOf(idx, 'ph:kt1')).toMatchObject({ type: 'photo', ref: 'ph:kt1' });
    for (const ref of ['ct:浙江,温州', 'pl:poi_none', 'ph:none', 'zz:x', 'pv', '']) expect(albumOf(idx, ref), ref).toBeNull();
  });

  it('maps the area link parameter to refs and back', () => {
    expect(refOfArea('浙江')).toBe('pv:浙江');
    expect(refOfArea('浙江,杭州')).toBe('ct:浙江,杭州');
    expect(refOfArea('浙江,杭州,西湖区')).toBe('co:浙江,杭州,西湖区');
    expect(refOfArea('')).toBe('');
    expect(refOfArea('a,b,c,d')).toBe('');
    expect(areaOfRef('co:浙江,杭州,西湖区')).toBe('浙江,杭州,西湖区');
    expect(areaOfRef('pl:poi_dq')).toBeNull();
  });
});

describe('partsOf and overview', () => {
  it('lists a city’s counties, largest first, ties in pinyin order', () => {
    const parts = partsOf(albumOf(index(), 'ct:浙江,杭州') as Album);
    expect(parts?.level).toBe('county');
    expect(parts?.units.map((u) => [u.label, u.spots.length])).toEqual([
      ['西湖区', 5],
      ['淳安县', 1],
      ['上城区', 1]
    ]);
  });

  it('lists a county’s places and counts the photos without one', () => {
    const parts = partsOf(albumOf(index(), 'co:浙江,杭州,西湖区') as Album);
    expect(parts).toMatchObject({ level: 'place', rest: 0 });
    expect(parts?.units.map((u) => u.name)).toEqual(['断桥', '白堤']);
  });

  it('lists the provinces of a region and the units of a merge', () => {
    const region = find(layoutAt(index(), 2), 'dq1');
    expect(partsOf(region)?.units.map((u) => u.label)).toEqual(['浙江', '广西', '京都府']);
    const merge = find(layoutAt(index(), 9), 'dq1');
    expect(partsOf(merge)?.units.map((u) => u.label)).toEqual(['西湖区', '上城区']);
  });

  it('has no parts for a place, a photo or an unnamed spot', () => {
    const idx = index();
    expect(partsOf(albumOf(idx, 'pl:poi_dq') as Album)).toBeNull();
    expect(partsOf(albumOf(idx, 'ph:dq1') as Album)).toBeNull();
    expect(partsOf(find(layoutAt(idx, 4), 'nm1'))).toBeNull();
  });

  it('starts the overview at the first level with more than one unit', () => {
    expect(overview(index())).toMatchObject({ level: 'province', rest: 1 });
    expect(overview(index())?.units.map((u) => u.label)).toEqual(['浙江', '广西', '京都府']);
    const hz = overview(index(LIBRARY.filter((p) => p.city === '杭州市')));
    expect(hz?.level).toBe('county');
    expect(overview(index([at('one', 22.6, 110.14, { district: '玉州区' })]))).toMatchObject({ level: 'county', rest: 0 });
    expect(overview(index([]))).toBeNull();
  });
});

describe('zoomTarget', () => {
  const VIEW = { w: 1000, h: 700 };

  it('zooms a province in to where its cities come apart, centred on all of it when it fits', () => {
    const idx = index();
    const zj = find(layoutAt(idx, 4), 'dq1');
    const to = zoomTarget(idx, zj, 4, VIEW);
    expect(to?.zoom).toBe(6);
    // 浙江 spans 2.5° of longitude, 230 px at zoom 6: centred between Qiandao Lake and Ningbo
    expect(to?.lng).toBeCloseTo((118.996 + 121.544) / 2, 3);
  });

  it('zooms a city in to its counties, and a merged county to its parts', () => {
    const idx = index();
    expect(zoomTarget(idx, find(layoutAt(idx, 7), 'dq1'), 7, VIEW)?.zoom).toBe(9);
    // 西湖区等地 at zoom 9 splits at 12, when 河坊街 leaves the lake
    expect(zoomTarget(idx, find(layoutAt(idx, 9), 'dq1'), 9, VIEW)?.zoom).toBe(12);
  });

  it('centres on the album when its photos do not fit at the new zoom', () => {
    const idx = index();
    const hz = find(layoutAt(idx, 7), 'dq1');
    // at zoom 9 Hangzhou with Qiandao Lake is 840 px wide: too wide for a 600 px map
    const to = zoomTarget(idx, hz, 7, { w: 600, h: 400 });
    expect(to).toMatchObject({ zoom: 9, lat: hz.lat, lng: hz.lng });
  });

  it('leaves the map alone for a place, a single photo, or photos taken on one spot', () => {
    const idx = index();
    expect(zoomTarget(idx, albumOf(idx, 'pl:poi_dq') as Album, 13, VIEW)).toBeNull();
    expect(zoomTarget(idx, albumOf(idx, 'ph:dq1') as Album, 17, VIEW)).toBeNull();
    const same = index([at('a', 43, 115), at('b', 43, 115)]);
    expect(zoomTarget(same, layoutAt(same, 4)[0], 4, VIEW)).toBeNull();
  });
});

describe('coversOf', () => {
  it('takes the best photo of each spot first, up to four', () => {
    const idx = index();
    const zj = albumOf(idx, 'pv:浙江') as Album;
    // the favourite on the bridge, then the best of each other spot
    expect(coversOf(zj.spots, () => true).map((p) => p.id)).toEqual(['dq3', 'nb1', 'qd1', 'hf1']);
  });

  it('fills up with second-best photos when there are fewer spots', () => {
    const idx = index();
    const bridge = albumOf(idx, 'pl:poi_dq') as Album;
    expect(coversOf(bridge.spots, () => true).map((p) => p.id)).toEqual(['dq3', 'dq2', 'dq1']);
    expect(coversOf(bridge.spots, () => true, 2)).toHaveLength(2);
  });

  it('shows only matching photos while any match, and all of them when none do', () => {
    const idx = index();
    const bridge = albumOf(idx, 'pl:poi_dq') as Album;
    expect(coversOf(bridge.spots, (p) => p.id === 'dq1').map((p) => p.id)).toEqual(['dq1']);
    expect(coversOf(bridge.spots, () => false).map((p) => p.id)).toEqual(['dq3', 'dq2', 'dq1']);
  });
});
