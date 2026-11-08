import { useCallback, useEffect, useRef, useState } from 'react';
import type { MatchCandidate, MatchResponse, NewPoi, Poi, PoiMethod } from '../../shared/types';
import { distance } from '../../shared/geo';
import { api } from '../lib/api';
import { errMsg } from './util';

// POI matching helpers shared by the upload page and the photo editor.
// Docs: /docs/product/features/poi-matching.md, /docs/api/pois.md

export const DEFAULT_RADIUS = 300;
export const MIN_RADIUS = 30;
export const MAX_RADIUS = 1000;

/** A place as the studio holds it: what to show, and what to send when saving. */
export interface PlaceChoice {
  /** matches `MatchCandidate.key` (poi id, or `source:sourceId`) */
  key: string;
  /** existing place: send `poiId` */
  poiId: string | null;
  /** provider result to create on save: send `newPoi` */
  newPoi: NewPoi | null;
  name: string;
  category: string;
  lat: number | null;
  lng: number | null;
  city: string | null;
  district: string | null;
  method: PoiMethod;
  /** metres from the photo, when known */
  distance: number | null;
  area?: boolean;
  inView?: boolean;
  /** why this was suggested, for time-inferred places */
  from?: string;
}

export interface MatchState {
  radius: number;
  loading: boolean;
  error: string | null;
  res: MatchResponse | null;
}
export const initialMatch = (): MatchState => ({ radius: DEFAULT_RADIUS, loading: false, error: null, res: null });

/** Candidates beyond the matching radius are shown but cannot be chosen (area places always can). */
export const isPickable = (c: MatchCandidate, radius: number) => c.area || c.distance <= radius;

/** Top candidate within 25 m and in view, or within 15 m: take it without asking. */
export function shouldAutoMatch(top: MatchCandidate | undefined): boolean {
  return !!top && ((top.distance <= 25 && top.inView) || top.distance <= 15);
}

export function choiceFromCandidate(c: MatchCandidate, method: PoiMethod): PlaceChoice {
  const local = !!c.poiId;
  return {
    key: c.key,
    poiId: c.poiId,
    newPoi: local
      ? null
      : {
          name: c.name,
          category: c.category,
          lat: c.lat,
          lng: c.lng,
          city: c.city,
          district: c.district,
          source: c.source === 'local' ? 'custom' : c.source,
          sourceId: c.sourceId
        },
    name: c.name,
    category: c.category,
    lat: c.lat,
    lng: c.lng,
    city: c.city,
    district: c.district,
    method,
    distance: c.area ? 0 : c.distance,
    area: c.area,
    inView: c.inView
  };
}

export function choiceFromPoi(poi: Poi, method: PoiMethod, from?: { lat: number; lng: number } | null): PlaceChoice {
  return {
    key: poi.id,
    poiId: poi.id,
    newPoi: null,
    name: poi.name,
    category: poi.category,
    lat: poi.lat,
    lng: poi.lng,
    city: poi.city,
    district: poi.district,
    method,
    distance: from ? Math.round(distance(from.lat, from.lng, poi.lat, poi.lng)) : null
  };
}

/** Fields of POST /api/photos meta and PATCH /api/photos/:id that carry the place. */
export function placeFields(choice: PlaceChoice | null) {
  return {
    poiId: choice?.poiId ?? null,
    newPoi: choice?.poiId ? null : (choice?.newPoi ?? null),
    poiDistance: choice?.distance != null ? Math.round(choice.distance) : null,
    poiMethod: choice ? choice.method : null
  };
}

export const matchPois = (lat: number, lng: number, heading: number | null, radius: number, signal?: AbortSignal) =>
  api<MatchResponse>('/api/pois/match', { json: { lat, lng, heading, radius }, signal });

export async function searchPois(q: string, at: { lat: number; lng: number } | null, signal?: AbortSignal): Promise<MatchCandidate[]> {
  const params = new URLSearchParams({ q });
  if (at) {
    params.set('lat', String(at.lat));
    params.set('lng', String(at.lng));
  }
  const res = await api<{ results: MatchCandidate[] }>(`/api/pois/search?${params}`, { signal });
  return res.results ?? [];
}

export async function createPoi(body: NewPoi): Promise<Poi> {
  const res = await api<{ poi: Poi }>('/api/pois', { json: body });
  return res.poi;
}

/**
 * Match state for a single photo (the editor). Call `start()` to run the first match; changing the radius
 * re-queries after a short pause. The last request wins.
 */
export function useMatch(at: { lat: number; lng: number; heading: number | null } | null) {
  const [state, setState] = useState<MatchState>(initialMatch);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lat = at?.lat;
  const lng = at?.lng;
  const heading = at?.heading ?? null;

  const run = useCallback(
    async (radius: number) => {
      if (lat == null || lng == null) return;
      const mine = ++seq.current;
      setState((s) => ({ ...s, radius, loading: true, error: null }));
      try {
        const res = await matchPois(lat, lng, heading, radius);
        if (mine === seq.current) setState({ radius, loading: false, error: null, res });
      } catch (e) {
        if (mine === seq.current) setState((s) => ({ ...s, loading: false, error: errMsg(e, '地点匹配失败') }));
      }
    },
    [lat, lng, heading]
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  const setRadius = useCallback(
    (radius: number) => {
      setState((s) => ({ ...s, radius }));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(radius), 350);
    },
    [run]
  );

  return {
    state,
    start: useCallback(() => run(DEFAULT_RADIUS), [run]),
    setRadius,
    retry: useCallback(() => run(state.radius), [run, state.radius])
  };
}

export const METHOD_LABEL: Record<PoiMethod, string> = {
  auto: '自动匹配',
  confirmed: '已确认',
  inferred: '按拍摄时间推断',
  manual: '手动选择'
};

export const PROVIDER_LABEL: Record<MatchResponse['provider'], string> = {
  amap: '高德',
  osm: 'OpenStreetMap',
  local: '仅站内地点'
};
