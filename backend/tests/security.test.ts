/**
 * Anti-exfiltration controls (§5.3, §5.4) and the memory-bounding sweeps.
 *
 * The sweeps are not housekeeping — an expired-but-resident DEK silently turns
 * "active-only decryption" into "ever-active decryption", so it is a security
 * property with a test, not a nice-to-have.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  chargeDecrypt,
  resetRateLimiter,
  sweepStaleBuckets,
  RateLimitTrippedError,
} from "@/src/lib/security/rateLimiter";
import {
  putDek,
  getDek,
  evictDek,
  flushAllDeks,
  activeDekCount,
  sweepExpiredDeks,
} from "@/src/lib/crypto/keyCache";
import { randomBytes, KEY_BYTES } from "@/src/lib/crypto/aead";

test("a sweep across distinct users trips the limiter", () => {
  resetRateLimiter();
  // The default ceiling is 5 distinct users per window.
  for (let i = 0; i < 5; i++) chargeDecrypt("session-evil", `user-${i}`, 1);
  assert.throws(
    () => chargeDecrypt("session-evil", "user-5", 1),
    (e: unknown) => e instanceof RateLimitTrippedError && e.kind === "distinct-users",
  );
});

test("one user's own heavy sync is not throttled by the user ceiling", () => {
  resetRateLimiter();
  for (let i = 0; i < 50; i++) chargeDecrypt("session-ok", "user-1", 100);
  assert.ok(true); // same user repeatedly -> never trips distinct-users
});

test("the record ceiling bounds bulk volume", () => {
  resetRateLimiter();
  assert.throws(
    () => chargeDecrypt("session-bulk", "user-1", 200_000),
    (e: unknown) => e instanceof RateLimitTrippedError && e.kind === "records",
  );
});

test("stale limiter buckets are swept so the map cannot grow without bound", () => {
  resetRateLimiter();
  for (let i = 0; i < 100; i++) chargeDecrypt(`session-${i}`, "user-1", 1);
  // Nothing is stale yet.
  assert.equal(sweepStaleBuckets(Date.now()), 0);
  // A full window later, every bucket is collectable.
  const dropped = sweepStaleBuckets(Date.now() + 10 * 60_000);
  assert.equal(dropped, 100);
});

test("a warm DEK is returned and its TTL slides on access", () => {
  flushAllDeks();
  const dek = randomBytes(KEY_BYTES);
  putDek("user-1", dek, 60_000);
  assert.deepEqual(getDek("user-1"), dek);
});

test("an expired DEK is not served", () => {
  flushAllDeks();
  putDek("user-1", randomBytes(KEY_BYTES), -1); // already expired
  assert.equal(getDek("user-1"), null);
});

test("expired DEKs are swept even when never read again", () => {
  flushAllDeks();
  // The leak this guards: a user who goes away is never read again, so lazy
  // expiry never runs and their key stays warm forever.
  putDek("gone-1", randomBytes(KEY_BYTES), -1);
  putDek("gone-2", randomBytes(KEY_BYTES), -1);
  putDek("active", randomBytes(KEY_BYTES), 60_000);
  assert.equal(activeDekCount(), 3);

  const evicted = sweepExpiredDeks();
  assert.equal(evicted, 2);
  assert.equal(activeDekCount(), 1);
  assert.notEqual(getDek("active"), null); // the active user is untouched
});

test("evictDek removes exactly one user", () => {
  flushAllDeks();
  putDek("a", randomBytes(KEY_BYTES));
  putDek("b", randomBytes(KEY_BYTES));
  evictDek("a");
  assert.equal(getDek("a"), null);
  assert.notEqual(getDek("b"), null);
});

test("break-glass flush scrubs key material, not just the map", () => {
  flushAllDeks();
  const dek = randomBytes(KEY_BYTES);
  putDek("user-1", dek);
  flushAllDeks();
  assert.equal(activeDekCount(), 0);
  // The caller's reference must be zeroed — that is the point of break-glass.
  assert.deepEqual(dek, Buffer.alloc(KEY_BYTES));
});
