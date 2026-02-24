import crypto from 'crypto';

function unb64(s: string): Buffer {
  return Buffer.from(s, 'base64');
}



export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [algo, nStr, rStr, pStr, saltB64, hashB64] = parts;
  if (algo !== 'scrypt') return false;

  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = unb64(saltB64);
  const expected = unb64(hashB64);

  const actual = crypto.scryptSync(password, salt, expected.length, {
    N,
    r,
    p,
    maxmem: 64 * 1024 * 1024,
  }) as Buffer;

  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

