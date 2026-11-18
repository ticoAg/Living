// Reading a ZIP archive in the browser without loading it: the central directory at the end says where each entry's
// bytes are, and an entry is a slice of the file (stored) or that slice inflated (deflate, by DecompressionStream).
// Enough for an export's own parts (export/zip.ts: stored, UTF-8 names) and for its folder zipped again by an
// operating system or another tool (deflate, ZIP64). Docs: /docs/product/features/import.md

export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflate */
  method: number;
  compressedSize: number;
  size: number;
  /** of the entry's local header */
  offset: number;
  encrypted: boolean;
}

/** A ZIP that cannot be read, said for the person who picked it. */
export class ZipError extends Error {}

const END = 0x06054b50;
const END64 = 0x06064b50;
const LOCATOR64 = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX32 = 0xffffffff;

const view = async (blob: Blob, start: number, end: number) => new DataView(await blob.slice(start, end).arrayBuffer());
const big = (v: DataView, at: number) => Number(v.getBigUint64(at, true));

const utf8 = new TextDecoder('utf-8', { fatal: true });
const latin1 = new TextDecoder('latin1');
/** A name: UTF-8 when it reads as UTF-8 (many tools leave the flag off), else byte by byte. */
function nameOf(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    return latin1.decode(bytes);
  }
}

/** The entries of an archive, folders left out. Throws ZipError when the file is not a ZIP, or not all of one. */
export async function zipEntries(file: Blob): Promise<ZipEntry[]> {
  // the end record is the last 22 bytes, unless a comment of up to 64 KiB follows it
  const tailStart = Math.max(0, file.size - 22 - 0xffff);
  const tail = await view(file, tailStart, file.size);
  let at = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === END) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new ZipError('不是 zip 文件，或者文件不完整');
  let count = tail.getUint16(at + 10, true);
  let dirSize = tail.getUint32(at + 12, true);
  let dirOffset = tail.getUint32(at + 16, true);
  if (count === 0xffff || dirSize === MAX32 || dirOffset === MAX32) {
    // ZIP64: its end record is found through the locator just before the ordinary one
    const locAt = tailStart + at - 20;
    const loc = locAt >= 0 ? await view(file, locAt, locAt + 20) : null;
    if (loc && loc.getUint32(0, true) === LOCATOR64) {
      const endAt = big(loc, 8);
      const end = await view(file, endAt, endAt + 56);
      if (end.byteLength < 56 || end.getUint32(0, true) !== END64) throw new ZipError('zip 文件不完整');
      count = big(end, 32);
      dirSize = big(end, 40);
      dirOffset = big(end, 48);
    }
  }
  if (dirOffset + dirSize > file.size) throw new ZipError('zip 文件不完整：可能还没下载完，或者是分卷压缩的一部分');

  const dir = await view(file, dirOffset, dirOffset + dirSize);
  const out: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > dir.byteLength || dir.getUint32(p, true) !== CENTRAL) throw new ZipError('zip 文件的目录损坏了');
    const flags = dir.getUint16(p + 8, true);
    const method = dir.getUint16(p + 10, true);
    let compressedSize = dir.getUint32(p + 20, true);
    let size = dir.getUint32(p + 24, true);
    const nameLen = dir.getUint16(p + 28, true);
    const extraLen = dir.getUint16(p + 30, true);
    const commentLen = dir.getUint16(p + 32, true);
    let offset = dir.getUint32(p + 42, true);
    const name = nameOf(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen));
    // the ZIP64 extra field holds, in this order, those of the three that did not fit
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = dir.getUint16(e, true);
      const len = dir.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        const fits = () => q + 8 <= e + 4 + len;
        if (size === MAX32 && fits()) {
          size = big(dir, q);
          q += 8;
        }
        if (compressedSize === MAX32 && fits()) {
          compressedSize = big(dir, q);
          q += 8;
        }
        if (offset === MAX32 && fits()) offset = big(dir, q);
      }
      e += 4 + len;
    }
    if (!name.endsWith('/')) out.push({ name, method, compressedSize, size, offset, encrypted: (flags & 1) === 1 });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** The bytes of one entry, as a Blob that reads them when asked. */
export async function zipRead(file: Blob, entry: ZipEntry): Promise<Blob> {
  if (entry.encrypted) throw new ZipError(`zip 里的「${entry.name}」加了密码，请先解压，再选解压出来的文件夹`);
  const head = await view(file, entry.offset, entry.offset + 30);
  if (head.byteLength < 30 || head.getUint32(0, true) !== LOCAL) throw new ZipError('zip 文件损坏了');
  // the local header's name and extra field may differ in length from the central directory's
  const start = entry.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  const raw = file.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
  throw new ZipError(`zip 里的「${entry.name}」用了不认识的压缩方式，请先解压，再选解压出来的文件夹`);
}
