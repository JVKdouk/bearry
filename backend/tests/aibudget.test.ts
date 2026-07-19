/**
 * Per-user AI budget.
 *
 * The control this replaces was "nothing": the global limiter caps requests per
 * IP and each endpoint caps its batch, but neither bounds cost. One client
 * looping enrich at 50 tasks a call drives tens of thousands of model requests
 * a minute and exhausts the shared quota for everyone.
 */

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  AiBudgetExceededError,
  chargeAi,
  remainingAi,
  resetAiBudget,
  sweepAiBuckets,
} from "@/src/lib/security/aiBudget";

const MAX = Number(process.env.AI_BUDGET_MAX_ITEMS ?? 300);
const WINDOW_MS = Number(process.env.AI_BUDGET_WINDOW_SECONDS ?? 3600) * 1000;

beforeEach(() => resetAiBudget());

test("ordinary use is never blocked", () => {
  // Enrich a 40-task backlog, ask for steps a dozen times, run a diagnosis.
  assert.doesNotThrow(() => {
    chargeAi("u1", 40);
    for (let i = 0; i < 12; i++) chargeAi("u1", 1);
    chargeAi("u1", 1);
  });
  assert.ok(remainingAi("u1") > 0);
});

test("a runaway loop is stopped", () => {
  assert.throws(
    () => {
      for (let i = 0; i < 100; i++) chargeAi("u2", 50);
    },
    AiBudgetExceededError,
  );
});

test("cost is charged per item, not per request", () => {
  // The whole point: one request about 50 tasks must not cost the same as one
  // request about one task.
  chargeAi("u3", 50);
  assert.equal(remainingAi("u3"), MAX - 50);
});

test("an over-budget request is refused whole, not partly served", () => {
  chargeAi("u4", MAX - 5);
  assert.throws(() => chargeAi("u4", 10), AiBudgetExceededError);
  // The refused request charged nothing, so the remaining 5 are still usable.
  assert.equal(remainingAi("u4"), 5);
  assert.doesNotThrow(() => chargeAi("u4", 5));
});

test("spending exactly the budget is allowed; one more is not", () => {
  assert.doesNotThrow(() => chargeAi("u5", MAX));
  assert.equal(remainingAi("u5"), 0);
  assert.throws(() => chargeAi("u5", 1), AiBudgetExceededError);
});

test("one user's spending never affects another's", () => {
  chargeAi("heavy", MAX);
  assert.equal(remainingAi("light"), MAX);
  assert.doesNotThrow(() => chargeAi("light", 10));
});

test("the budget refills after the window", () => {
  const t0 = 1_000_000;
  chargeAi("u6", MAX, t0);
  assert.throws(() => chargeAi("u6", 1, t0 + 1000), AiBudgetExceededError);
  assert.doesNotThrow(() => chargeAi("u6", MAX, t0 + WINDOW_MS + 1));
});

test("the error says when to come back", () => {
  const t0 = 2_000_000;
  chargeAi("u7", MAX, t0);
  try {
    chargeAi("u7", 1, t0 + 60_000);
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof AiBudgetExceededError);
    assert.ok(err.retryAfterSeconds > 0, "Retry-After must be positive");
    assert.ok(
      err.retryAfterSeconds <= WINDOW_MS / 1000,
      "Retry-After must not exceed the window",
    );
  }
});

test("Retry-After is never zero, even at the very end of a window", () => {
  // A zero would tell the client to retry immediately, producing a hot loop
  // against an endpoint that is refusing it.
  const t0 = 3_000_000;
  chargeAi("u8", MAX, t0);
  try {
    chargeAi("u8", 1, t0 + WINDOW_MS - 1);
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok((err as AiBudgetExceededError).retryAfterSeconds >= 1);
  }
});

test("stale buckets are swept so the map doesn't grow without bound", () => {
  const t0 = 4_000_000;
  for (let i = 0; i < 50; i++) chargeAi(`user-${i}`, 1, t0);
  assert.equal(sweepAiBuckets(t0 + 1000), 0, "live buckets must survive");
  assert.equal(sweepAiBuckets(t0 + WINDOW_MS + 1), 50);
});

test("an unknown user starts with the full budget", () => {
  assert.equal(remainingAi("never-seen"), MAX);
});
