/**
 * Tombstone retention.
 *
 * The dangerous case is a client returning after a long absence. If we pruned a
 * deletion it never saw and then served it a *delta*, it would keep the deleted
 * row forever and its next push could resurrect it — data corruption on exactly
 * the devices least able to report it. `needsFullResync` is the guard that makes
 * pruning safe, so its boundary is worth pinning down precisely.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  RETENTION_DAYS,
  needsFullResync,
  retentionHorizon,
} from "@/src/lib/sync/tombstones";

const DAY = 86_400_000;
const NOW = new Date("2026-07-19T12:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

test("a recent cursor gets a normal delta", () => {
  assert.equal(needsFullResync(ago(1), NOW), false);
  assert.equal(needsFullResync(ago(30), NOW), false);
});

test("a cursor older than retention forces a full resync", () => {
  assert.equal(needsFullResync(ago(RETENTION_DAYS + 1), NOW), true);
  assert.equal(needsFullResync(ago(365), NOW), true);
});

test("the boundary is exact and errs toward resyncing", () => {
  // A cursor exactly at the horizon is still safe: nothing older than it has
  // been pruned. One millisecond earlier is not.
  const horizon = retentionHorizon(NOW);
  assert.equal(needsFullResync(horizon, NOW), false);
  assert.equal(needsFullResync(new Date(horizon.getTime() - 1), NOW), true);
});

test("a first-time client is not told to reset", () => {
  // It has nothing to discard; a null cursor is already a full bootstrap.
  assert.equal(needsFullResync(null, NOW), false);
});

test("a cursor from the future is treated as current, not stale", () => {
  // Clock skew must never trigger a wipe of the client's local state.
  assert.equal(needsFullResync(new Date(NOW.getTime() + 60_000), NOW), false);
});

test("the horizon moves with the clock", () => {
  const later = new Date(NOW.getTime() + 10 * DAY);
  assert.equal(
    retentionHorizon(later).getTime() - retentionHorizon(NOW).getTime(),
    10 * DAY,
  );
});

test("retention is long enough to cover a realistic absence", () => {
  // A holiday, a hospital stay, a phone in a drawer for a season. If this is
  // ever tuned down, it should be a deliberate decision, not a drift.
  assert.ok(RETENTION_DAYS >= 30, `retention of ${RETENTION_DAYS}d is too short to be safe`);
});
