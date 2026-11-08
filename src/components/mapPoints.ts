import type { MarkerOptions } from 'maplibre-gl';

// The DOM of a point marker (.map-pt), shared by MapView's plain markers and its cluster layer.

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  /** number shown in the marker; omit for a plain photo dot */
  count?: number;
  label?: string;
  selected?: boolean;
  muted?: boolean;
  onClick?: () => void;
}

const ariaLabel = (p: MapPoint) => (p.label ? `${p.label}${p.count != null ? `，${p.count} 张` : ''}` : '地点');

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

/** Points with the same shape can be updated in place with `patchPoint`; a different shape needs a new element. */
export const pointShape = (p: MapPoint) => `${p.onClick ? 'b' : 's'}${p.count != null ? 'n' : 'p'}${p.label ? 'l' : ''}`;

/** Brings an element made by `pointElement` up to date with the point (same `pointShape`). */
export function patchPoint(el: HTMLElement, p: MapPoint): void {
  const selected = String(!!p.selected);
  const muted = String(!!p.muted);
  if (el.dataset.selected !== selected) el.dataset.selected = selected;
  if (el.dataset.muted !== muted) el.dataset.muted = muted;
  if (p.onClick) el.setAttribute('aria-label', ariaLabel(p));
  const dot = el.firstElementChild;
  if (dot && p.count != null && dot.textContent !== String(p.count)) dot.textContent = String(p.count);
  if (p.label && el.lastElementChild && el.lastElementChild.textContent !== p.label) el.lastElementChild.textContent = p.label;
}
