import { describe, expect, it } from 'vite-plus/test';
import type { GeoPrivacy } from '../../shared/types';
import { fakeD1, type DbCall } from '../test-utils';
import { toDetail, toSummary, type PhotoRow } from './photos';
import type { PoiRow } from './poi';

// docs/api/conventions.md#位置精度对非所有者
//
//  geoPrivacy | lat, lng      | heading, alt | poiId, poi, poiDistance | district
//  exact      | as stored     | as stored    | as stored               | as stored
//  fuzzy      | fuzz()        | null         | as stored               | as stored
//  hidden     | null          | null         | null                    | null
//
// The owner always sees everything. `province` and `city` are always returned; `district` follows the table in lists too.

const OWNER = 'u_owner';
const STRANGER = 'u_stranger';

const VARIANTS = {
  s: { key: 'v/ph_1/s.webp', w: 480, h: 360 },
  m: { key: 'v/ph_1/m.webp', w: 1600, h: 1200 },
  l: { key: 'v/ph_1/l.webp', w: 2560, h: 1920 }
};

const row = (over: Partial<PhotoRow> = {}): PhotoRow => ({
  id: 'ph_1',
  owner_id: OWNER,
  owner_handle: 'owner',
  title: '断桥',
  note: '清晨的断桥',
  has_note: 1,
  taken_at: '2026-11-08T07:15:30',
  tz: '+08:00',
  lat: 30.25912,
  lng: 120.13878,
  alt: 12.5,
  heading: 123.4,
  geo_privacy: 'exact',
  province: '浙江省',
  city: '杭州',
  district: '西湖区',
  poi_id: 'poi_1',
  poi_distance: 42,
  poi_method: 'auto',
  camera: 'Sony ILCE-7M4',
  lens: 'FE 35mm F1.8',
  focal: 35,
  focal35: 35,
  aperture: 1.8,
  shutter: '1/250',
  iso: 100,
  width: 4000,
  height: 3000,
  file_key: 'o/u_owner/ph_1.jpg',
  thumbhash: 'abc',
  variants: JSON.stringify(VARIANTS),
  palette: JSON.stringify(['#112233', '#AABBCC']),
  focus_x: 0.4,
  focus_y: 0.6,
  visibility: 'public',
  in_living: 1,
  favorite: 0,
  uploaded_at: '2026-11-08T08:00:00Z',
  updated_at: null,
  tag_ids: 'lake,bridge',
  ...over
});

const POI: PoiRow = {
  id: 'poi_1',
  name: '断桥',
  aliases: null,
  category: '桥',
  city: '杭州',
  district: '西湖区',
  lat: 30.2589,
  lng: 120.1494,
  radius: 60,
  source: 'custom',
  source_id: null,
  created_by: OWNER,
  created_at: '2026-11-01T00:00:00Z'
};

describe('toSummary', () => {
  describe.each<[GeoPrivacy, number | null, number | null, number | null, string | null, string | null]>([
    // geoPrivacy, lat, lng, heading, poiId, district — as a stranger sees them
    ['exact', 30.25912, 120.13878, 123.4, 'poi_1', '西湖区'],
    ['fuzzy', 30.26, 120.14, null, 'poi_1', '西湖区'],
    ['hidden', null, null, null, null, null]
  ])('%s photo seen by someone else', (geoPrivacy, lat, lng, heading, poiId, district) => {
    it('follows the documented table', () => {
      const s = toSummary(row({ geo_privacy: geoPrivacy }), STRANGER);
      expect(s.lat).toBe(lat);
      expect(s.lng).toBe(lng);
      expect(s.heading).toBe(heading);
      expect(s.poiId).toBe(poiId);
      expect(s.district).toBe(district);
    });

    it('is the same for a visitor who is not signed in', () => {
      expect(toSummary(row({ geo_privacy: geoPrivacy }), null)).toEqual(toSummary(row({ geo_privacy: geoPrivacy }), STRANGER));
    });

    it('still reports the stored setting and always returns the province and city', () => {
      const s = toSummary(row({ geo_privacy: geoPrivacy }), STRANGER);
      expect(s.geoPrivacy).toBe(geoPrivacy);
      expect(s.province).toBe('浙江省');
      expect(s.city).toBe('杭州');
    });
  });

  it('lets the owner see everything exactly, whatever the setting', () => {
    for (const geoPrivacy of ['exact', 'fuzzy', 'hidden'] as const) {
      const s = toSummary(row({ geo_privacy: geoPrivacy }), OWNER);
      expect(s, geoPrivacy).toMatchObject({
        lat: 30.25912,
        lng: 120.13878,
        heading: 123.4,
        poiId: 'poi_1',
        district: '西湖区',
        geoPrivacy
      });
    }
  });

  it('does not give a fuzzy photo’s exact coordinates away anywhere in the payload', () => {
    const json = JSON.stringify(toSummary(row({ geo_privacy: 'fuzzy' }), STRANGER));
    expect(json).not.toContain('30.25912');
    expect(json).not.toContain('120.13878');
    expect(json).not.toContain('123.4');
  });

  it('has no coordinates when the photo has none, or only one of the pair', () => {
    expect(toSummary(row({ lat: null, lng: null }), STRANGER)).toMatchObject({ lat: null, lng: null });
    expect(toSummary(row({ lat: null, lng: null }), OWNER)).toMatchObject({ lat: null, lng: null });
    expect(toSummary(row({ lat: 30.25, lng: null, geo_privacy: 'fuzzy' }), STRANGER)).toMatchObject({ lat: null, lng: null });
    expect(toSummary(row({ lat: null, lng: 120.14 }), OWNER)).toMatchObject({ lat: null, lng: null });
  });

  it('maps the rest of the row to the API shape', () => {
    expect(toSummary(row(), STRANGER)).toEqual({
      id: 'ph_1',
      ownerId: OWNER,
      ownerHandle: 'owner',
      title: '断桥',
      takenAt: '2026-11-08T07:15:30',
      width: 4000,
      height: 3000,
      thumbhash: 'abc',
      variants: VARIANTS,
      palette: ['#112233', '#AABBCC'],
      poiId: 'poi_1',
      province: '浙江省',
      city: '杭州',
      district: '西湖区',
      tagIds: ['lake', 'bridge'],
      visibility: 'public',
      geoPrivacy: 'exact',
      lat: 30.25912,
      lng: 120.13878,
      heading: 123.4,
      inLiving: true,
      favorite: false,
      hasNote: true,
      focus: [0.4, 0.6]
    });
  });

  it('never includes the note text in a summary', () => {
    expect(JSON.stringify(toSummary(row(), OWNER))).not.toContain('清晨的断桥');
  });

  it('reads the integer flags as booleans', () => {
    expect(toSummary(row({ in_living: 0, favorite: 1, has_note: 0 }), OWNER)).toMatchObject({
      inLiving: false,
      favorite: true,
      hasNote: false
    });
    expect(toSummary(row({ has_note: undefined }), OWNER).hasNote).toBe(false);
  });

  it('splits the tag list, with none for a photo without tags', () => {
    expect(toSummary(row({ tag_ids: 'lake' }), OWNER).tagIds).toEqual(['lake']);
    expect(toSummary(row({ tag_ids: null }), OWNER).tagIds).toEqual([]);
    expect(toSummary(row({ tag_ids: '' }), OWNER).tagIds).toEqual([]);
  });

  it('needs both focus coordinates, and parses a missing palette as none', () => {
    expect(toSummary(row({ focus_x: 0.5, focus_y: null }), OWNER).focus).toBeNull();
    expect(toSummary(row({ focus_x: null, focus_y: 0.5 }), OWNER).focus).toBeNull();
    expect(toSummary(row({ focus_x: 0, focus_y: 0 }), OWNER).focus).toEqual([0, 0]);
    expect(toSummary(row({ palette: null }), OWNER).palette).toBeNull();
  });

  it('keeps a photo without a capture time', () => {
    expect(toSummary(row({ taken_at: null }), OWNER).takenAt).toBeNull();
  });

  it('reads a province that was looked up without a result, stored as an empty string, as none', () => {
    expect(toSummary(row({ province: '' }), OWNER).province).toBeNull();
    expect(toSummary(row({ province: null }), OWNER).province).toBeNull();
  });
});

describe('toDetail', () => {
  /** Answers the POI lookup and the themes query of `toDetail`. */
  function detailDb() {
    return fakeD1((call: DbCall) => {
      if (call.sql.includes('FROM pois')) return POI;
      if (call.sql.includes('theme_items')) return [{ id: 'th_1', title: '西湖四季', updated_at: '2026-11-08T00:00:00Z' }];
      return null;
    });
  }

  it('gives the owner everything, exactly', async () => {
    const { db } = detailDb();
    const d = await toDetail(db, row({ geo_privacy: 'hidden' }), OWNER);
    expect(d).toMatchObject({
      lat: 30.25912,
      lng: 120.13878,
      heading: 123.4,
      alt: 12.5,
      district: '西湖区',
      poiId: 'poi_1',
      poiDistance: 42,
      poiMethod: 'auto',
      poi: { id: 'poi_1', name: '断桥', category: '桥', radius: 60, source: 'custom', sourceId: null }
    });
  });

  it('exact photo seen by someone else: all of it', async () => {
    const { db } = detailDb();
    const d = await toDetail(db, row(), STRANGER);
    expect(d).toMatchObject({
      lat: 30.25912,
      heading: 123.4,
      alt: 12.5,
      district: '西湖区',
      poiId: 'poi_1',
      poiDistance: 42,
      poiMethod: 'auto'
    });
    expect(d.poi?.name).toBe('断桥');
  });

  it('fuzzy photo seen by someone else: rounded position, no heading or altitude, place and district kept', async () => {
    const { db } = detailDb();
    const d = await toDetail(db, row({ geo_privacy: 'fuzzy' }), STRANGER);
    expect(d).toMatchObject({
      lat: 30.26,
      lng: 120.14,
      heading: null,
      alt: null,
      district: '西湖区',
      poiId: 'poi_1',
      poiDistance: 42,
      poiMethod: 'auto'
    });
    expect(d.poi?.name).toBe('断桥');
  });

  it('hidden photo seen by someone else: no position, heading, altitude, district or place at all', async () => {
    const { db, calls } = detailDb();
    const d = await toDetail(db, row({ geo_privacy: 'hidden' }), STRANGER);
    expect(d).toMatchObject({
      lat: null,
      lng: null,
      heading: null,
      alt: null,
      district: null,
      poiId: null,
      poi: null,
      poiDistance: null,
      poiMethod: null,
      city: '杭州'
    });
    // the place is not even looked up
    expect(calls.some((c) => c.sql.includes('FROM pois'))).toBe(false);
  });

  it('does not leak a hidden photo’s place or position anywhere in the payload', async () => {
    const { db } = detailDb();
    const json = JSON.stringify(await toDetail(db, row({ geo_privacy: 'hidden' }), null));
    expect(json).not.toContain('poi_1');
    expect(json).not.toContain('"category"');
    expect(json).not.toContain('30.25912');
    expect(json).not.toContain('120.13878');
    expect(json).not.toContain('西湖区');
  });

  it('returns the non-location fields to everyone', async () => {
    const { db } = detailDb();
    const d = await toDetail(db, row({ geo_privacy: 'hidden' }), STRANGER);
    expect(d).toMatchObject({
      note: '清晨的断桥',
      tz: '+08:00',
      camera: 'Sony ILCE-7M4',
      lens: 'FE 35mm F1.8',
      focal: 35,
      focal35: 35,
      aperture: 1.8,
      shutter: '1/250',
      iso: 100,
      uploadedAt: '2026-11-08T08:00:00Z',
      updatedAt: null
    });
  });

  it('lists the themes the database returns, without the sort column', async () => {
    const { db } = detailDb();
    const d = await toDetail(db, row(), OWNER);
    expect(d.themes).toEqual([{ id: 'th_1', title: '西湖四季' }]);
  });

  it('asks for themes visible to the viewer, or only public ones for a visitor', async () => {
    const owner = detailDb();
    await toDetail(owner.db, row(), OWNER);
    const themeCall = owner.calls.find((c) => c.sql.includes('theme_items'));
    expect(themeCall?.params).toEqual(['ph_1', OWNER]);
    expect(themeCall?.sql).toContain("th.visibility = 'public' OR th.owner_id = ?2");

    const visitor = detailDb();
    await toDetail(visitor.db, row(), null);
    expect(visitor.calls.find((c) => c.sql.includes('theme_items'))?.params).toEqual(['ph_1', '']);
  });

  it('copes with a photo whose place no longer exists', async () => {
    const { db } = fakeD1(() => null);
    const d = await toDetail(db, row(), OWNER);
    expect(d.poi).toBeNull();
    expect(d.poiId).toBe('poi_1');
    expect(d.themes).toEqual([]);
  });

  it('copes with a photo that has no place', async () => {
    const { db, calls } = detailDb();
    const d = await toDetail(db, row({ poi_id: null, poi_distance: null, poi_method: null }), OWNER);
    expect(d).toMatchObject({ poiId: null, poi: null, poiDistance: null, poiMethod: null });
    expect(calls.some((c) => c.sql.includes('FROM pois'))).toBe(false);
  });
});
