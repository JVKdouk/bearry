import { test } from "node:test";
import assert from "node:assert/strict";
import { HOLD_MS, MOVE_TOLERANCE_PX, movedTooFar } from "../src/lib/longPress";

test("a still finger is a hold", () => {
  assert.equal(movedTooFar({ x: 100, y: 100 }, { x: 100, y: 100 }), false);
});

test("a tiny drift is still a hold", () => {
  // Fingers are never perfectly still; a few pixels must not cancel it.
  assert.equal(movedTooFar({ x: 100, y: 100 }, { x: 104, y: 103 }), false);
});

test("moving past the tolerance is a scroll, not a hold", () => {
  assert.equal(movedTooFar({ x: 100, y: 100 }, { x: 100, y: 120 }), true);
  assert.equal(movedTooFar({ x: 100, y: 100 }, { x: 120, y: 100 }), true);
});

test("the tolerance is radial, not per-axis", () => {
  // 8px on each axis is ~11.3px diagonally, past a 10px radius — so a diagonal
  // drift that clears neither axis alone still cancels.
  assert.equal(movedTooFar({ x: 0, y: 0 }, { x: 8, y: 8 }), true);
  assert.equal(movedTooFar({ x: 0, y: 0 }, { x: 6, y: 6 }), false);
});

test("a custom tolerance is respected", () => {
  assert.equal(movedTooFar({ x: 0, y: 0 }, { x: 15, y: 0 }, 20), false);
  assert.equal(movedTooFar({ x: 0, y: 0 }, { x: 25, y: 0 }, 20), true);
});

test("the thresholds are sane", () => {
  // A hold long enough not to fire on a tap, short enough not to feel broken.
  assert.ok(HOLD_MS >= 300 && HOLD_MS <= 800);
  assert.ok(MOVE_TOLERANCE_PX > 0 && MOVE_TOLERANCE_PX <= 20);
});
