import type { CreatePhotoMeta, GeoPrivacy, Visibility } from '../../shared/types';
import { initialMatch, placeFields, shouldAutoMatch, choiceFromCandidate, type MatchState, type PlaceChoice } from './match';
import { subjectTagsForCategory, type ProcessPhase, type Processed } from './process';
import { uid } from './util';
import type { MatchResponse } from '../../shared/types';

// The upload queue's data model: one Item per file, plus the pure functions that derive status,
// inferred places, tag suggestions and the POST /api/photos metadata from it.

export type Stage = 'queued' | 'processing' | 'ready' | 'error';

/** What a photo that is `processing` is waiting on when it is more than "reading and resizing": short for the queue row, long for the panel. */
export const PHASE_TEXT: Record<ProcessPhase, { short: string; long: string }> = {
  'heic-load': { short: '加载 HEIC 解码器…', long: '这个浏览器不能直接打开 HEIC，正在加载解码器（只在第一张 HEIC 时加载）…' },
  'heic-decode': { short: '解码 HEIC…', long: '正在解码 HEIC，大尺寸的照片需要几秒…' }
};
export interface PublishInfo {
  state: 'idle' | 'sending' | 'done' | 'duplicate' | 'failed';
  /** 0..1 while sending */
  progress: number;
  photoId?: string;
  error?: string;
}

export interface Item {
  id: string;
  file: File;
  stage: Stage;
  /** while `processing`: the HEIC decoder step in progress, if any */
  phase: ProcessPhase | null;
  error: string | null;
  p: Processed | null;
  /** object URL of the 480 px variant */
  thumbUrl: string | null;
  match: MatchState | null;
  /** the first match response has been looked at (auto-match decided) */
  autoDone: boolean;
  /** an explicit place (auto, confirmed or manual) */
  place: PlaceChoice | null;
  /** the user removed the place on purpose: do not infer one from neighbours */
  cleared: boolean;
  title: string;
  note: string;
  /** tags chosen by hand */
  picked: string[];
  /** suggestions the user switched off */
  dismissed: string[];
  visibility: Visibility;
  geoPrivacy: GeoPrivacy;
  /** the user changed location precision themselves */
  geoTouched: boolean;
  inLiving: boolean;
  favorite: boolean;
  themeIds: string[];
  publish: PublishInfo;
}

export function newItem(file: File): Item {
  return {
    id: uid(),
    file,
    stage: 'queued',
    phase: null,
    error: null,
    p: null,
    thumbUrl: null,
    match: null,
    autoDone: false,
    place: null,
    cleared: false,
    title: '',
    note: '',
    picked: [],
    dismissed: [],
    visibility: 'public',
    geoPrivacy: 'exact',
    geoTouched: false,
    inLiving: true,
    favorite: false,
    themeIds: [],
    publish: { state: 'idle', progress: 0 }
  };
}

export const hasGps = (it: Item) => it.p?.exif.lat != null && it.p.exif.lng != null;
export const coordsOf = (it: Item): { lat: number; lng: number } | null =>
  it.p && it.p.exif.lat != null && it.p.exif.lng != null ? { lat: it.p.exif.lat, lng: it.p.exif.lng } : null;

const TWO_HOURS = 2 * 3600 * 1000;

const instants = new WeakMap<Processed, number | null>();

/** Capture instant in ms (wall clock shifted by the recorded offset when there is one). Cached per file. */
function instant(it: Item): number | null {
  const p = it.p;
  if (!p) return null;
  const hit = instants.get(p);
  if (hit !== undefined) return hit;
  const x = p.exif;
  let out: number | null = null;
  if (x.takenAt) {
    const wall = Date.parse(`${x.takenAt}Z`);
    if (Number.isFinite(wall)) {
      const m = x.tz ? /^([+-])(\d{2}):(\d{2})$/.exec(x.tz) : null;
      out = wall - (m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000 : 0);
    }
  }
  instants.set(p, out);
  return out;
}

/** Nearest batch photo (±2 h) satisfying `usable`. */
function nearestInTime(it: Item, all: Item[], usable: (o: Item) => boolean): { other: Item; minutes: number } | null {
  const t = instant(it);
  if (t == null) return null;
  let best: { other: Item; diff: number } | null = null;
  for (const o of all) {
    if (o.id === it.id || o.stage !== 'ready' || !usable(o)) continue;
    const to = instant(o);
    if (to == null) continue;
    const diff = Math.abs(to - t);
    if (diff <= TWO_HOURS && (!best || diff < best.diff)) best = { other: o, diff };
  }
  return best ? { other: best.other, minutes: Math.round(best.diff / 60000) } : null;
}

/** "按拍摄时间推断": for a photo without GPS, the place of the nearest-in-time batch photo that has one. */
export function inferPlace(it: Item, all: Item[]): PlaceChoice | null {
  if (hasGps(it)) return null;
  const hit = nearestInTime(it, all, (o) => !!o.place);
  if (!hit?.other.place) return null;
  const src = hit.other.place;
  return {
    ...src,
    method: 'inferred',
    distance: null,
    area: undefined,
    inView: undefined,
    from: `按拍摄时间推断：与「${hit.other.file.name}」相差 ${hit.minutes < 1 ? '不到 1' : hit.minutes} 分钟`
  };
}

/** The place this photo will be published with. */
export function placeOf(it: Item, all: Item[]): PlaceChoice | null {
  if (it.place) return it.place;
  if (it.cleared) return null;
  return inferPlace(it, all);
}

/** Where a custom place for a photo without GPS would go: the nearest-in-time neighbour that has coordinates. */
export function customAtFor(it: Item, all: Item[]): { lat: number; lng: number } | null {
  const own = coordsOf(it);
  if (own) return own;
  const hit = nearestInTime(it, all, (o) => hasGps(o));
  return hit ? coordsOf(hit.other) : null;
}

export function suggestionsFor(it: Item, all: Item[]): string[] {
  if (!it.p) return [];
  const out: string[] = [];
  for (const id of [...subjectTagsForCategory(placeOf(it, all)?.category), ...it.p.suggestedTagIds]) if (!out.includes(id)) out.push(id);
  return out;
}

/** Every selected tag id (accepted suggestions plus hand-picked) and the suggestion list. */
export function tagState(it: Item, all: Item[]): { value: string[]; suggested: string[] } {
  const suggested = suggestionsFor(it, all);
  const off = new Set(it.dismissed);
  const value = suggested.filter((id) => !off.has(id));
  for (const id of it.picked) if (!value.includes(id)) value.push(id);
  return { value, suggested };
}

/** Turn the picker's new selection back into hand-picked tags and dismissed suggestions. */
export function tagPatch(it: Item, all: Item[], next: string[]): Pick<Item, 'picked' | 'dismissed'> {
  const suggested = suggestionsFor(it, all);
  const set = new Set(next);
  return { picked: next.filter((id) => !suggested.includes(id)), dismissed: suggested.filter((id) => !set.has(id)) };
}

export type StatusKey = 'processing' | 'matched' | 'review' | 'nogps' | 'hidden' | 'sending' | 'published' | 'duplicate' | 'failed';
export interface Status {
  key: StatusKey;
  label: string;
}

export function statusOf(it: Item, all: Item[]): Status {
  if (it.publish.state === 'done') return { key: 'published', label: '已发布' };
  if (it.publish.state === 'duplicate') return { key: 'duplicate', label: '已存在' };
  if (it.publish.state === 'sending') return { key: 'sending', label: '发布中' };
  if (it.stage === 'error' || it.publish.state === 'failed') return { key: 'failed', label: '失败' };
  if (it.stage !== 'ready') return { key: 'processing', label: '处理中' };
  if (it.match?.res?.privacyZone) return { key: 'hidden', label: '位置不公开' };
  if (placeOf(it, all)) return { key: 'matched', label: '已匹配' };
  if (hasGps(it)) return it.match?.loading ? { key: 'processing', label: '处理中' } : { key: 'review', label: '待确认' };
  return { key: 'nogps', label: '无位置' };
}

/** Can the publish button be pressed? */
export function canPublish(it: Item, all: Item[]): boolean {
  if (it.stage !== 'ready' || !it.p) return false;
  const s = statusOf(it, all).key;
  return s !== 'processing' && s !== 'sending' && s !== 'published' && s !== 'duplicate';
}

/** Photos that "发布全部已匹配" sends. */
export const isBulkReady = (it: Item, all: Item[]) =>
  it.stage === 'ready' && it.publish.state === 'idle' && statusOf(it, all).key === 'matched';

/** What happens when a match response arrives: record it and make the automatic decision once. */
export function applyMatch(cur: Item, res: MatchResponse, radius: number): Partial<Item> {
  const patch: Partial<Item> = { match: { radius, loading: false, error: null, res } };
  if (!cur.autoDone) {
    patch.autoDone = true;
    const top = res.candidates[0];
    if (!cur.place && !cur.cleared && shouldAutoMatch(top)) patch.place = choiceFromCandidate(top, 'auto');
    if (res.privacyZone && !cur.geoTouched) patch.geoPrivacy = 'hidden';
  }
  return patch;
}

export const freshMatch = (): MatchState => ({ ...initialMatch(), loading: true });

/** The `meta` part of POST /api/photos. */
export function buildMeta(it: Item, all: Item[]): CreatePhotoMeta {
  const p = it.p!;
  const x = p.exif;
  const place = placeOf(it, all);
  const pf = placeFields(place);
  const { suggested } = tagState(it, all);
  const off = new Set(it.dismissed);
  const suggestedTagIds = suggested.filter((id) => !off.has(id) && !it.picked.includes(id));
  const res = it.match?.res;
  return {
    title: it.title.trim() || null,
    note: it.note.trim() || null,
    takenAt: x.takenAt,
    tz: x.tz,
    lat: x.lat,
    lng: x.lng,
    alt: x.alt,
    heading: x.heading,
    geoPrivacy: it.geoPrivacy,
    province: res?.province ?? null,
    city: res?.city ?? place?.city ?? null,
    district: res?.district ?? place?.district ?? null,
    poiId: pf.poiId,
    newPoi: pf.newPoi,
    poiDistance: pf.poiDistance,
    poiMethod: pf.poiMethod,
    camera: x.camera,
    lens: x.lens,
    focal: x.focal,
    focal35: x.focal35,
    aperture: x.aperture,
    shutter: x.shutter,
    iso: x.iso,
    width: p.width,
    height: p.height,
    variantSizes: {
      s: [p.variants.s.w, p.variants.s.h],
      m: [p.variants.m.w, p.variants.m.h],
      l: [p.variants.l.w, p.variants.l.h]
    },
    thumbhash: p.thumbhash,
    palette: p.palette,
    focus: null,
    visibility: it.visibility,
    inLiving: it.inLiving,
    favorite: it.favorite,
    sha256: p.sha256,
    tagIds: [...it.picked],
    suggestedTagIds,
    themeIds: [...it.themeIds]
  };
}

/** The multipart body for POST /api/photos. */
export function buildForm(it: Item, all: Item[]): FormData {
  const p = it.p!;
  const fd = new FormData();
  fd.append('meta', JSON.stringify(buildMeta(it, all)));
  fd.append('original', it.file, it.file.name);
  for (const k of ['s', 'm', 'l'] as const) fd.append(k, p.variants[k].blob, `${k}.${p.variants[k].ext}`);
  return fd;
}
