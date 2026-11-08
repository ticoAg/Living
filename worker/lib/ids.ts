// Prefixed ULIDs (docs/api/conventions.md#格式), invite codes and tokens.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastTime = -1;
let lastRand = new Uint8Array(10);

/** Monotonic ULID: 48-bit millisecond time + 80 random bits, Crockford base32, 26 chars. */
export function ulid(now: number = Date.now()): string {
  const rand = new Uint8Array(10);
  if (now === lastTime) {
    rand.set(lastRand);
    for (let i = 9; i >= 0; i--) {
      if (rand[i] === 255) rand[i] = 0;
      else {
        rand[i]++;
        break;
      }
    }
  } else {
    crypto.getRandomValues(rand);
  }
  lastTime = now;
  lastRand = rand;

  let t = now;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let acc = 0;
  let bits = 0;
  let out = '';
  for (const b of rand) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(acc >> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  return time + out;
}

export const newId = {
  user: () => `u_${ulid()}`,
  photo: () => `ph_${ulid()}`,
  poi: () => `poi_${ulid()}`,
  theme: () => `th_${ulid()}`,
  item: () => `it_${ulid()}`,
  tag: () => `t_${ulid()}`,
  zone: () => `pz_${ulid()}`
};

/** 10 characters from the unambiguous alphabet (no 0 O 1 I L), rejection-sampled for uniformity. */
const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function inviteCode(): string {
  let out = '';
  const limit = 256 - (256 % INVITE_ALPHABET.length);
  while (out.length < 10) {
    const buf = crypto.getRandomValues(new Uint8Array(16));
    for (const b of buf) {
      if (b < limit && out.length < 10) out += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
    }
  }
  return out;
}
