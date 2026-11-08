import { describe, expect, it } from 'vite-plus/test';
import { CATEGORY_RADIUS } from '../../shared/geo';
import { POI_LIMITS, type PoiDetail } from '../../shared/types';
import { RADIUS_STOPS, aliasesOf, diffDraft, draftOf, nearestStop, parseRadius, problemsOf, splitAliases } from './place-draft';

const poi = (over: Partial<PoiDetail> = {}): PoiDetail => ({
  id: 'poi_x',
  name: '断桥',
  category: '桥',
  city: '杭州',
  district: '西湖区',
  lat: 30.2593,
  lng: 120.15161,
  radius: 60,
  source: 'custom',
  sourceId: null,
  canEdit: true,
  aliases: ['白堤口'],
  ...over
});

describe('radius', () => {
  it('only takes numbers within the range the API accepts', () => {
    expect(parseRadius('60')).toBe(60);
    expect(parseRadius(' 120 ')).toBe(120);
    expect(parseRadius('85.5')).toBe(85.5);
    expect(parseRadius(String(POI_LIMITS.radiusMin))).toBe(POI_LIMITS.radiusMin);
    expect(parseRadius(String(POI_LIMITS.radiusMax))).toBe(POI_LIMITS.radiusMax);
    for (const bad of ['', 'abc', '9', '5001', '-60', '1e3', '12 m', '0x10']) expect(parseRadius(bad)).toBeNull();
  });

  it('has a slider stop for the default radius of every category, within the limits', () => {
    for (const r of Object.values(CATEGORY_RADIUS)) expect(RADIUS_STOPS).toContain(r);
    expect(RADIUS_STOPS[0]).toBe(POI_LIMITS.radiusMin);
    expect(RADIUS_STOPS.at(-1)).toBe(POI_LIMITS.radiusMax);
    expect([...RADIUS_STOPS].sort((a, b) => a - b)).toEqual([...RADIUS_STOPS]);
  });

  it('puts the slider on the nearest stop by ratio', () => {
    expect(RADIUS_STOPS[nearestStop(60)]).toBe(60);
    expect(RADIUS_STOPS[nearestStop(10)]).toBe(10);
    expect(RADIUS_STOPS[nearestStop(5000)]).toBe(5000);
    // halfway between 60 and 80 by ratio is about 69
    expect(RADIUS_STOPS[nearestStop(65)]).toBe(60);
    expect(RADIUS_STOPS[nearestStop(70)]).toBe(80);
    expect(RADIUS_STOPS[nearestStop(1200)]).toBe(1000);
  });
});

describe('aliases', () => {
  it('splits on the separators the server splits on', () => {
    expect(splitAliases('断桥残雪、白堤口, 段桥；里湖\n孤山路，')).toEqual(['断桥残雪', '白堤口', '段桥', '里湖', '孤山路']);
    expect(splitAliases('  ,、 ')).toEqual([]);
  });

  it('counts what is still in the box as an alias, without repeating one that is already there', () => {
    const d = { ...draftOf(poi()), aliasText: '白堤口、段桥' };
    expect(aliasesOf(d)).toEqual(['白堤口', '段桥']);
  });

  it('reads a list with repeats as one alias each', () => {
    expect(draftOf(poi({ aliases: ['a', 'a', 'b'] })).aliases).toEqual(['a', 'b']);
    expect(draftOf(poi({ aliases: undefined })).aliases).toEqual([]);
  });
});

describe('diffDraft', () => {
  const base = draftOf(poi());

  it('is empty for an untouched form, and for spacing around the name', () => {
    expect(diffDraft(base, base)).toEqual({});
    expect(diffDraft(base, { ...base, name: '  断桥 ' })).toEqual({});
  });

  it('sends only what changed', () => {
    expect(diffDraft(base, { ...base, name: '断桥残雪' })).toEqual({ name: '断桥残雪' });
    expect(diffDraft(base, { ...base, category: '堤' })).toEqual({ category: '堤' });
    expect(diffDraft(base, { ...base, radius: '120' })).toEqual({ radius: 120 });
    expect(diffDraft(base, { ...base, aliases: [] })).toEqual({ aliases: [] });
    expect(diffDraft(base, { ...base, aliasText: '段桥' })).toEqual({ aliases: ['白堤口', '段桥'] });
  });

  it('leaves an unreadable radius out; the form refuses to send it', () => {
    expect(diffDraft(base, { ...base, radius: 'abc' })).toEqual({});
    expect(problemsOf({ ...base, radius: 'abc' }).radius).toMatch(/10.*5000/);
  });
});

describe('problemsOf', () => {
  const base = draftOf(poi());

  it('accepts a saved place', () => {
    expect(problemsOf(base)).toEqual({});
  });

  it('refuses what the server would refuse', () => {
    expect(problemsOf({ ...base, name: '   ' }).name).toBeDefined();
    expect(problemsOf({ ...base, name: '长'.repeat(POI_LIMITS.nameMax + 1) }).name).toBeDefined();
    expect(problemsOf({ ...base, name: '长'.repeat(POI_LIMITS.nameMax) }).name).toBeUndefined();
    // the server counts characters, not UTF-16 units: 80 emoji are fine
    expect(problemsOf({ ...base, name: '🌉'.repeat(POI_LIMITS.nameMax) }).name).toBeUndefined();
    const many = Array.from({ length: POI_LIMITS.aliasCount + 1 }, (_, i) => `别名${i}`);
    expect(problemsOf({ ...base, aliases: many }).aliases).toBeDefined();
    expect(problemsOf({ ...base, aliases: many.slice(0, POI_LIMITS.aliasCount) }).aliases).toBeUndefined();
    expect(problemsOf({ ...base, aliases: many.slice(0, POI_LIMITS.aliasCount), aliasText: '多一个' }).aliases).toBeDefined();
  });
});
