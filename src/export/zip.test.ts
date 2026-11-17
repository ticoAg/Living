import { crc32 as nodeCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vite-plus/test';
import { crc32, crc32Blob } from './crc32';
import { dosTime, ZipWriter } from './zip';

const bytes = (s: string) => new TextEncoder().encode(s);

function random(n: number, seed = 1): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

describe('crc32', () => {
  it('gives the check value of the standard', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('agrees with zlib for every length around the eight-byte steps, and continues across pieces', () => {
    const data = random(4099, 7);
    for (const n of [1, 7, 8, 9, 15, 16, 17, 63, 64, 65, 1000, 4099]) {
      expect(crc32(data.subarray(0, n))).toBe(nodeCrc32(data.subarray(0, n)));
    }
    expect(crc32(data.subarray(1000), crc32(data.subarray(0, 1000)))).toBe(nodeCrc32(data));
  });

  it('reads a Blob in pieces to the same value', async () => {
    const data = random(9 * 1024 * 1024 + 3, 3);
    expect(await crc32Blob(new Blob([data]))).toBe(nodeCrc32(data));
  });
});

describe('dosTime', () => {
  it('packs the local date and time, seconds in steps of two, years from 1980', () => {
    expect(dosTime(new Date(2026, 10, 17, 13, 45, 59))).toEqual({
      date: ((2026 - 1980) << 9) | (11 << 5) | 17,
      time: (13 << 11) | (45 << 5) | 29
    });
    expect(dosTime(new Date(1970, 0, 1)).date >> 9).toBe(0);
  });
});

interface Read {
  name: string;
  data: Uint8Array;
  crc: number;
  flags: number;
  mode: number;
}

/** A small ZIP reader: the end record, the central directory, and each local header it points to. */
async function readZip(blob: Blob): Promise<Read[]> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const v = new DataView(buf.buffer);
  const end = buf.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  const dirSize = v.getUint32(end + 12, true);
  let at = v.getUint32(end + 16, true);
  expect(at + dirSize).toBe(end);
  const out: Read[] = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const flags = v.getUint16(at + 8, true);
    const crc = v.getUint32(at + 16, true);
    const size = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const mode = v.getUint32(at + 38, true) >>> 16;
    const offset = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nameLen));
    // the local header says the same
    expect(v.getUint32(offset, true)).toBe(0x04034b50);
    expect(v.getUint16(offset + 8, true)).toBe(0);
    expect(v.getUint32(offset + 14, true)).toBe(crc);
    expect(v.getUint32(offset + 18, true)).toBe(size);
    const localName = v.getUint16(offset + 26, true);
    const start = offset + 30 + localName + v.getUint16(offset + 28, true);
    out.push({ name, data: buf.slice(start, start + size), crc, flags, mode });
    at += 46 + nameLen;
  }
  return out;
}

describe('ZipWriter', () => {
  it('writes an archive any reader can walk: names, bytes and CRCs as given', async () => {
    const zip = new ZipWriter();
    const text = bytes('# 西湖边的一个下午\n\n今天去了西湖。');
    const photo = random(70_000, 5);
    zip.add('living-alice/entries/2026/2026-11-16 西湖边的一个下午.md', text, crc32(text), new Date(2026, 10, 16, 15, 30));
    zip.add('living-alice/media/2026/2026-11-16_ph_1.jpg', new Blob([photo]), crc32(photo), new Date(2026, 10, 16));
    zip.add('living-alice/empty.txt', new Uint8Array(), 0, new Date());
    expect(zip.count).toBe(3);
    const finishedSize = zip.finishedSize;
    const blob = zip.finish();
    expect(blob.size).toBe(finishedSize);
    expect(blob.type).toBe('application/zip');
    expect(blob.size).toBe(
      zip.size +
        [
          'living-alice/entries/2026/2026-11-16 西湖边的一个下午.md',
          'living-alice/media/2026/2026-11-16_ph_1.jpg',
          'living-alice/empty.txt'
        ].reduce((n, name) => n + 46 + bytes(name).length, 0) +
        22
    );

    const read = await readZip(blob);
    expect(read.map((r) => r.name)).toEqual([
      'living-alice/entries/2026/2026-11-16 西湖边的一个下午.md',
      'living-alice/media/2026/2026-11-16_ph_1.jpg',
      'living-alice/empty.txt'
    ]);
    expect(read[0].data).toEqual(text);
    expect(read[1].data).toEqual(photo);
    for (const r of read) {
      expect(r.crc).toBe(nodeCrc32(r.data));
      // UTF-8 names, ordinary file permissions
      expect(r.flags & 0x0800).toBe(0x0800);
      expect(r.mode).toBe(0o100644);
    }
  });

  it('counts what an entry will add, so that parts can be cut before they grow too large', () => {
    const zip = new ZipWriter();
    const name = 'a/文.txt';
    zip.add(name, bytes('xyz'), crc32(bytes('xyz')), new Date());
    expect(ZipWriter.cost(name, 3)).toBe(zip.size + 46 + bytes(name).length);
  });

  it('keeps its own copy of the bytes it was given', async () => {
    const zip = new ZipWriter();
    const data = bytes('abc');
    zip.add('a.txt', data, crc32(data), new Date());
    data[0] = 0x7a;
    const [r] = await readZip(zip.finish());
    expect(new TextDecoder().decode(r.data)).toBe('abc');
  });
});
