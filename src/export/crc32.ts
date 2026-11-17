// CRC-32 (the ZIP and gzip one, polynomial 0xEDB88320), eight bytes at a time. A ZIP entry carries the CRC of its
// bytes; the export computes it in the browser for every file it stores. Docs: /docs/product/features/export.md

const TABLES = (() => {
  const t = new Uint32Array(256 * 8);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  for (let n = 0; n < 256; n++) {
    let c = t[n];
    for (let k = 1; k < 8; k++) {
      c = t[c & 0xff] ^ (c >>> 8);
      t[k * 256 + n] = c;
    }
  }
  return t;
})();

/** The CRC of `data`, continuing from `crc` (the CRC of the bytes before it; 0 to start). */
export function crc32(data: Uint8Array, crc = 0): number {
  const t = TABLES;
  let c = (crc ^ 0xffffffff) >>> 0;
  let i = 0;
  const n = data.length;
  for (; n - i >= 8; i += 8) {
    const lo = (c ^ (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24))) >>> 0;
    const hi = data[i + 4] | (data[i + 5] << 8) | (data[i + 6] << 16) | (data[i + 7] << 24);
    c =
      t[1792 + (lo & 0xff)] ^
      t[1536 + ((lo >>> 8) & 0xff)] ^
      t[1280 + ((lo >>> 16) & 0xff)] ^
      t[1024 + (lo >>> 24)] ^
      t[768 + (hi & 0xff)] ^
      t[512 + ((hi >>> 8) & 0xff)] ^
      t[256 + ((hi >>> 16) & 0xff)] ^
      t[hi >>> 24];
  }
  for (; i < n; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Bytes read at a time from a Blob: big enough to be quick, small enough to keep the page responsive. */
const CHUNK = 4 * 1024 * 1024;

/** The CRC of a Blob, read a piece at a time, yielding to the page between pieces. */
export async function crc32Blob(blob: Blob): Promise<number> {
  let crc = 0;
  for (let at = 0; at < blob.size; at += CHUNK) {
    crc = crc32(new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer()), crc);
  }
  return crc;
}
