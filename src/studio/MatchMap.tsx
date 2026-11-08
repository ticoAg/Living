import { useMemo, useRef } from 'react';
import type { MatchCandidate } from '../../shared/types';
import MapView, { type MapPoint, type MapShapes } from '../components/MapView';
import { isPickable } from './match';

// The place match on a real map: the photo's position, the matching radius, the camera's ±30° view, and every candidate
// numbered as in the list. Clicking a number picks that place; candidates beyond the radius are faded and not clickable.
// Docs: /docs/product/features/poi-matching.md

interface At {
  lat: number;
  lng: number;
}

/** The map's points: the photo first, then the candidates (the chosen one last, so it is drawn on top). */
export function matchMapPoints(
  at: At,
  candidates: readonly MatchCandidate[],
  selectedKey: string | null,
  radius: number,
  onPick: ((c: MatchCandidate) => void) | null
): MapPoint[] {
  const ranked = candidates.map((c, i): MapPoint => {
    const pickable = isPickable(c, radius);
    const selected = c.key === selectedKey;
    return {
      id: c.key,
      lat: c.lat,
      lng: c.lng,
      count: i + 1,
      label: selected ? c.name : undefined,
      title: `${i + 1}. ${c.name}${pickable ? '' : '（超出匹配半径）'}`,
      selected,
      muted: !pickable,
      onClick: pickable && onPick ? () => onPick(c) : undefined
    };
  });
  const chosen = ranked.filter((p) => p.selected);
  return [{ id: 'photo', lat: at.lat, lng: at.lng, title: '拍摄位置' }, ...ranked.filter((p) => !p.selected), ...chosen];
}

interface Props {
  at: At;
  heading: number | null;
  radius: number;
  candidates: readonly MatchCandidate[];
  selectedKey: string | null;
  onPick: (c: MatchCandidate) => void;
  disabled?: boolean;
}

export default function MatchMap({ at, heading, radius, candidates, selectedKey, onPick, disabled }: Props) {
  // A fresh callback each render must not rebuild every marker; the markers call through this ref.
  const pick = useRef(onPick);
  pick.current = onPick;
  const { lat, lng } = at;
  const points = useMemo(
    () => matchMapPoints({ lat, lng }, candidates, selectedKey, radius, disabled ? null : (c) => pick.current(c)),
    [lat, lng, candidates, selectedKey, radius, disabled]
  );
  const shapes = useMemo<MapShapes>(
    () => ({
      circles: [{ id: 'radius', lat, lng, radius }],
      cones: heading === null ? [] : [{ id: 'view', lat, lng, heading, radius }]
    }),
    [lat, lng, heading, radius]
  );
  return (
    <MapView
      ariaLabel="匹配地图"
      className="pk-map"
      points={points}
      shapes={shapes}
      fitKey={`${lat.toFixed(5)},${lng.toFixed(5)},${radius}`}
      maxZoom={18}
      cooperativeGestures
    />
  );
}
