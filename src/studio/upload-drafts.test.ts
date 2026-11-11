import { describe, expect, it } from 'vite-plus/test';
import { choiceFromCandidate, type PlaceChoice } from './match';
import { DRAFT_TTL, DraftStore, draftOf, fileKey, restoreDraft, trim, type Draft, type DraftStorage } from './upload-drafts';
import { applyMatch, newItem, type Item } from './upload-model';
import type { MatchCandidate, MatchResponse } from '../../shared/types';

class MemoryStorage implements DraftStorage {
  map = new Map<string, string>();
  writes = 0;
  quota = Infinity;
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (v.length > this.quota) throw new DOMException('full', 'QuotaExceededError');
    this.writes++;
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const DAY = 24 * 3600 * 1000;
const file = (name = 'IMG_1.jpg') => new File(['abc'], name, { type: 'image/jpeg', lastModified: 1_700_000_000_000 });
const item = (over: Partial<Item> = {}, f = file()): Item => ({ ...newItem(f), ...over });

const cand = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  key: 'osm:way/1',
  poiId: null,
  name: '断桥',
  category: '桥',
  lat: 30.259,
  lng: 120.148,
  distance: 40,
  bearing: 10,
  inView: true,
  score: 15,
  source: 'osm',
  sourceId: 'way/1',
  area: false,
  city: '杭州市',
  district: '西湖区',
  ...over
});

const draft = (over: Partial<Draft> = {}): Draft => ({
  at: 1000,
  title: '早晨',
  note: '',
  tags: [],
  visibility: 'public',
  themeIds: [],
  place: null,
  cleared: false,
  ...over
});

describe('fileKey', () => {
  it('is name, size and modification time', () => {
    expect(fileKey(file())).toBe('IMG_1.jpg:3:1700000000000');
  });
});

describe('draftOf', () => {
  it('is nothing for a photo nobody touched', () => {
    expect(draftOf(item(), 5)).toBeNull();
    expect(draftOf(item({ title: '   ' }), 5)).toBeNull();
  });

  it('keeps the text and the choices, not the pixels', () => {
    const place = choiceFromCandidate(cand(), 'confirmed');
    const d = draftOf(
      item({
        title: '断桥',
        note: '雾',
        tags: ['lake'],
        visibility: 'private',
        geoPrivacy: 'fuzzy',
        geoTouched: true,
        themeIds: ['th_1'],
        place
      }),
      42
    );
    expect(d).toEqual({
      at: 42,
      title: '断桥',
      note: '雾',
      tags: ['lake'],
      visibility: 'private',
      geoPrivacy: 'fuzzy',
      themeIds: ['th_1'],
      place: { ...place, from: undefined },
      cleared: false
    });
    expect(JSON.stringify(d)).not.toMatch(/blob|thumb/i);
  });

  it('leaves out a location precision the user did not set and an automatic place', () => {
    const d = draftOf(item({ title: 'x', geoPrivacy: 'hidden', place: choiceFromCandidate(cand(), 'auto') }), 1)!;
    expect(d.geoPrivacy).toBeUndefined();
    expect(d.place).toBeNull();
    expect(draftOf(item({ place: choiceFromCandidate(cand(), 'auto') }), 1)).toBeNull();
  });

  it('remembers that the place was removed on purpose', () => {
    expect(draftOf(item({ cleared: true }), 1)?.cleared).toBe(true);
  });

  it('is nothing once the photo is on the site', () => {
    expect(draftOf(item({ title: 'x', publish: { state: 'done', progress: 1 } }), 1)).toBeNull();
    expect(draftOf(item({ title: 'x', publish: { state: 'duplicate', progress: 0 } }), 1)).toBeNull();
    expect(draftOf(item({ title: 'x', publish: { state: 'failed', progress: 0 } }), 1)?.title).toBe('x');
  });
});

describe('restoreDraft', () => {
  it('round-trips through a new queue item', () => {
    const before = item({
      title: 'a',
      note: 'b',
      tags: ['t'],
      visibility: 'unlisted',
      geoPrivacy: 'hidden',
      geoTouched: true,
      themeIds: ['th']
    });
    const after = { ...newItem(file()), ...restoreDraft(draftOf(before, 1)!) };
    for (const k of ['title', 'note', 'tags', 'visibility', 'geoPrivacy', 'geoTouched', 'themeIds', 'place', 'cleared'] as const) {
      expect(after[k]).toEqual(before[k]);
    }
  });

  it('keeps a restored place when the place match comes back, and lets the match decide when there is none', () => {
    const res = {
      candidates: [cand({ key: 'osm:near', distance: 5, inView: true })],
      provider: 'osm',
      privacyZone: null
    } as unknown as MatchResponse;
    const mine: PlaceChoice = choiceFromCandidate(cand(), 'confirmed');
    const restored = { ...newItem(file()), ...restoreDraft(draft({ place: mine })) };
    expect(applyMatch(restored, res, 300).place).toBeUndefined(); // the user's choice stands
    const cleared = { ...newItem(file()), ...restoreDraft(draft({ cleared: true })) };
    expect(applyMatch(cleared, res, 300).place).toBeUndefined();
    const plain = { ...newItem(file()), ...restoreDraft(draft()) };
    expect(applyMatch(plain, res, 300).place?.key).toBe('osm:near'); // automatic match as for any new photo
  });

  it('lets a privacy zone hide the location unless the user chose a precision', () => {
    const res = { candidates: [], provider: 'osm', privacyZone: '家' } as unknown as MatchResponse;
    const untouched = { ...newItem(file()), ...restoreDraft(draft()) };
    expect(applyMatch(untouched, res, 300).geoPrivacy).toBe('hidden');
    const chosen = { ...newItem(file()), ...restoreDraft(draft({ geoPrivacy: 'exact' })) };
    expect(applyMatch(chosen, res, 300).geoPrivacy).toBeUndefined();
  });
});

describe('DraftStore', () => {
  it('saves, reads back and forgets', () => {
    const s = new MemoryStorage();
    const store = new DraftStore(s, 'k', () => 2000);
    store.update(
      new Map([
        ['a', draft({ at: 2000 })],
        ['b', draft({ at: 2000, title: 'b' })]
      ])
    );
    expect(store.get('a')?.title).toBe('早晨');
    expect(Object.keys(store.all())).toEqual(['a', 'b']);
    store.forget(['a']);
    expect(store.get('a')).toBeNull();
    store.update(new Map([['b', null]]));
    expect(s.map.has('k')).toBe(false);
  });

  it('drops drafts older than 30 days', () => {
    const s = new MemoryStorage();
    let now = 0;
    const store = new DraftStore(s, 'k', () => now);
    store.update(new Map([['old', draft({ at: 0 })]]));
    now = DRAFT_TTL - 1;
    store.update(new Map([['new', draft({ at: now })]]));
    expect(Object.keys(store.all())).toEqual(['new', 'old']);
    now = DRAFT_TTL + 1;
    expect(Object.keys(store.all())).toEqual(['new']);
    store.update(new Map());
    expect(JSON.parse(s.map.get('k')!)).not.toHaveProperty('old');
  });

  it('keeps the newest within the count and size limits', () => {
    const many = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}`, draft({ at: i })]));
    expect(Object.keys(trim(many, 10, 3))).toEqual(['f9', 'f8', 'f7']);
    const big = { a: draft({ at: 2, note: 'x'.repeat(300) }), b: draft({ at: 1, note: 'y'.repeat(300) }) };
    expect(Object.keys(trim(big, 2, 10, 500))).toEqual(['a']);
  });

  it('halves what it keeps when storage is full, and never throws', () => {
    const s = new MemoryStorage();
    const store = new DraftStore(s, 'k', () => 100);
    const lots = new Map(Array.from({ length: 8 }, (_, i) => [`f${i}`, draft({ at: 100 - i, note: 'n'.repeat(100) })] as const));
    s.quota = 700;
    store.update(lots);
    const kept = Object.keys(store.all());
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(8);
    expect(kept[0]).toBe('f0');
    s.quota = 0;
    expect(() => store.update(new Map([['z', draft({ at: 100 })]]))).not.toThrow();
  });

  it('ignores anything in storage that is not a draft', () => {
    const s = new MemoryStorage();
    const store = new DraftStore(s, 'k', () => 5);
    s.map.set('k', 'not json');
    expect(store.all()).toEqual({});
    s.map.set('k', JSON.stringify({ a: { at: 5, title: 1 }, b: draft({ at: 5, visibility: 'everyone' as never }), c: draft({ at: 5 }) }));
    expect(Object.keys(store.all())).toEqual(['c']);
  });

  it('does nothing without storage', () => {
    const store = new DraftStore(null, 'k');
    expect(() => store.update(new Map([['a', draft()]]))).not.toThrow();
    expect(store.get('a')).toBeNull();
  });

  it('survives a storage that throws on read', () => {
    const broken: DraftStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
      removeItem: () => {}
    };
    expect(new DraftStore(broken, 'k').get('a')).toBeNull();
  });

  it('expires on read too', () => {
    const s = new MemoryStorage();
    s.map.set('k', JSON.stringify({ a: draft({ at: 0 }) }));
    expect(new DraftStore(s, 'k', () => DRAFT_TTL + DAY).get('a')).toBeNull();
  });
});
