import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Map as MLMap, Marker, GeoJSONSource, LngLatBoundsLike } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import { circleRing, coneRing } from '../../shared/geo';

// MapLibre wrapper with the atlas look: OpenFreeMap vector tiles restyled to paper land, pale
// water, quiet roads. MapLibre (~250 kB gz) is loaded only when a map mounts.

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
  maxZoom?: number;
  interactive?: boolean;
  /** require Ctrl/⌘ + scroll or two fingers to move the map, so an embedded map does not trap page scrolling */
  cooperativeGestures?: boolean;
  className?: string;
  style?: CSSProperties;
}

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
let lib: Promise<typeof import('maplibre-gl')> | null = null;
const loadLib = () =>
  (lib ??= Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([m]) => m));

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
const poly = (ring: [number, number][], props: Record<string, unknown> = {}): Feature => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });

export default function MapView({ ariaLabel, points = [], shapes, center, zoom = 13, fit = true, maxZoom = 16, interactive = true, cooperativeGestures = false, className, style }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const libRef = useRef<typeof import('maplibre-gl') | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

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
          map.addLayer({ id: 'lv-circles-fill', type: 'fill', source: 'lv-circles', paint: { 'fill-color': '#8F5530', 'fill-opacity': 0.06 } });
          map.addLayer({ id: 'lv-circles-line', type: 'line', source: 'lv-circles', paint: { 'line-color': '#8F5530', 'line-width': 1.2, 'line-dasharray': [3, 2] } });
          map.addLayer({ id: 'lv-cones-fill', type: 'fill', source: 'lv-cones', paint: { 'fill-color': '#8F5530', 'fill-opacity': ['case', ['get', 'muted'], 0.08, 0.28] } });
          map.addLayer({ id: 'lv-lines-solid', type: 'line', source: 'lv-lines', filter: ['!', ['get', 'dashed']], paint: { 'line-color': '#1C201E', 'line-width': 2 } });
          map.addLayer({ id: 'lv-lines-dashed', type: 'line', source: 'lv-lines', filter: ['get', 'dashed'], paint: { 'line-color': '#1C201E', 'line-width': 1.2, 'line-dasharray': [2, 2] } });
          setReady(true);
        });
        map.on('error', () => {});
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
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
    (map.getSource('lv-circles') as GeoJSONSource).setData(fc((shapes?.circles ?? []).map((c) => poly(circleRing(c.lat, c.lng, c.radius)))));
    (map.getSource('lv-cones') as GeoJSONSource).setData(
      fc((shapes?.cones ?? []).map((c) => poly(coneRing(c.lat, c.lng, c.heading, c.radius ?? 70), { muted: !!c.muted })))
    );
    (map.getSource('lv-lines') as GeoJSONSource).setData(
      fc(
        (shapes?.lines ?? []).map((l) => ({
          type: 'Feature',
          properties: { dashed: !!l.dashed },
          geometry: { type: 'LineString', coordinates: l.coords.map(([la, ln]) => [ln, la]) }
        }))
      )
    );

    markers.current.forEach((mk) => mk.remove());
    markers.current = points.map((p) => {
      const el = document.createElement(p.onClick ? 'button' : 'span');
      el.className = 'map-pt';
      el.dataset.selected = String(!!p.selected);
      el.dataset.muted = String(!!p.muted);
      if (p.onClick) {
        (el as HTMLButtonElement).type = 'button';
        el.setAttribute('aria-label', p.label ? `${p.label}${p.count != null ? `，${p.count} 张` : ''}` : '地点');
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          p.onClick!();
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
      return new m.Marker({ element: el, anchor: p.label ? 'left' : 'center', offset: p.label ? [-13, 0] : [0, 0] }).setLngLat([p.lng, p.lat]).addTo(map);
    });

    if (!fit) return;
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
  }, [ready, points, shapes, fit, maxZoom]);

  return (
    <div className={`map-frame${className ? ` ${className}` : ''}`} style={style} role="region" aria-label={ariaLabel}>
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />
      {failed && <p className="loading" style={{ position: 'absolute', inset: 0, margin: 0 }}>地图加载失败</p>}
    </div>
  );
}
