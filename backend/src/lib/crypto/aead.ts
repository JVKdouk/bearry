/**
 * Authenticated encryption primitive (AES-256-GCM).
 *
 * Every sealed value carries its own random 96-bit nonce and 128-bit auth tag,
 * so tampering is detected on open and no nonce is ever reused across records.
 * This is the single low-level crypto surface — envelope key handling (§5.1) and
 * field encryption (§5.8) build on top of it and never call `crypto` directly.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const NONCE_BYTES = 12; // 96-bit nonce, the GCM standard
const TAG_BYTES = 16; // 128-bit auth tag
const KEY_BYTES = 32; // AES-256

/**
 * A sealed value. Stored as three fields (or one packed buffer) per §5.8 —
 * ciphertext plus the nonce and tag needed to open and verify it.
 */
export type Sealed = {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
};

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`AEAD key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
}

/**
 * Seal plaintext under `key`. Optional `aad` (additional authenticated data) is
 * bound to the ciphertext without being encrypted — use it to pin a record to
 * its context (e.g. `userId:field`) so a ciphertext can't be replayed onto a
 * different row.
 */
export function seal(key: Buffer, plaintext: Buffer, aad?: Buffer): Sealed {
  assertKey(key);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, key, nonce, {
    authTagLength: TAG_BYTES,
  });
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, nonce, tag };
}

/** Open a sealed value. Throws if the key, nonce, tag, or aad don't verify. */
export function open(key: Buffer, sealed: Sealed, aad?: Buffer): Buffer {
  assertKey(key);
  const decipher = createDecipheriv(ALGO, key, sealed.nonce, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(sealed.tag);
  if (aad) decipher.setAAD(aad);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
}

const PACK_VERSION = 1;

/**
 * Pack a sealed value into a single buffer for column storage:
 * `[version:1][nonce:12][tag:16][ciphertext:…]`. A version byte lets the format
 * evolve (e.g. a future XChaCha20 variant) without a data migration.
 */
export function pack(sealed: Sealed): Buffer {
  return Buffer.concat([
    Buffer.from([PACK_VERSION]),
    sealed.nonce,
    sealed.tag,
    sealed.ciphertext,
  ]);
}

/** Inverse of {@link pack}. Throws on an unknown version or truncated buffer. */
export function unpack(buf: Buffer): Sealed {
  if (buf.length < 1 + NONCE_BYTES + TAG_BYTES) {
    throw new Error("Sealed buffer is truncated");
  }
  const version = buf[0];
  if (version !== PACK_VERSION) {
    throw new Error(`Unknown sealed format version ${version}`);
  }
  let off = 1;
  const nonce = buf.subarray(off, (off += NONCE_BYTES));
  const tag = buf.subarray(off, (off += TAG_BYTES));
  const ciphertext = buf.subarray(off);
  return { ciphertext, nonce, tag };
}

/** Convenience: seal → pack → base64 string for a text column. */
export function sealToString(key: Buffer, plaintext: string, aad?: Buffer): string {
  return pack(seal(key, Buffer.from(plaintext, "utf8"), aad)).toString("base64");
}

/** Inverse of {@link sealToString}. */
export function openFromString(key: Buffer, packed: string, aad?: Buffer): string {
  return open(key, unpack(Buffer.from(packed, "base64")), aad).toString("utf8");
}

/** Constant-time buffer comparison, re-exported so callers never hand-roll it. */
export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export { KEY_BYTES, NONCE_BYTES, TAG_BYTES, randomBytes };
