import { useMemo, useRef } from 'react';
import type { MatchCandidate } from '../../shared/types';
import MapView, { type MapPoint, type MapShapes } from '../components/MapView';
import { isPickable, type PlaceChoice } from './match';

// The place match on a real map: the photo's position, the matching radius, the camera's ±30° view, every candidate
// numbered as in the list, and the results of a name search lettered as in theirs. Clicking a number or letter picks
// that place; candidates beyond the radius are faded and not clickable. A photo without a position shows only the
// search results and the chosen place. Docs: /docs/product/features/poi-matching.md

interface At {
  lat: number;
  lng: number;
}

/** A, B, … Z for search results, then numbers past the alphabet. */
export const resultMark = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));

/**
 * The map's points: the photo first, then the candidates and the search results, then the chosen place when it is in
 * neither list, the chosen one last so it is drawn on top.
 */
export function matchMapPoints(
  at: At | null,
  candidates: readonly MatchCandidate[],
  results: readonly MatchCandidate[],
  selected: PlaceChoice | null,
  radius: number,
  onPick: ((c: MatchCandidate) => void) | null
): MapPoint[] {
  const key = selected?.key ?? null;
  const ranked = candidates.map((c, i): MapPoint => {
    const pickable = isPickable(c, radius);
    const on = c.key === key;
    return {
      id: c.key,
      lat: c.lat,
      lng: c.lng,
      count: i + 1,
      label: on ? c.name : undefined,
      title: `${i + 1}. ${c.name}${pickable ? '' : '（超出匹配半径）'}`,
      selected: on,
      muted: !pickable,
      onClick: pickable && onPick ? () => onPick(c) : undefined
    };
  });
  const found = results.map((c, i): MapPoint => {
    const on = c.key === key;
    return {
      id: `q:${c.key}`,
      lat: c.lat,
      lng: c.lng,
      count: resultMark(i),
      label: on ? c.name : undefined,
      title: `${resultMark(i)}. ${c.name}`,
      selected: on,
      onClick: onPick ? () => onPick(c) : undefined
    };
  });
  const listed = [...ranked, ...found];
  const elsewhere: MapPoint[] =
    selected && selected.lat != null && selected.lng != null && !listed.some((p) => p.selected)
      ? [{ id: `sel:${selected.key}`, lat: selected.lat, lng: selected.lng, label: selected.name, title: selected.name, selected: true }]
      : [];
  return [
    ...(at ? [{ id: 'photo', lat: at.lat, lng: at.lng, title: '拍摄位置' }] : []),
    ...listed.filter((p) => !p.selected),
    ...listed.filter((p) => p.selected),
    ...elsewhere
  ];
}

interface Props {
  /** the photo's position; null for a photo without one */
  at: At | null;
  heading: number | null;
  radius: number;
  candidates: readonly MatchCandidate[];
  /** a name search's results, lettered */
  results?: readonly MatchCandidate[];
  selected: PlaceChoice | null;
  onPick: (c: MatchCandidate) => void;
  disabled?: boolean;
  className?: string;
}

export default function MatchMap({ at, heading, radius, candidates, results = [], selected, onPick, disabled, className }: Props) {
  // A fresh callback each render must not rebuild every marker; the markers call through this ref.
  const pick = useRef(onPick);
  pick.current = onPick;
  const lat = at?.lat ?? null;
  const lng = at?.lng ?? null;
  const points = useMemo(
    () =>
      matchMapPoints(
        lat != null && lng != null ? { lat, lng } : null,
        candidates,
        results,
        selected,
        radius,
        disabled ? null : (c) => pick.current(c)
      ),
    [lat, lng, candidates, results, selected, radius, disabled]
  );
  const shapes = useMemo<MapShapes>(
    () =>
      lat != null && lng != null
        ? { circles: [{ id: 'radius', lat, lng, radius }], cones: heading === null ? [] : [{ id: 'view', lat, lng, heading, radius }] }
        : {},
    [lat, lng, heading, radius]
  );
  // refit when the photo, the radius or the search results change, not when a place is picked
  const where = lat != null && lng != null ? `${lat.toFixed(5)},${lng.toFixed(5)},${radius}` : selected ? `sel:${selected.key}` : '';
  const fitKey = `${where}|${results.map((r) => r.key).join(',')}`;
  return (
    <MapView
      ariaLabel={results.length ? '匹配地图，含搜索结果' : '匹配地图'}
      className={className ?? 'pk-map'}
      points={points}
      shapes={shapes}
      fitKey={fitKey}
      maxZoom={18}
      cooperativeGestures
    />
  );
}
