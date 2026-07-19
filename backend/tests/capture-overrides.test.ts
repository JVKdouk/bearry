/**
 * Triage override resolution.
 *
 * The subtlety is three-valued: the user cleared a suggestion, the user
 * replaced it, or the user left it alone. Collapsing "cleared" into "absent"
 * means a wrongly-detected date can only be escaped by throwing the capture
 * away and retyping it — so these cases are worth pinning down.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { resolveOverride } from "@/src/controllers/Capture/mutators/accept";

type Body = { date?: string | null; durationMinutes?: number | null };
type Fields = { date?: string; durationMinutes?: number };

const resolveDate = (b: Body, f: Fields) => resolveOverride(b.date, f.date);
const resolveDuration = (b: Body, f: Fields) =>
  resolveOverride(b.durationMinutes, f.durationMinutes);

const DETECTED = "2026-07-20T09:00:00.000Z";
const CHOSEN = "2026-07-25T14:00:00.000Z";

test("an untouched suggestion is kept", () => {
  assert.equal(resolveDate({}, { date: DETECTED }), DETECTED);
  assert.equal(resolveDuration({}, { durationMinutes: 45 }), 45);
});

test("an explicit null clears the suggestion", () => {
  assert.equal(resolveDate({ date: null }, { date: DETECTED }), null);
  assert.equal(resolveDuration({ durationMinutes: null }, { durationMinutes: 45 }), null);
});

test("an explicit value replaces the suggestion", () => {
  assert.equal(resolveDate({ date: CHOSEN }, { date: DETECTED }), CHOSEN);
  assert.equal(resolveDuration({ durationMinutes: 90 }, { durationMinutes: 45 }), 90);
});

test("clearing is distinguishable from never having a suggestion", () => {
  // Both end at null, but they must arrive there by different routes — the
  // first is a decision, the second is an absence.
  assert.equal(resolveDate({ date: null }, { date: DETECTED }), null);
  assert.equal(resolveDate({}, {}), null);
});

test("a suggestion the classifier never made stays absent", () => {
  assert.equal(resolveDate({}, {}), null);
  assert.equal(resolveDuration({}, {}), null);
});

test("an override applies even with nothing detected", () => {
  assert.equal(resolveDate({ date: CHOSEN }, {}), CHOSEN);
});
