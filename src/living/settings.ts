// Living mode parameters: one contract for the URL, localStorage and the settings drawer.
// Spec: docs/product/features/living-mode.md ("参数").
//
// Two groups:
//   Source   what to play (src, tags, place, city, theme, user, order). Comes from the link only,
//            so a bare /living always means "everything, shuffled".
//   Settings how to show it (every, fx, fit, fields, pos, size, brief, clock, awake, night).
//            Link parameters win; anything the link leaves out falls back to the last settings
//            used on this device (localStorage), then to the defaults below.

export const SRCS = ['all', 'tags', 'place', 'city', 'theme', 'today'] as const;
export const MATCHES = ['any', 'all'] as const;
export const ORDERS = ['shuffle', 'time'] as const;
export const FXS = ['drift', 'fade', 'cut'] as const;
export const FITS = ['cover', 'contain'] as const;
export const POSS = ['bl', 'bc', 'br'] as const;
export const SIZES = ['s', 'm', 'l'] as const;
export const EVERY_PRESETS = [5, 10, 30, 60, 300, 900] as const;
export const FIELD_KEYS = ['place', 'title', 'city', 'date', 'time', 'ago', 'coord', 'heading', 'exif', 'tags'] as const;

export type Src = (typeof SRCS)[number];
export type Match = (typeof MATCHES)[number];
export type Order = (typeof ORDERS)[number];
export type Fx = (typeof FXS)[number];
export type Fit = (typeof FITS)[number];
export type Pos = (typeof POSS)[number];
export type Size = (typeof SIZES)[number];
export type FieldKey = (typeof FIELD_KEYS)[number];

export interface Source {
  src: Src;
  /** tag ids; descendants are included when matching */
  tags: string[];
  match: Match;
  /** POI id */
  place: string;
  /** exact city name; filters every source except themes */
  city: string;
  /** theme id */
  theme: string;
  /** owner handle; limits the list to one user's photos */
  user: string;
  order: Order;
}

export interface Settings {
  /** seconds per photo */
  every: number;
  fx: Fx;
  fit: Fit;
  fields: FieldKey[];
  pos: Pos;
  size: Size;
  /** show the fields for 6 s after each change only */
  brief: boolean;
  clock: boolean;
  awake: boolean;
  /** dim the picture between 22:00 and 07:00 */
  night: boolean;
}

export interface Initial {
  source: Source;
  settings: Settings;
  /** photo id to start from; consumed once */
  start: string;
}

export const DEFAULT_SETTINGS: Settings = {
  every: 10,
  fx: 'drift',
  fit: 'cover',
  fields: ['place', 'date'],
  pos: 'bl',
  size: 'm',
  brief: false,
  clock: false,
  awake: true,
  night: false
};

export const STORE_KEY = 'living:settings';

/** A theme plays in its own (story) order unless the link asks for a shuffle. */
export const defaultOrder = (src: Src): Order => (src === 'theme' ? 'time' : 'shuffle');

const oneOf = <T extends string>(allowed: readonly T[], v: unknown): T | undefined =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

const toBool = (v: unknown): boolean | undefined => {
  if (v === true || v === 1 || v === '1' || v === 'true') return true;
  if (v === false || v === 0 || v === '0' || v === 'false') return false;
  return undefined;
};

const toEvery = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 2 && n <= 86400 ? Math.round(n) : undefined;
};

/** `place,date` (or an array) → the known keys in canonical order. `none` and empty mean no fields. */
const toFields = (v: unknown): FieldKey[] | undefined => {
  let list: string[];
  if (Array.isArray(v)) list = v.filter((x): x is string => typeof x === 'string');
  else if (typeof v === 'string') list = v.split(',');
  else return undefined;
  const set = new Set(list.map((s) => s.trim()));
  return FIELD_KEYS.filter((k) => set.has(k));
};

/** Validate loosely-typed input (URL strings or parsed JSON) into the settings it can express. */
function coerceSettings(get: (key: string) => unknown): Partial<Settings> {
  const out: Partial<Settings> = {};
  const set = <K extends keyof Settings>(key: K, value: Settings[K] | undefined) => {
    if (value !== undefined) out[key] = value;
  };
  set('every', toEvery(get('every')));
  set('fx', oneOf(FXS, get('fx')));
  set('fit', oneOf(FITS, get('fit')));
  set('fields', toFields(get('fields')));
  set('pos', oneOf(POSS, get('pos')));
  set('size', oneOf(SIZES, get('size')));
  set('brief', toBool(get('brief')));
  set('clock', toBool(get('clock')));
  set('awake', toBool(get('awake')));
  set('night', toBool(get('night')));
  return out;
}

export function readStored(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const o: unknown = JSON.parse(raw);
    if (!o || typeof o !== 'object') return {};
    return coerceSettings((k) => (o as Record<string, unknown>)[k]);
  } catch {
    return {};
  }
}

export function writeStored(s: Settings): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* private mode or blocked storage: the settings just don't persist */
  }
}

export function sourceFromQuery(q: URLSearchParams): Source {
  const tags = Array.from(
    new Set(
      (q.get('tags') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
  const place = (q.get('place') ?? '').trim();
  const city = (q.get('city') ?? '').trim();
  const theme = (q.get('theme') ?? '').trim();
  const user = (q.get('user') ?? '').trim().replace(/^@/, '');
  // `src` may be left out when the link carries a selector: /living?tags=lake, /living?theme=th_x
  let src: Src = oneOf(SRCS, q.get('src')) ?? (tags.length ? 'tags' : place ? 'place' : theme ? 'theme' : city ? 'city' : 'all');
  if ((src === 'place' && !place) || (src === 'theme' && !theme) || (src === 'city' && !city)) src = 'all';
  return {
    src,
    tags,
    match: oneOf(MATCHES, q.get('match')) ?? 'any',
    place,
    city,
    theme,
    user,
    order: oneOf(ORDERS, q.get('order')) ?? defaultOrder(src)
  };
}

export function readInitial(search: string = window.location.search): Initial {
  const q = new URLSearchParams(search);
  const fromUrl = coerceSettings((k) => q.get(k));
  return {
    source: sourceFromQuery(q),
    settings: { ...DEFAULT_SETTINGS, ...readStored(), ...fromUrl },
    start: (q.get('start') ?? '').trim()
  };
}

/**
 * The full query string for a configuration: every setting is written out, so the link behaves the
 * same on a device whose localStorage holds different settings. Source parameters are written only
 * when they matter for the chosen source.
 */
export function buildQuery(source: Source, s: Settings): string {
  const q: string[] = [];
  const add = (k: string, v: string) => q.push(`${k}=${v}`);
  add('src', source.src);
  if (source.src === 'tags' && source.tags.length) add('tags', source.tags.map(encodeURIComponent).join(','));
  if (source.src === 'tags') add('match', source.match);
  if (source.src === 'place' && source.place) add('place', encodeURIComponent(source.place));
  if (source.src === 'theme' && source.theme) add('theme', encodeURIComponent(source.theme));
  if (source.city && source.src !== 'theme') add('city', encodeURIComponent(source.city));
  if (source.user && source.src !== 'theme') add('user', encodeURIComponent(source.user));
  add('order', source.order);
  add('every', String(s.every));
  add('fx', s.fx);
  add('fit', s.fit);
  add('fields', s.fields.length ? s.fields.join(',') : 'none');
  add('pos', s.pos);
  add('size', s.size);
  add('brief', s.brief ? '1' : '0');
  add('clock', s.clock ? '1' : '0');
  add('awake', s.awake ? '1' : '0');
  add('night', s.night ? '1' : '0');
  return q.join('&');
}

/** Keep the address bar equal to the current configuration without adding history entries. */
export function replaceUrl(query: string): void {
  try {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  } catch {
    /* sandboxed frame */
  }
}

export const absoluteLink = (query: string): string => `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ''}`;
