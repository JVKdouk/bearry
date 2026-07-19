/**
 * Swipe arbitration.
 *
 * The calendar scrolls vertically, drags to create events, and now swipes
 * horizontally — three gestures sharing one surface. Getting the arbitration
 * wrong doesn't produce a crash, it produces a calendar that feels like it's
 * fighting the user, which is the hardest kind of bug to notice from code.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SWIPE,
  pinchDistance,
  pinchView,
  releaseOutcome,
  shouldClaim,
  trackOffset,
} from "../src/lib/swipe";

const W = 400;

test("a clearly horizontal drag is claimed", () => {
  assert.ok(shouldClaim(40, 3));
  assert.ok(shouldClaim(-40, 3));
});

test("a vertical scroll is never claimed, however far it travels", () => {
  assert.ok(!shouldClaim(5, 200));
  assert.ok(!shouldClaim(0, 500));
});

test("a slightly diagonal vertical scroll is left alone", () => {
  // The single most irritating failure: you meant to scroll, the view swiped.
  assert.ok(!shouldClaim(30, 60));
  assert.ok(!shouldClaim(-30, 60));
});

test("a tiny movement is not a swipe", () => {
  assert.ok(!shouldClaim(4, 0), "a tap wobble must not navigate");
  assert.ok(!shouldClaim(DEFAULT_SWIPE.claimAfter, 0), "threshold is exclusive");
});

test("the track follows the finger one-for-one in the normal case", () => {
  assert.equal(trackOffset(60, W), 60);
  assert.equal(trackOffset(-60, W), -60);
});

test("the track never travels further than one period", () => {
  // Beyond that the peek runs out of rendered content and shows blank space.
  assert.equal(trackOffset(9999, W), W);
  assert.equal(trackOffset(-9999, W), -W);
});

test("pulling past a boundary is damped rather than free", () => {
  const damped = trackOffset(100, W, { atStart: true });
  assert.ok(damped < 100 && damped > 0, `expected resistance, got ${damped}`);
  // The unblocked direction is unaffected.
  assert.equal(trackOffset(-100, W, { atStart: true }), -100);
});

test("a short slow drag snaps back", () => {
  assert.equal(releaseOutcome(30, W, 800), 0);
});

test("dragging past the commit point moves a period", () => {
  const past = W * DEFAULT_SWIPE.commitFraction + 1;
  assert.equal(releaseOutcome(-past, W, 800), 1, "leftwards reveals what comes next");
  assert.equal(releaseOutcome(past, W, 800), -1, "rightwards goes back");
});

test("a fast flick commits even when it barely travels", () => {
  // A quick confident gesture that snaps back reads as the app ignoring you.
  assert.equal(releaseOutcome(-60, W, 60), 1);
  assert.equal(releaseOutcome(60, W, 60), -1);
});

test("a flick too small to be intentional still does nothing", () => {
  assert.equal(releaseOutcome(-5, W, 5), 0);
});

test("a zero-width track never navigates", () => {
  // Guards the first render, before the element has been measured — dividing
  // by zero there would commit on any movement at all.
  assert.equal(releaseOutcome(-500, 0, 100), 0);
});

test("elapsed time of zero doesn't produce an infinite velocity", () => {
  assert.equal(releaseOutcome(-5, W, 0), 0);
});

test("outcomes are symmetric across the axis", () => {
  for (const dx of [50, 120, 200, 399]) {
    // `| 0` normalises the -0 that negating a zero outcome produces.
    assert.equal(
      releaseOutcome(dx, W, 500) | 0,
      -releaseOutcome(-dx, W, 500) | 0,
      `asymmetric at ${dx}`,
    );
  }
});

// --- pinch to change view --------------------------------------------------

test("spreading fingers apart zooms in, towards fewer days", () => {
  assert.equal(pinchView("week", 100, 200), "3day");
  assert.equal(pinchView("3day", 100, 200), "day");
});

test("pinching together zooms out, towards more days", () => {
  assert.equal(pinchView("day", 200, 100), "3day");
  assert.equal(pinchView("week", 200, 100), "month");
});

test("a small pinch is ignored", () => {
  // Fingers drift during a two-finger scroll; without a threshold the view
  // would flip constantly while the user is doing something else.
  assert.equal(pinchView("week", 100, 110), "week");
  assert.equal(pinchView("week", 100, 92), "week");
});

test("the scale has ends and stops at them", () => {
  assert.equal(pinchView("day", 100, 400), "day", "cannot zoom past a single day");
  assert.equal(pinchView("month", 400, 100), "month", "cannot zoom past a month");
});

test("a pinch moves exactly one step at a time", () => {
  // Even an enormous spread advances one level; the re-baselining in the
  // handler is what lets a continuing gesture step again.
  assert.equal(pinchView("month", 100, 1000), "week");
});

test("degenerate distances change nothing", () => {
  // Two fingers landing on the same pixel would otherwise divide by zero.
  assert.equal(pinchView("week", 0, 100), "week");
  assert.equal(pinchView("week", 100, 0), "week");
});

test("pinch distance is the plain euclidean one", () => {
  assert.equal(pinchDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(pinchDistance({ x: 5, y: 5 }, { x: 5, y: 5 }), 0);
});
