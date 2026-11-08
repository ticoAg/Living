// Per-file upload pipeline, run in the browser before anything is sent to the server:
// EXIF → decode (orientation applied) → three WebP/JPEG sizes → ThumbHash → palette → tone → SHA-256.
// The generated sizes carry no EXIF. Heavy libraries (exifr, thumbhash, suncalc) are imported lazily so
// they only load on the upload page. Files are processed one at a time by the caller to bound memory.
// Docs: /docs/product/features/upload.md, /docs/product/features/hierarchical-tags.md

export const MAX_ORIGINAL_BYTES = 50 * 1024 * 1024;
export const VARIANT_EDGES = { s: 480, m: 1600, l: 2560 } as const;
export type VariantKey = keyof typeof VARIANT_EDGES;

export const HEIC_MESSAGE = '浏览器无法解码这张图（HEIC 请在 Safari 上传或先转成 JPEG）';

export interface ExifSummary {
  /** Local wall-clock capture time, `YYYY-MM-DDTHH:mm:ss` */
  takenAt: string | null;
  /** `+08:00` */
  tz: string | null;
  lat: number | null;
  lng: number | null;
  alt: number | null;
  heading: number | null;
  camera: string | null;
  lens: string | null;
  focal: number | null;
  focal35: number | null;
  aperture: number | null;
  /** `1/500 s` */
  shutter: string | null;
  iso: number | null;
}

export interface VariantBlob {
  blob: Blob;
  w: number;
  h: number;
  mime: 'image/webp' | 'image/jpeg';
  ext: 'webp' | 'jpg';
}

export interface PaletteColor {
  hex: string;
  /** share of the image, 0..1 */
  weight: number;
}

export interface Processed {
  exif: ExifSummary;
  /** pixel size after orientation */
  width: number;
  height: number;
  variants: Record<VariantKey, VariantBlob>;
  /** base64 ThumbHash */
  thumbhash: string;
  /** up to 5 hex colours, most dominant first */
  palette: string[];
  /** preset tone tag id (warm/cool/green/blue/mono) */
  toneTag: string | null;
  sha256: string | null;
  /** preset tag ids from time of day, season and colour; subject tags come from the chosen place */
  suggestedTagIds: string[];
}

const EMPTY_EXIF: ExifSummary = {
  takenAt: null,
  tz: null,
  lat: null,
  lng: null,
  alt: null,
  heading: null,
  camera: null,
  lens: null,
  focal: null,
  focal35: null,
  aperture: null,
  shutter: null,
  iso: null
};
export const emptyExif = (): ExifSummary => ({ ...EMPTY_EXIF });

/* ---------------------------------------------------------------- EXIF mapping (pure) */

type Raw = Record<string, unknown>;

function first(v: unknown): unknown {
  if (Array.isArray(v)) return v[0];
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return (v as unknown as ArrayLike<unknown>)[0];
  return v;
}

function num(v: unknown): number | null {
  const x = first(v);
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f]/g, '').trim();
  return s ? s : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026:11:08 14:22:11` → `2026-11-08T14:22:11`; anything implausible → null. */
export function formatTakenAt(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(+v)) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}T${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  }
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})[:\-/](\d{2})[:\-/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(v.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

/** `+08:00`, `+0800`, `Z` → `+08:00`. */
export function normalizeTz(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (s.toUpperCase() === 'Z') return '+00:00';
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(s);
  if (!m || +m[2] > 14 || +m[3] > 59) return null;
  return `${m[1]}${m[2]}:${m[3]}`;
}

/** 0.002 → `1/500 s`, 2 → `2 s`, 0.5 → `0.5 s`. */
export function formatShutter(t: number | null): string | null {
  if (t == null || !Number.isFinite(t) || t <= 0) return null;
  if (t >= 0.4) return `${Number(t.toFixed(1))} s`;
  return `1/${Math.round(1 / t)} s`;
}

const MAKE_NOISE = /\b(corporation|corp|company|co|imaging|inc|limited|ltd|electronics)\b\.?/gi;
/** Make + Model without repeating the brand ("Canon" + "Canon EOS R5" → "Canon EOS R5"). */
export function formatCamera(make: string | null, model: string | null): string | null {
  const mk = make ? make.replace(MAKE_NOISE, ' ').replace(/\s+/g, ' ').replace(/[\s,.]+$/, '').trim() : null;
  if (!model) return mk || make;
  if (!mk) return model;
  const head = mk.split(' ')[0].toLowerCase();
  return model.toLowerCase().startsWith(head) ? model : `${mk} ${model}`;
}

function dmsToDeg(v: unknown, ref: unknown): number | null {
  const x = Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView)) ? Array.from(v as ArrayLike<number>) : null;
  let deg: number | null;
  if (x && x.length) {
    const [d, m = 0, s = 0] = x;
    deg = [d, m, s].every((n) => typeof n === 'number' && Number.isFinite(n)) ? d + m / 60 + s / 3600 : null;
  } else {
    deg = num(v);
  }
  if (deg == null) return null;
  const r = str(ref)?.toUpperCase();
  return r === 'S' || r === 'W' ? -Math.abs(deg) : deg;
}

/** Map exifr's merged output (raw values, translated keys) to what Living stores. */
export function mapExif(raw: Raw | null | undefined): ExifSummary {
  const out = emptyExif();
  if (!raw) return out;

  out.takenAt = formatTakenAt(raw.DateTimeOriginal) ?? formatTakenAt(raw.CreateDate) ?? formatTakenAt(raw.ModifyDate);
  out.tz = normalizeTz(raw.OffsetTimeOriginal) ?? normalizeTz(raw.OffsetTime) ?? normalizeTz(raw.OffsetTimeDigitized);

  const lat = num(raw.latitude) ?? dmsToDeg(raw.GPSLatitude, raw.GPSLatitudeRef);
  const lng = num(raw.longitude) ?? dmsToDeg(raw.GPSLongitude, raw.GPSLongitudeRef);
  if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
    out.lat = lat;
    out.lng = lng;
    const alt = num(raw.GPSAltitude);
    if (alt != null) out.alt = num(raw.GPSAltitudeRef) === 1 ? -Math.abs(alt) : alt;
  }
  const dir = num(raw.GPSImgDirection);
  if (dir != null && dir >= 0 && dir <= 360) out.heading = dir % 360;

  out.camera = formatCamera(str(raw.Make), str(raw.Model));
  out.lens = str(raw.LensModel);
  const focal = num(raw.FocalLength);
  out.focal = focal != null && focal > 0 ? focal : null;
  const f35 = num(raw.FocalLengthIn35mmFormat);
  out.focal35 = f35 != null && f35 > 0 ? f35 : null;
  const fn = num(raw.FNumber);
  out.aperture = fn != null && fn > 0 ? fn : null;
  out.shutter = formatShutter(num(raw.ExposureTime));
  const iso = num(raw.ISO);
  out.iso = iso != null && iso > 0 ? Math.round(iso) : null;
  return out;
}

/** exifr options: raw values (dates stay strings, no enum translation) under readable keys, one flat object. */
export const EXIFR_OPTIONS = {
  reviveValues: false,
  translateValues: false,
  translateKeys: true,
  mergeOutput: true,
  sanitize: true
} as const;

export async function readExif(file: Blob): Promise<ExifSummary> {
  try {
    const { parse } = await import('exifr');
    return mapExif((await parse(file, EXIFR_OPTIONS)) as Raw | undefined);
  } catch {
    return emptyExif();
  }
}

/* ---------------------------------------------------------------- suggestions (pure) */

type SunCalcApi = typeof import('suncalc');

const SUBJECT_TAGS: Record<string, string> = {
  桥: 'bridge',
  湖: 'lake',
  山: 'mountain',
  寺: 'temple',
  塔: 'pagoda',
  海岸: 'sea',
  岛: 'sea',
  街区: 'street',
  建筑: 'architecture',
  美术馆: 'architecture'
};
/** POI category → subject preset tag ids. */
export function subjectTagsForCategory(category: string | null | undefined): string[] {
  const id = category ? SUBJECT_TAGS[category] : undefined;
  return id ? [id] : [];
}

/** Season preset id from the capture month; the southern hemisphere is shifted by half a year. */
export function seasonTag(takenAt: string | null, lat: number | null): string | null {
  if (!takenAt) return null;
  const month = Number(takenAt.slice(5, 7));
  if (!(month >= 1 && month <= 12)) return null;
  const m = lat != null && lat < 0 ? ((month + 5) % 12) + 1 : month;
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}

/** Daypart from the local hour when there is no position to compute the sun from. */
export function daypartByHour(takenAt: string | null): string | null {
  if (!takenAt || takenAt.length < 13) return null;
  const h = Number(takenAt.slice(11, 13));
  if (!(h >= 0 && h <= 23)) return null;
  if (h >= 5 && h < 9) return 'morning';
  if (h >= 9 && h < 16) return 'daylight';
  if (h >= 16 && h < 19) return 'sunset';
  return 'night';
}

/** UTC instant of a local wall-clock time; without an offset, assume mean solar time at the longitude. */
export function wallClockToUtcMs(takenAt: string, tz: string | null, lng: number | null): number {
  const wall = Date.parse(`${takenAt}Z`);
  let offset = 0;
  const m = tz ? /^([+-])(\d{2}):(\d{2})$/.exec(tz) : null;
  if (m) offset = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000;
  else if (lng != null) offset = Math.round(lng / 15) * 3600000;
  return wall - offset;
}

/** Daypart preset id from the sun's altitude at the capture point. */
export function daypartBySun(sun: SunCalcApi, takenAt: string, tz: string | null, lat: number, lng: number): string | null {
  const ms = wallClockToUtcMs(takenAt, tz, lng);
  if (!Number.isFinite(ms)) return daypartByHour(takenAt);
  const date = new Date(ms);
  const alt = (sun.getPosition(date, lat, lng).altitude * 180) / Math.PI;
  if (!Number.isFinite(alt)) return daypartByHour(takenAt);
  if (alt <= -12) return 'night';
  if (alt < -1) return 'bluehour';
  if (alt >= 10) return 'daylight';
  // sun low: first light after sunrise or golden hour before sunset
  const noon = sun.getTimes(date, lat, lng).solarNoon.getTime();
  const morning = Number.isFinite(noon) ? ms < noon : Number(takenAt.slice(11, 13)) < 12;
  return morning ? 'morning' : 'sunset';
}

/* ---------------------------------------------------------------- colour (pure) */

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
export const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();
export function fromHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// sRGB → CIE Lab (D65), so clusters follow perceived colour distance.
function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** k-means (k-means++ seeding, fixed seed) over an RGBA buffer; returns colours by weight. */
export function kmeansPalette(rgba: ArrayLike<number>, k = 5, maxIter = 16): PaletteColor[] {
  const rgb: number[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] >= 128) rgb.push(rgba[i], rgba[i + 1], rgba[i + 2]);
  }
  const n = rgb.length / 3;
  if (n === 0) return [];
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [l, a, b] = srgbToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    lab[i * 3] = l;
    lab[i * 3 + 1] = a;
    lab[i * 3 + 2] = b;
  }
  const dist2 = (i: number, c: Float32Array, j: number) => {
    const dl = lab[i * 3] - c[j * 3];
    const da = lab[i * 3 + 1] - c[j * 3 + 1];
    const db = lab[i * 3 + 2] - c[j * 3 + 2];
    return dl * dl + da * da + db * db;
  };

  let kk = Math.min(k, n);
  const rnd = mulberry32(0x9e3779b1 ^ n);
  const cent = new Float32Array(kk * 3);
  const setCent = (j: number, i: number) => {
    cent[j * 3] = lab[i * 3];
    cent[j * 3 + 1] = lab[i * 3 + 1];
    cent[j * 3 + 2] = lab[i * 3 + 2];
  };
  setCent(0, Math.floor(rnd() * n));
  const nearest = new Float64Array(n).fill(Infinity);
  for (let j = 1; j < kk; j++) {
    let total = 0;
    for (let i = 0; i < n; i++) {
      nearest[i] = Math.min(nearest[i], dist2(i, cent, j - 1));
      total += nearest[i];
    }
    if (total === 0) {
      kk = j; // fewer distinct colours than k
      break;
    }
    let pick = rnd() * total;
    let chosen = n - 1;
    for (let i = 0; i < n; i++) {
      pick -= nearest[i];
      if (pick <= 0) {
        chosen = i;
        break;
      }
    }
    setCent(j, chosen);
  }

  const assign = new Int32Array(n).fill(-1);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = 0;
    for (let i = 0; i < n; i++) {
      let bj = 0;
      let bd = Infinity;
      for (let j = 0; j < kk; j++) {
        const d = dist2(i, cent, j);
        if (d < bd) {
          bd = d;
          bj = j;
        }
      }
      if (assign[i] !== bj) {
        assign[i] = bj;
        changed++;
      }
    }
    if (!changed) break;
    const sum = new Float64Array(kk * 3);
    const cnt = new Int32Array(kk);
    for (let i = 0; i < n; i++) {
      const j = assign[i];
      sum[j * 3] += lab[i * 3];
      sum[j * 3 + 1] += lab[i * 3 + 1];
      sum[j * 3 + 2] += lab[i * 3 + 2];
      cnt[j]++;
    }
    for (let j = 0; j < kk; j++) {
      if (cnt[j]) {
        cent[j * 3] = sum[j * 3] / cnt[j];
        cent[j * 3 + 1] = sum[j * 3 + 1] / cnt[j];
        cent[j * 3 + 2] = sum[j * 3 + 2] / cnt[j];
      }
    }
  }

  // Report each cluster as the mean sRGB of its members.
  const sum = new Float64Array(kk * 3);
  const cnt = new Int32Array(kk);
  for (let i = 0; i < n; i++) {
    const j = assign[i];
    sum[j * 3] += rgb[i * 3];
    sum[j * 3 + 1] += rgb[i * 3 + 1];
    sum[j * 3 + 2] += rgb[i * 3 + 2];
    cnt[j]++;
  }
  const out: PaletteColor[] = [];
  for (let j = 0; j < kk; j++) {
    if (!cnt[j]) continue;
    out.push({ hex: toHex(sum[j * 3] / cnt[j], sum[j * 3 + 1] / cnt[j], sum[j * 3 + 2] / cnt[j]), weight: cnt[j] / n });
  }
  out.sort((a, b) => b.weight - a.weight);
  return out;
}

/** Hue (0..360), HSV saturation and value (0..1), and chroma (max-min, 0..1) of a hex colour. */
export function hueInfo(hex: string): { h: number; s: number; v: number; chroma: number } {
  const [r, g, b] = fromHex(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const c = max - min;
  let h = 0;
  if (c > 0) {
    if (max === r) h = ((g - b) / c) % 6;
    else if (max === g) h = (b - r) / c + 2;
    else h = (r - g) / c + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : c / max, v: max, chroma: c };
}

/** Tone preset id (warm/cool/green/blue/mono) from a weighted palette, or null when unclear. */
export function toneFromPalette(palette: readonly PaletteColor[]): string | null {
  if (!palette.length) return null;
  let wSum = 0;
  let chromaSum = 0;
  const votes = { warm: 0, cool: 0, green: 0, blue: 0 };
  for (const p of palette) {
    const { h, v, chroma } = hueInfo(p.hex);
    wSum += p.weight;
    chromaSum += p.weight * chroma;
    if (v < 0.08 || chroma < 0.03) continue; // near-black and greys carry no hue
    const vote = p.weight * chroma;
    if (h < 70 || h >= 330) votes.warm += vote;
    else if (h < 165) votes.green += vote;
    else if (h < 190) votes.cool += vote; // cyan, teal
    else if (h <= 270) {
      // saturated blue is 蓝 (sky, sea); washed-out blue is 冷
      if (chroma >= 0.25) votes.blue += vote;
      else votes.cool += vote;
    } else if (h < 300) votes.cool += vote; // violet dusk
    else votes.warm += vote; // magenta, rose
  }
  if (wSum === 0) return null;
  if (chromaSum / wSum < 0.06) return 'mono';
  let bestKey: keyof typeof votes | null = null;
  let bestVote = 0;
  for (const key of Object.keys(votes) as (keyof typeof votes)[]) {
    if (votes[key] > bestVote) {
      bestVote = votes[key];
      bestKey = key;
    }
  }
  return bestKey && bestVote / wSum >= 0.02 ? bestKey : null;
}

/* ---------------------------------------------------------------- canvas helpers */

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
/** Safari keeps canvas backing stores alive until they shrink. */
function release(c: HTMLCanvasElement) {
  c.width = 0;
  c.height = 0;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('浏览器不支持画布，无法处理图片');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** Scale to exactly tw×th in steps of at most 2×, which keeps thin detail from aliasing. */
export function scaleTo(src: CanvasImageSource, sw: number, sh: number, tw: number, th: number, flatten = false): HTMLCanvasElement {
  let cur: CanvasImageSource = src;
  let cw = sw;
  let ch = sh;
  let owned: HTMLCanvasElement | null = null;
  while (cw >= tw * 2 && ch >= th * 2) {
    const nw = Math.max(tw, Math.floor(cw / 2));
    const nh = Math.max(th, Math.floor(ch / 2));
    const c = makeCanvas(nw, nh);
    ctx2d(c).drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
    if (owned) release(owned);
    owned = c;
    cur = c;
    cw = nw;
    ch = nh;
  }
  const out = makeCanvas(tw, th);
  const ctx = ctx2d(out);
  if (flatten) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, out.width, out.height);
  if (owned) release(owned);
  return out;
}

/** Fit inside a long edge without ever enlarging. */
export function fitLongEdge(w: number, h: number, edge: number): [number, number] {
  const long = Math.max(w, h);
  if (long <= edge) return [w, h];
  const k = edge / long;
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

const toBlob = (c: HTMLCanvasElement, mime: string, q: number) => new Promise<Blob | null>((res) => c.toBlob(res, mime, q));

interface Output {
  mime: 'image/webp' | 'image/jpeg';
  ext: 'webp' | 'jpg';
  quality: number;
}
const WEBP: Output = { mime: 'image/webp', ext: 'webp', quality: 0.82 };
const JPEG: Output = { mime: 'image/jpeg', ext: 'jpg', quality: 0.85 };
let outputProbe: Promise<Output> | null = null;
/** WebP when this browser can encode it (Safari before 17 silently returns PNG), else JPEG. */
function pickOutput(): Promise<Output> {
  return (outputProbe ??= (async () => {
    try {
      const c = makeCanvas(2, 2);
      const b = await toBlob(c, WEBP.mime, WEBP.quality);
      release(c);
      if (b && b.type === WEBP.mime) return WEBP;
    } catch {
      /* fall through */
    }
    return JPEG;
  })());
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

const isHeic = (file: File) => /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

async function decodeImage(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    for (const opts of [{ imageOrientation: 'from-image' as const }, undefined]) {
      try {
        const bmp = opts ? await createImageBitmap(file, opts) : await createImageBitmap(file);
        return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
      } catch {
        /* try the next strategy */
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty');
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(isHeic(file) ? HEIC_MESSAGE : '无法解码这张图片（文件可能已损坏或格式不受支持）');
  }
}

async function sha256Hex(file: Blob): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle; // only in secure contexts (https, localhost)
  if (!subtle) return null;
  try {
    const digest = await subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/* ---------------------------------------------------------------- pipeline */

/**
 * Run the whole pipeline for one file. Throws an Error with a user-facing Chinese message on failure.
 * Callers process files sequentially; every bitmap and scratch canvas is released before returning.
 */
export async function processFile(file: File): Promise<Processed> {
  if (!file.size) throw new Error('文件是空的');
  if (file.size > MAX_ORIGINAL_BYTES) throw new Error('原图超过 50 MB，无法上传');
  if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) throw new Error('不支持 SVG，请选择照片文件');

  const exif = await readExif(file);
  await tick();

  const out = await pickOutput();
  const decoded = await decodeImage(file);
  const canvases: HTMLCanvasElement[] = [];
  try {
    const { width, height } = decoded;
    if (!width || !height) throw new Error('无法读取图片尺寸');
    const flatten = out.mime === 'image/jpeg';

    const encoded = new Map<string, VariantBlob>();
    const encode = async (c: HTMLCanvasElement): Promise<VariantBlob> => {
      const key = `${c.width}x${c.height}`;
      const hit = encoded.get(key);
      if (hit) return hit;
      const blob = await toBlob(c, out.mime, out.quality);
      if (!blob || !blob.size) throw new Error('浏览器无法生成缩略图，请换一张图片或换个浏览器再试');
      const v: VariantBlob = { blob, w: c.width, h: c.height, mime: out.mime, ext: out.ext };
      encoded.set(key, v);
      return v;
    };

    // Large → small, each size scaled from the one before it.
    const [lw, lh] = fitLongEdge(width, height, VARIANT_EDGES.l);
    const lCanvas = scaleTo(decoded.source, width, height, lw, lh, flatten);
    canvases.push(lCanvas);
    decoded.close();
    await tick();
    const l = await encode(lCanvas);

    const [mw, mh] = fitLongEdge(width, height, VARIANT_EDGES.m);
    const mCanvas = mw === lw && mh === lh ? lCanvas : scaleTo(lCanvas, lw, lh, mw, mh, flatten);
    if (mCanvas !== lCanvas) canvases.push(mCanvas);
    const m = await encode(mCanvas);

    const [sw, sh] = fitLongEdge(width, height, VARIANT_EDGES.s);
    const sCanvas = sw === mw && sh === mh ? mCanvas : scaleTo(mCanvas, mw, mh, sw, sh, flatten);
    if (sCanvas !== mCanvas) canvases.push(sCanvas);
    const s = await encode(sCanvas);
    await tick();

    // ThumbHash from ≤100 px, palette from 64 px.
    const [tw, th] = fitLongEdge(sCanvas.width, sCanvas.height, 100);
    const tiny = scaleTo(sCanvas, sCanvas.width, sCanvas.height, tw, th);
    canvases.push(tiny);
    const tinyData = ctx2d(tiny).getImageData(0, 0, tiny.width, tiny.height).data;
    const { rgbaToThumbHash } = await import('thumbhash');
    const thumbhash = toBase64(rgbaToThumbHash(tiny.width, tiny.height, tinyData));

    const [pw, ph] = fitLongEdge(sCanvas.width, sCanvas.height, 64);
    const small = scaleTo(sCanvas, sCanvas.width, sCanvas.height, pw, ph);
    canvases.push(small);
    const colors = kmeansPalette(ctx2d(small).getImageData(0, 0, small.width, small.height).data, 5);
    const toneTag = toneFromPalette(colors);
    await tick();

    const sha256 = await sha256Hex(file);

    // time-of-day, season, tone
    const suggested: string[] = [];
    let daypart: string | null = null;
    if (exif.takenAt) {
      if (exif.lat != null && exif.lng != null) {
        try {
          const mod = await import('suncalc');
          const sun = ((mod as unknown as { default?: SunCalcApi }).default ?? mod) as SunCalcApi;
          daypart = daypartBySun(sun, exif.takenAt, exif.tz, exif.lat, exif.lng);
        } catch {
          daypart = daypartByHour(exif.takenAt);
        }
      } else {
        daypart = daypartByHour(exif.takenAt);
      }
    }
    for (const id of [daypart, seasonTag(exif.takenAt, exif.lat), toneTag]) if (id && !suggested.includes(id)) suggested.push(id);

    return { exif, width, height, variants: { s, m, l }, thumbhash, palette: colors.map((c) => c.hex), toneTag, sha256, suggestedTagIds: suggested };
  } finally {
    decoded.close();
    for (const c of canvases) release(c);
  }
}
