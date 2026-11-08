import { describe, expect, it } from 'vite-plus/test';
import { fmtCount, inBox, phase } from './mapAlbums';

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

describe('phase', () => {
  it('is the same for the same album and within the period', () => {
    expect(phase('ct:浙江,杭州')).toBe(phase('ct:浙江,杭州'));
    for (const key of ['pv:浙江', 'ct:浙江,杭州', 'pl:poi_1', 'ph:ph_1', '']) {
      expect(phase(key, 1000)).toBeGreaterThanOrEqual(0);
      expect(phase(key, 1000)).toBeLessThan(1000);
    }
  });

  it('spreads neighbouring albums over the period', () => {
    const phases = new Set(Array.from({ length: 50 }, (_, i) => Math.floor(phase(`pl:poi_${i}`, 1000) / 100)));
    expect(phases.size).toBeGreaterThanOrEqual(6);
  });
});

describe('fmtCount', () => {
  it('groups thousands like the captions in the design', () => {
    expect(fmtCount(0)).toBe('0');
    expect(fmtCount(486)).toBe('486');
    expect(fmtCount(1260)).toBe('1,260');
  });
});
