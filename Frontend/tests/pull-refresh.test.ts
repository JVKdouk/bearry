/**
 * Pull-to-refresh arbitration.
 *
 * This gesture shares a surface with ordinary scrolling, so the failure that
 * matters isn't a crash — it's a refresh firing while someone scrolls back up a
 * long list, which teaches people to scroll cautiously and makes the whole app
 * feel twitchy.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PULL,
  canPull,
  isPullVisible,
  pullDistance,
  pullProgress,
  shouldRefresh,
} from "../src/lib/pullRefresh";

test("pulling down at the very top arms the gesture", () => {
  assert.ok(canPull(0, 40, 0));
});

test("pulling down mid-list does nothing", () => {
  // The important one: scrolling back up through a list must never refresh.
  assert.ok(!canPull(300, 40, 0));
  assert.ok(!canPull(1, 40, 0));
});

test("scrolling UP at the top does not arm it", () => {
  assert.ok(!canPull(0, -40, 0));
});

test("a mostly-horizontal drag is left to the swipe handler", () => {
  // The calendar navigates on horizontal swipe; both gestures firing at once
  // would refresh and change period from one movement.
  assert.ok(!canPull(0, 20, 60));
  assert.ok(!canPull(0, 20, -60));
});

test("a diagonal that is mostly vertical still arms", () => {
  assert.ok(canPull(0, 60, 20));
});

test("a rubber-band overscroll position still counts as the top", () => {
  // iOS reports negative scrollTop while overscrolling.
  assert.ok(canPull(-15, 40, 0));
});

test("the pull is damped, so it lags the finger", () => {
  const d = pullDistance(100);
  assert.ok(d < 100, "an undamped pull feels like the page came loose");
  assert.ok(d > 0);
});

test("the pull cannot travel past its ceiling", () => {
  assert.equal(pullDistance(100_000), DEFAULT_PULL.maxPull);
});

test("an upward delta produces no pull", () => {
  assert.equal(pullDistance(-50), 0);
  assert.equal(pullDistance(0), 0);
});

test("a small overshoot draws nothing at all", () => {
  // Otherwise a spinner flickers every time you bump the top of the list.
  assert.ok(!isPullVisible(pullDistance(4)));
  assert.ok(!isPullVisible(DEFAULT_PULL.startAfter));
});

test("a deliberate pull becomes visible", () => {
  assert.ok(isPullVisible(pullDistance(60)));
});

test("releasing short of the threshold does not refresh", () => {
  assert.ok(!shouldRefresh(DEFAULT_PULL.triggerAt - 1));
  assert.ok(!shouldRefresh(0));
});

test("releasing at or past the threshold refreshes", () => {
  assert.ok(shouldRefresh(DEFAULT_PULL.triggerAt));
  assert.ok(shouldRefresh(DEFAULT_PULL.maxPull));
});

test("the threshold is reachable — the ceiling is above it", () => {
  // If maxPull were below triggerAt the gesture could never fire, and no
  // amount of pulling would explain why.
  assert.ok(DEFAULT_PULL.maxPull > DEFAULT_PULL.triggerAt);
  assert.ok(shouldRefresh(pullDistance(1000)));
});

test("progress runs 0 to 1 and clamps", () => {
  assert.equal(pullProgress(0), 0);
  assert.equal(pullProgress(DEFAULT_PULL.triggerAt), 1);
  assert.equal(pullProgress(DEFAULT_PULL.triggerAt * 5), 1);
  assert.ok(pullProgress(DEFAULT_PULL.triggerAt / 2) > 0.4);
});

test("progress reaching 1 coincides exactly with the release threshold", () => {
  // The arrow flips at progress 1; if that didn't line up with shouldRefresh,
  // the indicator would promise a refresh that doesn't happen.
  for (let d = 0; d <= DEFAULT_PULL.maxPull; d += 1) {
    assert.equal(pullProgress(d) >= 1, shouldRefresh(d), `disagreement at ${d}px`);
  }
});
