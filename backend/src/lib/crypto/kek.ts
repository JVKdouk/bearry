/**
 * The root KEK — the single trust anchor (§5.1, §5.6).
 *
 * It is loaded into process memory at boot from a secret kept deliberately off
 * Postgres and off the DB host, and ideally reconstructed from two shares so no
 * single leaked artifact contains it. It never touches a log, an env dump, or an
 * error trace. Rotating it re-wraps every DEK without re-encrypting content, so
 * break-glass revocation (§5.4) is cheap.
 *
 * This module is the ONLY place the raw KEK bytes live in the codebase; nothing
 * else imports the material, only the wrap/unwrap functions it exposes.
 */

import { seal, open, pack, unpack, KEY_BYTES, type Sealed } from "./aead";

/**
 * The KEK, held only in a module-private closure so it isn't reachable as a
 * property of any exported object (a small speed-bump against casual heap
 * inspection; §5.6 is honest that a full-takeover attacker can still reach it).
 */
let ROOT_KEK: Buffer | null = null;
let KEK_VERSION = 1;

/**
 * Reconstruct the KEK from one or two base64 shares and load it into memory.
 * Two shares are XORed, so neither share alone reveals the key — put them in
 * different sources (orchestrator secret store + read-only env mount, §14.1).
 * Called once at boot from {@link bootstrapKekFromEnv}.
 */
export function loadKek(shareA: Buffer, shareB?: Buffer): void {
  let key = shareA;
  if (shareB) {
    if (shareB.length !== shareA.length) {
      throw new Error("KEK shares must be the same length");
    }
    key = Buffer.alloc(shareA.length);
    for (let i = 0; i < shareA.length; i++) key[i] = shareA[i] ^ shareB[i];
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `Reconstructed KEK must be ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }
  ROOT_KEK = key;
}

/** Load the KEK from env at boot. Throws (fail-fast) if the shares are missing. */
export function bootstrapKekFromEnv(): void {
  const a = process.env.ROOT_KEK_SHARE_A ?? process.env.ROOT_KEK;
  const b = process.env.ROOT_KEK_SHARE_B;
  if (!a) {
    throw new Error(
      "ROOT_KEK (or ROOT_KEK_SHARE_A) must be set — the server holds no key to unwrap user DEKs without it (generate: openssl rand -base64 32)",
    );
  }
  loadKek(Buffer.from(a, "base64"), b ? Buffer.from(b, "base64") : undefined);
}

function requireKek(): Buffer {
  if (!ROOT_KEK) {
    throw new Error("KEK not loaded — call bootstrapKekFromEnv() at boot");
  }
  return ROOT_KEK;
}

export function kekVersion(): number {
  return KEK_VERSION;
}

/**
 * Wrap a per-user DEK for storage in Postgres. The DB only ever holds this
 * wrapped form, so a database-only breach yields no usable content key (§5.1).
 * `userId` is bound as AAD so a wrapped DEK can't be transplanted onto another
 * user's row.
 */
export function wrapDek(dek: Buffer, userId: string): string {
  const sealed = seal(requireKek(), dek, Buffer.from(userId, "utf8"));
  return pack(sealed).toString("base64");
}

/** Unwrap a stored DEK. Logged + rate-limited by the caller (§5.4). */
export function unwrapDek(wrapped: string, userId: string): Buffer {
  const sealed: Sealed = unpack(Buffer.from(wrapped, "base64"));
  return open(requireKek(), sealed, Buffer.from(userId, "utf8"));
}

/**
 * Rotate the KEK: swap in a new root key and return a re-wrapper. Callers pass
 * each user's currently-wrapped DEK and userId; the closure unwraps under the
 * OLD key and re-wraps under the NEW one. Content is never touched — this is the
 * O(users) operation that makes break-glass revocation fast (§5.4).
 */
export function beginKekRotation(newKek: Buffer): (wrapped: string, userId: string) => string {
  if (newKek.length !== KEY_BYTES) {
    throw new Error(`New KEK must be ${KEY_BYTES} bytes`);
  }
  const oldKek = requireKek();
  ROOT_KEK = newKek;
  KEK_VERSION += 1;
  return (wrapped: string, userId: string): string => {
    const dek = open(oldKek, unpack(Buffer.from(wrapped, "base64")), Buffer.from(userId, "utf8"));
    return wrapDek(dek, userId);
  };
}
