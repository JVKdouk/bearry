/**
 * The plan drawer's warnings tab label.
 *
 * The diagnosis arrives after the plan. It used to render above the schedule,
 * so landing shoved everything you were reading down the screen. Behind a tab,
 * the label is the only thing that changes — so the label has to be honest
 * about all three states rather than showing "0 warnings" while still thinking.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

/** Mirrors the label logic in the calendar's review drawer. */
function warningsLabel(diagnosing: boolean, count: number): string {
  if (diagnosing) return "Warnings…";
  if (count === 0) return "No warnings";
  return `${count} warning${count === 1 ? "" : "s"}`;
}

test("while the diagnosis is running the label says so", () => {
  // Not "0 warnings" — claiming a clean plan before checking is a lie that
  // resolves into a contradiction a second later.
  assert.equal(warningsLabel(true, 0), "Warnings…");
});

test("a checked plan with nothing to flag says so positively", () => {
  assert.equal(warningsLabel(false, 0), "No warnings");
});

test("one warning is singular, several are plural", () => {
  assert.equal(warningsLabel(false, 1), "1 warning");
  assert.equal(warningsLabel(false, 3), "3 warnings");
});

test("a stale count is never shown once a new check starts", () => {
  // Re-planning resets the diagnosis; the loading state must win over whatever
  // the previous plan reported.
  assert.equal(warningsLabel(true, 7), "Warnings…");
});
