/**
 * When a task is allowed to be split across sittings.
 *
 * The rule is small but it decides whether long work gets planned at all: with
 * the old "never split unless told to" default, a 15-hour task hunted for a
 * single 15-hour gap, never found one, and reported itself unplaceable.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { AUTO_CHUNK_MINUTES, isChunkable } from "@/src/lib/scheduler/chunking";
import { solve } from "@/src/lib/scheduler/solver";
import type { SchedulerInput, SchedulableTask } from "@/src/lib/scheduler/types";

test("the threshold is five hours", () => {
  assert.equal(AUTO_CHUNK_MINUTES, 300);
});

test("undecided long tasks split, undecided short ones don't", () => {
  assert.equal(isChunkable(null, 300), true);
  assert.equal(isChunkable(null, 301), true);
  assert.equal(isChunkable(null, 900), true);
  assert.equal(isChunkable(null, 299), false);
  assert.equal(isChunkable(null, 30), false);
});

test("undefined behaves the same as null", () => {
  // Prisma gives null, a partial object may give undefined; both mean
  // "nobody decided" and must not diverge.
  assert.equal(isChunkable(undefined, 900), true);
  assert.equal(isChunkable(undefined, 30), false);
});

test("an explicit choice always wins over the duration rule", () => {
  // Including the unusual directions — a 15-hour thing that genuinely can't be
  // broken up, and a 30-minute one the user wants split anyway.
  assert.equal(isChunkable(false, 900), false);
  assert.equal(isChunkable(true, 30), true);
});

test("exactly at the threshold splits", () => {
  // Stated explicitly because "5h+" is the requirement, and an off-by-one here
  // is invisible until someone's five-hour task silently refuses to schedule.
  assert.equal(isChunkable(null, AUTO_CHUNK_MINUTES), true);
  assert.equal(isChunkable(null, AUTO_CHUNK_MINUTES - 1), false);
});

// --- through the solver ---------------------------------------------------

function task(id: string, min: number, extra: Partial<SchedulableTask> = {}): SchedulableTask {
  return {
    id,
    estimatedDuration: min,
    deadline: null,
    priority: "medium",
    energyDemand: "medium",
    desire: "neutral",
    category: null,
    chunkable: null,
    minChunk: null,
    maxChunk: null,
    createdAt: new Date(2026, 6, 1),
    ...extra,
  };
}

/** A full working week, so a long task has somewhere to spread into. */
function weekInput(tasks: SchedulableTask[]): SchedulerInput {
  const hours = [{ start: "09:00", end: "17:00" }];
  return {
    tasks,
    busy: [],
    workingHours: { "1": hours, "2": hours, "3": hours, "4": hours, "5": hours },
    energyWindows: [],
    regions: [],
    horizonStart: new Date(2026, 6, 20, 9, 0, 0),
    horizonEnd: new Date(2026, 6, 24, 17, 0, 0),
  };
}

test("a long undecided task is split rather than declared unplaceable", () => {
  const out = solve(weekInput([task("long", 600)]));
  const blocks = out.blocks.filter((b) => b.taskId === "long");
  assert.ok(blocks.length > 1, "should have been split into several sittings");
  assert.ok(blocks.every((b) => b.isChunk), "each piece should be marked as a chunk");
});

test("a long task actually spreads across more than one day", () => {
  // The point of the feature: "broken across a period", not two solid days.
  const out = solve(weekInput([task("long", 600)]));
  const days = new Set(
    out.blocks.filter((b) => b.taskId === "long").map((b) => b.start.toDateString()),
  );
  assert.ok(days.size > 1, `expected several days, got ${days.size}`);
});

test("a short undecided task is left whole", () => {
  const out = solve(weekInput([task("short", 45)]));
  const blocks = out.blocks.filter((b) => b.taskId === "short");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].isChunk, false);
});

test("an explicit no keeps a long task in one piece", () => {
  // It won't fit a single working day, so refusing to split means refusing to
  // schedule — which is the honest outcome of the user's own instruction.
  const out = solve(weekInput([task("exam", 600, { chunkable: false })]));
  const blocks = out.blocks.filter((b) => b.taskId === "exam");
  assert.equal(blocks.length, 0);
  assert.ok(out.unscheduled.some((u) => u.taskId === "exam"));
});

test("an explicit yes splits a task under the threshold", () => {
  const out = solve(weekInput([task("small", 120, { chunkable: true, maxChunk: 30 })]));
  const blocks = out.blocks.filter((b) => b.taskId === "small");
  assert.ok(blocks.length > 1, "an explicit yes should override the duration rule");
});
