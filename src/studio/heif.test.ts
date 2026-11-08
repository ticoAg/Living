import { describe, expect, test } from 'vite-plus/test';
import { ftypBrands, heifColorSpace, isComplete, isHeif, isP3Profile } from './heif';

type Bytes = Uint8Array<ArrayBuffer>;

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const filled = (length: number, value: number) => Array.from({ length }, () => value);

/** An ISO base media box: 32-bit size, four-character type, payload. */
function box(type: string, payload: number[] = []): Bytes {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(ascii(type), 4);
  out.set(payload, 8);
  return out;
}
const join = (...parts: Bytes[]): Bytes => Uint8Array.from(parts.flatMap((p) => [...p]));

/** What an iPhone writes first: major brand heic, compatible brands mif1 MiHE miaf heic. */
const IPHONE_FTYP = box('ftyp', [...ascii('heic'), 0, 0, 0, 0, ...ascii('mif1'), ...ascii('MiHE'), ...ascii('miaf'), ...ascii('heic')]);
const AVIF_FTYP = box('ftyp', [...ascii('avif'), 0, 0, 0, 0, ...ascii('avif'), ...ascii('mif1'), ...ascii('miaf')]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);

describe('ftypBrands', () => {
  test('lists the major brand, then the compatible ones', () => {
    expect(ftypBrands(IPHONE_FTYP)).toEqual(['heic', 'mif1', 'MiHE', 'miaf', 'heic']);
  });

  test('is empty for anything that does not start with a ftyp box', () => {
    expect(ftypBrands(JPEG)).toEqual([]);
    expect(ftypBrands(new Uint8Array(0))).toEqual([]);
    expect(ftypBrands(box('moov', ascii('heic')))).toEqual([]);
  });

  test('does not read past the box into the bytes that follow', () => {
    expect(ftypBrands(join(box('ftyp', [...ascii('mif1'), 0, 0, 0, 0, ...ascii('heic')]), box('meta', ascii('avif'))))).toEqual([
      'mif1',
      'heic'
    ]);
  });
});

describe('isHeif', () => {
  test('goes by MIME type or extension first, whatever the case', async () => {
    expect(await isHeif(new File([JPEG], 'IMG_0001.HEIC'))).toBe(true);
    expect(await isHeif(new File([JPEG], 'photo.heif'))).toBe(true);
    expect(await isHeif(new File([JPEG], 'noext', { type: 'image/heic' }))).toBe(true);
    expect(await isHeif(new File([JPEG], 'noext', { type: 'image/heif-sequence' }))).toBe(true);
  });

  test('recognises a HEIC that has the wrong name by its brands', async () => {
    expect(await isHeif(new File([IPHONE_FTYP], 'IMG_0001.jpg', { type: 'image/jpeg' }))).toBe(true);
    expect(await isHeif(new File([box('ftyp', [...ascii('mif1'), 0, 0, 0, 0, ...ascii('mif1')])], 'x.bin'))).toBe(true);
  });

  test('a JPEG is not HEIF', async () => {
    expect(await isHeif(new File([JPEG], 'a.jpg', { type: 'image/jpeg' }))).toBe(false);
  });

  test('AVIF shares the mif1 brand but is not HEIC', async () => {
    expect(await isHeif(new File([AVIF_FTYP], 'a.avif', { type: 'image/avif' }))).toBe(false);
  });
});

describe('isComplete', () => {
  const photo = join(IPHONE_FTYP, box('meta', filled(100, 1)), box('mdat', filled(1000, 2)));

  test('accepts a file whose boxes end exactly where the file does', async () => {
    expect(await isComplete(new Blob([photo]))).toBe(true);
  });

  test('rejects a file cut anywhere inside a box', async () => {
    for (const keep of [0.05, 0.5, 0.9, 0.99]) {
      expect(await isComplete(new Blob([photo.slice(0, Math.floor(photo.length * keep))]))).toBe(false);
    }
    expect(await isComplete(new Blob([photo.slice(0, photo.length - 1)]))).toBe(false);
  });

  test('accepts a last box that runs to the end of the file (size 0) and 64-bit sizes', async () => {
    const open = box('mdat', filled(50, 3));
    new DataView(open.buffer).setUint32(0, 0);
    expect(await isComplete(new Blob([IPHONE_FTYP, open]))).toBe(true);

    const wide = new Uint8Array(16 + 20);
    const view = new DataView(wide.buffer);
    view.setUint32(0, 1);
    wide.set(ascii('mdat'), 4);
    view.setBigUint64(8, BigInt(wide.length));
    expect(await isComplete(new Blob([IPHONE_FTYP, wide]))).toBe(true);
    view.setBigUint64(8, BigInt(wide.length + 1));
    expect(await isComplete(new Blob([IPHONE_FTYP, wide]))).toBe(false);
  });

  test('rejects data that is not a sequence of boxes, and files too small to hold one', async () => {
    expect(await isComplete(new Blob([new Uint8Array(40).fill(0xff)]))).toBe(false); // first box claims 4 GB
    expect(await isComplete(new Blob([Uint8Array.from([0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0])]))).toBe(false); // smaller than its own header
    expect(await isComplete(new Blob([new Uint8Array(0)]))).toBe(false);
    expect(await isComplete(new Blob([new Uint8Array(5)]))).toBe(false);
  });
});

type Colorants = Record<'rXYZ' | 'gXYZ' | 'bXYZ', [number, number, number]>;
const P3: Colorants = { rXYZ: [0.5151, 0.2412, -0.0011], gXYZ: [0.292, 0.6922, 0.0419], bXYZ: [0.1571, 0.0666, 0.7841] };
const SRGB: Colorants = { rXYZ: [0.436, 0.2225, 0.0139], gXYZ: [0.3851, 0.7169, 0.0971], bXYZ: [0.1431, 0.0606, 0.7141] };
const ADOBE_RGB: Colorants = { rXYZ: [0.6097, 0.3111, 0.0195], gXYZ: [0.2053, 0.6257, 0.0609], bXYZ: [0.1492, 0.0632, 0.7446] };

/** A minimal ICC profile: the 128-byte header (colour space at 16), a tag table, and one XYZ tag per colorant. */
function icc(colorants: Colorants, space = 'RGB '): Bytes {
  const names = Object.keys(colorants) as (keyof Colorants)[];
  const table = 132 + names.length * 12;
  const out = new Uint8Array(table + names.length * 20);
  const view = new DataView(out.buffer);
  out.set(ascii(space), 16);
  view.setUint32(128, names.length);
  names.forEach((name, i) => {
    const at = 132 + i * 12;
    const data = table + i * 20;
    out.set(ascii(name), at);
    view.setUint32(at + 4, data);
    view.setUint32(at + 8, 20);
    out.set(ascii('XYZ '), data);
    colorants[name].forEach((v, k) => view.setInt32(data + 8 + k * 4, Math.round(v * 65536)));
  });
  return out;
}

/** The colr property: `prof` followed by an ICC profile, or `nclx` followed by colour primaries, transfer and matrix. */
const colrProf = (profile: Bytes) => box('colr', [...ascii('prof'), ...profile]);
const colrNclx = (primaries: number) => box('colr', [...ascii('nclx'), primaries >> 8, primaries & 255, 0, 13, 0, 5, 0x80]);

/** What a HEIC looks like to the colour check: ftyp, a meta box (version/flags, then iprp > ipco > the properties), and image data. */
function heicWith(...properties: Bytes[]): Bytes {
  const ipco = box('ipco', [...join(...properties)]);
  const meta = box('meta', [0, 0, 0, 0, ...box('hdlr', filled(20, 0)), ...box('iprp', [...ipco])]);
  return join(IPHONE_FTYP, meta, box('mdat', filled(64, 7)));
}

describe('isP3Profile', () => {
  test('recognises Display P3 primaries, whatever the profile is called', () => {
    expect(isP3Profile(icc(P3))).toBe(true);
  });

  test('is not fooled by sRGB, or by a wider space such as Adobe RGB', () => {
    expect(isP3Profile(icc(SRGB))).toBe(false);
    expect(isP3Profile(icc(ADOBE_RGB))).toBe(false);
  });

  test('needs an RGB profile with all three colorants, and enough bytes', () => {
    expect(isP3Profile(icc(P3, 'GRAY'))).toBe(false);
    const { rXYZ, gXYZ } = P3;
    expect(isP3Profile(icc({ rXYZ, gXYZ } as Colorants))).toBe(false);
    expect(isP3Profile(icc(P3).slice(0, 140))).toBe(false);
    expect(isP3Profile(new Uint8Array(0))).toBe(false);
  });
});

describe('heifColorSpace', () => {
  test('an iPhone photo (Display P3 ICC profile) is display-p3', async () => {
    expect(await heifColorSpace(new Blob([heicWith(colrProf(icc(P3)))]))).toBe('display-p3');
  });

  test('colour primaries 12 in an nclx property mean Display P3; 1 (BT.709, as sRGB) does not', async () => {
    expect(await heifColorSpace(new Blob([heicWith(colrNclx(12))]))).toBe('display-p3');
    expect(await heifColorSpace(new Blob([heicWith(colrNclx(1))]))).toBe('srgb');
  });

  test('an sRGB profile, or none at all (most Android phones), is srgb', async () => {
    expect(await heifColorSpace(new Blob([heicWith(colrProf(icc(SRGB)))]))).toBe('srgb');
    expect(await heifColorSpace(new Blob([heicWith(box('ispe', filled(12, 0)))]))).toBe('srgb');
  });

  test('looks at every property, not only the first', async () => {
    expect(await heifColorSpace(new Blob([heicWith(box('ispe', filled(12, 0)), colrNclx(1), colrProf(icc(P3)))]))).toBe('display-p3');
  });

  test('anything it cannot read is srgb: no meta box, damage, or not a HEIF at all', async () => {
    expect(await heifColorSpace(new Blob([join(IPHONE_FTYP, box('mdat', filled(64, 7)))]))).toBe('srgb');
    const whole = heicWith(colrProf(icc(P3)));
    expect(await heifColorSpace(new Blob([whole.slice(0, 120)]))).toBe('srgb');
    expect(await heifColorSpace(new Blob([JPEG]))).toBe('srgb');
    expect(await heifColorSpace(new Blob([]))).toBe('srgb');
  });
});
