import type { PhotoDetail, UpdatePhotoBody } from '../../shared/types';
import type { FieldsValue } from './PhotoFields';
import { placeFields, type PlaceChoice } from './match';

// Editable state of an existing photo (the /studio/photo/:id form) and the PATCH body for what changed.

export interface Draft extends FieldsValue {
  tagIds: string[];
  focus: [number, number] | null;
  place: PlaceChoice | null;
}

/** GET /api/photos/:id returns the bare detail; POST and PATCH wrap it as `{ photo }`. Accept both. */
export function unwrapPhoto(v: unknown): PhotoDetail | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { photo?: unknown; id?: unknown };
  if (o.photo && typeof o.photo === 'object') return o.photo as PhotoDetail;
  return typeof o.id === 'string' ? (v as PhotoDetail) : null;
}

export function placeOfPhoto(p: PhotoDetail): PlaceChoice | null {
  if (!p.poi) return null;
  return {
    key: p.poi.id,
    poiId: p.poi.id,
    newPoi: null,
    name: p.poi.name,
    category: p.poi.category,
    lat: p.poi.lat,
    lng: p.poi.lng,
    city: p.poi.city,
    district: p.poi.district,
    method: p.poiMethod ?? 'manual',
    distance: p.poiDistance
  };
}

export function draftOf(p: PhotoDetail): Draft {
  return {
    title: p.title ?? '',
    note: p.note ?? '',
    visibility: p.visibility,
    geoPrivacy: p.geoPrivacy,
    inLiving: p.inLiving,
    favorite: p.favorite,
    tagIds: [...p.tagIds],
    focus: p.focus ? [p.focus[0], p.focus[1]] : null,
    place: placeOfPhoto(p)
  };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/** Only the fields that differ from the saved photo. */
export function diffDraft(base: Draft, cur: Draft): UpdatePhotoBody {
  const body: UpdatePhotoBody = {};
  if (cur.title.trim() !== base.title.trim()) body.title = cur.title.trim() || null;
  if (cur.note.trim() !== base.note.trim()) body.note = cur.note.trim() || null;
  if (cur.visibility !== base.visibility) body.visibility = cur.visibility;
  if (cur.geoPrivacy !== base.geoPrivacy) body.geoPrivacy = cur.geoPrivacy;
  if (cur.inLiving !== base.inLiving) body.inLiving = cur.inLiving;
  if (cur.favorite !== base.favorite) body.favorite = cur.favorite;
  if (!sameSet(cur.tagIds, base.tagIds)) body.tagIds = cur.tagIds;
  if (JSON.stringify(cur.focus) !== JSON.stringify(base.focus)) body.focus = cur.focus;
  if (cur.place?.key !== base.place?.key || cur.place?.method !== base.place?.method) {
    if (!cur.place) {
      body.poiId = null;
    } else {
      const pf = placeFields(cur.place);
      if (pf.poiId) body.poiId = pf.poiId;
      else body.newPoi = pf.newPoi;
      body.poiMethod = pf.poiMethod;
    }
  }
  return body;
}
