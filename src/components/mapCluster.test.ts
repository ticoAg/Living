import { describe, expect, it } from 'vite-plus/test';
import { clusterKey, inBox, pointFeatures, sameFeatures } from './mapCluster';
import type { MapPoint } from './mapPoints';

const pt = (id: string, lng: number, lat: number, rest: Partial<MapPoint> = {}): MapPoint => ({ id, lng, lat, ...rest });

describe('pointFeatures', () => {
  it('makes [lng, lat] features carrying the photo count, muting and selection', () => {
    const [a, b] = pointFeatures([pt('a', 120.1, 30.2, { count: 4 }), pt('b', 121, 31, { muted: true, selected: true })]);
    expect(a.geometry.coordinates).toEqual([120.1, 30.2]);
    expect(a.properties).toEqual({ pid: 'a', n: 4, live: 1, sel: 0 });
    expect(b.properties).toEqual({ pid: 'b', n: 1, live: 0, sel: 1 });
  });

  it('counts a point without a count as one photo, and keeps a count of zero', () => {
    const [plain, empty] = pointFeatures([pt('a', 0, 0), pt('b', 0, 0, { count: 0 })]);
    expect(plain.properties.n).toBe(1);
    expect(empty.properties.n).toBe(0);
  });

  it('keeps every point, selected or not, so clusters stay the same when the selection moves', () => {
    expect(pointFeatures([pt('a', 1, 1, { selected: true }), pt('b', 2, 2)])).toHaveLength(2);
  });
});

describe('sameFeatures', () => {
  const base = () => pointFeatures([pt('a', 120.1, 30.2, { count: 4 }), pt('b', 121, 31)]);

  it('is true for equal data, however it was built', () => {
    expect(sameFeatures(base(), base())).toBe(true);
    expect(sameFeatures([], [])).toBe(true);
  });

  it('notices a change of count, muting, selection, position or length', () => {
    const change = (i: number, edit: (p: MapPoint) => MapPoint) =>
      pointFeatures([pt('a', 120.1, 30.2, { count: 4 }), pt('b', 121, 31)].map((p, k) => (k === i ? edit(p) : p)));
    expect(
      sameFeatures(
        base(),
        change(0, (p) => ({ ...p, count: 5 }))
      )
    ).toBe(false);
    expect(
      sameFeatures(
        base(),
        change(1, (p) => ({ ...p, muted: true }))
      )
    ).toBe(false);
    expect(
      sameFeatures(
        base(),
        change(1, (p) => ({ ...p, selected: true }))
      )
    ).toBe(false);
    expect(
      sameFeatures(
        base(),
        change(0, (p) => ({ ...p, lat: 30.3 }))
      )
    ).toBe(false);
    expect(
      sameFeatures(
        base(),
        change(0, (p) => ({ ...p, lng: 120.2 }))
      )
    ).toBe(false);
    expect(sameFeatures(base(), base().slice(1))).toBe(false);
  });

  it('ignores what is not clustering input (label, handler)', () => {
    const a = pointFeatures([pt('a', 1, 2, { label: 'x', onClick: () => {} })]);
    const b = pointFeatures([pt('a', 1, 2, { label: 'y' })]);
    expect(sameFeatures(a, b)).toBe(true);
  });
});

describe('inBox', () => {
  const box: [number, number, number, number] = [119, 29, 121, 31];

  it('tests longitude and latitude', () => {
    expect(inBox(box, 120, 30)).toBe(true);
    expect(inBox(box, 118.9, 30)).toBe(false);
    expect(inBox(box, 120, 31.1)).toBe(false);
    expect(inBox(box, 120, 28.9)).toBe(false);
  });

  it('knows the map repeats: a box past the date line holds points written the other way round', () => {
    const east: [number, number, number, number] = [179, -18, 181.5, -16];
    expect(inBox(east, -179.9, -17)).toBe(true); // 180.1
    expect(inBox(east, 179.5, -17)).toBe(true);
    expect(inBox(east, -170, -17)).toBe(false);
    const west: [number, number, number, number] = [-181.5, -18, -179, -16];
    expect(inBox(west, 179.9, -17)).toBe(true); // -180.1
  });

  it('takes everything when the view spans the world', () => {
    expect(inBox([-200, -80, 200, 80], 50, 10)).toBe(true);
    expect(inBox([-200, -80, 200, 80], 50, 85)).toBe(false);
  });
});

describe('clusterKey', () => {
  it('is the same for a cluster seen from both world copies', () => {
    expect(clusterKey(180.133, -17.133)).toBe(clusterKey(-179.867, -17.133));
    expect(clusterKey(180, 1)).toBe(clusterKey(-180, 1));
    expect(clusterKey(540.5, 3)).toBe(clusterKey(-179.5, 3));
  });

  it('differs for clusters in different places', () => {
    expect(clusterKey(120.1, 30.2)).not.toBe(clusterKey(120.1, 30.3));
    expect(clusterKey(120.1, 30.2)).not.toBe(clusterKey(120.2, 30.2));
  });

  it('shrugs off float noise far below a metre', () => {
    expect(clusterKey(120.1234500001, 30.2)).toBe(clusterKey(120.12345, 30.2));
  });
});
