import { describe, expect, it, vi } from 'vite-plus/test';
import type { MatchCandidate } from '../../shared/types';
import { matchMapPoints } from './MatchMap';

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

describe('matchMapPoints', () => {
  it('puts the photo first and numbers the candidates as the list does', () => {
    const points = matchMapPoints(at, list, null, 300, () => {});
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
    const [, a, , c] = matchMapPoints(at, list, null, 300, onPick);
    expect(a.muted).toBe(false);
    a.onClick?.();
    expect(onPick).toHaveBeenCalledWith(list[0]);
    expect(c.muted).toBe(true);
    expect(c.onClick).toBeUndefined();
  });

  it('counts an area that contains the photo as inside, wherever its centre is', () => {
    const lake = candidate('lake', '西湖', 0, { area: true, lat: at.lat - 0.01 });
    const [, p] = matchMapPoints(at, [lake], null, 100, () => {});
    expect(p.muted).toBe(false);
    expect(p.onClick).toBeTypeOf('function');
  });

  it('names and highlights the chosen place, and draws it last so it sits on top', () => {
    const points = matchMapPoints(at, list, 'a', 300, () => {});
    const last = points[points.length - 1];
    expect(last).toMatchObject({ id: 'a', count: 1, selected: true, label: '湖畔居' });
    expect(points.filter((p) => p.label)).toHaveLength(1);
  });

  it('makes nothing clickable while the picker is disabled', () => {
    const points = matchMapPoints(at, list, null, 300, null);
    expect(points.every((p) => p.onClick === undefined)).toBe(true);
  });
});
