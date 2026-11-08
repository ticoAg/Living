// Password hashing (PBKDF2-SHA256 via WebCrypto) and token helpers.

// New hashes use HASH_ITERATIONS. 100k iterations cost ~20–30 ms of CPU, more than the Workers
// Free plan's 10 ms per request, so new hashes use 20k; each hash stores its own count, so this
// can be raised later (e.g. on Workers Paid) without breaking existing accounts.
const HASH_ITERATIONS = 20_000;
const MAX_ITERATIONS = 100_000; // the maximum Workers' WebCrypto accepts for PBKDF2
const enc = new TextEncoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** `pbkdf2$<iterations>$<salt base64>$<hash base64>` — 16-byte salt, 32-byte hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, HASH_ITERATIONS);
  return `pbkdf2$${HASH_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return false;
  try {
    const hash = await derive(password, fromBase64(parts[2]), iterations);
    return timingSafeEqual(hash, fromBase64(parts[3]));
  } catch {
    return false;
  }
}

/** A well-formed hash nobody knows the password of; verifying against it burns the same time as a real user. */
export const DUMMY_HASH = `pbkdf2$${HASH_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;
