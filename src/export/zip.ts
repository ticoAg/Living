// A ZIP archive written in the browser: stored entries (photos are compressed already, text is small), UTF-8 names,
// sizes and CRCs in the local headers, no data descriptors and no ZIP64. A part is kept well under 4 GiB and 65,535
// entries, which every unzip tool reads. Docs: /docs/product/features/export.md

/** The largest file a part takes, and the most entries: ZIP's 32-bit sizes and 16-bit counts, with room to spare. */
export const ZIP_MAX_BYTES = 0xffff_0000;
export const ZIP_MAX_ENTRIES = 0xfff0;

const UTF8_NAMES = 0x0800;
const VERSION = 20;
/** made by Unix, so that the entries carry ordinary file permissions (rw-r--r--) */
const MADE_BY = (3 << 8) | VERSION;
const FILE_MODE = 0o100644;

const encoder = new TextEncoder();

/** MS-DOS date and time of a local wall-clock time, as ZIP stores it (2-second steps, 1980–2107). */
export function dosTime(d: Date): { date: number; time: number } {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  };
}

interface Written {
  name: Uint8Array<ArrayBuffer>;
  crc: number;
  size: number;
  offset: number;
  date: number;
  time: number;
}

/** One archive: add entries in order, then `finish()` for the Blob. */
export class ZipWriter {
  #parts: BlobPart[] = [];
  #entries: Written[] = [];
  #offset = 0;
  #dir = 0;

  /** bytes written so far, headers included */
  get size(): number {
    return this.#offset;
  }

  /** the archive's size, were it finished now: the entries, the central directory and the end record */
  get finishedSize(): number {
    return this.#offset + this.#dir + 22;
  }

  get count(): number {
    return this.#entries.length;
  }

  /** The bytes this entry adds to the archive, central directory included. */
  static cost(name: string, size: number): number {
    const n = encoder.encode(name).length;
    return 30 + n + size + 46 + n;
  }

  /** Stores `data` under `name` (a relative path with `/`), whose CRC-32 is `crc`. */
  add(name: string, data: Blob | Uint8Array, crc: number, mtime: Date): void {
    const size = data instanceof Blob ? data.size : data.length;
    if (size > ZIP_MAX_BYTES) throw new Error(`${name}: too large for a ZIP without ZIP64`);
    if (this.#entries.length >= ZIP_MAX_ENTRIES) throw new Error('too many entries for a ZIP without ZIP64');
    const nameBytes = encoder.encode(name);
    const { date, time } = dosTime(mtime);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, VERSION, true);
    head.setUint16(6, UTF8_NAMES, true);
    head.setUint16(8, 0, true); // stored
    head.setUint16(10, time, true);
    head.setUint16(12, date, true);
    head.setUint32(14, crc >>> 0, true);
    head.setUint32(18, size, true);
    head.setUint32(22, size, true);
    head.setUint16(26, nameBytes.length, true);
    head.setUint16(28, 0, true);
    this.#entries.push({ name: nameBytes, crc: crc >>> 0, size, offset: this.#offset, date, time });
    this.#dir += 46 + nameBytes.length;
    this.#parts.push(head.buffer, nameBytes, data instanceof Blob ? data : new Uint8Array(data));
    this.#offset += 30 + nameBytes.length + size;
  }

  /** The archive: the entries, then the central directory and its end record. */
  finish(): Blob {
    const start = this.#offset;
    let dirSize = 0;
    for (const e of this.#entries) {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true);
      h.setUint16(4, MADE_BY, true);
      h.setUint16(6, VERSION, true);
      h.setUint16(8, UTF8_NAMES, true);
      h.setUint16(10, 0, true);
      h.setUint16(12, e.time, true);
      h.setUint16(14, e.date, true);
      h.setUint32(16, e.crc, true);
      h.setUint32(20, e.size, true);
      h.setUint32(24, e.size, true);
      h.setUint16(28, e.name.length, true);
      h.setUint16(30, 0, true); // extra
      h.setUint16(32, 0, true); // comment
      h.setUint16(34, 0, true); // disk
      h.setUint16(36, 0, true); // internal attributes
      h.setUint32(38, (FILE_MODE << 16) >>> 0, true);
      h.setUint32(42, e.offset, true);
      this.#parts.push(h.buffer, e.name);
      dirSize += 46 + e.name.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.#entries.length, true);
    end.setUint16(10, this.#entries.length, true);
    end.setUint32(12, dirSize, true);
    end.setUint32(16, start, true);
    this.#parts.push(end.buffer);
    return new Blob(this.#parts, { type: 'application/zip' });
  }
}
