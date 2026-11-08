import { useMemo } from 'react';
import type { MatchCandidate } from '../../shared/types';
import { isPickable } from './match';

// The match plot: the shot position at the centre, concentric rings at 50/100/200/300 m, the camera's
// ±30° cone, the dashed matching radius, and candidates numbered by rank at their bearing and distance.
// Area places (a lake you stand in) have no bearing, so they sit in a row along the bottom edge.

const SIZE = 320;
const C = SIZE / 2;
const RMAX = 136;
const RINGS = [50, 100, 200, 300];
const MARKER = 11;

const rad = (d: number) => (d * Math.PI) / 180;
const polar = (deg: number, r: number): [number, number] => [C + r * Math.sin(rad(deg)), C - r * Math.cos(rad(deg))];

interface Pt {
  c: MatchCandidate;
  rank: number;
  x: number;
  y: number;
  area: boolean;
  far: boolean;
}

/** Nudge overlapping markers apart (a few pixels at most) so every number stays readable. */
function layout(candidates: MatchCandidate[], k: number): Pt[] {
  const pts: Pt[] = candidates.map((c, i) => {
    if (c.area) return { c, rank: i + 1, x: 0, y: 0, area: true, far: false };
    const far = c.distance * k > RMAX;
    const [x, y] = polar(c.bearing, Math.min(c.distance * k, RMAX + 4));
    return { c, rank: i + 1, x, y, area: false, far };
  });
  const free = pts.filter((p) => !p.area);
  const MIN = MARKER * 2 + 1;
  for (let it = 0; it < 30; it++) {
    let moved = false;
    free.forEach((a, i) => {
      let dx = a.x - C;
      let dy = a.y - C;
      let d = Math.hypot(dx, dy);
      const keep = MARKER + 7; // clear of the photo's own dot
      if (d < keep) {
        if (d < 0.01) {
          dx = Math.sin(rad(a.c.bearing));
          dy = -Math.cos(rad(a.c.bearing));
          d = 1;
        }
        a.x = C + (dx / d) * keep;
        a.y = C + (dy / d) * keep;
        moved = true;
      }
      for (let j = i + 1; j < free.length; j++) {
        const b = free[j];
        dx = b.x - a.x;
        dy = b.y - a.y;
        d = Math.hypot(dx, dy);
        if (d >= MIN) continue;
        if (d < 0.01) {
          dx = Math.cos(i + j);
          dy = Math.sin(i + j);
          d = 1;
        }
        const push = (MIN - d) / 2;
        a.x -= (dx / d) * push;
        a.y -= (dy / d) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d) * push;
        moved = true;
      }
    });
    if (!moved) break;
  }
  for (const p of free) {
    const dx = p.x - C;
    const dy = p.y - C;
    const d = Math.hypot(dx, dy);
    const lim = RMAX + 8;
    if (d > lim) {
      p.x = C + (dx / d) * lim;
      p.y = C + (dy / d) * lim;
    }
  }
  pts.filter((p) => p.area).forEach((p, i) => {
    p.x = 22 + i * (MARKER * 2 + 6);
    p.y = SIZE - 16;
  });
  return pts;
}

interface Props {
  radius: number;
  heading: number | null;
  candidates: MatchCandidate[];
  selectedKey: string | null;
  activeKey?: string | null;
  onPick?: (c: MatchCandidate) => void;
  onActive?: (key: string | null) => void;
}

export default function MatchPlot({ radius, heading, candidates, selectedKey, activeKey, onPick, onActive }: Props) {
  const viewR = Math.max(radius * 1.15, 80);
  const k = RMAX / viewR;
  const pts = useMemo(() => layout(candidates, k), [candidates, k]);
  const rings = RINGS.filter((r) => r < viewR * 0.985);

  let cone: string | null = null;
  if (heading != null) {
    const [x0, y0] = polar(heading - 30, RMAX);
    const [x1, y1] = polar(heading + 30, RMAX);
    cone = `M ${C} ${C} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${RMAX} ${RMAX} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;
  }
  const [hx, hy] = heading != null ? polar(heading, RMAX) : [C, C];
  const [rx, ry] = polar(45, radius * k);

  const label =
    `匹配图：以拍摄点为圆心，匹配半径 ${radius} 米，` +
    (heading != null ? `镜头朝向 ${Math.round(heading)} 度，` : '无镜头朝向，') +
    `${candidates.length} 个候选地点。`;

  const ordered = [...pts].sort((a, b) => Number(a.c.key === selectedKey) - Number(b.c.key === selectedKey) || Number(a.c.key === activeKey) - Number(b.c.key === activeKey));

  return (
    <svg className="mp" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={label}>
      <rect className="mp-bg" x="0.5" y="0.5" width={SIZE - 1} height={SIZE - 1} />
      <line className="mp-axis" x1={C} y1="14" x2={C} y2={SIZE - 14} />
      <line className="mp-axis" x1="14" y1={C} x2={SIZE - 14} y2={C} />
      {rings.map((r) => (
        <g key={r}>
          <circle className="mp-ring" cx={C} cy={C} r={r * k} />
          <text className="mp-ring-label" x={C + 3} y={C + r * k + 10}>{r}{r === rings[rings.length - 1] ? ' m' : ''}</text>
        </g>
      ))}
      {cone && <path className="mp-cone" d={cone} />}
      {cone && <line className="mp-heading" x1={C} y1={C} x2={hx} y2={hy} />}
      <circle className="mp-radius" cx={C} cy={C} r={radius * k} />
      <text className="mp-radius-label" x={rx + 4} y={ry - 3}>{radius} m</text>
      <path className="mp-north" d={`M ${C} 5 l -4 9 h 8 z`} />
      <text className="mp-north-label" x={C + 8} y="13">N</text>

      {ordered.map((p) => {
        const pickable = isPickable(p.c, radius);
        const selected = p.c.key === selectedKey;
        const active = p.c.key === activeKey;
        return (
          <g
            key={p.c.key}
            className="mp-pt"
            transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
            data-selected={selected}
            data-active={active}
            data-view={p.c.inView}
            data-muted={!pickable}
            data-area={p.area}
            data-pickable={pickable}
            onClick={() => pickable && onPick?.(p.c)}
            onMouseEnter={() => onActive?.(p.c.key)}
            onMouseLeave={() => onActive?.(null)}
          >
            {p.area ? <rect x={-MARKER} y={-MARKER} width={MARKER * 2} height={MARKER * 2} rx="5" /> : <circle r={MARKER} />}
            <text textAnchor="middle" dominantBaseline="central">{p.rank}</text>
            {(selected || active) && (
              <text className="mp-name" x={p.x < C ? -MARKER - 5 : MARKER + 5} y="1" textAnchor={p.x < C ? 'end' : 'start'} dominantBaseline="central">
                {p.c.name}
              </text>
            )}
          </g>
        );
      })}

      <g className="mp-photo">
        <circle r="7" cx={C} cy={C} className="mp-photo-halo" />
        <circle r="4" cx={C} cy={C} className="mp-photo-dot" />
      </g>
    </svg>
  );
}
