import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { ID_RE } from './http';
import { inviteCode, newId, ulid } from './ids';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_BODY = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Milliseconds encoded in the first ten characters. */
function decodeTime(id: string): number {
  let t = 0;
  for (const ch of id.slice(0, 10)) t = t * 32 + CROCKFORD.indexOf(ch);
  return t;
}

const filled = (length: number, value: number) => Array.from({ length }, () => value);

/** Independent encoder: 48-bit time and the ten random bytes as BigInts, written out five bits at a time. */
function encodeUlid(time: number, random: number[]): string {
  let t = BigInt(time);
  let head = '';
  for (let i = 0; i < 10; i++) {
    head = CROCKFORD[Number(t % 32n)] + head;
    t /= 32n;
  }
  let r = 0n;
  for (const b of random) r = (r << 8n) | BigInt(b);
  let tail = '';
  for (let i = 0; i < 16; i++) {
    tail = CROCKFORD[Number(r % 32n)] + tail;
    r /= 32n;
  }
  return head + tail;
}

/** Replaces `crypto.getRandomValues` with a scripted source: each call takes the next buffer from `fills` (zeros once empty). */
function scriptRandom(...fills: number[][]) {
  const queue = [...fills];
  const calls = { count: 0 };
  vi.stubGlobal('crypto', {
    getRandomValues: (array: Uint8Array) => {
      calls.count++;
      array.set(queue.shift() ?? []);
      return array;
    }
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ulid', () => {
  it('is 26 Crockford base32 characters', () => {
    for (const now of [0, 1, 1_700_000_000_000, 2 ** 48 - 1]) expect(ulid(now)).toMatch(ULID_BODY);
    expect(ulid()).toMatch(ULID_BODY);
  });

  it('encodes the millisecond time in the first ten characters', () => {
    expect(ulid(0).slice(0, 10)).toBe('0000000000');
    expect(ulid(31).slice(0, 10)).toBe('000000000Z');
    expect(ulid(32).slice(0, 10)).toBe('0000000010');
    // the example timestamp from the ULID specification
    expect(ulid(1_469_918_176_385).slice(0, 10)).toBe('01ARYZ6S41');
    // the largest 48-bit time
    expect(ulid(2 ** 48 - 1).slice(0, 10)).toBe('7ZZZZZZZZZ');
    for (const now of [1, 999, 1_700_000_000_123]) expect(decodeTime(ulid(now))).toBe(now);
  });

  it('uses the current time by default', () => {
    expect(Math.abs(decodeTime(ulid()) - Date.now())).toBeLessThan(5000);
  });

  it('sorts by time as a plain string', () => {
    const times = [0, 1, 31, 32, 1023, 1024, 1_000_000_000, 1_700_000_000_000, 1_700_000_000_001, 2 ** 48 - 1];
    const ids = times.map((t) => ulid(t));
    expect([...ids].sort()).toEqual(ids);
  });

  it('packs the ten random bytes into the last sixteen characters', () => {
    const patterns = [
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [255, 255, 255, 255, 255, 255, 255, 255, 255, 255],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [0xde, 0xad, 0xbe, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab]
    ];
    patterns.forEach((bytes, i) => {
      const now = 1_700_000_000_000 + i;
      scriptRandom(bytes);
      expect(ulid(now)).toBe(encodeUlid(now, bytes));
    });
    scriptRandom([255, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
    expect(ulid(1_700_000_000_100).slice(10)).toBe('ZZZZZZZZZZZZZZZZ');
  });

  it('increments the random part when called again within the same millisecond', () => {
    const now = 1_700_000_001_000;
    const calls = scriptRandom([0, 0, 0, 0, 0, 0, 0, 0, 0, 254]);
    expect(ulid(now)).toBe(encodeUlid(now, [0, 0, 0, 0, 0, 0, 0, 0, 0, 254]));
    expect(ulid(now)).toBe(encodeUlid(now, [0, 0, 0, 0, 0, 0, 0, 0, 0, 255]));
    // 255 rolls over into the next byte
    expect(ulid(now)).toBe(encodeUlid(now, [0, 0, 0, 0, 0, 0, 0, 0, 1, 0]));
    expect(ulid(now)).toBe(encodeUlid(now, [0, 0, 0, 0, 0, 0, 0, 0, 1, 1]));
    // only the first call of the millisecond drew fresh randomness
    expect(calls.count).toBe(1);
  });

  it('draws fresh randomness when the millisecond changes', () => {
    const calls = scriptRandom([1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [9, 9, 9, 9, 9, 9, 9, 9, 9, 9]);
    expect(ulid(1_700_000_002_000)).toBe(encodeUlid(1_700_000_002_000, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]));
    expect(ulid(1_700_000_002_001)).toBe(encodeUlid(1_700_000_002_001, [9, 9, 9, 9, 9, 9, 9, 9, 9, 9]));
    expect(calls.count).toBe(2);
  });

  it('keeps ids created in one millisecond strictly increasing', () => {
    const now = 1_700_000_003_000;
    const ids = Array.from({ length: 2000 }, () => ulid(now));
    const wrong = ids.flatMap((id, i) => (i > 0 && id <= ids[i - 1] ? [`${i}: ${ids[i - 1]} then ${id}`] : []));
    expect(wrong).toEqual([]);
    expect(new Set(ids.map((id) => id.slice(0, 10)))).toEqual(new Set([ids[0].slice(0, 10)]));
  });
});

describe('newId', () => {
  const prefixes = { user: 'u_', photo: 'ph_', poi: 'poi_', theme: 'th_', item: 'it_', tag: 't_', zone: 'pz_' } as const;

  it('has a generator for every kind of record', () => {
    expect(Object.keys(newId).sort()).toEqual(Object.keys(prefixes).sort());
  });

  it('prefixes a ULID with the kind documented in docs/api/conventions.md', () => {
    for (const [kind, prefix] of Object.entries(prefixes) as [keyof typeof prefixes, string][]) {
      const id = newId[kind]();
      expect(id.startsWith(prefix), kind).toBe(true);
      expect(id.slice(prefix.length), kind).toMatch(ULID_BODY);
    }
  });

  it('produces ids that are valid as URL path parameters', () => {
    for (const make of Object.values(newId)) expect(ID_RE.test(make())).toBe(true);
  });

  it('are unique and come out in creation order', () => {
    const ids = Array.from({ length: 300 }, () => newId.photo());
    expect(new Set(ids).size).toBe(300);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('inviteCode', () => {
  const ALLOWED = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

  it('is ten characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 300; i++) {
      const code = inviteCode();
      expect(code).toHaveLength(10);
      expect(code).toMatch(/^[2-9A-HJKMNP-Z]{10}$/);
    }
  });

  it('never uses the look-alike characters 0 O 1 I L', () => {
    const all = Array.from({ length: 500 }, () => inviteCode()).join('');
    expect(all).not.toMatch(/[01OIL]/);
  });

  it('uses every symbol of the alphabet and does not repeat', () => {
    const codes = Array.from({ length: 3000 }, () => inviteCode());
    const seen = new Set(codes.join(''));
    expect([...seen].sort().join('')).toBe([...ALLOWED].sort().join(''));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('skips random bytes that would favour some symbols (rejection sampling)', () => {
    // 31 symbols: bytes 248 and up would map unevenly, so they are dropped; 247 % 31 = 30 is the last symbol
    const calls = scriptRandom(filled(16, 255), [248, 247, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(inviteCode()).toBe('Z23456789A');
    // the all-rejected buffer cost one extra draw, and the surplus bytes of the second were not used
    expect(calls.count).toBe(2);
  });

  it('keeps drawing until it has ten characters', () => {
    // the first buffer only has four usable bytes (0..3 → "2345"); the second supplies the remaining six
    const calls = scriptRandom([0, 1, 2, 3, ...filled(12, 255)], [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(inviteCode()).toBe('23456789AB');
    expect(calls.count).toBe(2);
  });
});
