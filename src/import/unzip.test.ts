import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vite-plus/test';
import { crc32 } from '../export/crc32';
import { ZipWriter } from '../export/zip';
import { zipEntries, ZipError, zipRead, type ZipEntry } from './unzip';

const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s);
const DATE = new Date(2026, 10, 16, 15, 30);

function random(n: number, seed = 1): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

const read = async (zip: Blob, e: ZipEntry) => new Uint8Array(await (await zipRead(zip, e)).arrayBuffer());

interface Raw {
  name: string | Uint8Array;
  /** the bytes as they are stored: compressed already when `method` is 8 */
  data: Uint8Array;
  method: number;
  /** of the bytes once inflated */
  size: number;
  flags?: number;
  /** a data descriptor follows the bytes, and the local header's CRC and sizes are 0 */
  descriptor?: boolean;
  localExtra?: Uint8Array;
  centralExtra?: Uint8Array;
}

/** An extra field: its id, its length, then `data`. */
function extra(id: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + data.length);
  const v = new DataView(out.buffer);
  v.setUint16(0, id, true);
  v.setUint16(2, data.length, true);
  out.set(data, 4);
  return out;
}

const u64 = (...values: number[]) => {
  const out = new Uint8Array(values.length * 8);
  const v = new DataView(out.buffer);
  values.forEach((n, i) => v.setBigUint64(i * 8, BigInt(n), true));
  return out;
};

/**
 * A ZIP put together by hand, as tools other than the export write them: deflate, data descriptors, extra fields that
 * differ between the local header and the central directory, a comment, ZIP64 records.
 */
function build(entries: Raw[], opts: { comment?: string; zip64?: boolean } = {}): Blob {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const push = (b: Uint8Array) => {
    parts.push(b);
    offset += b.length;
  };
  for (const e of entries) {
    const name = typeof e.name === 'string' ? bytes(e.name) : e.name;
    const crc = e.method === 0 ? crc32(e.data) : 0;
    const flags = (e.flags ?? 0) | (e.descriptor ? 8 : 0) | (typeof e.name === 'string' ? 0x800 : 0);
    const localExtra = opts.zip64 ? extra(1, u64(e.size, e.data.length)) : (e.localExtra ?? new Uint8Array());
    const head = new Uint8Array(30);
    const h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, opts.zip64 ? 45 : 20, true);
    h.setUint16(6, flags, true);
    h.setUint16(8, e.method, true);
    h.setUint32(14, e.descriptor ? 0 : crc, true);
    h.setUint32(18, opts.zip64 ? 0xffffffff : e.descriptor ? 0 : e.data.length, true);
    h.setUint32(22, opts.zip64 ? 0xffffffff : e.descriptor ? 0 : e.size, true);
    h.setUint16(26, name.length, true);
    h.setUint16(28, localExtra.length, true);
    const at = offset;
    push(head);
    push(name);
    push(localExtra);
    push(e.data);
    if (e.descriptor) {
      const d = new Uint8Array(16);
      const dv = new DataView(d.buffer);
      dv.setUint32(0, 0x08074b50, true);
      dv.setUint32(4, crc, true);
      dv.setUint32(8, e.data.length, true);
      dv.setUint32(12, e.size, true);
      push(d);
    }
    // ZIP64: the sizes and the offset in the extra field, in the order the format gives them
    const centralExtra = opts.zip64 ? extra(1, u64(e.size, e.data.length, at)) : (e.centralExtra ?? new Uint8Array());
    const c = new Uint8Array(46);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 0x031e, true);
    cv.setUint16(6, opts.zip64 ? 45 : 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, e.method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, opts.zip64 ? 0xffffffff : e.data.length, true);
    cv.setUint32(24, opts.zip64 ? 0xffffffff : e.size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, centralExtra.length, true);
    cv.setUint32(42, opts.zip64 ? 0xffffffff : at, true);
    central.push(c, name, centralExtra);
  }
  const dirStart = offset;
  for (const c of central) push(c);
  const dirSize = offset - dirStart;
  if (opts.zip64) {
    const end64 = new Uint8Array(56);
    const v = new DataView(end64.buffer);
    v.setUint32(0, 0x06064b50, true);
    v.setBigUint64(4, 44n, true);
    v.setUint16(12, 45, true);
    v.setUint16(14, 45, true);
    v.setBigUint64(24, BigInt(entries.length), true);
    v.setBigUint64(32, BigInt(entries.length), true);
    v.setBigUint64(40, BigInt(dirSize), true);
    v.setBigUint64(48, BigInt(dirStart), true);
    const end64At = offset;
    push(end64);
    const loc = new Uint8Array(20);
    const lv = new DataView(loc.buffer);
    lv.setUint32(0, 0x07064b50, true);
    lv.setBigUint64(8, BigInt(end64At), true);
    lv.setUint32(16, 1, true);
    push(loc);
  }
  const comment = bytes(opts.comment ?? '');
  const end = new Uint8Array(22 + comment.length);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, opts.zip64 ? 0xffff : entries.length, true);
  ev.setUint16(10, opts.zip64 ? 0xffff : entries.length, true);
  ev.setUint32(12, opts.zip64 ? 0xffffffff : dirSize, true);
  ev.setUint32(16, opts.zip64 ? 0xffffffff : dirStart, true);
  ev.setUint16(20, comment.length, true);
  end.set(comment, 22);
  push(end);
  return new Blob(parts as BlobPart[]);
}

const deflated = (name: string, data: Uint8Array, over: Partial<Raw> = {}): Raw => ({
  name,
  data: deflateRawSync(data),
  method: 8,
  size: data.length,
  ...over
});

describe('zipEntries and zipRead', () => {
  it("reads the export's own parts: stored entries under UTF-8 names, folders left out", async () => {
    const zip = new ZipWriter();
    const json = bytes('{"format":"living-export"}');
    const text = bytes('# 西湖边的一个下午\n\n今天去了西湖。');
    const photo = random(70_000, 5);
    zip.add('living-ada/', new Uint8Array(), 0, DATE);
    zip.add('living-ada/living.json', json, crc32(json), DATE);
    zip.add('living-ada/entries/2026/2026-11-16 西湖边的一个下午.md', text, crc32(text), DATE);
    zip.add('living-ada/media/2026/2026-11-16_ph_1.jpg', new Blob([photo]), crc32(photo), DATE);
    zip.add('living-ada/empty.txt', new Uint8Array(), 0, DATE);
    const blob = zip.finish();

    const entries = await zipEntries(blob);
    expect(entries.map((e) => e.name)).toEqual([
      'living-ada/living.json',
      'living-ada/entries/2026/2026-11-16 西湖边的一个下午.md',
      'living-ada/media/2026/2026-11-16_ph_1.jpg',
      'living-ada/empty.txt'
    ]);
    expect(entries.every((e) => e.method === 0 && !e.encrypted)).toBe(true);
    expect(entries.map((e) => e.size)).toEqual([json.length, text.length, photo.length, 0]);
    expect(await read(blob, entries[0])).toEqual(json);
    expect(await read(blob, entries[1])).toEqual(text);
    expect(await read(blob, entries[2])).toEqual(photo);
    expect((await read(blob, entries[3])).length).toBe(0);
  });

  it('inflates deflate entries, with a data descriptor or a local extra field of its own', async () => {
    const text = bytes('今天去了西湖。'.repeat(200));
    const photo = random(50_000, 9);
    const timestamp = extra(0x5455, new Uint8Array([3, 1, 2, 3, 4, 5, 6, 7, 8]));
    const blob = build([
      deflated('living-ada/entries/a.md', text, { descriptor: true }),
      deflated('living-ada/media/b.jpg', photo, { localExtra: timestamp, centralExtra: extra(0x5455, new Uint8Array([3, 1, 2, 3, 4])) }),
      { name: 'living-ada/c.txt', data: bytes('stored'), method: 0, size: 6 }
    ]);
    const entries = await zipEntries(blob);
    expect(entries.map((e) => [e.name, e.method, e.size])).toEqual([
      ['living-ada/entries/a.md', 8, text.length],
      ['living-ada/media/b.jpg', 8, photo.length],
      ['living-ada/c.txt', 0, 6]
    ]);
    expect(entries[0].compressedSize).toBeLessThan(text.length);
    expect(await read(blob, entries[0])).toEqual(text);
    expect(await read(blob, entries[1])).toEqual(photo);
    expect(new TextDecoder().decode(await read(blob, entries[2]))).toBe('stored');
  });

  it('finds the end record before a comment', async () => {
    const blob = build([{ name: 'living.json', data: bytes('{}'), method: 0, size: 2 }], { comment: '由压缩工具写下的注释 '.repeat(100) });
    const entries = await zipEntries(blob);
    expect(entries.map((e) => e.name)).toEqual(['living.json']);
    expect(new TextDecoder().decode(await read(blob, entries[0]))).toBe('{}');
  });

  it('reads ZIP64: the end record through its locator, sizes and offsets from the extra field', async () => {
    const a = random(3000, 2);
    const b = bytes('第二个文件');
    const blob = build([deflated('living-ada/media/a.jpg', a), { name: 'living-ada/b.txt', data: b, method: 0, size: b.length }], {
      zip64: true
    });
    const entries = await zipEntries(blob);
    expect(entries.map((e) => [e.name, e.size])).toEqual([
      ['living-ada/media/a.jpg', a.length],
      ['living-ada/b.txt', b.length]
    ]);
    expect(entries[1].offset).toBeGreaterThan(0);
    expect(await read(blob, entries[0])).toEqual(a);
    expect(await read(blob, entries[1])).toEqual(b);
  });

  it('takes a name that is not UTF-8 byte by byte', async () => {
    // 西湖 in GBK, as an old Windows zip tool writes it, without the UTF-8 flag
    const name = new Uint8Array([0xce, 0xf7, 0xba, 0xfe, 0x2e, 0x6a, 0x70, 0x67]);
    const blob = build([{ name, data: bytes('x'), method: 0, size: 1 }]);
    const [entry] = await zipEntries(blob);
    expect(entry.name).toBe('Î÷ºþ.jpg');
    expect(new TextDecoder().decode(await read(blob, entry))).toBe('x');
  });

  it('says what is wrong with a file that is not a whole ZIP', async () => {
    await expect(zipEntries(new Blob([bytes('hello')]))).rejects.toThrow(ZipError);
    await expect(zipEntries(new Blob([random(100_000, 4)]))).rejects.toThrow('不是 zip 文件，或者文件不完整');

    const zip = new ZipWriter();
    const photo = random(10_000, 6);
    zip.add('living-ada/media/a.jpg', photo, crc32(photo), DATE);
    const whole = zip.finish();
    // the end cut off, as a download that did not finish
    await expect(zipEntries(whole.slice(0, whole.size - 10))).rejects.toThrow('不是 zip 文件，或者文件不完整');
    // the beginning missing, as the second part of a split archive: the directory says it starts past the end
    await expect(zipEntries(whole.slice(5000))).rejects.toThrow('zip 文件不完整：可能还没下载完，或者是分卷压缩的一部分');

    // a directory whose records are not where the end record says
    const broken = new Uint8Array(await whole.arrayBuffer());
    const dirAt = new DataView(broken.buffer).getUint32(broken.length - 6, true);
    broken[dirAt] = 0;
    await expect(zipEntries(new Blob([broken]))).rejects.toThrow('zip 文件的目录损坏了');
  });

  it('will not read an entry that is encrypted, compressed some other way, or whose local header is gone', async () => {
    const blob = build([
      { name: 'living-ada/secret.jpg', data: random(100), method: 0, size: 100, flags: 1 },
      { name: 'living-ada/b.jpg', data: random(100), method: 12, size: 300 }
    ]);
    const [secret, bzip] = await zipEntries(blob);
    expect(secret.encrypted).toBe(true);
    expect(bzip.encrypted).toBe(false);
    await expect(zipRead(blob, secret)).rejects.toThrow(ZipError);
    await expect(zipRead(blob, secret)).rejects.toThrow('「living-ada/secret.jpg」加了密码');
    await expect(zipRead(blob, bzip)).rejects.toThrow('「living-ada/b.jpg」用了不认识的压缩方式');
    await expect(zipRead(blob, { ...bzip, method: 0, offset: bzip.offset + 1 })).rejects.toThrow('zip 文件损坏了');
  });
});
