import { test } from "node:test";
import assert from "node:assert/strict";
import { convertLoses, convertTo, nextQuarterHour } from "../src/lib/convert";
import type { Block } from "../src/lib/types";

type Partial3 = Pick<Block, "kind" | "startTime" | "endTime" | "deadline" | "estimatedDuration">;

const task = (over: Partial<Partial3> = {}): Partial3 => ({
  kind: "task",
  startTime: null,
  endTime: null,
  deadline: null,
  estimatedDuration: 30,
  ...over,
});

test("converting to the same kind changes nothing", () => {
  assert.deepEqual(convertTo(task(), "task"), {});
  assert.deepEqual(convertTo(task({ kind: "note" }), "note"), {});
});

test("task to note clears everything that only meant something for a task", () => {
  // A note that kept its deadline would still surface as overdue.
  const patch = convertTo(task({ deadline: "2026-07-20T12:00:00.000Z" }), "note");
  assert.equal(patch.kind, "note");
  assert.equal(patch.deadline, null);
  assert.equal(patch.startTime, null);
  assert.equal(patch.endTime, null);
  assert.equal(patch.isFixed, false);
});

test("event to task keeps the times", () => {
  // They're the one thing the event actually carried; a scheduled task is a
  // perfectly good thing to be.
  const ev = task({
    kind: "event",
    startTime: "2026-07-20T09:00:00.000Z",
    endTime: "2026-07-20T10:00:00.000Z",
  });
  const patch = convertTo(ev, "task");
  assert.equal(patch.kind, "task");
  assert.equal(patch.startTime, undefined, "times are untouched, not cleared");
  assert.equal(patch.status, "todo");
});

test("task to event uses the task's own schedule when it has one", () => {
  const t = task({
    startTime: "2026-07-20T09:00:00.000Z",
    endTime: "2026-07-20T09:45:00.000Z",
  });
  const patch = convertTo(t, "event");
  assert.equal(patch.startTime, "2026-07-20T09:00:00.000Z");
  assert.equal(patch.endTime, "2026-07-20T09:45:00.000Z");
  assert.equal(patch.estimatedDuration, 45);
});

test("task to event falls back to the deadline before inventing a time", () => {
  const t = task({ deadline: "2026-07-20T14:00:00.000Z", estimatedDuration: 60 });
  const patch = convertTo(t, "event");
  assert.equal(patch.startTime, "2026-07-20T14:00:00.000Z");
  assert.equal(patch.endTime, "2026-07-20T15:00:00.000Z");
  assert.equal(patch.deadline, null, "the deadline became the time; it shouldn't also linger");
});

test("task to event uses the fallback when there's nothing to go on", () => {
  const fallback = new Date("2026-07-20T11:15:00.000Z");
  const patch = convertTo(task({ estimatedDuration: 25 }), "event", fallback);
  assert.equal(patch.startTime, fallback.toISOString());
  assert.equal(patch.endTime, new Date("2026-07-20T11:40:00.000Z").toISOString());
});

test("an event always ends after it starts", () => {
  // A zero or negative duration would draw a block with no height, or one that
  // renders backwards.
  for (const d of [0, -5, NaN]) {
    const patch = convertTo(task({ estimatedDuration: d as number }), "event");
    assert.ok(new Date(patch.endTime!) > new Date(patch.startTime!), `duration ${d}`);
    assert.ok(patch.estimatedDuration! >= 1);
  }
});

test("note to event still produces a usable time", () => {
  const patch = convertTo(task({ kind: "note" }), "event");
  assert.ok(patch.startTime);
  assert.ok(new Date(patch.endTime!) > new Date(patch.startTime!));
});

test("nextQuarterHour rounds up and never returns the current minute", () => {
  assert.equal(
    nextQuarterHour(new Date("2026-07-20T09:01:30.000Z")).toISOString(),
    "2026-07-20T09:15:00.000Z",
  );
  assert.equal(
    nextQuarterHour(new Date("2026-07-20T09:14:00.000Z")).toISOString(),
    "2026-07-20T09:15:00.000Z",
  );
  // Exactly on a quarter still moves forward — "now" is not a future start.
  assert.equal(
    nextQuarterHour(new Date("2026-07-20T09:15:00.000Z")).toISOString(),
    "2026-07-20T09:30:00.000Z",
  );
  assert.equal(
    nextQuarterHour(new Date("2026-07-20T09:52:00.000Z")).toISOString(),
    "2026-07-20T10:00:00.000Z",
  );
});

test("only leaving a task with steps loses anything", () => {
  assert.equal(convertLoses("task", "note", 3), "3 steps will be removed");
  assert.equal(convertLoses("task", "event", 1), "1 step will be removed");
  assert.equal(convertLoses("task", "note", 0), null);
  assert.equal(convertLoses("event", "task", 3), null);
  assert.equal(convertLoses("task", "task", 3), null);
});
