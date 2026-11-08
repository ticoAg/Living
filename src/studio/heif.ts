// Reading what the pipeline needs to know about a HEIC/HEIF file without decoding it: whether it is one, whether it is
// whole, and which colour space its pixels are in. Pure, so the upload pipeline can use it without loading the decoder (heic.ts).
// Docs: /docs/product/features/upload.md

/** Brands that mark a file as HEIC/HEIF: the HEVC ones iPhones and cameras write, and the generic image-collection ones. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

const ascii = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));

/** The brands in an ISO base media `ftyp` box at the start of `head`: the major brand first, then the compatible ones. */
export function ftypBrands(head: Uint8Array): string[] {
  if (head.length < 16 || ascii(head, 4) !== 'ftyp') return [];
  const size = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(0);
  const end = size >= 16 && size <= head.length ? size : head.length;
  const brands = [ascii(head, 8)];
  for (let at = 16; at + 4 <= end; at += 4) brands.push(ascii(head, at));
  return brands;
}

/** HEIC or HEIF by MIME type or extension, or, for a file that has neither, by the brands inside it. AVIF is not HEIC. */
export async function isHeif(file: Blob & { name?: string }): Promise<boolean> {
  if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name ?? '')) return true;
  const brands = ftypBrands(new Uint8Array(await file.slice(0, 128).arrayBuffer()));
  return !/^avi[fs]$/.test(brands[0] ?? '') && brands.some((b) => HEIF_BRANDS.has(b));
}

/* ---------------------------------------------------------------- boxes */

interface BoxHeader {
  type: string;
  /** the whole box, header included; may reach past the end of the file when the file was cut short */
  size: number;
  header: number;
}

/** The box header at `at` in a file: null past the last box (fewer than 8 bytes left), false where there is no valid header. */
async function boxHeaderAt(file: Blob, at: number): Promise<BoxHeader | null | false> {
  if (at + 8 > file.size) return null;
  const head = new Uint8Array(await file.slice(at, at + 16).arrayBuffer());
  const view = new DataView(head.buffer);
  let size = view.getUint32(0);
  let header = 8;
  if (size === 0) {
    size = file.size - at; // the box runs to the end of the file
  } else if (size === 1) {
    if (head.length < 16) return false;
    size = Number(view.getBigUint64(8)); // 64-bit size
    header = 16;
  }
  return size < header ? false : { type: ascii(head, 4), size, header };
}

/**
 * False when the file ends before its last top-level box (ftyp, meta, mdat, ...) does, which is what a copy or download cut
 * short leaves behind. libheif decodes such a file without complaint and fills what is missing with grey, so it is checked
 * before decoding. Reads a handful of 16-byte box headers, not the file.
 */
export async function isComplete(file: Blob): Promise<boolean> {
  if (file.size < 8) return false;
  let at = 0;
  for (let boxes = 0; boxes < 1000; boxes++) {
    const box = await boxHeaderAt(file, at);
    if (box === null) break;
    if (box === false) return false; // not a box at all
    at += box.size;
  }
  return at <= file.size;
}

/** The content (after the header) of the first top-level box of `type`, or null when there is none or it is bigger than `maxBytes`. */
async function topLevelBox(file: Blob, type: string, maxBytes: number): Promise<Uint8Array | null> {
  let at = 0;
  for (let boxes = 0; boxes < 1000; boxes++) {
    const box = await boxHeaderAt(file, at);
    if (!box) return null;
    if (box.type === type) {
      if (box.size > maxBytes || at + box.size > file.size) return null;
      return new Uint8Array(await file.slice(at + box.header, at + box.size).arrayBuffer());
    }
    at += box.size;
  }
  return null;
}

/** The boxes inside bytes[from, to): their type and the range of their content. Stops at the first one that does not fit. */
function* childBoxes(bytes: Uint8Array, from: number, to: number): Generator<{ type: string; start: number; end: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = from;
  while (at + 8 <= to) {
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1 && at + 16 <= to) {
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) return;
    yield { type: ascii(bytes, at + 4), start: at + header, end: at + size };
    at += size;
  }
}

/* ---------------------------------------------------------------- colour space */

export type HeifColorSpace = 'srgb' | 'display-p3';

/** Display P3's colorants as an ICC profile states them (XYZ, adapted to D50). sRGB's red is 0.4360 and Adobe RGB's is 0.6097. */
const P3_COLORANTS: Record<string, readonly number[]> = {
  rXYZ: [0.5151, 0.2412, -0.0011],
  gXYZ: [0.292, 0.6922, 0.0419],
  bXYZ: [0.1571, 0.0666, 0.7841]
};
const COLORANT_TOLERANCE = 0.01;

/** True when an ICC profile is an RGB profile with Display P3 primaries: Apple's "Display P3" and Samsung's P3-with-sRGB-curve alike. */
export function isP3Profile(icc: Uint8Array): boolean {
  if (icc.length < 132 || ascii(icc, 16) !== 'RGB ') return false;
  const view = new DataView(icc.buffer, icc.byteOffset, icc.byteLength);
  const matched = new Set<string>();
  const tags = Math.min(view.getUint32(128), 200);
  for (let i = 0; i < tags && 132 + i * 12 + 12 <= icc.length; i++) {
    const at = 132 + i * 12;
    const name = ascii(icc, at);
    const reference = P3_COLORANTS[name];
    const data = view.getUint32(at + 4);
    if (!reference || data + 20 > icc.length || ascii(icc, data) !== 'XYZ ') continue;
    // an XYZ tag: the signature, 4 reserved bytes, then three signed 16.16 fixed-point numbers
    if (reference.every((expected, k) => Math.abs(view.getInt32(data + 8 + k * 4) / 65536 - expected) <= COLORANT_TOLERANCE))
      matched.add(name);
  }
  return matched.size === Object.keys(P3_COLORANTS).length;
}

/** `colr` property contents (`prof`/`rICC` ICC profile, or `nclx` colour primaries, 12 being Display P3) → is it P3? */
function colrIsP3(bytes: Uint8Array, start: number, end: number): boolean {
  const kind = ascii(bytes, start);
  if (kind === 'prof' || kind === 'rICC') return isP3Profile(bytes.subarray(start + 4, end));
  if (kind === 'nclx' && start + 6 <= end)
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(start + 4) === 12;
  return false;
}

/**
 * The colour space a HEIC's pixels are in, from the colour profile it carries. iPhones write Display P3, which libheif hands over
 * as plain RGB values; the caller tags them as display-p3 so the browser converts them to sRGB, the way it does for a P3 JPEG.
 * Files without a profile (most Android phones) and everything not recognised as P3 are sRGB. Reads only the `meta` box.
 */
export async function heifColorSpace(file: Blob): Promise<HeifColorSpace> {
  try {
    const meta = await topLevelBox(file, 'meta', 8 * 1024 * 1024);
    if (!meta) return 'srgb';
    // meta is a "full box": 4 bytes of version and flags precede its children. Colour profiles are item properties, in iprp > ipco.
    for (const iprp of childBoxes(meta, 4, meta.length)) {
      if (iprp.type !== 'iprp') continue;
      for (const ipco of childBoxes(meta, iprp.start, iprp.end)) {
        if (ipco.type !== 'ipco') continue;
        for (const property of childBoxes(meta, ipco.start, ipco.end)) {
          if (property.type === 'colr' && colrIsP3(meta, property.start, property.end)) return 'display-p3';
        }
      }
    }
  } catch {
    /* an unreadable header: treat the pixels as sRGB, as before */
  }
  return 'srgb';
}
