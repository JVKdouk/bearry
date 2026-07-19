/**
 * Task dependencies (§7.4): "A blocks B" means B cannot start until A finishes.
 *
 * Ordering constraints are easy to get subtly wrong — the failure mode is a
 * plan that looks fine but has you writing the report before gathering the
 * numbers — so the invariant is asserted directly on the output.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { solve } from "@/src/lib/scheduler/solver";
import { DEFAULT_PERSONA } from "@/src/lib/scheduler/persona";
import type { SchedulerInput, SchedulableTask, TaskDependency } from "@/src/lib/scheduler/types";

function task(id: string, min = 30, extra: Partial<SchedulableTask> = {}): SchedulableTask {
  return {
    id,
    estimatedDuration: min,
    deadline: null,
    priority: "medium",
    energyDemand: "medium",
    desire: "neutral",
    category: null,
    chunkable: false,
    minChunk: null,
    maxChunk: null,
    createdAt: new Date(2026, 6, 1),
    ...extra,
  };
}

function input(
  tasks: SchedulableTask[],
  dependencies: TaskDependency[] = [],
  blockerEnds: Record<string, Date> = {},
): SchedulerInput {
  const wh = { start: "09:00", end: "18:00" };
  return {
    tasks,
    busy: [],
    workingHours: { "0": [wh], "1": [wh], "2": [wh], "3": [wh], "4": [wh], "5": [wh], "6": [wh] },
    energyWindows: [],
    regions: [],
    horizonStart: new Date(2026, 6, 20, 9, 0),
    horizonEnd: new Date(2026, 6, 24, 18, 0),
    persona: { ...DEFAULT_PERSONA, weekendMode: "full" },
    dependencies,
    blockerEnds,
  };
}

const startOf = (out: ReturnType<typeof solve>, id: string) =>
  out.blocks.find((b) => b.taskId === id)?.start;
const endOf = (out: ReturnType<typeof solve>, id: string) =>
  [...out.blocks].reverse().find((b) => b.taskId === id)?.end;

test("a blocked task starts only after its blocker finishes", () => {
  const out = solve(input([task("write"), task("gather")], [{ blockerId: "gather", blockedId: "write" }]));
  const gatherEnd = endOf(out, "gather")!;
  const writeStart = startOf(out, "write")!;
  assert.ok(gatherEnd && writeStart, "both should be scheduled");
  assert.ok(writeStart >= gatherEnd, `write started ${writeStart} before gather ended ${gatherEnd}`);
});

test("the constraint holds even when the blocked task scores higher", () => {
  // "write" is ASAP so it would normally be placed first — the dependency wins.
  const out = solve(
    input(
      [task("write", 30, { priority: "ASAP" }), task("gather")],
      [{ blockerId: "gather", blockedId: "write" }],
    ),
  );
  assert.ok(startOf(out, "write")! >= endOf(out, "gather")!, "priority must not break ordering");
});

test("a chain of three is ordered end to end", () => {
  const out = solve(
    input(
      [task("c"), task("b"), task("a")],
      [
        { blockerId: "a", blockedId: "b" },
        { blockerId: "b", blockedId: "c" },
      ],
    ),
  );
  assert.ok(startOf(out, "b")! >= endOf(out, "a")!, "b before a");
  assert.ok(startOf(out, "c")! >= endOf(out, "b")!, "c before b");
});

test("a task with two blockers waits for the later one", () => {
  const out = solve(
    input(
      [task("final"), task("p1"), task("p2")],
      [
        { blockerId: "p1", blockedId: "final" },
        { blockerId: "p2", blockedId: "final" },
      ],
    ),
  );
  const latest = new Date(Math.max(endOf(out, "p1")!.getTime(), endOf(out, "p2")!.getTime()));
  assert.ok(startOf(out, "final")! >= latest, "must wait for BOTH prerequisites");
});

test("a finished prerequisite imposes no constraint", () => {
  // The service drops edges whose blocker is done, so the solver never sees
  // them — which is what makes it safe for the solver itself to be strict.
  const out = solve(input([task("write")], []));
  assert.equal(out.blocks.length, 1);
  assert.equal(out.unscheduled.length, 0);
});

test("REGRESSION: a blocker already on the calendar pins the dependent AFTER it", () => {
  // The reported bug. "ETM Ociosidade" was already scheduled for Monday, which
  // the old code treated as "satisfied" — so "Estimativa de capacidade" was free
  // to be planned on Sunday, before the thing it depends on.
  const mondayEnd = new Date(2026, 6, 20, 14, 0); // horizon starts Mon 09:00
  const out = solve(
    input(
      [task("estimativa")],
      [{ blockerId: "etm", blockedId: "estimativa" }],
      { etm: mondayEnd },
    ),
  );
  const start = startOf(out, "estimativa");
  assert.ok(start, "it should still be scheduled — just later");
  assert.ok(
    start! >= mondayEnd,
    `scheduled ${start} BEFORE its blocker finished at ${mondayEnd}`,
  );
});

test("an already-scheduled blocker in the past frees the dependent immediately", () => {
  const lastWeek = new Date(2026, 6, 10, 12, 0);
  const out = solve(
    input([task("after")], [{ blockerId: "old", blockedId: "after" }], { old: lastWeek }),
  );
  assert.equal(out.blocks.length, 1, "a blocker that already happened shouldn't hold anything up");
});

test("a blocker that is neither finished nor scheduled defers the dependent", () => {
  // The caller only passes edges for blockers that still need doing, so there is
  // no safe slot for the dependent — it must be reported, never guessed at.
  const out = solve(input([task("write")], [{ blockerId: "pending", blockedId: "write" }]));
  assert.equal(out.blocks.length, 0);
  assert.equal(out.unscheduled.length, 1);
  assert.match(out.unscheduled[0].reason, /hasn't been scheduled yet/i);
});

test("the whole chain holds when the root is already on the calendar", () => {
  const rootEnd = new Date(2026, 6, 21, 11, 0);
  const out = solve(
    input(
      [task("b"), task("c")],
      [
        { blockerId: "a", blockedId: "b" },
        { blockerId: "b", blockedId: "c" },
      ],
      { a: rootEnd },
    ),
  );
  assert.ok(startOf(out, "b")! >= rootEnd, "b must follow the fixed blocker");
  assert.ok(startOf(out, "c")! >= endOf(out, "b")!, "c must follow b");
});

test("a dependency cycle still schedules everything, and says so", () => {
  const out = solve(
    input(
      [task("a"), task("b")],
      [
        { blockerId: "a", blockedId: "b" },
        { blockerId: "b", blockedId: "a" },
      ],
    ),
  );
  assert.equal(out.blocks.length, 2, "a user mistake must not delete their tasks");
  const reasons = out.blocks.map((b) => b.reason).join(" ");
  assert.match(reasons, /loop/i, "the loop should be disclosed in the reason");
});

test("a self-dependency is ignored rather than deadlocking", () => {
  const out = solve(input([task("a")], [{ blockerId: "a", blockedId: "a" }]));
  assert.equal(out.blocks.length, 1);
});

test("dependents of an unplaceable task are reported, not silently dropped", () => {
  const out = solve(
    input(
      [task("huge", 100000), task("after")],
      [{ blockerId: "huge", blockedId: "after" }],
    ),
  );
  assert.equal(out.blocks.length, 0);
  const ids = out.unscheduled.map((u) => u.taskId);
  assert.ok(ids.includes("huge"));
  assert.ok(ids.includes("after"), "the dependent must be accounted for");
  const afterReason = out.unscheduled.find((u) => u.taskId === "after")!.reason;
  assert.match(afterReason, /waiting on another task/i);
});

test("chunks of one task stay in order", () => {
  const out = solve(
    input([task("big", 150, { chunkable: true, minChunk: 30, maxChunk: 50 })]),
  );
  const mine = out.blocks.filter((b) => b.taskId === "big");
  assert.ok(mine.length > 1, "expected chunks");
  for (let i = 1; i < mine.length; i++) {
    assert.ok(mine[i].start >= mine[i - 1].end, "chunk order must be monotonic");
  }
});

test("dependencies don't waste the gap before the blocked task", () => {
  // "filler" has no constraints, so it should use the morning that "second"
  // can't touch while it waits on "first".
  const out = solve(
    input(
      [task("first", 30), task("second", 30), task("filler", 30)],
      [{ blockerId: "first", blockedId: "second" }],
    ),
  );
  assert.equal(out.blocks.length, 3, "all three should fit");
});

test("no dependencies means the ordering is untouched", () => {
  const plain = solve(input([task("a"), task("b"), task("c")]));
  const withEmpty = solve(input([task("a"), task("b"), task("c")], []));
  assert.deepEqual(
    plain.blocks.map((b) => [b.taskId, b.start.toISOString()]),
    withEmpty.blocks.map((b) => [b.taskId, b.start.toISOString()]),
  );
});
