import { describe, expect, it } from 'vite-plus/test';
import { fitViewport, type MapViewport } from './mapfit';

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** Where a [lat, lng] lands, in pixels, on a map of `size` showing `view` (MapLibre: the world is 512·2^zoom px wide). */
function project(point: readonly [number, number], view: MapViewport, size: { w: number; h: number }) {
  const world = 512 * 2 ** view.zoom;
  return {
    x: size.w / 2 + ((point[1] - view.center[1]) / 360) * world,
    y: size.h / 2 - ((mercY(point[0]) - mercY(view.center[0])) / (2 * Math.PI)) * world
  };
}

const SIZE = { w: 800, h: 600 };
const HANGZHOU: [number, number][] = [
  [30.2589, 120.1494],
  [30.2316, 120.1485],
  [30.2433, 120.1399],
  [30.2701, 120.1655]
];

describe('fitViewport', () => {
  it('has nothing to show without points', () => {
    expect(fitViewport([], SIZE)).toBeNull();
  });

  it('centres a single point at the single-point zoom', () => {
    expect(fitViewport([[30.25, 120.14]], SIZE)).toEqual({ center: [30.25, 120.14], zoom: 15 });
    expect(fitViewport([[30.25, 120.14]], SIZE, { singleZoom: 12 })?.zoom).toBe(12);
  });

  it('treats several identical points as one', () => {
    expect(
      fitViewport(
        [
          [30.25, 120.14],
          [30.25, 120.14]
        ],
        SIZE
      )
    ).toEqual({ center: [30.25, 120.14], zoom: 15 });
  });

  it('keeps every point inside the box, clear of the padding', () => {
    for (const points of [
      HANGZHOU,
      [
        [30.2, 120.1],
        [31.2, 121.5]
      ] as [number, number][],
      [
        [-33.9, 151.2],
        [35.7, 139.7],
        [51.5, -0.1]
      ] as [number, number][]
    ]) {
      const view = fitViewport(points, SIZE);
      expect(view).not.toBeNull();
      for (const point of points) {
        const { x, y } = project(point, view as MapViewport, SIZE);
        expect(x, `${point.join(',')} x`).toBeGreaterThanOrEqual(56 - 0.5);
        expect(x, `${point.join(',')} x`).toBeLessThanOrEqual(SIZE.w - 56 + 0.5);
        expect(y, `${point.join(',')} y`).toBeGreaterThanOrEqual(56 - 0.5);
        expect(y, `${point.join(',')} y`).toBeLessThanOrEqual(SIZE.h - 56 + 0.5);
      }
    }
  });

  it('zooms in as far as the tighter side allows', () => {
    // a wide, flat spread: the width is the limit, so the extreme points touch the padding left and right
    const points: [number, number][] = [
      [30.25, 120.0],
      [30.25, 120.4]
    ];
    const view = fitViewport(points, SIZE, { maxZoom: 20 }) as MapViewport;
    const left = project(points[0], view, SIZE).x;
    const right = project(points[1], view, SIZE).x;
    expect(left).toBeCloseTo(56, 3);
    expect(right).toBeCloseTo(SIZE.w - 56, 3);
    // a tall spread: now the height is the limit
    const tall: [number, number][] = [
      [30.0, 120.25],
      [30.4, 120.25]
    ];
    const tallView = fitViewport(tall, SIZE, { maxZoom: 20 }) as MapViewport;
    expect(project(tall[0], tallView, SIZE).y).toBeCloseTo(SIZE.h - 56, 3);
    expect(project(tall[1], tallView, SIZE).y).toBeCloseTo(56, 3);
  });

  it('centres the points in the box', () => {
    const view = fitViewport(HANGZHOU, SIZE) as MapViewport;
    const xs = HANGZHOU.map((p) => project(p, view, SIZE).x);
    const ys = HANGZHOU.map((p) => project(p, view, SIZE).y);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(SIZE.w / 2, 3);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(SIZE.h / 2, 3);
  });

  it('zooms out as the points spread further apart', () => {
    const zooms = [0.002, 0.02, 0.2, 2, 20].map(
      (d) =>
        (
          fitViewport(
            [
              [30, 120],
              [30 + d, 120 + d]
            ],
            SIZE,
            { maxZoom: 22 }
          ) as MapViewport
        ).zoom
    );
    for (let i = 1; i < zooms.length; i++) expect(zooms[i], `step ${i}`).toBeLessThan(zooms[i - 1]);
  });

  it('never zooms in past the cap, however close the points', () => {
    expect(
      (
        fitViewport(
          [
            [30.25, 120.14],
            [30.250001, 120.140001]
          ],
          SIZE
        ) as MapViewport
      ).zoom
    ).toBe(16);
    expect(
      (
        fitViewport(
          [
            [30.25, 120.14],
            [30.250001, 120.140001]
          ],
          SIZE,
          { maxZoom: 12 }
        ) as MapViewport
      ).zoom
    ).toBe(12);
  });

  it('never zooms out past 1, even for points across the world', () => {
    const view = fitViewport(
      [
        [-60, -170],
        [60, 170]
      ],
      { w: 300, h: 200 }
    ) as MapViewport;
    expect(view.zoom).toBe(1);
  });

  it('copes with points in a straight line', () => {
    const horizontal = fitViewport(
      [
        [30.25, 120.1],
        [30.25, 120.2]
      ],
      SIZE
    ) as MapViewport;
    const vertical = fitViewport(
      [
        [30.2, 120.14],
        [30.3, 120.14]
      ],
      SIZE
    ) as MapViewport;
    expect(Number.isFinite(horizontal.zoom)).toBe(true);
    expect(Number.isFinite(vertical.zoom)).toBe(true);
    expect(horizontal.center[0]).toBeCloseTo(30.25, 6);
    expect(vertical.center[1]).toBeCloseTo(120.14, 9);
  });

  it('takes the padding from the options', () => {
    const tight = fitViewport(HANGZHOU, SIZE, { padding: 0 }) as MapViewport;
    const loose = fitViewport(HANGZHOU, SIZE, { padding: 150 }) as MapViewport;
    expect(tight.zoom).toBeGreaterThan(loose.zoom);
  });

  it('keeps a strip on the right free for labels, shifting the view east and zooming out a little', () => {
    const points: [number, number][] = [
      [30.2, 120.0],
      [30.3, 120.3]
    ];
    const plain = fitViewport(points, SIZE) as MapViewport;
    const reserved = fitViewport(points, SIZE, { right: 200 }) as MapViewport;
    expect(reserved.zoom).toBeLessThan(plain.zoom);
    expect(reserved.center[1]).toBeGreaterThan(plain.center[1] - 1e-9);
    for (const point of points) {
      const { x } = project(point, reserved, SIZE);
      expect(x).toBeLessThanOrEqual(SIZE.w - 56 - 200 + 0.5);
    }
  });

  it('gives a very small box a usable minimum area instead of a negative one', () => {
    const view = fitViewport(HANGZHOU, { w: 100, h: 100 }) as MapViewport;
    expect(Number.isFinite(view.zoom)).toBe(true);
    expect(view.zoom).toBeGreaterThanOrEqual(1);
  });
});
