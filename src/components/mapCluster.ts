import type { GeoJSONSource, Map as MLMap, MapSourceDataEvent, Marker } from 'maplibre-gl';
import type { Feature, FeatureCollection, Point } from 'geojson';
import { patchPoint, pointElement, pointMarkerOptions, pointShape, type MapPoint } from './mapPoints';

// Marker clustering for MapView. MapLibre's GeoJSON source clusters the points in its worker; the markers
// themselves stay HTML, so a cluster looks like a place dot with a bigger number. Markers are pooled (a place by
// its id, a cluster by its position): moving the map only adds and removes the ones that enter or leave the view.
//
//  - every point is a feature carrying its photo count (`n`), whether it is muted (`live` is 0) and whether
//    it is selected (`sel`); `clusterProperties` sums and maxes them, so a cluster knows its photo total,
//    whether it is muted (nothing live inside) and whether the selection is inside it
//  - the source only loads tiles while a visible layer uses it, hence the invisible probe layer

type Lib = typeof import('maplibre-gl');

export interface ClusterLayer {
  /** Show these points; the clustering is recomputed only when positions, counts, muting or the selection change. */
  update(points: readonly MapPoint[]): void;
  destroy(): void;
}

interface PointProps {
  pid: string;
  n: number;
  live: number;
  sel: number;
}
interface ClusterProps {
  cluster_id: number;
  point_count: number;
  n: number;
  live: number;
  sel: number;
}
type PointFeature = Feature<Point, PointProps>;

interface Entry {
  marker: Marker;
  el: HTMLElement;
  /** place id, or the cluster id */
  id: string | number;
  cluster: boolean;
  lng: number;
  lat: number;
  /** `pointShape` of a point; decides between patching the element and building a new one */
  shape: string;
  muted: boolean;
}
type Want =
  | { key: string; cluster: false; p: MapPoint }
  | { key: string; cluster: true; id: number; lng: number; lat: number; c: ClusterProps };

const SOURCE = 'lv-points';
const PROBE = 'lv-points-probe';
/** screen pixels (at the zoom the clusters were built for, so up to twice that on screen) within which points merge */
const RADIUS = 80;
/** from the next zoom on, points are never clustered */
const MAX_ZOOM = 16;
/** markers are kept this far (fraction of the view) outside the view, so a pan does not pop them in at the edge */
const MARGIN = 0.25;
/** while the map is moving, look at the clusters at most this often; the end of a move and tile loads always do */
const MOVE_STEP_MS = 90;
/** MapLibre sets an inline `opacity: 1` on every marker, which beats the stylesheet's `.map-pt[data-muted]`; fade through the marker instead */
const MUTED_OPACITY = '0.45';

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

export function pointFeatures(points: readonly MapPoint[]): PointFeature[] {
  return points.map((p) => ({
    type: 'Feature',
    properties: { pid: p.id, n: p.count ?? 1, live: p.muted ? 0 : 1, sel: p.selected ? 1 : 0 },
    geometry: { type: 'Point', coordinates: [p.lng, p.lat] }
  }));
}

export function sameFeatures(a: readonly PointFeature[], b: readonly PointFeature[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const [x, y] = [a[i], b[i]];
    const [p, q] = [x.properties, y.properties];
    if (p.pid !== q.pid || p.n !== q.n || p.live !== q.live || p.sel !== q.sel) return false;
    if (x.geometry.coordinates[0] !== y.geometry.coordinates[0] || x.geometry.coordinates[1] !== y.geometry.coordinates[1]) return false;
  }
  return true;
}

type Box = [west: number, south: number, east: number, north: number];

function paddedView(map: MLMap): Box {
  const b = map.getBounds();
  const dx = (b.getEast() - b.getWest()) * MARGIN;
  const dy = (b.getNorth() - b.getSouth()) * MARGIN;
  return [b.getWest() - dx, b.getSouth() - dy, b.getEast() + dx, b.getNorth() + dy];
}

/** Whether a position is in the box; longitudes are also tried one world to either side, since the map repeats. */
export function inBox([w, s, e, n]: Box, lng: number, lat: number): boolean {
  if (lat < s || lat > n) return false;
  if (e - w >= 360) return true;
  return (lng >= w && lng <= e) || (lng - 360 >= w && lng - 360 <= e) || (lng + 360 >= w && lng + 360 <= e);
}

/**
 * A cluster is known by where it is, not by its id: ids are renumbered when the data changes, and a cluster at the date line
 * exists in both world copies under two ids (at +180 and -180), which is one cluster.
 */
export const clusterKey = (lng: number, lat: number) =>
  `c${Math.round((((((lng + 180) % 360) + 360) % 360) - 180) * 1e5)},${Math.round(lat * 1e5)}`;

const sizeOf = (places: number) => (places < 10 ? 's' : places < 40 ? 'm' : 'l');

function clusterElement(onClick: () => void): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'map-pt map-pt-cluster';
  const dot = document.createElement('span');
  dot.className = 'map-pt-dot';
  el.appendChild(dot);
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return el;
}

function patchCluster(el: HTMLElement, c: ClusterProps): void {
  el.dataset.size = sizeOf(c.point_count);
  el.dataset.selected = String(c.sel > 0);
  el.dataset.muted = String(c.live === 0);
  el.setAttribute('aria-label', `${c.point_count} 个地点，${c.n} 张${c.sel > 0 ? '，含所选地点' : ''}，放大查看`);
  const dot = el.firstElementChild;
  if (dot && dot.textContent !== String(c.n)) dot.textContent = String(c.n);
}

export function createClusterLayer(lib: Lib, map: MLMap): ClusterLayer {
  map.addSource(SOURCE, {
    type: 'geojson',
    data: EMPTY,
    cluster: true,
    clusterRadius: RADIUS,
    clusterMaxZoom: MAX_ZOOM,
    clusterProperties: { n: ['+', ['get', 'n']], live: ['+', ['get', 'live']], sel: ['max', ['get', 'sel']] }
  });
  map.addLayer({ id: PROBE, type: 'circle', source: SOURCE, paint: { 'circle-radius': 0, 'circle-opacity': 0 } });

  const entries = new Map<string, Entry>();
  let byId = new Map<string, MapPoint>();
  let features: PointFeature[] = [];
  let destroyed = false;
  let frame = 0;
  let lastMove = 0;

  const remove = (key: string, e: Entry) => {
    e.marker.remove();
    entries.delete(key);
  };

  const fade = (e: Entry, muted: boolean) => {
    if (e.muted === muted) return;
    e.muted = muted;
    e.marker.setOpacity(muted ? MUTED_OPACITY : '1');
  };

  function expand(e: Entry) {
    const src = map.getSource(SOURCE) as GeoJSONSource | undefined;
    if (!src || !e.cluster) return;
    const center: [number, number] = [e.lng, e.lat];
    // the zoom where the cluster falls apart, but never less than one level in, so a click always visibly zooms
    const go = (zoom: number) => {
      if (!destroyed) map.easeTo({ center, zoom: Math.min(Math.max(zoom, map.getZoom() + 1), map.getMaxZoom()), duration: 450 });
    };
    src.getClusterExpansionZoom(e.id as number).then(go, () => go(0));
  }

  // clusters sit above places, so they stay clickable where a label runs over them; the selected place above the other places
  const stack = (e: Entry, p?: MapPoint) => {
    e.el.style.zIndex = !p ? '3' : p.selected ? '2' : '1';
  };

  function putPoint(p: MapPoint, old: Entry | undefined) {
    const shape = pointShape(p);
    let e = old;
    if (e && e.shape !== shape) {
      remove(`p${p.id}`, e);
      e = undefined;
    }
    if (e) {
      patchPoint(e.el, p);
      if (e.lng !== p.lng || e.lat !== p.lat) {
        e.marker.setLngLat([p.lng, p.lat]);
        e.lng = p.lng;
        e.lat = p.lat;
      }
    } else {
      const el = pointElement(p, p.onClick ? () => byId.get(p.id)?.onClick?.() : undefined);
      const marker = new lib.Marker({ element: el, ...pointMarkerOptions(p) }).setLngLat([p.lng, p.lat]).addTo(map);
      e = { marker, el, id: p.id, cluster: false, lng: p.lng, lat: p.lat, shape, muted: false };
      entries.set(`p${p.id}`, e);
    }
    stack(e, p);
    fade(e, !!p.muted);
  }

  function putCluster(w: Extract<Want, { cluster: true }>, old: Entry | undefined) {
    let e = old;
    if (e) {
      if (e.lng !== w.lng || e.lat !== w.lat) {
        e.marker.setLngLat([w.lng, w.lat]);
        e.lng = w.lng;
        e.lat = w.lat;
      }
    } else {
      const el = clusterElement(() => {
        const cur = entries.get(w.key);
        if (cur) expand(cur);
      });
      const marker = new lib.Marker({ element: el }).setLngLat([w.lng, w.lat]).addTo(map);
      e = { marker, el, id: w.id, cluster: true, lng: w.lng, lat: w.lat, shape: '', muted: false };
      entries.set(w.key, e);
    }
    e.id = w.id;
    patchCluster(e.el, w.c);
    stack(e);
    fade(e, w.c.live === 0);
  }

  /** Reconcile the markers with what the source has for the current view. */
  function sync() {
    if (destroyed || !map.getSource(SOURCE)) return;
    // while the worker or the tiles are catching up the features describe an older state; keep what is shown
    if (!map.isSourceLoaded(SOURCE)) return;
    const view = paddedView(map);
    const want = new Map<string, Want>();
    for (const f of map.querySourceFeatures(SOURCE)) {
      const props = f.properties as Partial<PointProps & ClusterProps> & { cluster?: boolean };
      if (props.cluster) {
        const [lng, lat] = (f.geometry as Point).coordinates;
        const key = clusterKey(lng, lat);
        if (want.has(key)) continue; // tiles overlap, so a cluster can come up more than once
        if (inBox(view, lng, lat)) want.set(key, { key, cluster: true, id: props.cluster_id!, lng, lat, c: props as ClusterProps });
      } else {
        const p = byId.get(props.pid!);
        if (p && inBox(view, p.lng, p.lat)) want.set(`p${p.id}`, { key: `p${p.id}`, cluster: false, p });
      }
    }

    // a keyboard user who just opened a cluster must not lose their place when its element goes away
    const active = document.activeElement;
    let focusAt: [number, number] | null = null;
    for (const [key, e] of entries) {
      if (want.has(key)) continue;
      if (active && e.el.contains(active)) focusAt = [e.lng, e.lat];
      remove(key, e);
    }
    for (const w of want.values()) {
      if (w.cluster) putCluster(w, entries.get(w.key));
      else putPoint(w.p, entries.get(w.key));
    }
    if (focusAt) {
      const [fx, fy] = focusAt;
      const dist = (e: Entry) => (e.lng - fx) ** 2 + (e.lat - fy) ** 2;
      [...entries.values()].sort((a, b) => dist(a) - dist(b))[0]?.el.focus({ preventScroll: true });
    }
  }

  const schedule = () => {
    if (frame || destroyed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      sync();
    });
  };
  const onMove = () => {
    const now = performance.now();
    if (now - lastMove < MOVE_STEP_MS) return;
    lastMove = now;
    schedule();
  };
  const onData = (e: MapSourceDataEvent) => {
    if (e.sourceId === SOURCE) schedule();
  };
  map.on('move', onMove);
  map.on('moveend', schedule);
  map.on('resize', schedule);
  map.on('sourcedata', onData);

  return {
    update(points) {
      byId = new Map(points.map((p) => [p.id, p]));
      const next = pointFeatures(points);
      if (!sameFeatures(features, next)) {
        features = next;
        (map.getSource(SOURCE) as GeoJSONSource).setData({ type: 'FeatureCollection', features: next });
      }
      // the places on screen take the new state at once (a click shows its selection without waiting for the
      // worker); clusters follow when the clustering has caught up, and so does a place whose shape changed
      for (const e of entries.values()) {
        const p = !e.cluster ? byId.get(String(e.id)) : undefined;
        if (p && pointShape(p) === e.shape) {
          patchPoint(e.el, p);
          stack(e, p);
          fade(e, !!p.muted);
        }
      }
      schedule();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      map.off('move', onMove);
      map.off('moveend', schedule);
      map.off('resize', schedule);
      map.off('sourcedata', onData);
      for (const e of entries.values()) e.marker.remove();
      entries.clear();
    }
  };
}
