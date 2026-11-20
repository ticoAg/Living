import { entryLabel } from '../../shared/entries';
import type { EntrySummary, LocatedPlace, PhotoSummary, Poi } from '../../shared/types';
import { shortCity, shortCounty, shortProvince } from './regions';

// 图集 for the map: the located photos grouped at the administrative level that suits the zoom (province → city →
// county → place → single photo), merged where their markers would overlap on screen, and named by what the merged
// photos share. The entries layer groups located entries the same way, a single entry at the deepest level. Pure:
// components/mapAlbums.ts draws what this computes. Spec: docs/product/features/map.md#图集
//
//  1. levelAt(zoom) picks the level; photos are grouped by their unit at that level (all of 杭州, all of 断桥…). A photo
//     whose unit is unknown (no city yet, no place) is a group of its own.
//  2. A group sits at its densest spot: the ~300 m square with the most photos around it, so an album stays put while
//     it splits into its parts, the largest part keeping the spot.
//  3. Largest first, a group joins the nearest album already placed within one album box (in pixels at this zoom),
//     else it becomes a new album.
//  4. The type and name come from the members: one unit at the level → that unit; several units making up a whole
//     unit of the level above → that unit (西湖区 and 上城区 being all of 杭州 → 杭州); otherwise the largest unit and
//     等地 (西湖区等地); several provinces → a region (浙江等地); nothing known → an unnamed spot.

export const LEVELS = ['province', 'city', 'county', 'place', 'photo'] as const;
export type Level = (typeof LEVELS)[number];
export type AlbumType = Level | 'region' | 'spot';

/** The first zoom of each level (MapLibre zoom: the world is 512·2^z px wide). */
export const LEVEL_ZOOM: Record<Level, number> = { province: 0, city: 6, county: 9, place: 12, photo: 16 };
/** Layouts stop changing here; a deeper zoom only spreads them further. */
export const MAX_LAYOUT_ZOOM = 18;

/**
 * Centre-to-centre distance in screen pixels below which two albums merge, at the zoom they are laid out for: the
 * widest disc with its stack (80 px) or caption (108 px) across, disc and caption (83 px) down, and a gap.
 */
export const ALBUM_BOX = { w: 116, h: 92 };
/** The same for single photos, which are drawn smaller and without a caption. */
export const PHOTO_BOX = { w: 60, h: 56 };

export function levelAt(z: number): Level {
  if (z >= LEVEL_ZOOM.photo) return 'photo';
  if (z >= LEVEL_ZOOM.place) return 'place';
  if (z >= LEVEL_ZOOM.county) return 'county';
  if (z >= LEVEL_ZOOM.city) return 'city';
  return 'province';
}

/** The layout zoom for a map zoom: whole levels, so albums change at integer zooms only. */
export const layoutZoom = (z: number) => Math.max(0, Math.min(MAX_LAYOUT_ZOOM, Math.floor(z)));

const PARENT: Partial<Record<Level, Level>> = { city: 'province', county: 'city', place: 'county', photo: 'place' };
const CHILD: Partial<Record<Level, Level>> = { province: 'city', city: 'county', county: 'place' };

/** A located photo, or a located entry, with its administrative path. Names are '' when unknown. */
export interface Spot<T = PhotoSummary> {
  item: T;
  /** the photo's or the entry's id */
  id: string;
  /** what one alone is called: its title; '' for none */
  title: string;
  /** what its album shows, best first: a photo itself, an entry's photos (none for an entry without) */
  covers: readonly PhotoSummary[];
  poi: LocatedPlace | null;
  lat: number;
  lng: number;
  /** Web Mercator, 0..1 across and down */
  x: number;
  y: number;
  /** full names, as stored */
  province: string;
  city: string;
  county: string;
  /** the ~300 m square it is in: anchors and cover variety */
  cell: number;
  /** cover order: favourite photos, then the newest */
  rank: number;
}

export interface Album<T = PhotoSummary> {
  /** marker identity: the same while the album is the same, across zooms where possible; unique within a layout */
  key: string;
  /** what selecting it selects, `pv:` `ct:` `co:` `pl:` `ph:`; '' when it is only a merge on screen */
  ref: string;
  type: AlbumType;
  /** named after its largest part, 等地 */
  merged: boolean;
  /** full name for the panel; '' for an unnamed spot */
  name: string;
  /** short name under the album; '' for none */
  label: string;
  lat: number;
  lng: number;
  /** members, best cover first */
  spots: Spot<T>[];
  /** the units above it that all members share, coarse to fine, full names */
  parents: string[];
}

export interface Unit<T = PhotoSummary> {
  ref: string;
  name: string;
  label: string;
  spots: Spot<T>[];
}

interface Group<T> {
  key: string;
  spots: Spot<T>[];
  x: number;
  y: number;
}

export interface AlbumIndex<T = PhotoSummary> {
  /** located items, best cover first */
  spots: Spot<T>[];
  byId: Map<string, Spot<T>>;
  /** items per unit (`pv:` `ct:` `co:` `pl:`) */
  unitSize: Map<string, number>;
  groups: Map<Level, Group<T>[]>;
  layouts: Map<number, Album<T>[]>;
}

// ---- geometry -------------------------------------------------------------------------------------------------

const MAX_LAT = 85.051129;
export const mercX = (lng: number) => (lng + 180) / 360;
export function mercY(lat: number): number {
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2;
}
export const unMercX = (x: number) => x * 360 - 180;
export const unMercY = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
/** world width in pixels at a zoom */
export const worldPx = (z: number) => 512 * 2 ** z;

/** squares of 2^-17 of the world: about 300 m at the equator, 260 m at Hangzhou */
const CELL_BITS = 17;
const CELLS = 2 ** CELL_BITS;
const cellOf = (x: number, y: number) => Math.min(CELLS - 1, Math.floor(x * CELLS)) * CELLS + Math.min(CELLS - 1, Math.floor(y * CELLS));

// ---- index ----------------------------------------------------------------------------------------------------

/** Keys use short names, so 杭州 and 杭州市 are one city; a comma would break the `area` link parameter. */
const keyName = (s: string) => s.replace(/,/g, '，');
/** Any spot, whatever it holds: what grouping and naming read. */
type AnySpot = Spot<unknown>;

const pvOf = (s: AnySpot) => (s.province ? keyName(shortProvince(s.province)) : '');
const ctOf = (s: AnySpot) => (s.city ? keyName(shortCity(s.city)) : '');
const coOf = (s: AnySpot) => (s.county ? keyName(shortCounty(s.county)) : '');

/** The unit a photo or an entry belongs to at a level ('photo': itself); '' when unknown. */
export function unitOf(level: Level, s: AnySpot): string {
  switch (level) {
    case 'province':
      return s.province ? `pv:${pvOf(s)}` : '';
    case 'city':
      return s.city ? `ct:${pvOf(s)},${ctOf(s)}` : '';
    case 'county':
      return s.county ? `co:${pvOf(s)},${ctOf(s)},${coOf(s)}` : '';
    case 'place':
      return s.poi ? `pl:${s.poi.id}` : '';
    case 'photo':
      return `ph:${s.id}`;
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

const byCover = (a: PhotoSummary, b: PhotoSummary) =>
  Number(b.favorite) - Number(a.favorite) || (b.takenAt ?? '').localeCompare(a.takenAt ?? '') || a.id.localeCompare(b.id);

/** The most common value, ties to the first seen. */
function mode(values: Iterable<string>): string {
  const n = new Map<string, number>();
  let best = '';
  let bestN = 0;
  for (const v of values) {
    if (!v) continue;
    const c = (n.get(v) ?? 0) + 1;
    n.set(v, c);
    if (c > bestN) {
      best = v;
      bestN = c;
    }
  }
  return best;
}

/** Where a photo is as the viewer is shown it: its own coordinates, else its place's; null when neither. */
function whereIs(photo: PhotoSummary, pois: ReadonlyMap<string, Poi>): { lat: number; lng: number; poi: Poi | null } | null {
  const poi = (photo.poiId && pois.get(photo.poiId)) || null;
  if (photo.lat != null && photo.lng != null) return { lat: photo.lat, lng: photo.lng, poi };
  return poi ? { lat: poi.lat, lng: poi.lng, poi } : null;
}

type Placed<T> = Omit<Spot<T>, 'x' | 'y' | 'cell' | 'rank'>;

/**
 * The spots, in cover order, with the gaps in their administrative path filled from spots that have it (theirs or
 * the `hints`, e.g. the located photos for the entries): a city's province, and a county's city within its province.
 */
function indexOf<T>(placed: readonly Placed<T>[], hints: readonly AnySpot[]): AlbumIndex<T> {
  const spots = placed.map((p, rank): Spot<T> => {
    const x = mercX(p.lng);
    const y = mercY(p.lat);
    return { ...p, x, y, cell: cellOf(x, y), rank };
  });

  const provinceOf = new Map<string, string[]>();
  const cityOf = new Map<string, string[]>();
  for (const s of [...spots, ...hints]) {
    if (s.city && s.province) push(provinceOf, ctOf(s), s.province);
    if (s.county && s.city && s.province) push(cityOf, `${pvOf(s)},${coOf(s)}`, s.city);
  }
  for (const s of spots) {
    if (s.city && !s.province) s.province = mode(provinceOf.get(ctOf(s)) ?? []);
    if (s.county && !s.city && s.province) s.city = mode(cityOf.get(`${pvOf(s)},${coOf(s)}`) ?? []);
  }

  const unitSize = new Map<string, number>();
  for (const s of spots) {
    for (const level of ['province', 'city', 'county', 'place'] as const) {
      const u = unitOf(level, s);
      if (u) unitSize.set(u, (unitSize.get(u) ?? 0) + 1);
    }
  }
  return { spots, byId: new Map(spots.map((s) => [s.id, s])), unitSize, groups: new Map(), layouts: new Map() };
}

/** Places the photos that have a position, their own or their place's. */
export function buildIndex(photos: readonly PhotoSummary[], pois: ReadonlyMap<string, Poi>): AlbumIndex {
  const placed: Placed<PhotoSummary>[] = [];
  for (const photo of [...photos].sort(byCover)) {
    const at = whereIs(photo, pois);
    if (!at) continue;
    placed.push({
      item: photo,
      id: photo.id,
      title: photo.title ?? '',
      covers: [photo],
      poi: at.poi,
      lat: at.lat,
      lng: at.lng,
      province: photo.province ?? '',
      city: photo.city ?? at.poi?.city ?? '',
      county: photo.district ?? at.poi?.district ?? ''
    });
  }
  return indexOf(placed, []);
}

const byOccurred = (a: EntrySummary, b: EntrySummary) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id);

/**
 * Places the entries, newest first: at their own place, else where the first of their photos with a position is
 * (`photos` holds the ones the viewer is shown). `hints` lend provinces to the places' cities, which carry none.
 */
export function buildEntryIndex(
  entries: readonly EntrySummary[],
  photos: ReadonlyMap<string, PhotoSummary>,
  pois: ReadonlyMap<string, Poi>,
  hints: readonly AnySpot[] = []
): AlbumIndex<EntrySummary> {
  const placed: Placed<EntrySummary>[] = [];
  for (const entry of [...entries].sort(byOccurred)) {
    const covers = entry.photoIds.map((id) => photos.get(id)).filter((p): p is PhotoSummary => !!p);
    const base = { item: entry, id: entry.id, title: entryLabel(entry.title, entry.excerpt), covers };
    if (entry.poi) {
      const { poi } = entry;
      placed.push({ ...base, poi, lat: poi.lat, lng: poi.lng, province: '', city: poi.city ?? '', county: poi.district ?? '' });
      continue;
    }
    for (const photo of covers) {
      const at = whereIs(photo, pois);
      if (!at) continue;
      placed.push({
        ...base,
        poi: at.poi,
        lat: at.lat,
        lng: at.lng,
        province: photo.province ?? '',
        city: photo.city ?? at.poi?.city ?? '',
        county: photo.district ?? at.poi?.district ?? ''
      });
      break;
    }
  }
  return indexOf(placed, hints);
}

// ---- grouping -------------------------------------------------------------------------------------------------

/** The densest spot of a set of photos: the mean position around the square with the most photos in its 3×3. */
export function anchorOf(spots: readonly AnySpot[]): { x: number; y: number } {
  if (spots.length === 1) return { x: spots[0].x, y: spots[0].y };
  const count = new Map<number, number>();
  for (const s of spots) count.set(s.cell, (count.get(s.cell) ?? 0) + 1);
  const around = (cell: number, visit: (c: number) => void) => {
    const cx = Math.floor(cell / CELLS);
    const cy = cell % CELLS;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) visit((cx + dx) * CELLS + cy + dy);
  };
  let best = -1;
  let bestN = -1;
  // ties go to the square met first, and the spots come best cover first
  for (const s of spots) {
    let n = 0;
    around(s.cell, (c) => (n += count.get(c) ?? 0));
    if (n > bestN) {
      bestN = n;
      best = s.cell;
    }
  }
  const near = new Set<number>();
  around(best, (c) => near.add(c));
  let x = 0;
  let y = 0;
  let n = 0;
  for (const s of spots) {
    if (!near.has(s.cell)) continue;
    x += s.x;
    y += s.y;
    n++;
  }
  return { x: x / n, y: y / n };
}

function groupsAt<T>(index: AlbumIndex<T>, level: Level): Group<T>[] {
  const cached = index.groups.get(level);
  if (cached) return cached;
  const by = new Map<string, Spot<T>[]>();
  for (const s of index.spots) push(by, unitOf(level, s) || `ph:${s.id}`, s);
  const groups = [...by].map(([key, spots]) => ({ key, spots, ...anchorOf(spots) }));
  groups.sort((a, b) => b.spots.length - a.spots.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  index.groups.set(level, groups);
  return groups;
}

// ---- naming ---------------------------------------------------------------------------------------------------

type Agreement = { kind: 'one'; unit: string } | { kind: 'many' } | { kind: 'none' };

/** Whether the photos are in one unit at a level: all that know theirs agree, and they are at least half. */
function agree(spots: readonly AnySpot[], level: Level): Agreement {
  let unit = '';
  let known = 0;
  for (const s of spots) {
    const u = unitOf(level, s);
    if (!u) continue;
    if (unit && u !== unit) return { kind: 'many' };
    unit = u;
    known++;
  }
  if (!unit || known * 2 < spots.length) return { kind: 'none' };
  return { kind: 'one', unit };
}

/** Full and short name of a unit, from the photos in it. */
function nameOf(level: Level, unit: string, spots: readonly AnySpot[]): { name: string; label: string } {
  const inUnit = spots.filter((s) => unitOf(level, s) === unit);
  switch (level) {
    case 'province': {
      const name = mode(inUnit.map((s) => s.province));
      return { name, label: shortProvince(name) };
    }
    case 'city': {
      const name = mode(inUnit.map((s) => s.city));
      return { name, label: shortCity(name) };
    }
    case 'county': {
      const name = mode(inUnit.map((s) => s.county));
      return { name, label: shortCounty(name) };
    }
    case 'place': {
      const name = inUnit[0]?.poi?.name ?? '';
      return { name, label: name };
    }
    case 'photo':
      return { name: inUnit[0]?.title ?? '', label: '' };
  }
}

/** The units above `level` that every member shares, coarse to fine. */
function parentsOf(spots: readonly AnySpot[], level: Level | 'region'): string[] {
  const out: string[] = [];
  for (const l of ['province', 'city', 'county'] as const) {
    if (level === 'region' || LEVELS.indexOf(l) >= LEVELS.indexOf(level)) break;
    const a = agree(spots, l);
    if (a.kind !== 'one') break;
    out.push(nameOf(l, a.unit, spots).name);
  }
  return out;
}

/** The unit at a level holding the most of the photos. */
function largest(spots: readonly AnySpot[], level: Level): string {
  return mode(spots.map((s) => unitOf(level, s)));
}

type Described = Pick<Album, 'ref' | 'type' | 'merged' | 'name' | 'label' | 'parents'>;

function named(level: Level, unit: string, spots: readonly AnySpot[]): Described {
  return { ref: unit, type: level, merged: false, ...nameOf(level, unit, spots), parents: parentsOf(spots, level) };
}

/** Type and name of an album laid out at `level` (rules in the comment at the top). */
export function describe<T>(index: AlbumIndex<T>, spots: readonly Spot<T>[], level: Level): Described {
  if (level === 'photo' && spots.length === 1) return named('photo', unitOf('photo', spots[0]), spots);
  const at: Level = level === 'photo' ? 'place' : level;
  const a = agree(spots, at);
  if (a.kind === 'one') return named(at, a.unit, spots);
  if (a.kind === 'none') {
    const ref = spots.length === 1 ? unitOf('photo', spots[0]) : '';
    return { ref, type: 'spot', merged: false, name: '', label: '', parents: parentsOf(spots, at) };
  }
  const up = PARENT[at];
  if (up) {
    const p = agree(spots, up);
    if (p.kind === 'one' && spots.filter((s) => unitOf(up, s) === p.unit).length === index.unitSize.get(p.unit)) {
      return named(up, p.unit, spots);
    }
  }
  const top = nameOf(at, largest(spots, at), spots).label;
  const name = `${top}等地`;
  return { ref: '', type: at === 'province' ? 'region' : at, merged: true, name, label: name, parents: parentsOf(spots, at) };
}

// ---- layout ---------------------------------------------------------------------------------------------------

/** The albums at an integer zoom; cached per zoom. */
export function layoutAt<T>(index: AlbumIndex<T>, z: number): Album<T>[] {
  const cached = index.layouts.get(z);
  if (cached) return cached;
  const level = levelAt(z);
  const box = level === 'photo' ? PHOTO_BOX : ALBUM_BOX;
  const scale = worldPx(z);

  interface Bin {
    px: number;
    py: number;
    groups: Group<T>[];
  }
  const bins: Bin[] = [];
  const grid = new Map<string, Bin[]>();
  for (const g of groupsAt(index, level)) {
    const px = g.x * scale;
    const py = g.y * scale;
    const gx = Math.floor(px / box.w);
    const gy = Math.floor(py / box.h);
    let into: Bin | null = null;
    let nearest = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const b of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          const ddx = Math.abs(b.px - px);
          const ddy = Math.abs(b.py - py);
          if (ddx >= box.w || ddy >= box.h) continue;
          const d = ddx * ddx + ddy * ddy;
          if (d < nearest) {
            nearest = d;
            into = b;
          }
        }
      }
    }
    if (into) into.groups.push(g);
    else {
      const b: Bin = { px, py, groups: [g] };
      bins.push(b);
      push(grid, `${gx},${gy}`, b);
    }
  }

  const used = new Set<string>();
  const albums = bins.map((b) => {
    const head = b.groups[0];
    const spots = b.groups.length === 1 ? head.spots : b.groups.flatMap((g) => g.spots).sort((p, q) => p.rank - q.rank);
    const d = describe(index, spots, level);
    // a lone group keeps its own key, so the album that is 杭州 at zoom 6 is the same marker at 7 and 8
    let key = b.groups.length === 1 && (d.ref === head.key || d.type === 'spot') ? head.key : d.ref || `${d.type}~${head.key}`;
    if (used.has(key)) key = `${key}~${head.key}`;
    used.add(key);
    return { key, ...d, lat: unMercY(head.y), lng: unMercX(head.x), spots };
  });
  index.layouts.set(z, albums);
  return albums;
}

// ---- selection ------------------------------------------------------------------------------------------------

const REF_LEVEL: Record<string, Level> = { pv: 'province', ct: 'city', co: 'county', pl: 'place', ph: 'photo' };

/** The whole unit a `ref` names, as an album at its own spot; null when nothing located is in it. */
export function albumOf<T>(index: AlbumIndex<T>, ref: string): Album<T> | null {
  const level = REF_LEVEL[ref.slice(0, 2)];
  if (!level || ref[2] !== ':') return null;
  const spots =
    level === 'photo'
      ? [index.byId.get(ref.slice(3))].filter((s): s is Spot<T> => !!s)
      : index.spots.filter((s) => unitOf(level, s) === ref);
  if (!spots.length) return null;
  const at = anchorOf(spots);
  return { key: ref, ...named(level, ref, spots), lat: unMercY(at.y), lng: unMercX(at.x), spots };
}

/** `area` link parameter ↔ ref: 浙江 · 浙江,杭州 · 浙江,杭州,西湖区 */
export function refOfArea(area: string): string {
  const parts = area.split(',');
  if (!area || parts.length > 3) return '';
  return `${['pv', 'ct', 'co'][parts.length - 1]}:${area}`;
}
export const areaOfRef = (ref: string): string | null => (/^(pv|ct|co):/.test(ref) ? ref.slice(3) : null);

export interface Parts<T = PhotoSummary> {
  level: Level;
  /** largest first */
  units: Unit<T>[];
  /** items without a unit at that level */
  rest: number;
}

function partsAt<T>(spots: readonly Spot<T>[], level: Level): Parts<T> {
  const by = new Map<string, Spot<T>[]>();
  let rest = 0;
  for (const s of spots) {
    const u = unitOf(level, s);
    if (u) push(by, u, s);
    else rest++;
  }
  const units = [...by]
    .map(([ref, members]) => ({ ref, ...nameOf(level, ref, members), spots: members }))
    .sort((a, b) => b.spots.length - a.spots.length || a.label.localeCompare(b.label, 'zh-CN'));
  return { level, units, rest };
}

/** The parts of an album: provinces of a region, the units of a merge, else the units one level down. */
export function partsOf<T>(album: Album<T>): Parts<T> | null {
  if (album.type === 'spot') return null;
  const level = album.type === 'region' ? 'province' : album.merged ? album.type : CHILD[album.type];
  return level ? partsAt(album.spots, level) : null;
}

/** The highest level with more than one unit (provinces, else cities, …), for the panel with nothing selected. */
export function overview<T>(index: AlbumIndex<T>): Parts<T> | null {
  let last: Parts<T> | null = null;
  for (const level of ['province', 'city', 'county', 'place'] as const) {
    const parts = partsAt(index.spots, level);
    if (!parts.units.length) continue;
    last = parts;
    if (parts.units.length > 1) break;
  }
  return last;
}

/**
 * Where clicking an album takes the map: in to the first zoom at which its photos come apart, centred on all of them
 * when they fit at that zoom, else on the album. Places and single photos never move the map.
 */
export function zoomTarget<T>(
  index: AlbumIndex<T>,
  album: Album<T>,
  z: number,
  view: { w: number; h: number },
  pad = 48
): { lat: number; lng: number; zoom: number } | null {
  if (album.type === 'photo' || (album.type === 'place' && !album.merged)) return null;
  const ids = new Set(album.spots.map((s) => s.id));
  for (let z2 = z + 1; z2 <= MAX_LAYOUT_ZOOM; z2++) {
    let seen = 0;
    for (const a of layoutAt(index, z2)) {
      if (a.spots.some((s) => ids.has(s.id)) && ++seen > 1) break;
    }
    if (seen < 2) continue;
    const xs = album.spots.map((s) => s.x);
    const ys = album.spots.map((s) => s.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const fits = (x1 - x0) * worldPx(z2) <= view.w - 2 * pad && (y1 - y0) * worldPx(z2) <= view.h - 2 * pad;
    return fits ? { lat: unMercY((y0 + y1) / 2), lng: unMercX((x0 + x1) / 2), zoom: z2 } : { lat: album.lat, lng: album.lng, zoom: z2 };
  }
  return null;
}

// ---- decoration -----------------------------------------------------------------------------------------------

/**
 * Up to `max` photos for the album's carousel: the first of each spot first, one per place or ~300 m square, so a
 * province shows several of its places rather than four shots of one; then the first of the other spots, then the
 * rest of their photos (an entry's). Matching spots only, unless none match; none when they have no photos.
 */
export function coversOf<T>(spots: readonly Spot<T>[], matches: (s: Spot<T>) => boolean, max = 4): PhotoSummary[] {
  const hits = spots.filter(matches);
  const pool = hits.length ? hits : spots;
  const out: PhotoSummary[] = [];
  const taken = new Set<string>();
  const add = (p: PhotoSummary) => {
    if (out.length < max && !taken.has(p.id)) {
      taken.add(p.id);
      out.push(p);
    }
  };
  // two entries can hold the same photo: each spot shows the first of its photos not shown yet
  const next = (s: Spot<T>) => s.covers.find((p) => !taken.has(p.id));
  const seen = new Set<string>();
  const shown = new Set<Spot<T>>();
  for (const s of pool) {
    const where = s.poi ? `p${s.poi.id}` : `c${s.cell}`;
    const p = seen.has(where) ? undefined : next(s);
    if (!p) continue;
    seen.add(where);
    shown.add(s);
    add(p);
  }
  for (const s of pool) {
    const p = shown.has(s) ? undefined : next(s);
    if (p) add(p);
  }
  for (const s of pool) for (const p of s.covers) add(p);
  return out;
}
