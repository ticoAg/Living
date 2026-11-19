// Where a video or recording was made, taken out before it is uploaded. MP4 and QuickTime files (the videos phones
// make, voice memos) can carry it in their metadata as ISO 6709 text (`+30.2593+120.1517/`): in a `©xyz` or 3GPP
// `loci` box of their user data, or as a `com.apple.quicktime.location.*` item of their `meta`. Each is blanked where
// it is, the same length, so nothing else in the file moves and no part of it is read but those boxes' headers.
// Other files are uploaded as they are. Docs: /docs/product/features/attachments.md

/** Bytes to read from: a File or Blob, or bytes in a test. */
export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export const blobSource = (b: Blob): ByteSource => ({
  size: b.size,
  read: async (offset, length) => new Uint8Array(await b.slice(offset, offset + length).arrayBuffer())
});

/** Bytes to write over the file's own, at `offset`. */
export interface Patch {
  offset: number;
  bytes: Uint8Array;
}

interface Box {
  type: string;
  start: number;
  /** 8, or 16 with a 64-bit size */
  header: number;
  end: number;
}

/** Top-level boxes an MP4 or QuickTime file may start with. */
const FIRST = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot', 'uuid']);
/** Boxes of user data that are a position, and nothing else. */
const POSITION = new Set(['©xyz', 'loci']);
/** Boxes that hold the others looked into; `mdia` (the samples' tables, most of `moov`) is not one. */
const INTO = new Set(['moov', 'trak', 'udta']);
/** Keys of a QuickTime `meta` whose values tell where. */
const PLACE_KEY = /location/i;
/** More boxes than any real file has at one level: a file that says so is not one. */
const MAX_BOXES = 10_000;

const typeOf = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

async function boxAt(src: ByteSource, offset: number, end: number): Promise<Box | null> {
  if (offset + 8 > end) return null;
  const h = await src.read(offset, Math.min(16, end - offset));
  if (h.length < 8) return null;
  let size = u32(h, 0);
  let header = 8;
  if (size === 1) {
    if (h.length < 16) return null;
    size = u32(h, 8) * 2 ** 32 + u32(h, 12);
    header = 16;
  } else if (size === 0) size = end - offset;
  if (size < header || offset + size > end) return null;
  return { type: typeOf(h, 4), start: offset, header, end: offset + size };
}

/** The boxes inside `from`…`to`, one after another, up to the first that does not fit. */
async function boxesIn(src: ByteSource, from: number, to: number): Promise<Box[]> {
  const out: Box[] = [];
  for (let at = from; at + 8 <= to && out.length < MAX_BOXES;) {
    const b = await boxAt(src, at, to);
    if (!b) break;
    out.push(b);
    at = b.end;
  }
  return out;
}

const zeros = (n: number) => new Uint8Array(n);
const FREE = new Uint8Array([0x66, 0x72, 0x65, 0x65]);

/** A box of user data made `free`, its content zero. */
const blank = (b: Box): Patch[] => [
  { offset: b.start + 4, bytes: FREE },
  { offset: b.start + b.header, bytes: zeros(b.end - b.start - b.header) }
];

/**
 * A `meta`: in QuickTime files its boxes follow its header, in ISO files four bytes of version and flags come first.
 * The values of the keys about location are zeroed in its `ilst`, and so are the `©xyz` items of an iTunes-style one.
 */
async function metaPatches(src: ByteSource, meta: Box): Promise<Patch[]> {
  const peek = await src.read(meta.start + meta.header, Math.min(12, meta.end - meta.start - meta.header));
  const quicktime = peek.length >= 8 && ['hdlr', 'keys', 'ilst', 'mdta'].includes(typeOf(peek, 4));
  const inner = await boxesIn(src, meta.start + meta.header + (quicktime ? 0 : 4), meta.end);
  const keys = inner.find((b) => b.type === 'keys');
  const ilst = inner.find((b) => b.type === 'ilst');
  if (!ilst) return [];
  const where = new Set<number>();
  if (keys) {
    const k = await src.read(keys.start + keys.header, keys.end - keys.start - keys.header);
    const count = k.length >= 8 ? u32(k, 4) : 0;
    for (let i = 0, at = 8; i < count && at + 8 <= k.length; i++) {
      const size = u32(k, at);
      if (size < 8 || at + size > k.length) break;
      const name = new TextDecoder().decode(k.subarray(at + 8, at + size));
      if (PLACE_KEY.test(name)) where.add(i + 1);
      at += size;
    }
  }
  const out: Patch[] = [];
  for (const item of await boxesIn(src, ilst.start + ilst.header, ilst.end)) {
    const head = await src.read(item.start + 4, 4);
    if (!where.has(u32(head, 0)) && item.type !== '©xyz') continue;
    for (const data of await boxesIn(src, item.start + item.header, item.end)) {
      // after the data box's type and locale, the value
      const from = data.start + data.header + 8;
      if (data.type === 'data' && from < data.end) out.push({ offset: from, bytes: zeros(data.end - from) });
    }
  }
  return out;
}

async function walk(src: ByteSource, box: Box): Promise<Patch[]> {
  const out: Patch[] = [];
  for (const child of await boxesIn(src, box.start + box.header, box.end)) {
    if (box.type === 'udta' && POSITION.has(child.type)) out.push(...blank(child));
    else if (child.type === 'meta') out.push(...(await metaPatches(src, child)));
    else if (INTO.has(child.type)) out.push(...(await walk(src, child)));
  }
  return out;
}

/** The bytes to write over the places in an MP4 or QuickTime file that say where it was made; none for any other. */
export async function locationPatches(src: ByteSource): Promise<Patch[]> {
  const top = await boxesIn(src, 0, src.size);
  if (!top.length || !FIRST.has(top[0].type)) return [];
  const out: Patch[] = [];
  for (const b of top) if (b.type === 'moov') out.push(...(await walk(src, b)));
  return out.sort((a, b) => a.offset - b.offset);
}

/** `file` with `patches` written over it: the same size, the rest read from the file as it is sent. */
export function patched(file: Blob, patches: Patch[]): Blob {
  if (!patches.length) return file;
  const parts: BlobPart[] = [];
  let at = 0;
  for (const p of patches) {
    parts.push(file.slice(at, p.offset), p.bytes as Uint8Array<ArrayBuffer>);
    at = p.offset + p.bytes.length;
  }
  parts.push(file.slice(at));
  return new Blob(parts, { type: file.type });
}

/** `file` without where it was made, and whether it said. */
export async function withoutLocation(file: Blob): Promise<{ blob: Blob; located: boolean }> {
  const patches = await locationPatches(blobSource(file));
  return { blob: patched(file, patches), located: patches.length > 0 };
}
