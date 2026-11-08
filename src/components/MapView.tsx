import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Map as MLMap, Marker, GeoJSONSource, LngLatBoundsLike } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import { circleRing, coneRing } from '../../shared/geo';
import { createClusterLayer, type ClusterLayer } from './mapCluster';
import { pointElement, pointMarkerOptions, type MapPoint } from './mapPoints';

export type { MapPoint };

// MapLibre wrapper with the atlas look: OpenFreeMap vector tiles restyled to paper land, pale
// water, quiet roads. MapLibre (~250 kB gz) is loaded only when a map mounts.

export interface MapShapes {
  /** matching radius rings (metres) */
  circles?: { id: string; lat: number; lng: number; radius: number }[];
  /** camera view cones */
  cones?: { id: string; lat: number; lng: number; heading: number; radius?: number; muted?: boolean }[];
  /** polylines, coordinates as [lat, lng] */
  lines?: { id: string; coords: [number, number][]; dashed?: boolean }[];
}
interface Props {
  ariaLabel: string;
  points?: MapPoint[];
  shapes?: MapShapes;
  /** [lat, lng] used when there is nothing to fit */
  center?: [number, number];
  zoom?: number;
  /** fit the view to points and shapes whenever they change (default true) */
  fit?: boolean;
  /** with `fit`, fit only when this value changes, so a selection or restyle does not undo the user's pan and zoom */
  fitKey?: string;
  maxZoom?: number;
  interactive?: boolean;
  /** require Ctrl/⌘ + scroll or two fingers to move the map, so an embedded map does not trap page scrolling */
  cooperativeGestures?: boolean;
  /**
   * Merge nearby points into numbered cluster markers that zoom in when clicked (default off). Like `interactive`, it is read
   * when the map is created. A cluster shows the sum of its points' `count`s (1 for a point without one), is drawn selected when
   * it holds a selected point and muted when all of its points are muted; `fit` still fits every point.
   */
  cluster?: boolean;
  className?: string;
  style?: CSSProperties;
}

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
let lib: Promise<typeof import('maplibre-gl')> | null = null;
// MapLibre 6 looks for its worker next to its own module file, which a bundle does not keep; point it at the worker Vite
// builds from the package (with the shared chunk it imports).
const loadLib = () =>
  (lib ??= Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
    import('maplibre-gl/dist/maplibre-gl.css')
  ]).then(([m, worker]) => {
    m.setWorkerUrl(worker.default);
    return m;
  }));

function restyle(map: MLMap) {
  for (const l of map.getStyle().layers ?? []) {
    try {
      if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', '#E9EBE5');
      else if (l.type === 'fill' && /water/.test(l.id)) map.setPaintProperty(l.id, 'fill-color', '#CFDDE3');
      else if (l.type === 'fill' && /park|wood|grass|landcover|forest/.test(l.id)) map.setPaintProperty(l.id, 'fill-color', '#DDE4D5');
      else if (l.type === 'line' && /water|river|stream/.test(l.id)) map.setPaintProperty(l.id, 'line-color', '#BCD0D8');
      else if (l.type === 'symbol') {
        map.setPaintProperty(l.id, 'text-color', /water/.test(l.id) ? '#2B5F86' : '#5A605C');
        map.setPaintProperty(l.id, 'text-halo-color', '#F1F2EE');
      }
    } catch {
      /* layer without that paint property */
    }
  }
}

const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });
const poly = (ring: [number, number][], props: Record<string, unknown> = {}): Feature => ({
  type: 'Feature',
  properties: props,
  geometry: { type: 'Polygon', coordinates: [ring] }
});

export default function MapView({
  ariaLabel,
  points = [],
  shapes,
  center,
  zoom = 13,
  fit = true,
  fitKey,
  maxZoom = 16,
  interactive = true,
  cooperativeGestures = false,
  cluster = false,
  className,
  style
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const clusters = useRef<ClusterLayer | null>(null);
  const libRef = useRef<typeof import('maplibre-gl') | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const fittedKey = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadLib()
      .then((m) => {
        if (cancelled || !box.current) return;
        libRef.current = m;
        const map = new m.Map({
          container: box.current,
          style: STYLE_URL,
          center: center ? [center[1], center[0]] : [120.15, 30.25],
          zoom,
          interactive,
          cooperativeGestures,
          attributionControl: { compact: true },
          localIdeographFontFamily: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"
        });
        mapRef.current = map;
        if (interactive) map.addControl(new m.NavigationControl({ showCompass: false }), 'top-right');
        map.on('load', () => {
          restyle(map);
          map.addSource('lv-circles', { type: 'geojson', data: fc([]) });
          map.addSource('lv-cones', { type: 'geojson', data: fc([]) });
          map.addSource('lv-lines', { type: 'geojson', data: fc([]) });
          map.addLayer({
            id: 'lv-circles-fill',
            type: 'fill',
            source: 'lv-circles',
            paint: { 'fill-color': '#8F5530', 'fill-opacity': 0.06 }
          });
          map.addLayer({
            id: 'lv-circles-line',
            type: 'line',
            source: 'lv-circles',
            paint: { 'line-color': '#8F5530', 'line-width': 1.2, 'line-dasharray': [3, 2] }
          });
          map.addLayer({
            id: 'lv-cones-fill',
            type: 'fill',
            source: 'lv-cones',
            paint: { 'fill-color': '#8F5530', 'fill-opacity': ['case', ['get', 'muted'], 0.08, 0.28] }
          });
          map.addLayer({
            id: 'lv-lines-solid',
            type: 'line',
            source: 'lv-lines',
            filter: ['!', ['get', 'dashed']],
            paint: { 'line-color': '#1C201E', 'line-width': 2 }
          });
          map.addLayer({
            id: 'lv-lines-dashed',
            type: 'line',
            source: 'lv-lines',
            filter: ['get', 'dashed'],
            paint: { 'line-color': '#1C201E', 'line-width': 1.2, 'line-dasharray': [2, 2] }
          });
          if (cluster) clusters.current = createClusterLayer(m, map);
          setReady(true);
        });
        map.on('error', () => {});
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      clusters.current?.destroy();
      clusters.current = null;
      markers.current.forEach((mk) => mk.remove());
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // the map is created once; props are applied in the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const m = libRef.current;
    if (!ready || !map || !m) return;
    void (map.getSource('lv-circles') as GeoJSONSource).setData(
      fc((shapes?.circles ?? []).map((c) => poly(circleRing(c.lat, c.lng, c.radius))))
    );
    void (map.getSource('lv-cones') as GeoJSONSource).setData(
      fc((shapes?.cones ?? []).map((c) => poly(coneRing(c.lat, c.lng, c.heading, c.radius ?? 70), { muted: !!c.muted })))
    );
    void (map.getSource('lv-lines') as GeoJSONSource).setData(
      fc(
        (shapes?.lines ?? []).map((l) => ({
          type: 'Feature',
          properties: { dashed: !!l.dashed },
          geometry: { type: 'LineString', coordinates: l.coords.map(([la, ln]) => [ln, la]) }
        }))
      )
    );

    if (clusters.current) clusters.current.update(points);
    else {
      markers.current.forEach((mk) => mk.remove());
      markers.current = points.map((p) =>
        new m.Marker({ element: pointElement(p), ...pointMarkerOptions(p) }).setLngLat([p.lng, p.lat]).addTo(map)
      );
    }

    if (!fit) return;
    if (fitKey !== undefined) {
      if (fittedKey.current === fitKey) return;
      fittedKey.current = fitKey;
    }
    const coords: [number, number][] = [
      ...points.map((p) => [p.lng, p.lat] as [number, number]),
      ...(shapes?.circles ?? []).flatMap((c) => circleRing(c.lat, c.lng, c.radius, 8)),
      ...(shapes?.cones ?? []).flatMap((c) => coneRing(c.lat, c.lng, c.heading, c.radius ?? 70, 28, 4)),
      ...(shapes?.lines ?? []).flatMap((l) => l.coords.map(([la, ln]) => [ln, la] as [number, number]))
    ];
    if (coords.length === 1) map.jumpTo({ center: coords[0], zoom: Math.min(maxZoom, 15) });
    else if (coords.length > 1) {
      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      const bounds: LngLatBoundsLike = [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)]
      ];
      map.fitBounds(bounds, { padding: 48, maxZoom, duration: 0 });
    }
  }, [ready, points, shapes, fit, fitKey, maxZoom]);

  return (
    <div className={`map-frame${className ? ` ${className}` : ''}`} style={style} role="region" aria-label={ariaLabel}>
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />
      {failed && (
        <p className="loading" style={{ position: 'absolute', inset: 0, margin: 0 }}>
          地图加载失败
        </p>
      )}
    </div>
  );
}
