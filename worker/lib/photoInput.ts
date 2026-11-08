// Validation of the JSON `meta` part of POST /api/photos (CreatePhotoMeta).

import type { GeoPrivacy, NewPoi, PoiMethod, Visibility } from '../../shared/types';
import { invalid } from './http';
import { parseNewPoi } from './poi';
import {
  isPlainObject,
  optBool,
  optEnum,
  optFocus,
  optHeading,
  optNum,
  optPalette,
  optTakenAt,
  optText,
  optTz,
  strArray,
  type Body
} from './validate';

export const VISIBILITIES = ['public', 'unlisted', 'private'] as const;
export const GEO_PRIVACIES = ['exact', 'fuzzy', 'hidden'] as const;
export const POI_METHODS = ['auto', 'confirmed', 'inferred', 'manual'] as const;

export interface ParsedMeta {
  title: string | null;
  note: string | null;
  takenAt: string | null;
  tz: string | null;
  lat: number | null;
  lng: number | null;
  alt: number | null;
  heading: number | null;
  geoPrivacy: GeoPrivacy;
  province: string | null;
  city: string | null;
  district: string | null;
  poiId: string | null;
  newPoi: NewPoi | null;
  poiDistance: number | null;
  poiMethod: PoiMethod | null;
  camera: string | null;
  lens: string | null;
  focal: number | null;
  focal35: number | null;
  aperture: number | null;
  shutter: string | null;
  iso: number | null;
  width: number;
  height: number;
  sizes: { s: [number, number]; m: [number, number]; l: [number, number] };
  thumbhash: string | null;
  palette: string[] | null;
  focus: [number, number] | null;
  visibility: Visibility;
  inLiving: boolean;
  favorite: boolean;
  sha256: string | null;
  tagIds: string[];
  suggestedTagIds: string[];
  themeIds: string[];
}

function size(v: unknown, label: string): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) throw invalid(`${label}需要是 [宽, 高]`);
  const w = optNum(v[0], `${label}的宽`, { min: 1, max: 20000, int: true });
  const h = optNum(v[1], `${label}的高`, { min: 1, max: 20000, int: true });
  if (w === null || h === null) throw invalid(`${label}需要是 [宽, 高]`);
  return [w, h];
}

export function parseCreateMeta(raw: unknown): ParsedMeta {
  if (!isPlainObject(raw)) throw invalid('meta 需要是一个 JSON 对象');
  const m: Body = raw;

  const width = optNum(m.width, '图片宽度', { min: 1, max: 20000, int: true });
  const height = optNum(m.height, '图片高度', { min: 1, max: 20000, int: true });
  if (width === null || height === null) throw invalid('meta 里缺少图片的宽和高');
  if (!isPlainObject(m.variantSizes)) throw invalid('meta 里缺少 variantSizes（s、m、l 三种尺寸图的像素尺寸）');
  const sizes = { s: size(m.variantSizes.s, '小图尺寸'), m: size(m.variantSizes.m, '中图尺寸'), l: size(m.variantSizes.l, '大图尺寸') };

  // A point needs both coordinates; a stray half is dropped rather than stored.
  let lat = optNum(m.lat, '纬度', { min: -90, max: 90 });
  let lng = optNum(m.lng, '经度', { min: -180, max: 180 });
  if (lat === null || lng === null) lat = lng = null;

  const sha = m.sha256 === undefined || m.sha256 === null || m.sha256 === '' ? null : m.sha256;
  if (sha !== null && (typeof sha !== 'string' || !/^[0-9a-fA-F]{64}$/.test(sha))) throw invalid('sha256 需要是 64 位十六进制');

  const thumbhash = optText(m.thumbhash, 'thumbhash', 200);
  if (thumbhash !== null && !/^[A-Za-z0-9+/=_-]+$/.test(thumbhash)) throw invalid('thumbhash 格式不对');

  const poiId = optText(m.poiId, '地点', 64);
  const newPoi = m.newPoi === undefined || m.newPoi === null ? null : parseNewPoi(m.newPoi);

  return {
    title: optText(m.title, '标题', 200),
    note: optText(m.note, '笔记', 5000),
    takenAt: optTakenAt(m.takenAt),
    tz: optTz(m.tz, true),
    lat,
    lng,
    alt: optNum(m.alt, '海拔', { min: -1000, max: 100000 }),
    heading: optHeading(m.heading),
    geoPrivacy: optEnum<GeoPrivacy>(m.geoPrivacy, '位置精度', GEO_PRIVACIES) ?? 'exact',
    province: optText(m.province, '省份', 60),
    city: optText(m.city, '城市', 60),
    district: optText(m.district, '区县', 60),
    poiId,
    newPoi,
    poiDistance: optNum(m.poiDistance, '地点距离', { min: 0, max: 1_000_000 }),
    poiMethod: optEnum<PoiMethod>(m.poiMethod === null ? undefined : m.poiMethod, '地点匹配方式', POI_METHODS) ?? null,
    camera: optText(m.camera, '相机', 120),
    lens: optText(m.lens, '镜头', 120),
    focal: optNum(m.focal, '焦距', { min: 0, max: 5000 }),
    focal35: optNum(m.focal35, '等效焦距', { min: 0, max: 5000 }),
    aperture: optNum(m.aperture, '光圈', { min: 0, max: 100 }),
    shutter: optText(m.shutter, '快门', 30),
    iso: optNum(m.iso, 'ISO', { min: 0, max: 10_000_000, int: true }),
    width,
    height,
    sizes,
    thumbhash,
    palette: optPalette(m.palette),
    focus: optFocus(m.focus),
    visibility: optEnum<Visibility>(m.visibility, '公开范围', VISIBILITIES) ?? 'public',
    inLiving: optBool(m.inLiving, 'inLiving') ?? true,
    favorite: optBool(m.favorite, 'favorite') ?? false,
    sha256: sha === null ? null : (sha as string).toLowerCase(),
    tagIds: strArray(m.tagIds, '标签', 200),
    suggestedTagIds: strArray(m.suggestedTagIds, '建议标签', 200),
    themeIds: strArray(m.themeIds, '主题', 50)
  };
}

// ---- file parts -----------------------------------------------------------------------------------------------

export const MAX_ORIGINAL_BYTES = 50 * 1024 * 1024;
export const MAX_VARIANT_BYTES = 12 * 1024 * 1024;
/** Request-size guard: original + three variants + metadata headroom. */
export const MAX_REQUEST_BYTES = MAX_ORIGINAL_BYTES + 3 * MAX_VARIANT_BYTES + 2 * 1024 * 1024;

export function isFile(v: unknown): v is File {
  return typeof v === 'object' && v !== null && typeof (v as File).arrayBuffer === 'function' && typeof (v as File).size === 'number';
}

const ORIGINAL_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
  'image/tiff': 'tif',
  'image/bmp': 'bmp'
};
const KNOWN_EXT = new Set(Object.values(ORIGINAL_EXT).concat(['jpeg', 'tiff']));
const EXT_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(ORIGINAL_EXT)
    .filter(([t]) => t !== 'image/jpg')
    .map(([t, e]) => [e, t])
);

/** Content type and file extension for the original, from its MIME type or file name. */
export function originalKind(file: { type: string; name?: string }): { ext: string; type: string } {
  const type = file.type.toLowerCase().split(';')[0].trim();
  if (ORIGINAL_EXT[type]) return { ext: ORIGINAL_EXT[type], type: type === 'image/jpg' ? 'image/jpeg' : type };
  const ext = (file.name?.split('.').pop() ?? '').toLowerCase();
  if (KNOWN_EXT.has(ext)) {
    const e = ext === 'jpeg' ? 'jpg' : ext === 'tiff' ? 'tif' : ext;
    return { ext: e, type: EXT_TYPE[e] };
  }
  throw invalid('原图需要是图片文件（JPEG、PNG、WebP、AVIF、HEIC 等）');
}

/** Variant files are public: only WebP or JPEG whose bytes really are that format. */
export async function variantKind(file: Blob, label: string): Promise<{ ext: 'webp' | 'jpg'; type: string }> {
  const type = file.type.toLowerCase().split(';')[0].trim();
  if (type !== 'image/webp' && type !== 'image/jpeg') throw invalid(`${label}需要是 image/webp 或 image/jpeg`);
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isWebp =
    head.length >= 12 && String.fromCharCode(...head.slice(0, 4)) === 'RIFF' && String.fromCharCode(...head.slice(8, 12)) === 'WEBP';
  if (type === 'image/jpeg' ? !isJpeg : !isWebp) throw invalid(`${label}的内容和它声明的格式不一致`);
  return type === 'image/webp' ? { ext: 'webp', type } : { ext: 'jpg', type };
}
