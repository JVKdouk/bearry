/**
 * Applying a plan must never leave a task drawn twice.
 *
 * The bug this guards: a timed task whose moment had passed was re-placed by the
 * solver, which created a planner block for it — but the source task kept its
 * own (past) start/end, so the calendar showed both, and the stale copy stayed
 * flagged "carried over". `vacatePatches` is the pure decision that strips the
 * source task's own time on apply; every branch is covered here so a regression
 * shows up as a red test rather than a duplicate on someone's calendar.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { vacatePatches, type VacateSource } from "@/src/lib/scheduler/vacate";

const D = (s: string) => new Date(s);

function src(overrides: Partial<VacateSource> & { id: string }): VacateSource {
  return {
    startTime: null,
    deadline: null,
    recurrenceRule: null,
    ...overrides,
  };
}

test("a deadline-only task is left untouched (it placed nothing of its own)", () => {
  const out = vacatePatches([src({ id: "a", deadline: D("2026-07-25T00:00:00Z") })]);
  assert.deepEqual(out, []);
});

test("a task with no time at all is left untouched", () => {
  const out = vacatePatches([src({ id: "a" })]);
  assert.deepEqual(out, []);
});

test("a timed task is stripped of its start/end and its fixed pin", () => {
  const out = vacatePatches([
    src({ id: "a", startTime: D("2026-07-10T14:00:00Z"), deadline: D("2026-07-10T15:00:00Z") }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "a");
  assert.equal(out[0].startTime, null);
  assert.equal(out[0].endTime, null);
  assert.equal(out[0].isFixed, false);
  // It already had a deadline, so we don't invent one.
  assert.equal("deadline" in out[0], false);
});

test("a recurring timed task with no deadline keeps its series anchor", () => {
  const start = D("2026-07-10T14:00:00Z");
  const out = vacatePatches([
    src({ id: "r", startTime: start, deadline: null, recurrenceRule: "FREQ=WEEKLY" }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].startTime, null);
  // Anchor preserved so advanceRecurrence can still walk the series.
  assert.deepEqual(out[0].deadline, start);
});

test("a recurring timed task that already has a deadline is not given another", () => {
  const out = vacatePatches([
    src({
      id: "r",
      startTime: D("2026-07-10T14:00:00Z"),
      deadline: D("2026-07-10T00:00:00Z"),
      recurrenceRule: "FREQ=WEEKLY",
    }),
  ]);
  assert.equal(out.length, 1);
  assert.equal("deadline" in out[0], false);
});

test("a non-recurring timed task never gains a deadline", () => {
  const out = vacatePatches([
    src({ id: "a", startTime: D("2026-07-10T14:00:00Z"), deadline: null }),
  ]);
  assert.equal(out.length, 1);
  assert.equal("deadline" in out[0], false);
});

test("only the timed tasks in a mixed batch are vacated", () => {
  const out = vacatePatches([
    src({ id: "deadline-only", deadline: D("2026-07-25T00:00:00Z") }),
    src({ id: "timed", startTime: D("2026-07-10T14:00:00Z") }),
    src({ id: "bare" }),
  ]);
  assert.deepEqual(
    out.map((p) => p.id),
    ["timed"],
  );
});
