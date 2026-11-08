import { describe, expect, it } from 'vite-plus/test';
import type { MatchCandidate } from '../../shared/types';
import { poi } from '../test-utils';
import {
  DEFAULT_RADIUS,
  MAX_RADIUS,
  MIN_RADIUS,
  choiceFromCandidate,
  choiceFromPoi,
  initialMatch,
  isPickable,
  placeFields,
  shouldAutoMatch
} from './match';

const candidate = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  key: 'osm:way/42',
  poiId: null,
  name: '湖心亭',
  category: '亭',
  lat: 30.2433,
  lng: 120.1399,
  distance: 120,
  bearing: 45,
  inView: false,
  score: 120,
  source: 'osm',
  sourceId: 'way/42',
  area: false,
  city: '杭州',
  district: '西湖区',
  ...over
});

describe('radius limits', () => {
  it('are the ones the documentation gives: 300 m by default, between 30 and 1000 m', () => {
    // docs/product/features/poi-matching.md
    expect(DEFAULT_RADIUS).toBe(300);
    expect(MIN_RADIUS).toBe(30);
    expect(MAX_RADIUS).toBe(1000);
  });

  it('start a fresh match at the default', () => {
    expect(initialMatch()).toEqual({ radius: 300, loading: false, error: null, res: null });
  });
});

describe('isPickable', () => {
  it('allows candidates within the radius, edge included', () => {
    expect(isPickable(candidate({ distance: 299.9 }), 300)).toBe(true);
    expect(isPickable(candidate({ distance: 300 }), 300)).toBe(true);
  });

  it('shows but does not allow candidates beyond it', () => {
    expect(isPickable(candidate({ distance: 300.1 }), 300)).toBe(false);
  });

  it('always allows an area the photo is inside, however far its centre', () => {
    expect(isPickable(candidate({ area: true, distance: 0 }), 30)).toBe(true);
    expect(isPickable(candidate({ area: true, distance: 5000 }), 30)).toBe(true);
  });
});

describe('shouldAutoMatch', () => {
  it('takes a candidate within 15 m on distance alone', () => {
    expect(shouldAutoMatch(candidate({ distance: 15, inView: false }))).toBe(true);
    expect(shouldAutoMatch(candidate({ distance: 0, inView: false }))).toBe(true);
  });

  it('takes one within 25 m when it is also in front of the camera', () => {
    expect(shouldAutoMatch(candidate({ distance: 25, inView: true }))).toBe(true);
    expect(shouldAutoMatch(candidate({ distance: 20, inView: true }))).toBe(true);
  });

  it('asks the user otherwise', () => {
    expect(shouldAutoMatch(candidate({ distance: 25, inView: false }))).toBe(false);
    expect(shouldAutoMatch(candidate({ distance: 15.1, inView: false }))).toBe(false);
    expect(shouldAutoMatch(candidate({ distance: 25.1, inView: true }))).toBe(false);
    expect(shouldAutoMatch(candidate({ distance: 100, inView: true }))).toBe(false);
  });

  it('has nothing to take without a candidate', () => {
    expect(shouldAutoMatch(undefined)).toBe(false);
  });
});

describe('choiceFromCandidate', () => {
  it('keeps a stored place as a reference to it, with nothing to create', () => {
    const choice = choiceFromCandidate(candidate({ key: 'poi_1', poiId: 'poi_1', source: 'local', sourceId: null }), 'auto');
    expect(choice).toMatchObject({ key: 'poi_1', poiId: 'poi_1', newPoi: null, method: 'auto', distance: 120 });
  });

  it('turns a provider place into a place to create on save', () => {
    const choice = choiceFromCandidate(candidate(), 'confirmed');
    expect(choice.poiId).toBeNull();
    expect(choice.newPoi).toEqual({
      name: '湖心亭',
      category: '亭',
      lat: 30.2433,
      lng: 120.1399,
      city: '杭州',
      district: '西湖区',
      source: 'osm',
      sourceId: 'way/42'
    });
    expect(choice.method).toBe('confirmed');
  });

  it('records the distance as 0 for an area the photo is inside, and keeps the flags for display', () => {
    expect(choiceFromCandidate(candidate({ area: true, distance: 0 }), 'auto')).toMatchObject({ distance: 0, area: true });
    expect(choiceFromCandidate(candidate({ inView: true }), 'auto')).toMatchObject({ inView: true, area: false });
  });

  it('files a local place without a stored id under the custom source', () => {
    expect(choiceFromCandidate(candidate({ source: 'local', poiId: null, sourceId: null }), 'manual').newPoi).toMatchObject({
      source: 'custom',
      sourceId: null
    });
  });
});

describe('choiceFromPoi', () => {
  it('describes a stored place', () => {
    expect(choiceFromPoi(poi('poi_1'), 'manual')).toEqual({
      key: 'poi_1',
      poiId: 'poi_1',
      newPoi: null,
      name: '断桥',
      category: '桥',
      lat: 30.2589,
      lng: 120.1494,
      city: '杭州',
      district: '西湖区',
      method: 'manual',
      distance: null
    });
  });

  it('measures the distance from the photo, to whole metres, when it knows where the photo is', () => {
    // about 3 km apart
    const choice = choiceFromPoi(poi('poi_1'), 'inferred', { lat: 30.2316, lng: 120.1485 });
    expect(choice.distance).toBe(Math.round(choice.distance as number));
    expect(choice.distance).toBeGreaterThan(3000);
    expect(choice.distance).toBeLessThan(3100);
    expect(choice.method).toBe('inferred');
  });

  it('has no distance for a photo without a position', () => {
    expect(choiceFromPoi(poi('poi_1'), 'manual', null).distance).toBeNull();
    expect(choiceFromPoi(poi('poi_1'), 'manual', undefined).distance).toBeNull();
  });
});

describe('placeFields', () => {
  it('clears the place when none is chosen', () => {
    expect(placeFields(null)).toEqual({ poiId: null, newPoi: null, poiDistance: null, poiMethod: null });
  });

  it('refers to a stored place by id, without a copy to create', () => {
    const choice = choiceFromPoi(poi('poi_1'), 'confirmed', { lat: 30.2589, lng: 120.1494 });
    expect(placeFields(choice)).toEqual({ poiId: 'poi_1', newPoi: null, poiDistance: 0, poiMethod: 'confirmed' });
  });

  it('sends a provider place to be created, rounding its distance', () => {
    const choice = choiceFromCandidate(candidate({ distance: 42.6 }), 'auto');
    expect(placeFields(choice)).toMatchObject({ poiId: null, poiDistance: 43, poiMethod: 'auto' });
    expect(placeFields(choice).newPoi).toMatchObject({ name: '湖心亭', source: 'osm', sourceId: 'way/42' });
  });

  it('never sends both a stored id and a place to create', () => {
    const both = { ...choiceFromCandidate(candidate(), 'manual'), poiId: 'poi_9' };
    const fields = placeFields(both);
    expect(fields.poiId).toBe('poi_9');
    expect(fields.newPoi).toBeNull();
  });

  it('sends no distance when it is unknown', () => {
    expect(placeFields(choiceFromPoi(poi('poi_1'), 'manual')).poiDistance).toBeNull();
  });
});
