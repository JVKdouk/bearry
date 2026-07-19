/* Standalone verification of the crypto core (run: yarn tsx scripts/verify-crypto.ts). */
import assert from "node:assert";
import { seal, open, pack, unpack, sealToString, openFromString, randomBytes, KEY_BYTES } from "../src/lib/crypto/aead";
import { loadKek, wrapDek, unwrapDek, beginKekRotation, kekVersion } from "../src/lib/crypto/kek";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";
import { chargeDecrypt, RateLimitTrippedError, resetRateLimiter } from "../src/lib/security/rateLimiter";

async function main() {
  const key = randomBytes(KEY_BYTES);

  // 1. Round-trip AEAD
  const pt = Buffer.from("Buy oat milk 🥛 — deadline Friday");
  const sealed = seal(key, pt);
  assert.deepEqual(open(key, sealed), pt, "AEAD round-trip");

  // 2. Tamper detection
  const bad = { ...sealed, ciphertext: Buffer.from(sealed.ciphertext) };
  bad.ciphertext[0] ^= 0xff;
  assert.throws(() => open(key, bad), "tamper detected");

  // 3. AAD binding: opening with wrong AAD fails
  const s2 = seal(key, pt, Buffer.from("user-A"));
  assert.throws(() => open(key, s2, Buffer.from("user-B")), "AAD mismatch rejected");
  assert.deepEqual(open(key, s2, Buffer.from("user-A")), pt, "AAD match");

  // 4. pack/unpack + string helpers
  assert.deepEqual(unpack(pack(sealed)).ciphertext, sealed.ciphertext, "pack/unpack");
  const str = sealToString(key, "hello");
  assert.equal(openFromString(key, str), "hello", "string round-trip");

  // 5. Envelope: KEK wraps DEK, per-user AAD prevents transplant
  loadKek(randomBytes(KEY_BYTES));
  const dek = randomBytes(KEY_BYTES);
  const wrapped = wrapDek(dek, "user-1");
  assert.deepEqual(unwrapDek(wrapped, "user-1"), dek, "DEK unwrap");
  assert.throws(() => unwrapDek(wrapped, "user-2"), "DEK transplant rejected");

  // 6. KEK rotation re-wraps without touching content
  const vBefore = kekVersion();
  const rewrap = beginKekRotation(randomBytes(KEY_BYTES));
  const rewrapped = rewrap(wrapped, "user-1");
  assert.equal(kekVersion(), vBefore + 1, "KEK version bumped");
  assert.deepEqual(unwrapDek(rewrapped, "user-1"), dek, "DEK survives rotation");
  assert.throws(() => unwrapDek(wrapped, "user-1"), "old wrap invalid after rotation");

  // 7. Password verifier
  const hash = await hashPassword("correct horse battery staple");
  assert.ok(await verifyPassword("correct horse battery staple", hash), "password verifies");
  assert.ok(!(await verifyPassword("wrong", hash)), "wrong password rejected");

  // 8. Rate limiter trips on a distinct-user sweep
  resetRateLimiter();
  assert.throws(
    () => {
      for (let i = 0; i < 50; i++) chargeDecrypt("session-attacker", `victim-${i}`, 1);
    },
    RateLimitTrippedError,
    "bulk distinct-user decrypt trips the limiter",
  );

  // 9. Whitelisted job actor gets the elevated ceiling
  resetRateLimiter();
  for (let i = 0; i < 5000; i++) chargeDecrypt("job:summary", `user-${i}`, 1);

  console.log("✓ crypto core: all", 9, "checks passed");
}

main().catch((e) => {
  console.error("✗ verification failed:", e);
  process.exit(1);
});
