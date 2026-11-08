import { useId, useMemo } from 'react';
import type { PoiDetail } from '../../shared/types';
import { dms } from '../../shared/geo';
import MapView, { type MapPoint, type MapShapes } from '../components/MapView';
import { RADIUS_STOPS, nearestStop, parseRadius } from './place-draft';
import { useKeep } from './util';

// The matching radius of a place (the /studio/place/:id form): a number, a slider through round values, and a small
// map that draws the circle around the place's centre while it is being changed.

interface Props {
  place: Pick<PoiDetail, 'lat' | 'lng'>;
  /** as typed */
  value: string;
  error?: string;
  onChange: (text: string) => void;
  disabled?: boolean;
}

export default function PlaceRadius({ place, value, error, onChange, disabled }: Props) {
  const id = useId();
  const { lat, lng } = place;
  // while the number is half-typed or out of range, the circle keeps the last radius that was valid
  const radius = useKeep(parseRadius(value) ?? undefined) ?? RADIUS_STOPS[0];

  const points = useMemo<MapPoint[]>(() => [{ id: 'place', lat, lng }], [lat, lng]);
  const shapes = useMemo<MapShapes>(() => ({ circles: [{ id: 'radius', lat, lng, radius }] }), [lat, lng, radius]);

  return (
    <section className="pl-radius" aria-label="匹配半径">
      <div className="field">
        <label className="label" htmlFor={`${id}-n`}>
          匹配半径
        </label>
        <div className="pl-radius-row">
          <input
            type="range"
            className="pk-range"
            min={0}
            max={RADIUS_STOPS.length - 1}
            step={1}
            value={nearestStop(radius)}
            onChange={(e) => onChange(String(RADIUS_STOPS[Number(e.target.value)]))}
            disabled={disabled}
            aria-label="调整匹配半径"
            aria-valuetext={`${radius} 米`}
          />
          <span className="pl-radius-n">
            <input
              id={`${id}-n`}
              className="input mono"
              inputMode="numeric"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              autoComplete="off"
              disabled={disabled}
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-err` : undefined}
            />
            <span className="mono">m</span>
          </span>
        </div>
        {error && (
          <span id={`${id}-err`} className="error-text small">
            {error}
          </span>
        )}
      </div>
      <MapView
        className="pl-map"
        ariaLabel={`匹配半径 ${radius} 米的范围`}
        points={points}
        shapes={shapes}
        center={[lat, lng]}
        zoom={16}
        maxZoom={19}
        interactive={false}
      />
      <p className="pl-coord mono small muted">
        <span>{dms(lat, 'N', 'S', 1)}</span>
        <span>{dms(lng, 'E', 'W', 1)}</span>
      </p>
    </section>
  );
}
