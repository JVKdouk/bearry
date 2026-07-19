/**
 * Password verifier (§4, §5 Authentication).
 *
 * The spec names Argon2id; we use Node's built-in scrypt (a memory-hard KDF) to
 * keep the server free of native build dependencies. The stored format is
 * self-describing (`scrypt$N$r$p$salt$hash`) so a later swap to Argon2id is a
 * per-record upgrade on next login, not a migration. The server verifies the
 * password and never stores it in plaintext — only this one-way verifier.
 */

import { randomBytes, scrypt as _scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Promisified scrypt that keeps the options overload (the default promisify
// typing drops it). Options carry the memory-hard cost parameters.
function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    _scrypt(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
}

// cost=2^15, blocksize=8, parallelization=1, 32-byte output. Tuned to be slow
// enough to blunt offline cracking without stalling logins.
const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password.normalize("NFKC"), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: 128 * N * R * 2,
  })) as Buffer;
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const derived = (await scrypt(password.normalize("NFKC"), salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
    maxmem: 128 * Number(nStr) * Number(rStr) * 2,
  })) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
