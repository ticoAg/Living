import { describe, expect, it, vi } from 'vite-plus/test';
import { destination } from '../../shared/geo';
import type { MatchCandidate, MatchResponse } from '../../shared/types';
import { poi } from '../test-utils';
import {
  FAR_SLACK,
  centreOf,
  choiceFor,
  ensureSaved,
  farLimit,
  isTooFar,
  mergeCandidates,
  nearbyGroup,
  planPlace,
  sharedPlace
} from './batch-place';
import { choiceFromCandidate, choiceFromPoi, type PlaceChoice } from './match';
import type { Processed } from './process';
import { newItem, type Item } from './upload-model';

const BRIDGE = { lat: 30.25905, lng: 120.14806 };
/** a point `m` metres north of the bridge */
const north = (m: number) => {
  const [lat, lng] = destination(BRIDGE.lat, BRIDGE.lng, 0, m);
  return { lat, lng };
};

const cand = (key: string, distance: number, over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  key,
  poiId: key.startsWith('poi_') ? key : null,
  name: key,
  category: '桥',
  lat: BRIDGE.lat,
  lng: BRIDGE.lng,
  distance,
  bearing: 0,
  inView: false,
  score: distance,
  source: key.startsWith('poi_') ? 'local' : 'osm',
  sourceId: key.startsWith('poi_') ? null : key.replace(/^osm:/, ''),
  area: false,
  city: '杭州市',
  district: '西湖区',
  ...over
});

const res = (candidates: MatchCandidate[]): MatchResponse =>
  ({ candidates, provider: 'osm', province: '浙江省', city: '杭州市', district: '西湖区', privacyZone: null }) as unknown as MatchResponse;

let n = 0;
function photo(at: { lat: number; lng: number } | null, candidates: MatchCandidate[] = [], over: Partial<Item> = {}): Item {
  const p = { exif: { lat: at?.lat ?? null, lng: at?.lng ?? null, takenAt: null, tz: null, heading: null } } as unknown as Processed;
  return {
    ...newItem(new File(['x'], `p${++n}.jpg`, { type: 'image/jpeg' })),
    stage: 'ready',
    p,
    match: at ? { radius: 300, loading: false, error: null, res: res(candidates) } : null,
    ...over
  };
}

const bridge = (over: Partial<PlaceChoice> = {}): PlaceChoice => ({
  ...choiceFromPoi(poi('poi_bridge', { lat: BRIDGE.lat, lng: BRIDGE.lng, category: '桥' }), 'confirmed'),
  ...over
});

describe('mergeCandidates', () => {
  it('ranks places more photos list first, then the nearer on average', () => {
    const a = photo(north(80), [cand('poi_bridge', 80), cand('osm:lake', 0, { area: true, category: '湖' }), cand('osm:cafe', 40)]);
    const b = photo(north(120), [cand('poi_bridge', 120), cand('osm:lake', 0, { area: true, category: '湖' })]);
    const c = photo(north(60), [cand('poi_bridge', 60), cand('osm:tea', 10)]);
    const out = mergeCandidates([a, b, c]);
    expect(out.map((x) => [x.c.key, x.count, Math.round(x.distance)])).toEqual([
      ['poi_bridge', 3, 87],
      ['osm:lake', 2, 0],
      ['osm:tea', 1, 10],
      ['osm:cafe', 1, 40]
    ]);
    // the occurrence kept is the one nearest to its photo
    expect(out[0].c.distance).toBe(60);
  });

  it('counts a place once per photo and adds places made this session at the end', () => {
    const a = photo(north(50), [cand('poi_bridge', 50), cand('poi_bridge', 50)]);
    const made = poi('poi_new', { lat: north(300).lat, lng: north(300).lng, name: '湖边长椅' });
    const out = mergeCandidates([a], [made, poi('poi_bridge')]);
    expect(out.map((x) => [x.c.key, x.count])).toEqual([
      ['poi_bridge', 1],
      ['poi_new', 0]
    ]);
    expect(Math.round(out[1].distance)).toBe(250);
    expect(out[1].c.poiId).toBe('poi_new');
  });

  it('is empty for photos without matches', () => {
    expect(mergeCandidates([photo(null), photo(north(10), [], { match: null })])).toEqual([]);
  });
});

describe('isTooFar', () => {
  it('gives a point place a tight limit and an area room for its size', () => {
    expect(farLimit('桥')).toBe(FAR_SLACK + 120);
    expect(farLimit('湖')).toBe(FAR_SLACK + 1200);
    expect(farLimit('未知类别')).toBe(FAR_SLACK + 240);
    expect(isTooFar(photo(north(600)), bridge())).toBe(false);
    expect(isTooFar(photo(north(700)), bridge())).toBe(true);
    expect(isTooFar(photo(north(1600)), bridge({ category: '湖' }))).toBe(false);
    expect(isTooFar(photo(north(1800)), bridge({ category: '湖' }))).toBe(true);
  });

  it('never for a place the photo is inside, or that its own match offers', () => {
    const inside = photo(north(3000), [cand('poi_bridge', 0, { area: true, category: '湖' })]);
    expect(isTooFar(inside, bridge({ category: '湖' }))).toBe(false);
    const wide = photo(north(900), [cand('poi_bridge', 900)], {});
    wide.match = { ...wide.match!, radius: 1000 };
    expect(isTooFar(wide, bridge())).toBe(false);
  });

  it('never without positions', () => {
    expect(isTooFar(photo(null), bridge())).toBe(false);
    expect(isTooFar(photo(north(5000)), bridge({ lat: null, lng: null }))).toBe(false);
  });
});

describe('choiceFor', () => {
  it('confirms a candidate the photo itself was offered, with its own distance and view', () => {
    const own = cand('poi_bridge', 42, { inView: true });
    const it = photo(north(42), [own]);
    const got = choiceFor(it, choiceFromCandidate(cand('poi_bridge', 80), 'confirmed'), true);
    expect(got).toMatchObject({ key: 'poi_bridge', poiId: 'poi_bridge', method: 'confirmed', distance: 42, inView: true });
  });

  it('is manual for a photo not offered it, a search, a new place and a photo without position', () => {
    const base = choiceFromCandidate(cand('poi_bridge', 80), 'confirmed');
    const other = choiceFor(photo(north(300), [cand('osm:x', 5)]), base, true);
    expect(other).toMatchObject({ method: 'manual', distance: 300, poiId: 'poi_bridge' });
    expect(choiceFor(photo(north(30), [cand('poi_bridge', 30)]), base, false)).toMatchObject({ method: 'manual', distance: 30 });
    expect(choiceFor(photo(null), base, true)).toMatchObject({ method: 'manual', distance: null, poiId: 'poi_bridge' });
  });
});

describe('planPlace', () => {
  it('gives the place to every photo that can take it and says which were skipped', () => {
    const near = photo(north(50), [cand('poi_bridge', 50)]);
    const blind = photo(null);
    const far = photo(north(3000));
    const reading = photo(null, [], { stage: 'processing', p: null });
    const sent = photo(north(10), [], { publish: { state: 'done', progress: 1 } });
    const broken = photo(null, [], { stage: 'error', p: null });
    const plan = planPlace([near, blind, far, reading, sent, broken], bridge(), true);
    expect([...plan.patches.keys()]).toEqual([near.id, blind.id]);
    expect(plan.patches.get(near.id)).toMatchObject({ cleared: false, place: { method: 'confirmed', distance: 50 } });
    expect(plan.patches.get(blind.id)).toMatchObject({ place: { method: 'manual', poiId: 'poi_bridge' } });
    expect(plan.far).toEqual([far.id]);
    expect(plan.pending).toEqual([reading.id]);
  });

  it('undoes an earlier "no place" on the photos it sets', () => {
    const it = photo(north(20), [], { cleared: true });
    expect(planPlace([it], bridge(), false).patches.get(it.id)?.cleared).toBe(false);
  });
});

describe('sharedPlace', () => {
  it('is the place when every editable photo has the same one', () => {
    const a = photo(north(1), [], { place: bridge() });
    const b = photo(north(2), [], { place: bridge({ method: 'manual' }) });
    const sent = photo(north(3), [], { publish: { state: 'done', progress: 1 } });
    expect(sharedPlace([a, b, sent], [a, b, sent])?.key).toBe('poi_bridge');
    expect(sharedPlace([a, photo(north(4))], [a])).toBeNull();
    expect(sharedPlace([sent], [sent])).toBeNull();
  });
});

describe('ensureSaved', () => {
  it('creates a custom place without a source id once and points at it', async () => {
    const create = vi.fn(async () => poi('poi_made', { name: '家门口的桥' }));
    const custom: PlaceChoice = {
      ...bridge(),
      key: 'custom:new',
      poiId: null,
      newPoi: { name: '家门口的桥', category: '桥', lat: 1, lng: 2, city: null, district: null, source: 'custom', sourceId: null },
      method: 'manual'
    };
    const out = await ensureSaved(custom, create);
    expect(create).toHaveBeenCalledTimes(1);
    expect(out.created?.id).toBe('poi_made');
    expect(out.choice).toMatchObject({ key: 'poi_made', poiId: 'poi_made', newPoi: null, method: 'manual' });
  });

  it('leaves stored places and provider places (de-duplicated by the server) alone', async () => {
    const create = vi.fn();
    const provider = choiceFromCandidate(cand('osm:way/1', 10), 'confirmed');
    expect((await ensureSaved(bridge(), create)).created).toBeNull();
    expect((await ensureSaved(provider, create)).choice).toBe(provider);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('centreOf', () => {
  it('averages the positions it has', () => {
    expect(centreOf([photo({ lat: 30, lng: 120 }), photo({ lat: 31, lng: 121 }), photo(null)])).toEqual({ lat: 30.5, lng: 120.5 });
    expect(centreOf([photo(null)])).toBeNull();
  });
});

describe('nearbyGroup', () => {
  it('chains photos taken close together, in queue order, within reach of the first', () => {
    const a = photo(north(0));
    const b = photo(north(150));
    const c = photo(north(300)); // 150 m from b
    const d = photo(north(900)); // a gap of 600 m
    const e = photo(null);
    const queue = [d, c, e, a, b];
    expect(nearbyGroup(queue, a.id)).toEqual([c.id, a.id, b.id]);
    expect(nearbyGroup(queue, d.id)).toEqual([d.id]);
    // a long chain stops at the reach
    const line = [0, 180, 360, 540, 720, 900, 1080].map((m) => photo(north(m)));
    expect(nearbyGroup(line, line[0].id)).toHaveLength(6);
  });

  it('skips photos that cannot be edited, and has nothing for a photo without position', () => {
    const a = photo(north(0));
    const sent = photo(north(10), [], { publish: { state: 'done', progress: 1 } });
    const b = photo(north(20));
    expect(nearbyGroup([a, sent, b], a.id)).toEqual([a.id, b.id]);
    expect(nearbyGroup([a, sent, b], sent.id)).toEqual([]);
    const blind = photo(null);
    expect(nearbyGroup([a, blind], blind.id)).toEqual([]);
  });
});
