import { describe, expect, it, vi } from 'vite-plus/test';
import type { MatchCandidate } from '../../shared/types';
import type { PlaceChoice } from './match';
import { choiceFromCandidate } from './match';
import { matchMapPoints, resultMark } from './MatchMap';

const at = { lat: 30.2593, lng: 120.1516 };

const candidate = (key: string, name: string, distance: number, over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  key,
  poiId: null,
  name,
  category: '景',
  lat: at.lat + distance / 111_320,
  lng: at.lng,
  distance,
  bearing: 0,
  inView: false,
  score: distance,
  source: 'osm',
  sourceId: key,
  area: false,
  city: null,
  district: null,
  ...over
});

const list = [candidate('a', '湖畔居', 133), candidate('b', '库迪咖啡', 158), candidate('c', '断桥', 475)];
const pick = (key: string): PlaceChoice =>
  choiceFromCandidate(
    [...list, ...found].find((c) => c.key === key)!,
    'confirmed'
  );
// a name search: 雷峰塔 2 km away, and 断桥 again
const found = [candidate('r1', '雷峰塔', 2000), candidate('c', '断桥', 475)];

describe('matchMapPoints', () => {
  it('puts the photo first and numbers the candidates as the list does', () => {
    const points = matchMapPoints(at, list, [], null, 300, () => {});
    expect(points[0]).toMatchObject({ id: 'photo', lat: at.lat, lng: at.lng, title: '拍摄位置' });
    expect(points[0].count).toBeUndefined();
    expect(points.slice(1).map((p) => [p.id, p.count, p.title])).toEqual([
      ['a', 1, '1. 湖畔居'],
      ['b', 2, '2. 库迪咖啡'],
      ['c', 3, '3. 断桥（超出匹配半径）']
    ]);
  });

  it('lets only candidates inside the radius be clicked, and fades the others', () => {
    const onPick = vi.fn();
    const [, a, , c] = matchMapPoints(at, list, [], null, 300, onPick);
    expect(a.muted).toBe(false);
    a.onClick?.();
    expect(onPick).toHaveBeenCalledWith(list[0]);
    expect(c.muted).toBe(true);
    expect(c.onClick).toBeUndefined();
  });

  it('counts an area that contains the photo as inside, wherever its centre is', () => {
    const lake = candidate('lake', '西湖', 0, { area: true, lat: at.lat - 0.01 });
    const [, p] = matchMapPoints(at, [lake], [], null, 100, () => {});
    expect(p.muted).toBe(false);
    expect(p.onClick).toBeTypeOf('function');
  });

  it('names and highlights the chosen place, and draws it last so it sits on top', () => {
    const points = matchMapPoints(at, list, [], pick('a'), 300, () => {});
    const last = points[points.length - 1];
    expect(last).toMatchObject({ id: 'a', count: 1, selected: true, label: '湖畔居' });
    expect(points.filter((p) => p.label)).toHaveLength(1);
  });

  it('makes nothing clickable while the picker is disabled', () => {
    const points = matchMapPoints(at, list, [], null, 300, null);
    expect(points.every((p) => p.onClick === undefined)).toBe(true);
  });
});

describe('matchMapPoints with search results', () => {
  it('letters the results after the numbered candidates, every one clickable whatever its distance', () => {
    const onPick = vi.fn();
    const points = matchMapPoints(at, list, found, null, 300, onPick);
    expect(points.slice(4).map((p) => [p.id, p.count, p.title, p.muted ?? false])).toEqual([
      ['q:r1', 'A', 'A. 雷峰塔', false],
      ['q:c', 'B', 'B. 断桥', false]
    ]);
    points[4].onClick?.();
    expect(onPick).toHaveBeenCalledWith(found[0]);
  });

  it('shows only the results and the chosen place for a photo without a position', () => {
    const points = matchMapPoints(null, [], found, null, 300, () => {});
    expect(points.map((p) => p.id)).toEqual(['q:r1', 'q:c']);
  });

  it('marks the chosen result, and adds the chosen place when it is in neither list', () => {
    const chosen = matchMapPoints(null, [], found, pick('r1'), 300, () => {});
    expect(chosen[chosen.length - 1]).toMatchObject({ id: 'q:r1', selected: true, label: '雷峰塔' });
    const other: PlaceChoice = { ...pick('a'), key: 'poi_x', name: '孤山', lat: 30.26, lng: 120.14 };
    const points = matchMapPoints(null, [], found, other, 300, () => {});
    expect(points[points.length - 1]).toMatchObject({ id: 'sel:poi_x', label: '孤山', selected: true, lat: 30.26 });
    expect(points[points.length - 1].onClick).toBeUndefined();
  });

  it('adds nothing for a chosen place without coordinates', () => {
    const vague: PlaceChoice = { ...pick('a'), key: 'poi_y', lat: null, lng: null };
    expect(matchMapPoints(null, [], [], vague, 300, () => {})).toEqual([]);
  });
});

describe('resultMark', () => {
  it('runs A to Z, then numbers', () => {
    expect([0, 1, 25, 26, 29].map(resultMark)).toEqual(['A', 'B', 'Z', '27', '30']);
  });
});
