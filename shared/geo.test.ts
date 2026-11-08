import { describe, expect, it } from 'vite-plus/test';
import {
  CATEGORY_RADIUS,
  angleDiff,
  bearing,
  circleRing,
  compass,
  coneRing,
  destination,
  distance,
  dms,
  fmtDistance,
  fmtLat,
  fmtLng,
  fuzz,
  gcj02ToWgs84,
  outOfChina,
  wgs84ToGcj02
} from './geo';
import { POI_CATEGORIES } from './types';

// West Lake, Hangzhou (WGS-84): the Broken Bridge on the north shore, Leifeng Pagoda on the south shore.
const BROKEN_BRIDGE = { lat: 30.2589, lng: 120.1494 };
const LEIFENG = { lat: 30.2316, lng: 120.1485 };

/**
 * Flat-earth distance and bearing between two nearby points. Accurate to centimetres over a few kilometres
 * and written independently of the haversine code, so it can serve as an oracle for it.
 */
function flat(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_000;
  const k = Math.PI / 180;
  const north = (b.lat - a.lat) * k * R;
  const east = (b.lng - a.lng) * k * R * Math.cos(((a.lat + b.lat) / 2) * k);
  return { meters: Math.hypot(north, east), bearing: (Math.atan2(east, north) / k + 360) % 360 };
}

describe('distance', () => {
  it('is zero for identical points and symmetric', () => {
    expect(distance(30.25, 120.14, 30.25, 120.14)).toBe(0);
    expect(distance(30.2589, 120.1494, 30.2316, 120.1485)).toBeCloseTo(distance(30.2316, 120.1485, 30.2589, 120.1494), 9);
  });

  it('agrees with a flat-earth estimate across West Lake', () => {
    const d = distance(BROKEN_BRIDGE.lat, BROKEN_BRIDGE.lng, LEIFENG.lat, LEIFENG.lng);
    expect(Math.abs(d - flat(BROKEN_BRIDGE, LEIFENG).meters)).toBeLessThan(0.5);
    // about three kilometres from shore to shore
    expect(d).toBeGreaterThan(3000);
    expect(d).toBeLessThan(3100);
  });

  it('matches textbook great-circle figures', () => {
    const within = (actual: number, expected: number, relative: number) => Math.abs(actual - expected) / expected < relative;
    // a degree of latitude is 111.2 km everywhere; a degree of longitude shrinks with cos(latitude)
    expect(within(distance(0, 0, 1, 0), 111_200, 0.001)).toBe(true);
    expect(within(distance(45, 10, 46, 10), 111_200, 0.001)).toBe(true);
    expect(within(distance(60, 0, 60, 1), 111_200 / 2, 0.001)).toBe(true);
    // Beijing to Shanghai is about 1,068 km as the crow flies
    expect(within(distance(39.9042, 116.4074, 31.2304, 121.4737), 1_068_000, 0.005)).toBe(true);
    // a quarter meridian is a quarter of the 40,030 km circumference
    expect(within(distance(0, 0, 90, 0), 10_007_500, 0.001)).toBe(true);
  });

  it('stays finite for antipodal points', () => {
    const half = distance(0, 0, 0, 180);
    expect(Number.isFinite(half)).toBe(true);
    expect(half / 1000).toBeCloseTo(20_015.1, 0);
    expect(distance(58, 10, -58, -170)).toBeCloseTo(half, 3);
  });
});

describe('bearing', () => {
  it('points along the cardinal directions', () => {
    expect(bearing(0, 0, 1, 0)).toBeCloseTo(0, 9);
    expect(bearing(0, 0, 0, 1)).toBeCloseTo(90, 9);
    expect(bearing(0, 0, -1, 0)).toBeCloseTo(180, 9);
    expect(bearing(0, 0, 0, -1)).toBeCloseTo(270, 9);
    expect(bearing(0, 0, 1, 1)).toBeCloseTo(45, 1);
  });

  it('agrees with a flat-earth estimate across West Lake', () => {
    const b = bearing(BROKEN_BRIDGE.lat, BROKEN_BRIDGE.lng, LEIFENG.lat, LEIFENG.lng);
    expect(Math.abs(b - flat(BROKEN_BRIDGE, LEIFENG).bearing)).toBeLessThan(0.01);
    // the pagoda lies just west of due south of the bridge
    expect(b).toBeGreaterThan(180);
    expect(b).toBeLessThan(183);
  });

  it('flips by 180 degrees on a short reverse hop', () => {
    const forward = bearing(BROKEN_BRIDGE.lat, BROKEN_BRIDGE.lng, LEIFENG.lat, LEIFENG.lng);
    const back = bearing(LEIFENG.lat, LEIFENG.lng, BROKEN_BRIDGE.lat, BROKEN_BRIDGE.lng);
    expect(angleDiff(forward, back)).toBeCloseTo(180, 2);
  });

  it('always lies in [0, 360)', () => {
    for (let lat = -80; lat <= 80; lat += 20) {
      for (let lng = -170; lng <= 170; lng += 34) {
        for (const [dLat, dLng] of [
          [0.01, 0],
          [-0.01, 0],
          [0, 0.01],
          [0, -0.01],
          [0.01, -0.01],
          [-0.01, 0.01]
        ]) {
          const b = bearing(lat, lng, lat + dLat, lng + dLng);
          expect(b).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThan(360);
        }
      }
    }
  });
});

describe('angleDiff', () => {
  it('wraps around north', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(0, 359)).toBe(1);
    expect(angleDiff(1, 359)).toBe(2);
  });

  it('is 0 for equal headings and 180 for opposite ones', () => {
    expect(angleDiff(90, 90)).toBe(0);
    expect(angleDiff(0, 180)).toBe(180);
    expect(angleDiff(270, 90)).toBe(180);
  });

  it('equals the shorter way round the compass for every pair of headings', () => {
    const wrong: string[] = [];
    for (let a = 0; a < 360; a += 5) {
      for (let b = 0; b < 360; b += 5) {
        const straight = Math.abs(a - b);
        const expected = Math.min(straight, 360 - straight);
        if (angleDiff(a, b) !== expected || angleDiff(b, a) !== expected) wrong.push(`${a},${b}: ${angleDiff(a, b)} ≠ ${expected}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('destination', () => {
  it('moves due north and due east by the expected angle', () => {
    // 1 km is about 0.008993 degrees of latitude
    const [lat, lng] = destination(30, 120, 0, 1000);
    expect(lat).toBeCloseTo(30.008993, 5);
    expect(lng).toBeCloseTo(120, 9);
    const [eastLat, eastLng] = destination(30, 120, 90, 1000);
    expect(eastLat).toBeCloseTo(30, 5);
    // a degree of longitude at 30N is cos(30) of an equatorial one
    expect(eastLng).toBeCloseTo(120 + 0.008993 / Math.cos((30 * Math.PI) / 180), 5);
  });

  it('returns the start for a zero distance', () => {
    const [lat, lng] = destination(30.25, 120.14, 77, 0);
    expect(lat).toBeCloseTo(30.25, 12);
    expect(lng).toBeCloseTo(120.14, 12);
  });

  it('is consistent with distance and bearing', () => {
    const origin = { lat: 30.25, lng: 120.14 };
    for (const brg of [0, 30, 90, 135, 180, 225, 270, 315, 359]) {
      for (const meters of [10, 500, 12_345, 400_000]) {
        const [lat, lng] = destination(origin.lat, origin.lng, brg, meters);
        expect(Math.abs(distance(origin.lat, origin.lng, lat, lng) - meters) / meters).toBeLessThan(1e-9);
        expect(angleDiff(bearing(origin.lat, origin.lng, lat, lng), brg)).toBeLessThan(1e-4);
      }
    }
  });

  it('wraps longitude across the antimeridian', () => {
    const [lat, east] = destination(0, 179.9, 90, 50_000);
    expect(lat).toBeCloseTo(0, 9);
    expect(east).toBeCloseTo(-179.65, 2);
    const [, west] = destination(0, -179.9, 270, 50_000);
    expect(west).toBeCloseTo(179.65, 2);
  });
});

describe('circleRing', () => {
  const center = { lat: 30.25, lng: 120.14 };
  const pointAt = ([lng, lat]: [number, number]) => ({ lat, lng });

  it('has steps + 1 vertices in [lng, lat] order and closes on its first vertex', () => {
    const ring = circleRing(center.lat, center.lng, 500);
    expect(ring).toHaveLength(49);
    // vertex 0 is due north of the centre, so lng is unchanged and lat is larger
    expect(ring[0][0]).toBeCloseTo(center.lng, 9);
    expect(ring[0][1]).toBeGreaterThan(center.lat);
    expect(ring[48][0]).toBeCloseTo(ring[0][0], 9);
    expect(ring[48][1]).toBeCloseTo(ring[0][1], 9);
    expect(circleRing(center.lat, center.lng, 500, 8)).toHaveLength(9);
  });

  it('puts every vertex at the radius, evenly spaced in bearing', () => {
    const steps = 12;
    const ring = circleRing(center.lat, center.lng, 800, steps);
    ring.forEach((vertex, i) => {
      const p = pointAt(vertex);
      expect(distance(center.lat, center.lng, p.lat, p.lng)).toBeCloseTo(800, 4);
      expect(angleDiff(bearing(center.lat, center.lng, p.lat, p.lng), (360 * i) / steps)).toBeLessThan(1e-4);
    });
  });
});

describe('coneRing', () => {
  const apex = { lat: 30.25, lng: 120.14 };

  it('starts and ends at the apex with an arc in between', () => {
    const ring = coneRing(apex.lat, apex.lng, 90, 100);
    // apex + (steps + 1) arc vertices + apex
    expect(ring).toHaveLength(15);
    expect(ring[0]).toEqual([apex.lng, apex.lat]);
    expect(ring[ring.length - 1]).toEqual([apex.lng, apex.lat]);
  });

  it('spans heading ± spread at the given range, evenly', () => {
    const ring = coneRing(apex.lat, apex.lng, 90, 100);
    const arc = ring.slice(1, -1);
    expect(arc).toHaveLength(13);
    arc.forEach(([lng, lat], i) => {
      expect(distance(apex.lat, apex.lng, lat, lng)).toBeCloseTo(100, 4);
      // default spread is 28 degrees either side, 12 steps
      const expected = 90 - 28 + (2 * 28 * i) / 12;
      expect(angleDiff(bearing(apex.lat, apex.lng, lat, lng), expected)).toBeLessThan(1e-3);
    });
  });

  it('honours custom spread and steps, and wraps a heading near north', () => {
    const ring = coneRing(apex.lat, apex.lng, 5, 60, 20, 4);
    expect(ring).toHaveLength(4 + 3);
    const arc = ring.slice(1, -1);
    arc.forEach(([lng, lat], i) => {
      expect(angleDiff(bearing(apex.lat, apex.lng, lat, lng), 5 - 20 + (2 * 20 * i) / 4)).toBeLessThan(1e-3);
    });
  });
});

describe('fuzz', () => {
  it('rounds to the nearest 0.005 degrees', () => {
    expect(fuzz(30.25912)).toBeCloseTo(30.26, 9);
    expect(fuzz(120.13878)).toBeCloseTo(120.14, 9);
    expect(fuzz(-33.8688)).toBeCloseTo(-33.87, 9);
    expect(fuzz(151.2093)).toBeCloseTo(151.21, 9);
    expect(fuzz(30.2626)).toBeCloseTo(30.265, 9);
  });

  it('maps every point of a grid cell to the same value', () => {
    // 30.26 ± 0.0025
    expect(fuzz(30.2576)).toBeCloseTo(30.26, 9);
    expect(fuzz(30.2601)).toBeCloseTo(30.26, 9);
    expect(fuzz(30.2624)).toBeCloseTo(30.26, 9);
    expect(fuzz(30.2576)).not.toBeCloseTo(fuzz(30.2574), 3);
  });

  it('never moves a coordinate by more than half a cell, and lands on the 0.005 grid', () => {
    const wrong: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      const v = -180 + i * 0.01801;
      const cells = fuzz(v) / 0.005;
      if (Math.abs(fuzz(v) - v) > 0.0025 + 1e-9) wrong.push(`${v} moved by ${Math.abs(fuzz(v) - v)}`);
      if (Math.abs(cells - Math.round(cells)) > 1e-6) wrong.push(`${v} → ${fuzz(v)} is off the grid`);
    }
    expect(wrong).toEqual([]);
  });

  it('is idempotent', () => {
    for (const v of [30.25912, 120.13878, -33.8688, 0.0026, 179.9999]) {
      expect(fuzz(fuzz(v))).toBeCloseTo(fuzz(v), 9);
    }
  });

  it('blurs to roughly 500 m at Hangzhou', () => {
    const lat = 30.26;
    const lng = 120.14;
    const cellNorth = distance(lat, lng, lat + 0.005, lng);
    const cellEast = distance(lat, lng, lat, lng + 0.005);
    expect(cellNorth).toBeGreaterThan(500);
    expect(cellNorth).toBeLessThan(600);
    expect(cellEast).toBeGreaterThan(450);
    expect(cellEast).toBeLessThan(550);
  });
});

describe('outOfChina', () => {
  it('is false for places in China', () => {
    expect(outOfChina(30.259, 120.139)).toBe(false); // Hangzhou
    expect(outOfChina(39.9087, 116.3975)).toBe(false); // Beijing
    expect(outOfChina(43.8256, 87.6168)).toBe(false); // Urumqi
    expect(outOfChina(18.2528, 109.512)).toBe(false); // Sanya
    expect(outOfChina(53.4753, 122.3382)).toBe(false); // Mohe
  });

  it('is true for places abroad', () => {
    expect(outOfChina(35.6762, 139.6503)).toBe(true); // Tokyo
    expect(outOfChina(51.5074, -0.1278)).toBe(true); // London
    expect(outOfChina(40.7128, -74.006)).toBe(true); // New York
    expect(outOfChina(-33.8688, 151.2093)).toBe(true); // Sydney
    expect(outOfChina(0, 0)).toBe(true);
  });

  it('uses the documented bounding box, edges included', () => {
    expect(outOfChina(40, 72.004)).toBe(false);
    expect(outOfChina(40, 72.0039)).toBe(true);
    expect(outOfChina(40, 137.8347)).toBe(false);
    expect(outOfChina(40, 137.8348)).toBe(true);
    expect(outOfChina(0.8293, 100)).toBe(false);
    expect(outOfChina(0.8292, 100)).toBe(true);
    expect(outOfChina(55.8271, 100)).toBe(false);
    expect(outOfChina(55.8272, 100)).toBe(true);
  });
});

describe('WGS-84 / GCJ-02', () => {
  const cities: [string, number, number][] = [
    ['Hangzhou', 30.259, 120.1388],
    ['Beijing', 39.9087, 116.3975],
    ['Shanghai', 31.24, 121.49],
    ['Chengdu', 30.5728, 104.0668],
    ['Urumqi', 43.8256, 87.6168],
    ['Harbin', 45.8038, 126.5349],
    ['Kunming', 25.0389, 102.7183],
    ['Lhasa', 29.65, 91.1],
    ['Sanya', 18.2528, 109.512]
  ];

  it('reproduces a published reference vector', () => {
    // The widely used `eviltransform` test case (Pudong, Shanghai).
    const [lat, lng] = wgs84ToGcj02(31.1774276, 121.5272106);
    expect(lat).toBeCloseTo(31.17530398364597, 10);
    expect(lng).toBeCloseTo(121.531541859215, 10);
    const [wLat, wLng] = gcj02ToWgs84(31.17530398364597, 121.531541859215);
    expect(wLat).toBeCloseTo(31.1774276, 9);
    expect(wLng).toBeCloseTo(121.5272106, 9);
  });

  it('shifts points inside China by a few hundred metres', () => {
    for (const [name, lat, lng] of cities) {
      const [gLat, gLng] = wgs84ToGcj02(lat, lng);
      const shift = distance(lat, lng, gLat, gLng);
      expect(shift, name).toBeGreaterThan(100);
      expect(shift, name).toBeLessThan(800);
    }
  });

  it('round-trips WGS-84 → GCJ-02 → WGS-84 to well under a metre', () => {
    for (const [name, lat, lng] of cities) {
      const [gLat, gLng] = wgs84ToGcj02(lat, lng);
      const [wLat, wLng] = gcj02ToWgs84(gLat, gLng);
      expect(distance(lat, lng, wLat, wLng), name).toBeLessThan(0.01);
    }
  });

  it('round-trips GCJ-02 → WGS-84 → GCJ-02 as well', () => {
    for (const [name, lat, lng] of cities) {
      const [wLat, wLng] = gcj02ToWgs84(lat, lng);
      const [gLat, gLng] = wgs84ToGcj02(wLat, wLng);
      expect(distance(lat, lng, gLat, gLng), name).toBeLessThan(0.01);
    }
  });

  it('round-trips across a grid covering mainland China', () => {
    let worst = 0;
    for (let lat = 1; lat <= 55; lat += 2.3) {
      for (let lng = 73; lng <= 137; lng += 3.1) {
        const [gLat, gLng] = wgs84ToGcj02(lat, lng);
        const [wLat, wLng] = gcj02ToWgs84(gLat, gLng);
        worst = Math.max(worst, distance(lat, lng, wLat, wLng));
      }
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('leaves points outside China untouched', () => {
    for (const [lat, lng] of [
      [35.6762, 139.6503],
      [51.5074, -0.1278],
      [-33.8688, 151.2093],
      [40, 137.9],
      [40, 72]
    ] as const) {
      expect(wgs84ToGcj02(lat, lng)).toEqual([lat, lng]);
      expect(gcj02ToWgs84(lat, lng)).toEqual([lat, lng]);
    }
  });

  it('jumps at the bounding-box edge: inside it shifts, just outside it does not', () => {
    const [inLat, inLng] = wgs84ToGcj02(40, 137.8);
    expect(distance(40, 137.8, inLat, inLng)).toBeGreaterThan(300);
    expect(wgs84ToGcj02(40, 137.9)).toEqual([40, 137.9]);
  });
});

describe('dms / fmtLat / fmtLng', () => {
  it('formats degrees, minutes and seconds with a hemisphere letter', () => {
    expect(fmtLat(30.259167)).toBe('30°15′33″N');
    expect(fmtLng(120.1388)).toBe('120°08′20″E');
    expect(fmtLat(-33.8688)).toBe('33°52′08″S');
    expect(fmtLng(-0.1278)).toBe('0°07′40″W');
    expect(fmtLat(0)).toBe('0°00′00″N');
    expect(fmtLng(180)).toBe('180°00′00″E');
  });

  it('pads minutes and seconds to two digits', () => {
    expect(fmtLat(1.0175)).toBe('1°01′03″N');
    expect(dms(30.25, 'N', 'S')).toBe('30°15′00″N');
  });

  it('prints fractional seconds when asked', () => {
    expect(dms(30.259167, 'N', 'S', 1)).toBe('30°15′33.0″N');
    expect(dms(120.1388, 'E', 'W', 1)).toBe('120°08′19.7″E');
    expect(dms(120.1388, 'E', 'W', 2)).toBe('120°08′19.68″E');
    expect(dms(30.0010278, 'N', 'S', 2)).toBe('30°00′03.70″N');
  });

  it('carries a rounded-up second into the minute and degree instead of printing 60', () => {
    // 120.1 is exactly 120°06′00″; float noise used to turn it into 120°05′60″
    expect(fmtLng(120.1)).toBe('120°06′00″E');
    expect(fmtLat(30.1)).toBe('30°06′00″N');
    expect(fmtLat(30.99999)).toBe('31°00′00″N');
    expect(fmtLat(0.99999999)).toBe('1°00′00″N');
    expect(dms(29.9999999, 'N', 'S', 1)).toBe('30°00′00.0″N');
    expect(dms(30.9999, 'N', 'S', 1)).toBe('30°59′59.6″N');
    expect(dms(-119.9999999, 'E', 'W', 2)).toBe('120°00′00.00″W');
  });

  it('never prints 60 and stays within half a unit of the value, for every hundredth of a degree', () => {
    const pattern = /^(\d+)°(\d{2})′(\d{2}(?:\.\d+)?)″[NS]$/;
    const wrong: string[] = [];
    for (const digits of [0, 1, 2]) {
      const halfUnit = 0.5 / 3600 / 10 ** digits;
      for (let i = 0; i <= 18_000; i++) {
        const v = i / 100;
        const text = dms(v, 'N', 'S', digits);
        const m = pattern.exec(text);
        if (!m) {
          wrong.push(`${v}/${digits} → ${text} is malformed`);
          continue;
        }
        const [, d, min, sec] = m;
        if (+min >= 60 || +sec >= 60) wrong.push(`${v}/${digits} → ${text} has 60 in it`);
        else if (Math.abs(+d + +min / 60 + +sec / 3600 - v) > halfUnit + 1e-9) wrong.push(`${v}/${digits} → ${text} is off by too much`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('compass', () => {
  const winds: [number, string][] = [
    [0, '北'],
    [22.5, '北偏东'],
    [45, '东北'],
    [67.5, '东偏北'],
    [90, '东'],
    [112.5, '东偏南'],
    [135, '东南'],
    [157.5, '南偏东'],
    [180, '南'],
    [202.5, '南偏西'],
    [225, '西南'],
    [247.5, '西偏南'],
    [270, '西'],
    [292.5, '西偏北'],
    [315, '西北'],
    [337.5, '北偏西']
  ];

  it('names the 16 winds at their exact headings', () => {
    for (const [heading, name] of winds) expect(compass(heading), `${heading}°`).toBe(name);
  });

  it('gives each wind a 22.5 degree sector centred on it', () => {
    for (const [heading, name] of winds) {
      expect(compass(heading + 11), `${heading}° + 11`).toBe(name);
      expect(compass(heading - 11), `${heading}° - 11`).toBe(name);
    }
    expect(compass(11.26)).toBe('北偏东');
    expect(compass(348.74)).toBe('北偏西');
  });

  it('wraps headings outside 0..360', () => {
    expect(compass(359)).toBe('北');
    expect(compass(360)).toBe('北');
    expect(compass(-1)).toBe('北');
    expect(compass(-90)).toBe('西');
    expect(compass(450)).toBe('东');
    expect(compass(720 + 180)).toBe('南');
  });
});

describe('fmtDistance', () => {
  it('rounds to whole metres below a kilometre', () => {
    expect(fmtDistance(0)).toBe('0 m');
    expect(fmtDistance(31.6)).toBe('32 m');
    expect(fmtDistance(999)).toBe('999 m');
  });

  it('shows one decimal of a kilometre up to 10 km, then whole kilometres', () => {
    expect(fmtDistance(1000)).toBe('1.0 km');
    expect(fmtDistance(1234)).toBe('1.2 km');
    expect(fmtDistance(9400)).toBe('9.4 km');
    expect(fmtDistance(10_000)).toBe('10 km');
    expect(fmtDistance(12_345)).toBe('12 km');
  });
});

describe('CATEGORY_RADIUS', () => {
  it('has a positive radius for exactly the POI categories', () => {
    expect(Object.keys(CATEGORY_RADIUS).sort()).toEqual([...POI_CATEGORIES].sort());
    for (const radius of Object.values(CATEGORY_RADIUS)) expect(radius).toBeGreaterThan(0);
  });
});
