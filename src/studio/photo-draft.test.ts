import { describe, expect, it } from 'vite-plus/test';
import { photoDetail, poi } from '../test-utils';
import { choiceFromCandidate, choiceFromPoi, type PlaceChoice } from './match';
import { diffDraft, draftOf, placeOfPhoto, unwrapPhoto, type Draft } from './photo-draft';

const base = (over: Partial<Draft> = {}): Draft => ({
  title: '断桥',
  note: '清晨',
  visibility: 'public',
  geoPrivacy: 'exact',
  inLiving: true,
  favorite: false,
  tagIds: ['lake', 'bridge'],
  focus: [0.4, 0.6],
  place: null,
  ...over
});

const providerPlace = (): PlaceChoice =>
  choiceFromCandidate(
    {
      key: 'osm:way/42',
      poiId: null,
      name: '湖心亭',
      category: '亭',
      lat: 30.24,
      lng: 120.14,
      distance: 30,
      bearing: 0,
      inView: true,
      score: 5,
      source: 'osm',
      sourceId: 'way/42',
      area: false,
      city: '杭州',
      district: null
    },
    'confirmed'
  );

describe('unwrapPhoto', () => {
  const detail = photoDetail('ph_1');

  it('accepts the bare detail GET returns', () => {
    expect(unwrapPhoto(detail)).toBe(detail);
  });

  it('accepts the { photo } wrapper POST and PATCH return', () => {
    expect(unwrapPhoto({ photo: detail })).toBe(detail);
  });

  it('gives null for anything else', () => {
    for (const bad of [null, undefined, 'x', 5, {}, { photo: null }, { photo: 'x' }, { id: 5 }, []]) {
      expect(unwrapPhoto(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('placeOfPhoto', () => {
  it('is null for a photo without a place', () => {
    expect(placeOfPhoto(photoDetail('ph_1'))).toBeNull();
  });

  it('describes the photo’s place with how it was matched and how far it is', () => {
    const p = photoDetail('ph_1', { poi: poi('poi_1'), poiMethod: 'confirmed', poiDistance: 42 });
    expect(placeOfPhoto(p)).toEqual({
      key: 'poi_1',
      poiId: 'poi_1',
      newPoi: null,
      name: '断桥',
      category: '桥',
      lat: 30.2589,
      lng: 120.1494,
      city: '杭州',
      district: '西湖区',
      method: 'confirmed',
      distance: 42
    });
  });

  it('counts a place without a recorded method as chosen by hand', () => {
    expect(placeOfPhoto(photoDetail('ph_1', { poi: poi('poi_1'), poiMethod: null, poiDistance: null }))).toMatchObject({
      method: 'manual',
      distance: null
    });
  });
});

describe('draftOf', () => {
  it('copies the editable fields, with empty text instead of null', () => {
    const d = draftOf(
      photoDetail('ph_1', {
        title: null,
        note: null,
        visibility: 'unlisted',
        geoPrivacy: 'fuzzy',
        inLiving: false,
        favorite: true,
        tagIds: ['a'],
        focus: [0.1, 0.9]
      })
    );
    expect(d).toEqual({
      title: '',
      note: '',
      visibility: 'unlisted',
      geoPrivacy: 'fuzzy',
      inLiving: false,
      favorite: true,
      tagIds: ['a'],
      focus: [0.1, 0.9],
      place: null
    });
  });

  it('copies the arrays, so editing the draft cannot change the saved photo', () => {
    const p = photoDetail('ph_1', { tagIds: ['a', 'b'], focus: [0.5, 0.5] });
    const d = draftOf(p);
    d.tagIds.push('c');
    expect(p.tagIds).toEqual(['a', 'b']);
    expect(d.focus).not.toBe(p.focus);
  });

  it('includes the place', () => {
    expect(draftOf(photoDetail('ph_1', { poi: poi('poi_1') })).place?.poiId).toBe('poi_1');
  });
});

describe('diffDraft', () => {
  it('is empty when nothing changed', () => {
    expect(diffDraft(base(), base())).toEqual({});
    expect(diffDraft(base({ place: providerPlace() }), base({ place: providerPlace() }))).toEqual({});
  });

  it('compares text after trimming, and sends a cleared title or note as null', () => {
    expect(diffDraft(base(), base({ title: '  断桥  ', note: ' 清晨\n' }))).toEqual({});
    expect(diffDraft(base(), base({ title: '雷峰塔' }))).toEqual({ title: '雷峰塔' });
    expect(diffDraft(base(), base({ title: '  新标题 ' }))).toEqual({ title: '新标题' });
    expect(diffDraft(base(), base({ title: '', note: '   ' }))).toEqual({ title: null, note: null });
  });

  it('sends only the fields that changed', () => {
    expect(diffDraft(base(), base({ visibility: 'private' }))).toEqual({ visibility: 'private' });
    expect(diffDraft(base(), base({ geoPrivacy: 'hidden' }))).toEqual({ geoPrivacy: 'hidden' });
    expect(diffDraft(base(), base({ inLiving: false }))).toEqual({ inLiving: false });
    expect(diffDraft(base(), base({ favorite: true }))).toEqual({ favorite: true });
    expect(diffDraft(base(), base({ visibility: 'private', favorite: true }))).toEqual({ visibility: 'private', favorite: true });
  });

  it('treats tags as a set: order does not matter, and any change sends the whole new set', () => {
    expect(diffDraft(base(), base({ tagIds: ['bridge', 'lake'] }))).toEqual({});
    expect(diffDraft(base(), base({ tagIds: ['lake', 'bridge', 'sunset'] }))).toEqual({ tagIds: ['lake', 'bridge', 'sunset'] });
    expect(diffDraft(base(), base({ tagIds: ['lake'] }))).toEqual({ tagIds: ['lake'] });
    expect(diffDraft(base(), base({ tagIds: [] }))).toEqual({ tagIds: [] });
  });

  it('does not confuse tag sets whose ids run together', () => {
    expect(diffDraft(base({ tagIds: ['ab', 'c'] }), base({ tagIds: ['a', 'bc'] }))).toEqual({ tagIds: ['a', 'bc'] });
  });

  it('compares the focus point by value, and can clear it', () => {
    expect(diffDraft(base(), base({ focus: [0.4, 0.6] }))).toEqual({});
    expect(diffDraft(base(), base({ focus: [0.5, 0.6] }))).toEqual({ focus: [0.5, 0.6] });
    expect(diffDraft(base(), base({ focus: null }))).toEqual({ focus: null });
    expect(diffDraft(base({ focus: null }), base({ focus: [0.1, 0.2] }))).toEqual({ focus: [0.1, 0.2] });
  });

  describe('place', () => {
    it('removes the place with poiId null', () => {
      expect(diffDraft(base({ place: providerPlace() }), base({ place: null }))).toEqual({ poiId: null });
    });

    it('sets a stored place by id, with how it was matched', () => {
      expect(diffDraft(base({ place: null }), base({ place: choiceFromPoi(poi('poi_1'), 'manual') }))).toEqual({
        poiId: 'poi_1',
        poiMethod: 'manual'
      });
    });

    it('sets a provider place by describing it, to be created on save', () => {
      const diff = diffDraft(base({ place: null }), base({ place: providerPlace() }));
      expect(diff.poiId).toBeUndefined();
      expect(diff.poiMethod).toBe('confirmed');
      expect(diff.newPoi).toMatchObject({ name: '湖心亭', source: 'osm', sourceId: 'way/42' });
    });

    it('notices a change of how the same place was matched', () => {
      const before = { ...providerPlace(), method: 'auto' as const };
      const after = { ...providerPlace(), method: 'confirmed' as const };
      expect(diffDraft(base({ place: before }), base({ place: after }))).toMatchObject({ poiMethod: 'confirmed' });
    });

    it('is quiet when the same place is chosen again', () => {
      expect(diffDraft(base({ place: providerPlace() }), base({ place: { ...providerPlace() } }))).toEqual({});
    });
  });

  it('collects several changes in one body', () => {
    const diff = diffDraft(base(), base({ title: '新', favorite: true, tagIds: [], place: providerPlace() }));
    expect(Object.keys(diff).sort()).toEqual(['favorite', 'newPoi', 'poiMethod', 'tagIds', 'title']);
  });
});
