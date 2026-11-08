import { describe, expect, it } from 'vite-plus/test';
import { DUMMY_HASH, fromBase64, hashPassword, randomToken, toBase64, toBase64Url, verifyPassword } from './crypto';

const encoder = new TextEncoder();
const bytes = (...values: number[]) => Uint8Array.from(values);
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

/** A stored hash with an arbitrary iteration count, derived with plain WebCrypto and independent of `hashPassword`. */
async function storedHash(password: string, iterations: number, salt: Uint8Array = new Uint8Array(16).fill(7)): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return `pbkdf2$${iterations}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}

describe('base64 helpers', () => {
  it('encode the RFC 4648 test vectors', () => {
    expect(toBase64(encoder.encode(''))).toBe('');
    expect(toBase64(encoder.encode('M'))).toBe('TQ==');
    expect(toBase64(encoder.encode('Ma'))).toBe('TWE=');
    expect(toBase64(encoder.encode('Man'))).toBe('TWFu');
    expect(toBase64(encoder.encode('foobar'))).toBe('Zm9vYmFy');
  });

  it('round-trip every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromBase64(toBase64(all))).toEqual(all);
    expect(fromBase64('')).toEqual(new Uint8Array(0));
  });

  it('url-safe form swaps +/ for -_ and drops the padding', () => {
    // 0xfb 0xff 0xfe is "+//+" in the standard alphabet
    expect(toBase64(bytes(0xfb, 0xff, 0xfe))).toBe('+//+');
    expect(toBase64Url(bytes(0xfb, 0xff, 0xfe))).toBe('-__-');
    expect(toBase64Url(encoder.encode('M'))).toBe('TQ');
    expect(toBase64Url(encoder.encode('Ma'))).toBe('TWE');
  });
});

describe('randomToken', () => {
  it('is 43 url-safe characters for the default 32 bytes', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('encodes the requested number of bytes', () => {
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomToken(8)).toHaveLength(11);
    const standard = randomToken(24).replace(/-/g, '+').replace(/_/g, '/');
    expect(fromBase64(standard)).toHaveLength(24);
  });

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(tokens.size).toBe(200);
  });
});

describe('hashPassword', () => {
  it('produces pbkdf2$iterations$salt$hash with a 16-byte salt and 32-byte hash', async () => {
    const stored = await hashPassword('correct horse battery staple');
    const parts = stored.split('$');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('pbkdf2');
    expect(Number(parts[1])).toBeGreaterThan(0);
    expect(fromBase64(parts[2])).toHaveLength(16);
    expect(fromBase64(parts[3])).toHaveLength(32);
  });

  it('salts every hash, so equal passwords give different strings that both verify', async () => {
    const [a, b] = await Promise.all([hashPassword('same password'), hashPassword('same password')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same password', a)).toBe(true);
    expect(await verifyPassword('same password', b)).toBe(true);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', stored)).toBe(false);
    expect(await verifyPassword('Correct horse battery staple', stored)).toBe(false);
    expect(await verifyPassword('correct horse battery staple ', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('handles non-ASCII passwords', async () => {
    const stored = await hashPassword('密码🔒Ünïcode');
    expect(await verifyPassword('密码🔒Ünïcode', stored)).toBe(true);
    expect(await verifyPassword('密码🔓Ünïcode', stored)).toBe(false);
  });

  it('accepts hashes made by another PBKDF2-HMAC-SHA256 implementation', async () => {
    // known-answer vectors for password "password", salt "salt", 32-byte output
    const salt = encoder.encode('salt');
    const stored = (iterations: number, hex: string) => `pbkdf2$${iterations}$${toBase64(salt)}$${toBase64(fromHex(hex))}`;
    const one = stored(1, '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
    expect(await verifyPassword('password', one)).toBe(true);
    expect(await verifyPassword('password', stored(2, 'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43'))).toBe(true);
    expect(await verifyPassword('password', stored(4096, 'c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a'))).toBe(true);
    expect(await verifyPassword('passwore', one)).toBe(false);
  });

  it('reads the iteration count from each hash, so older hashes keep working', async () => {
    expect(await verifyPassword('pw', await storedHash('pw', 1))).toBe(true);
    expect(await verifyPassword('pw', await storedHash('pw', 1000))).toBe(true);
    expect(await verifyPassword('other', await storedHash('pw', 1000))).toBe(false);
  });

  it('rejects a hash that differs in a single bit anywhere', async () => {
    const stored = await storedHash('pw', 1000);
    const [scheme, iterations, salt, hash] = stored.split('$');
    const flip = (b64: string, index: number) => {
      const raw = fromBase64(b64);
      raw[index] ^= 1;
      return toBase64(raw);
    };
    for (const index of [0, 15, 31]) {
      expect(await verifyPassword('pw', [scheme, iterations, salt, flip(hash, index)].join('$')), `hash byte ${index}`).toBe(false);
    }
    expect(await verifyPassword('pw', [scheme, iterations, flip(salt, 0), hash].join('$'))).toBe(false);
  });

  describe('iteration cap', () => {
    it('accepts the largest count the Workers runtime allows', async () => {
      expect(await verifyPassword('pw', await storedHash('pw', 100_000))).toBe(true);
    });

    it('refuses one more, even for a correct hash', async () => {
      expect(await verifyPassword('pw', await storedHash('pw', 100_001))).toBe(false);
    });

    it('refuses absurd counts without computing them', async () => {
      // honouring these would pin the CPU for minutes; the call returns at once instead
      const salt = toBase64(new Uint8Array(16));
      const hash = toBase64(new Uint8Array(32));
      for (const iterations of ['1000000', '4294967296', '99999999999']) {
        expect(await verifyPassword('pw', `pbkdf2$${iterations}$${salt}$${hash}`), iterations).toBe(false);
      }
    });
  });

  describe('malformed hashes', () => {
    const salt = toBase64(new Uint8Array(16));
    const hash = toBase64(new Uint8Array(32));

    it('are rejected without throwing', async () => {
      const malformed = [
        '',
        'pbkdf2',
        'pbkdf2$20000',
        `pbkdf2$20000$${salt}`,
        `pbkdf2$20000$${salt}$${hash}$extra`,
        `bcrypt$20000$${salt}$${hash}`,
        `PBKDF2$20000$${salt}$${hash}`,
        `$20000$${salt}$${hash}`,
        'plaintext password',
        '$$$'
      ];
      for (const stored of malformed) expect(await verifyPassword('pw', stored), JSON.stringify(stored)).toBe(false);
    });

    it('with an unusable iteration count are rejected', async () => {
      for (const iterations of ['', ' ', '0', '-1', '-20000', '1.5', 'abc', 'NaN', 'Infinity', '1e999', '0x', '20000abc']) {
        expect(await verifyPassword('pw', `pbkdf2$${iterations}$${salt}$${hash}`), JSON.stringify(iterations)).toBe(false);
      }
    });

    it('with invalid base64 are rejected', async () => {
      expect(await verifyPassword('pw', `pbkdf2$1000$!!!not-base64!!!$${hash}`)).toBe(false);
      expect(await verifyPassword('pw', `pbkdf2$1000$${salt}$!!!not-base64!!!`)).toBe(false);
      expect(await verifyPassword('pw', `pbkdf2$1000$a$${hash}`)).toBe(false);
    });

    it('with a hash of the wrong length are rejected', async () => {
      const real = await storedHash('pw', 1000);
      const [scheme, iterations, realSalt, realHash] = real.split('$');
      const shorter = toBase64(fromBase64(realHash).slice(0, 31));
      const longer = toBase64(new Uint8Array([...fromBase64(realHash), 0]));
      expect(await verifyPassword('pw', [scheme, iterations, realSalt, shorter].join('$'))).toBe(false);
      expect(await verifyPassword('pw', [scheme, iterations, realSalt, longer].join('$'))).toBe(false);
      expect(await verifyPassword('pw', [scheme, iterations, realSalt, ''].join('$'))).toBe(false);
    });
  });
});

describe('DUMMY_HASH', () => {
  it('is shaped like a real hash, with the same iteration count', async () => {
    const parts = DUMMY_HASH.split('$');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('pbkdf2');
    expect(parts[1]).toBe((await hashPassword('x')).split('$')[1]);
    expect(fromBase64(parts[2])).toHaveLength(16);
    expect(fromBase64(parts[3])).toHaveLength(32);
  });

  it('never verifies, whatever the password', async () => {
    for (const password of ['', 'password', 'AAAAAAAAAAAAAAAAAAAAAA==', DUMMY_HASH]) {
      expect(await verifyPassword(password, DUMMY_HASH), JSON.stringify(password)).toBe(false);
    }
  });
});
