// MapView refits whenever its points change, which would undo the visitor's pan and zoom every time a
// filter chip or a marker is clicked. Pages that need a stable view compute the initial view here from
// the measured box and hand MapView `fit={false}` with a `key` that changes only when the view should.

export interface MapViewport {
  /** [lat, lng] */
  center: [number, number];
  zoom: number;
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const unMercY = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

/** Viewport that contains every [lat, lng] in a box of `size` px (MapLibre: world = 512·2^zoom px). */
export function fitViewport(
  coords: readonly [number, number][],
  size: { w: number; h: number },
  opts: {
    padding?: number;
    maxZoom?: number;
    singleZoom?: number;
    /** extra px kept free on the right, for marker labels that extend past their dot */
    right?: number;
  } = {}
): MapViewport | null {
  if (!coords.length) return null;
  const pad = opts.padding ?? 56;
  const maxZoom = opts.maxZoom ?? 16;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [la, ln] of coords) {
    minLat = Math.min(minLat, la);
    maxLat = Math.max(maxLat, la);
    minLng = Math.min(minLng, ln);
    maxLng = Math.max(maxLng, ln);
  }
  const right = opts.right ?? 0;
  const mid: [number, number] = [unMercY((mercY(minLat) + mercY(maxLat)) / 2), (minLng + maxLng) / 2];
  const lngFrac = (maxLng - minLng) / 360;
  const latFrac = (mercY(maxLat) - mercY(minLat)) / (2 * Math.PI);
  let zoom: number;
  if (lngFrac <= 1e-9 && latFrac <= 1e-9) {
    zoom = opts.singleZoom ?? 15;
  } else {
    const availW = Math.max(80, size.w - pad * 2 - right);
    const availH = Math.max(80, size.h - pad * 2);
    const zx = lngFrac > 0 ? Math.log2(availW / (512 * lngFrac)) : Infinity;
    const zy = latFrac > 0 ? Math.log2(availH / (512 * latFrac)) : Infinity;
    zoom = Math.max(1, Math.min(zx, zy, maxZoom));
  }
  // the reserved strip sits on the right, so the view centre moves east by half of it
  const center: [number, number] = [mid[0], mid[1] + (right / 2 / (512 * 2 ** zoom)) * 360];
  return { center, zoom };
}
