// Fixtures shared by the front end's unit tests. Nothing in the app imports this file.

import type { PhotoDetail, PhotoSummary, Poi, ThemeDetail } from '../shared/types';

export const VARIANTS: PhotoSummary['variants'] = {
  s: { key: 'v/x/s.webp', w: 480, h: 320 },
  m: { key: 'v/x/m.webp', w: 1600, h: 1067 },
  l: { key: 'v/x/l.webp', w: 2560, h: 1707 }
};

/** A public, located-nowhere photo that Living can play; override what a test cares about. */
export function photo(id: string, over: Partial<PhotoSummary> = {}): PhotoSummary {
  return {
    id,
    ownerId: 'u_1',
    ownerHandle: 'ada',
    title: null,
    takenAt: null,
    width: 3000,
    height: 2000,
    thumbhash: null,
    variants: VARIANTS,
    palette: null,
    poiId: null,
    province: null,
    city: null,
    district: null,
    tagIds: [],
    visibility: 'public',
    geoPrivacy: 'exact',
    lat: null,
    lng: null,
    heading: null,
    inLiving: true,
    favorite: false,
    hasNote: false,
    focus: null,
    ...over
  };
}

export function photoDetail(id: string, over: Partial<PhotoDetail> = {}): PhotoDetail {
  return {
    ...photo(id),
    note: null,
    tz: '+08:00',
    alt: null,
    poi: null,
    poiDistance: null,
    poiMethod: null,
    camera: null,
    lens: null,
    focal: null,
    focal35: null,
    aperture: null,
    shutter: null,
    iso: null,
    themes: [],
    uploadedAt: '2026-11-08T08:00:00Z',
    updatedAt: null,
    ...over
  };
}

export function poi(id: string, over: Partial<Poi> = {}): Poi {
  return {
    id,
    name: '断桥',
    category: '桥',
    city: '杭州',
    district: '西湖区',
    lat: 30.2589,
    lng: 120.1494,
    radius: 60,
    source: 'custom',
    sourceId: null,
    ...over
  };
}

export function themeDetail(over: Partial<ThemeDetail> = {}): ThemeDetail {
  return {
    id: 'th_1',
    ownerId: 'u_1',
    ownerHandle: 'ada',
    kind: 'trip',
    title: '西湖三日',
    subtitle: null,
    coverPhotoId: null,
    cover: null,
    startDate: null,
    endDate: null,
    visibility: 'public',
    photoCount: 0,
    createdAt: '2026-11-08T00:00:00Z',
    updatedAt: '2026-11-08T00:00:00Z',
    publishedAt: null,
    intro: null,
    items: [],
    pois: [],
    ...over
  };
}
