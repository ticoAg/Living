import type { Map as MLMap, Marker } from 'maplibre-gl';
import type { PhotoSummary } from '../../shared/types';
import { mediaUrl } from '../lib/api';
import { placeholder } from './Img';
import { MUTED_OPACITY } from './mapPoints';

// Album markers for MapView (小图册): a round photo with paper sheets stacked behind it when it holds several, turning
// through a few of its photos, with a caption of name and count. What the albums are comes from an AlbumSource
// (browse/albums.ts on the map page), asked again whenever the whole-number zoom changes; this module only draws.
//
//  - markers are made for albums in view (plus a margin) and kept by key, so panning and zooming within a layout
//    only adds and removes markers at the edges, and an album that stays the same keeps its element
//  - the carousels turn one photo every few seconds, staggered, and stand still while the map moves, while the
//    pointer or focus is on an album, in a hidden tab, and for visitors who prefer reduced motion
//  - region boundaries from the base map are drawn dashed for the level being shown (province lines zoomed out,
//    city and county lines from zoom 9)

type Lib = typeof import('maplibre-gl');

export type AlbumSize = 'xl' | 'l' | 'm' | 's' | 'xs';
export type CoverPhoto = Pick<PhotoSummary, 'id' | 'variants' | 'thumbhash' | 'focus'>;

export interface AlbumMark {
  key: string;
  lat: number;
  lng: number;
  size: AlbumSize;
  /** name in the caption; '' for none */
  label: string;
  /** photos counted under the current filters */
  count: number;
  /** all its photos: a caption is shown for two or more (or a name), a stack for two or more */
  total: number;
  /** the carousel, best first; at least one */
  covers: readonly CoverPhoto[];
  selected: boolean;
  muted: boolean;
  /** what a screen reader says for it */
  title: string;
}

export interface MapTarget {
  lat: number;
  lng: number;
  zoom: number;
}

export interface AlbumSource {
  /** the albums for a whole-number zoom */
  at(z: number): readonly AlbumMark[];
  /** the visitor chose an album: where to take the map, or null to leave it */
  pick(key: string, z: number, view: { w: number; h: number }): MapTarget | null;
  /** somewhere the page asks the map to go (a region chosen in the side panel); followed once per `id` */
  target?: (MapTarget & { id: number }) | null;
}

export interface AlbumLayer {
  update(source: AlbumSource): void;
  destroy(): void;
}

/** disc diameter per size, px; the stylesheet draws the same */
export const DISC: Record<AlbumSize, number> = { xl: 70, l: 64, m: 58, s: 54, xs: 44 };
/** markers are kept this far (fraction of the view) outside it, so a pan does not pop them in at the edge */
const MARGIN = 0.25;
/** while the map moves, reconcile at most this often; the end of a move always does */
const MOVE_STEP_MS = 90;
const TURN_MS = 4600;
const TICK_MS = 400;

const layoutZoom = (z: number) => Math.max(0, Math.min(18, Math.floor(z)));

type Box = [west: number, south: number, east: number, north: number];

/** Whether a position is in the box; longitudes are also tried one world to either side, since the map repeats. */
export function inBox([w, s, e, n]: Box, lng: number, lat: number): boolean {
  if (lat < s || lat > n) return false;
  if (e - w >= 360) return true;
  return (lng >= w && lng <= e) || (lng - 360 >= w && lng - 360 <= e) || (lng + 360 >= w && lng + 360 <= e);
}

function paddedView(map: MLMap): Box {
  const b = map.getBounds();
  const dx = (b.getEast() - b.getWest()) * MARGIN;
  const dy = (b.getNorth() - b.getSouth()) * MARGIN;
  return [b.getWest() - dx, b.getSouth() - dy, b.getEast() + dx, b.getNorth() + dy];
}

/** A stable spread of start times, so neighbouring carousels do not turn together. */
export function phase(key: string, period = TURN_MS): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return h % period;
}

export const fmtCount = (n: number) => n.toLocaleString('en-US');

/** Boundary lines of the base map's `boundary` layer, by OSM admin_level: 4 province, 5 prefecture city, 6 county. */
const BOUNDARIES: { id: string; level: number; dash: number[]; opacity: unknown; width: unknown }[] = [
  {
    id: 'lv-bnd-4',
    level: 4,
    dash: [3, 2],
    opacity: ['interpolate', ['linear'], ['zoom'], 2, 0.5, 8, 0.55, 11, 0.3, 13, 0],
    width: ['interpolate', ['linear'], ['zoom'], 3, 0.8, 8, 1.4]
  },
  {
    id: 'lv-bnd-5',
    level: 5,
    dash: [3, 2],
    opacity: ['interpolate', ['linear'], ['zoom'], 8.5, 0, 9, 0.5, 12, 0.4, 15, 0],
    width: ['interpolate', ['linear'], ['zoom'], 9, 1, 13, 1.4]
  },
  {
    id: 'lv-bnd-6',
    level: 6,
    dash: [1.5, 2],
    opacity: ['interpolate', ['linear'], ['zoom'], 9, 0, 9.5, 0.4, 14, 0.35, 16, 0],
    width: 1
  }
];

function addBoundaries(map: MLMap): void {
  if (!map.getSource('openmaptiles')) return;
  const beforeId = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
  // the base style draws levels 3–6 as one faint dash from zoom 8; these replace it
  if (map.getLayer('boundary_3')) map.setLayoutProperty('boundary_3', 'visibility', 'none');
  for (const b of BOUNDARIES) {
    map.addLayer(
      {
        id: b.id,
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        filter: [
          'all',
          ['==', ['get', 'admin_level'], b.level],
          ['!=', ['get', 'maritime'], 1],
          ['!=', ['get', 'disputed'], 1],
          ['!', ['has', 'claimed_by']]
        ],
        layout: { 'line-join': 'round' },
        // MapLibre's types want literal expressions here; these are checked by the style validator at runtime
        paint: { 'line-color': '#96562E', 'line-dasharray': b.dash, 'line-opacity': b.opacity as number, 'line-width': b.width as number }
      },
      beforeId
    );
  }
}

const ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8.5" r="1.5"/></svg>';

interface Entry {
  key: string;
  marker: Marker;
  el: HTMLButtonElement;
  disc: HTMLElement;
  imgs: [HTMLImageElement, HTMLImageElement];
  front: 0 | 1;
  dots: HTMLElement;
  tag: HTMLElement;
  name: HTMLElement;
  n: HTMLElement;
  mark: AlbumMark;
  /** cover ids shown, to tell a new carousel from the same one */
  coverIds: string;
  at: number;
  /** when the carousel turns next, ms since page load */
  next: number;
  /** pointer or focus on it */
  held: boolean;
  /** bumped per cover change, so a late image load does not overwrite a newer one */
  loading: number;
  lng: number;
  lat: number;
  size: AlbumSize;
  muted: boolean;
}

export function createAlbumLayer(lib: Lib, map: MLMap, initial: AlbumSource): AlbumLayer {
  let source = initial;
  // a map made after the page asked to go somewhere starts where it is told instead
  let followed = initial.target?.id ?? 0;
  const entries = new Map<string, Entry>();
  let destroyed = false;
  let frame = 0;
  let lastMove = 0;
  let moving = false;
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  addBoundaries(map);

  function show(e: Entry, i: number, instant = false) {
    const covers = e.mark.covers;
    if (!covers.length) return;
    e.at = ((i % covers.length) + covers.length) % covers.length;
    const c = covers[e.at];
    const token = ++e.loading;
    const back = e.imgs[e.front === 0 ? 1 : 0];
    const ph = placeholder(c.thumbhash);
    const swap = () => {
      if (token !== e.loading || destroyed) return;
      back.dataset.on = 'true';
      e.imgs[e.front].dataset.on = 'false';
      e.front = e.front === 0 ? 1 : 0;
      if (ph) e.disc.style.backgroundImage = `url(${ph})`;
    };
    back.style.objectPosition = c.focus ? `${c.focus[0] * 100}% ${c.focus[1] * 100}%` : '';
    back.src = mediaUrl(c.variants.s.key);
    if (instant) {
      if (ph) e.disc.style.backgroundImage = `url(${ph})`;
      swap();
    } else back.decode().then(swap, swap);
    const dots = e.dots.children;
    for (let k = 0; k < dots.length; k++) (dots[k] as HTMLElement).dataset.on = String(k === e.at);
  }

  function step(e: Entry, by: number) {
    if (e.mark.covers.length < 2) return;
    show(e, e.at + by);
    e.next = performance.now() + TURN_MS;
  }

  function build(m: AlbumMark): Entry {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'map-album';
    const disc = document.createElement('span');
    disc.className = 'map-album-disc';
    const img = () => {
      const i = document.createElement('img');
      i.alt = '';
      i.decoding = 'async';
      i.draggable = false;
      i.className = 'map-album-img';
      disc.appendChild(i);
      return i;
    };
    const imgs: [HTMLImageElement, HTMLImageElement] = [img(), img()];
    for (const dir of [-1, 1]) {
      const nav = document.createElement('span');
      nav.className = 'map-album-nav';
      nav.dataset.dir = String(dir);
      nav.setAttribute('aria-hidden', 'true');
      nav.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${dir < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}"/></svg>`;
      disc.appendChild(nav);
    }
    const dots = document.createElement('span');
    dots.className = 'map-album-dots';
    dots.setAttribute('aria-hidden', 'true');
    disc.appendChild(dots);
    el.appendChild(disc);

    const tag = document.createElement('span');
    tag.className = 'map-album-tag';
    tag.insertAdjacentHTML('afterbegin', ICON);
    const name = document.createElement('span');
    name.className = 'map-album-name';
    const n = document.createElement('span');
    n.className = 'map-album-n';
    tag.append(name, n);
    el.appendChild(tag);

    const marker = new lib.Marker({ element: el, anchor: 'top', offset: [0, -DISC[m.size] / 2] }).setLngLat([m.lng, m.lat]).addTo(map);
    const e: Entry = {
      key: m.key,
      marker,
      el,
      disc,
      imgs,
      front: 0,
      dots,
      tag,
      name,
      n,
      mark: m,
      coverIds: '',
      at: 0,
      next: performance.now() + 1500 + phase(m.key),
      held: false,
      loading: 0,
      lng: m.lng,
      lat: m.lat,
      size: m.size,
      muted: false
    };

    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const nav = (ev.target as Element).closest('.map-album-nav') as HTMLElement | null;
      if (nav) {
        step(e, Number(nav.dataset.dir));
        return;
      }
      const z = layoutZoom(map.getZoom());
      const box = map.getContainer();
      const to = source.pick(e.key, z, { w: box.clientWidth, h: box.clientHeight });
      if (to && !destroyed) map.easeTo({ center: [to.lng, to.lat], zoom: Math.min(to.zoom, map.getMaxZoom()), duration: 650 });
    });
    el.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      ev.stopPropagation();
      step(e, ev.key === 'ArrowLeft' ? -1 : 1);
    });
    const hold = (v: boolean) => () => {
      e.held = v;
      if (!v) e.next = Math.max(e.next, performance.now() + TURN_MS / 2);
    };
    el.addEventListener('pointerenter', hold(true));
    el.addEventListener('pointerleave', hold(false));
    el.addEventListener('focus', hold(true));
    el.addEventListener('blur', hold(false));

    entries.set(m.key, e);
    patch(e, m, true);
    return e;
  }

  function patch(e: Entry, m: AlbumMark, fresh = false) {
    e.mark = m;
    const { el } = e;
    if (e.lng !== m.lng || e.lat !== m.lat) {
      e.marker.setLngLat([m.lng, m.lat]);
      e.lng = m.lng;
      e.lat = m.lat;
    }
    if (fresh || e.size !== m.size) {
      e.size = m.size;
      el.dataset.size = m.size;
      e.marker.setOffset([0, -DISC[m.size] / 2]);
    }
    el.dataset.selected = String(m.selected);
    el.dataset.stack = String(m.total >= 3 ? 2 : m.total === 2 ? 1 : 0);
    el.dataset.turns = String(m.covers.length > 1);
    el.style.zIndex = m.selected ? '2' : '1';
    if (el.getAttribute('aria-label') !== m.title) el.setAttribute('aria-label', m.title);
    if (fresh || e.muted !== m.muted) {
      e.muted = m.muted;
      el.dataset.muted = String(m.muted);
      e.marker.setOpacity(m.muted ? MUTED_OPACITY : '1');
    }

    const caption = !!m.label || m.total > 1;
    e.tag.hidden = !caption;
    e.tag.dataset.named = String(!!m.label);
    if (e.name.textContent !== m.label) e.name.textContent = m.label;
    const count = fmtCount(m.count);
    if (e.n.textContent !== count) e.n.textContent = count;

    const ids = m.covers.map((c) => c.id).join(',');
    if (ids !== e.coverIds) {
      e.coverIds = ids;
      e.dots.replaceChildren(...m.covers.map(() => document.createElement('i')));
      e.dots.hidden = m.covers.length < 2;
      show(e, 0, fresh);
    }
  }

  function remove(e: Entry) {
    e.loading++;
    e.marker.remove();
    entries.delete(e.key);
  }

  /** Reconcile the markers with the albums of the current zoom that are in view. */
  function sync() {
    if (destroyed) return;
    const view = paddedView(map);
    const want = new Map<string, AlbumMark>();
    for (const m of source.at(layoutZoom(map.getZoom()))) if (inBox(view, m.lng, m.lat)) want.set(m.key, m);

    // a keyboard user who just opened an album must not lose their place when its element goes away
    const active = document.activeElement;
    let focusAt: [number, number] | null = null;
    for (const e of entries.values()) {
      if (want.has(e.key)) continue;
      if (active && e.el.contains(active)) focusAt = [e.lng, e.lat];
      remove(e);
    }
    for (const m of want.values()) {
      const e = entries.get(m.key);
      if (e) patch(e, m);
      else build(m);
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
    moving = true;
    const now = performance.now();
    if (now - lastMove < MOVE_STEP_MS) return;
    lastMove = now;
    schedule();
  };
  const onMoveEnd = () => {
    moving = false;
    schedule();
  };
  map.on('move', onMove);
  map.on('moveend', onMoveEnd);
  map.on('resize', schedule);

  const timer = still
    ? 0
    : window.setInterval(() => {
        if (moving || document.hidden) return;
        const now = performance.now();
        for (const e of entries.values()) {
          if (e.held || e.mark.covers.length < 2 || now < e.next) continue;
          show(e, e.at + 1);
          e.next = now + TURN_MS;
        }
      }, TICK_MS);

  sync();

  return {
    update(next) {
      source = next;
      const t = next.target;
      if (t && t.id !== followed && !destroyed) {
        followed = t.id;
        map.easeTo({ center: [t.lng, t.lat], zoom: Math.min(t.zoom, map.getMaxZoom()), duration: 650 });
      }
      schedule();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      if (timer) clearInterval(timer);
      map.off('move', onMove);
      map.off('moveend', onMoveEnd);
      map.off('resize', schedule);
      for (const e of entries.values()) remove(e);
      for (const b of BOUNDARIES) if (map.getLayer(b.id)) map.removeLayer(b.id);
    }
  };
}
