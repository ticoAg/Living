import type { MarkerOptions } from 'maplibre-gl';

// The DOM of a point marker (.map-pt) for MapView's plain markers.

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  /** number shown in the marker; omit for a plain photo dot */
  count?: number;
  label?: string;
  selected?: boolean;
  muted?: boolean;
  /** what a screen reader says for the marker, instead of the label and count */
  title?: string;
  onClick?: () => void;
}

const ariaLabel = (p: MapPoint) => p.title ?? (p.label ? `${p.label}${p.count != null ? `，${p.count} 张` : ''}` : '地点');

/** `onClick` is what a click calls; it defaults to the point's own handler. */
export function pointElement(p: MapPoint, onClick: (() => void) | undefined = p.onClick): HTMLElement {
  const el = document.createElement(onClick ? 'button' : 'span');
  el.className = 'map-pt';
  el.dataset.selected = String(!!p.selected);
  el.dataset.muted = String(!!p.muted);
  if (onClick) {
    (el as HTMLButtonElement).type = 'button';
    el.setAttribute('aria-label', ariaLabel(p));
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
  }
  if (p.count != null) {
    const dot = document.createElement('span');
    dot.className = 'map-pt-dot';
    dot.textContent = String(p.count);
    el.appendChild(dot);
  } else {
    const dot = document.createElement('span');
    dot.className = 'map-pt-photo';
    el.appendChild(dot);
  }
  if (p.label) {
    const label = document.createElement('span');
    label.className = 'map-pt-label';
    label.textContent = p.label;
    el.appendChild(label);
  }
  return el;
}

/** MapLibre writes an inline `opacity` on every marker, which beats any stylesheet rule; muted markers fade through the marker. */
export const MUTED_OPACITY = '0.45';

export const pointMarkerOptions = (p: MapPoint): Pick<MarkerOptions, 'anchor' | 'offset' | 'opacity'> => ({
  anchor: p.label ? 'left' : 'center',
  offset: p.label ? [-13, 0] : [0, 0],
  opacity: p.muted ? MUTED_OPACITY : '1'
});
