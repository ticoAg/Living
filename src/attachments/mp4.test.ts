import { describe, expect, it } from 'vite-plus/test';
import { blobSource, locationPatches, patched, withoutLocation } from './mp4';

// Files built box by box, as phones write them: an Android video's `©xyz`, an iPhone video's QuickTime `meta` with
// its location keys, a 3GPP `loci`, and an iTunes-style `meta` in the user data.

const enc = new TextEncoder();
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const u32 = (n: number) => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
/** A box of `type` (4 characters, © as one byte) holding `parts`. */
const box = (type: string, ...parts: Uint8Array[]) => {
  const body = cat(...parts);
  return cat(
    u32(8 + body.length),
    Uint8Array.from(type, (c) => c.charCodeAt(0)),
    body
  );
};
/** The same with a 64-bit size. */
const bigBox = (type: string, ...parts: Uint8Array[]) => {
  const body = cat(...parts);
  return cat(
    u32(1),
    Uint8Array.from(type, (c) => c.charCodeAt(0)),
    u32(0),
    u32(16 + body.length),
    body
  );
};
const text = (s: string) => enc.encode(s);
const full = (...parts: Uint8Array[]) => cat(u32(0), ...parts);
/** QuickTime user-data text: length, language, the text. */
const udtaText = (s: string) => cat(new Uint8Array([0, text(s).length, 0x15, 0xc7]), text(s));
/** An `ilst` item's value: its type indicator and locale, then the bytes. */
const data = (s: string) => box('data', u32(1), u32(0), text(s));

const WHERE = '+30.2593+120.1517+012.000/';
const ftyp = box('ftyp', text('qt  '), u32(0), text('qt  '));
const mvhd = box('mvhd', full(new Uint8Array(96)));
const mdat = box('mdat', text('frames of the video, untouched'));
const trak = (...more: Uint8Array[]) =>
  box('trak', box('tkhd', full(new Uint8Array(80))), box('mdia', box('mdhd', full(new Uint8Array(20)))), ...more);
const keys = (...names: string[]) =>
  box('keys', full(u32(names.length), ...names.map((n) => cat(u32(8 + n.length), text('mdta'), text(n)))));

const source = (bytes: Uint8Array) => blobSource(new Blob([bytes as Uint8Array<ArrayBuffer>]));
const strip = async (bytes: Uint8Array) =>
  new Uint8Array(await (await withoutLocation(new Blob([bytes as Uint8Array<ArrayBuffer>]))).blob.arrayBuffer());
/** Whether `bytes` hold `s` in UTF-8 anywhere. */
function has(bytes: Uint8Array, s: string): boolean {
  const want = enc.encode(s);
  outer: for (let i = 0; i + want.length <= bytes.length; i++) {
    for (let j = 0; j < want.length; j++) if (bytes[i + j] !== want[j]) continue outer;
    return true;
  }
  return false;
}
/** The bytes that differ between two files of one length, as [offset, length] runs. */
function changed(a: Uint8Array, b: Uint8Array): [number, number][] {
  expect(b.length).toBe(a.length);
  const runs: [number, number][] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    const last = runs.at(-1);
    if (last && last[0] + last[1] === i) last[1]++;
    else runs.push([i, 1]);
  }
  return runs;
}

describe('withoutLocation', () => {
  it('blanks an Android video’s ©xyz, keeping its length, and leaves everything else as it was', async () => {
    const xyz = box('©xyz', udtaText(WHERE));
    const file = cat(ftyp, box('moov', mvhd, trak(), box('udta', box('©nam', udtaText('西湖')), xyz)), mdat);
    expect(has(file, WHERE)).toBe(true);
    const out = await strip(file);
    expect(has(out, WHERE)).toBe(false);
    expect(has(out, '西湖')).toBe(true);
    expect(has(out, 'frames of the video, untouched')).toBe(true);
    const at = file.indexOf(0xa9, file.length - mdat.length - xyz.length - 1);
    // the box is free now, its content zero; nothing else moved
    expect(new TextDecoder().decode(out.subarray(at, at + 4))).toBe('free');
    expect([...out.subarray(at + 4, at + xyz.length - 4)].every((b) => b === 0)).toBe(true);
    expect(changed(file, out).every(([o, n]) => o >= at && o + n <= at - 4 + xyz.length)).toBe(true);
  });

  it('zeroes the location items of an iPhone video’s QuickTime meta, and only those', async () => {
    const meta = box(
      'meta',
      box('hdlr', full(text('mdta'), new Uint8Array(12))),
      keys('com.apple.quicktime.make', 'com.apple.quicktime.location.ISO6709', 'com.apple.quicktime.location.accuracy.horizontal'),
      box(
        'ilst',
        box('\u0000\u0000\u0000\u0001', data('Apple')),
        box('\u0000\u0000\u0000\u0002', data(WHERE)),
        box('\u0000\u0000\u0000\u0003', data('4.7'))
      )
    );
    const file = cat(ftyp, mdat, box('moov', mvhd, trak(), meta));
    const out = await strip(file);
    expect(has(out, WHERE)).toBe(false);
    expect(has(out, '4.7')).toBe(false);
    expect(has(out, 'Apple')).toBe(true);
    expect(has(out, 'com.apple.quicktime.location.ISO6709')).toBe(true);
    // the values only: every box of the item is still there, so the metadata still reads
    expect(changed(file, out).map(([, n]) => n)).toEqual([WHERE.length, 3]);
  });

  it('finds them in a track, a 3GPP loci, an iTunes-style meta in the user data, and past a 64-bit box', async () => {
    const loci = box('loci', full(new Uint8Array([0x15, 0xc7]), text('西湖\u0000'), new Uint8Array([0]), u32(0x1e3e000), u32(0x78267000)));
    const itunes = box(
      'meta',
      full(box('hdlr', full(new Uint8Array(4), text('mdir'), new Uint8Array(12))), box('ilst', box('©xyz', data(WHERE))))
    );
    const file = cat(ftyp, bigBox('mdat', text('a long video')), box('moov', mvhd, trak(box('udta', loci)), box('udta', itunes)));
    expect(has(file, '西湖')).toBe(true);
    // the loci box made free and zeroed, and the iTunes item's value zeroed
    expect((await locationPatches(source(file))).length).toBe(3);
    const out = await strip(file);
    expect(has(out, WHERE)).toBe(false);
    expect(has(out, '西湖')).toBe(false);
    expect(has(out, 'a long video')).toBe(true);
  });

  it('leaves a file without a location, and any file that is not MP4, as it is', async () => {
    const plain = cat(ftyp, box('moov', mvhd, trak(), box('udta', box('©nam', udtaText('西湖')))), mdat);
    const webm = cat(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), text(`webm ${WHERE}`));
    const short = new Uint8Array([0, 0, 0]);
    for (const file of [plain, webm, short, new Uint8Array()]) {
      const blob = new Blob([file as Uint8Array<ArrayBuffer>]);
      const out = await withoutLocation(blob);
      expect(out.located).toBe(false);
      expect(out.blob).toBe(blob);
    }
  });

  it('stops at a box that runs past its parent, keeping what it found before', async () => {
    const xyz = box('©xyz', udtaText(WHERE));
    const broken = cat(u32(1000), text('udta'));
    const file = cat(ftyp, box('moov', box('udta', xyz), broken), mdat);
    const out = await strip(file);
    expect(has(out, WHERE)).toBe(false);
    expect(out.length).toBe(file.length);
  });
});

describe('patched', () => {
  it('writes the patches over the file, which keeps its type and length', async () => {
    const file = new Blob([text('0123456789')], { type: 'video/mp4' });
    const out = patched(file, [
      { offset: 1, bytes: text('ab') },
      { offset: 7, bytes: text('x') }
    ]);
    expect(out.type).toBe('video/mp4');
    expect(await out.text()).toBe('0ab3456x89');
    expect(patched(file, [])).toBe(file);
  });
});
