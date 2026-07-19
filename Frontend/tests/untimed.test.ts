import { test } from "node:test";
import assert from "node:assert/strict";
import { untimedDayKey, untimedForDay, untimedLabel } from "../src/lib/untimed";

const iso = (s: string) => new Date(s).toISOString();

test("a task with a start and an end is drawable, so not untimed", () => {
  assert.equal(
    untimedDayKey({
      id: "a",
      startTime: iso("2026-07-20T09:00:00"),
      endTime: iso("2026-07-20T10:00:00"),
    }),
    null,
  );
});

test("a deadline with no time lands on the deadline's day", () => {
  assert.equal(
    untimedDayKey({ id: "a", deadline: iso("2026-07-20T23:59:00") }),
    "2026-07-20",
  );
});

test("a start with no end counts as untimed", () => {
  // The grid needs both, so this is invisible — having a start makes that more
  // surprising, not less.
  assert.equal(
    untimedDayKey({ id: "a", startTime: iso("2026-07-20T09:00:00") }),
    "2026-07-20",
  );
});

test("a start time wins over a deadline when both exist", () => {
  assert.equal(
    untimedDayKey({
      id: "a",
      startTime: iso("2026-07-20T09:00:00"),
      deadline: iso("2026-07-25T12:00:00"),
    }),
    "2026-07-20",
  );
});

test("a task with no date at all belongs to no day", () => {
  assert.equal(untimedDayKey({ id: "a" }), null);
});

test("done, let go and deleted tasks are not nudged about", () => {
  const base = { id: "a", deadline: iso("2026-07-20T12:00:00") };
  assert.equal(untimedDayKey({ ...base, status: "done" }), null);
  assert.equal(untimedDayKey({ ...base, letGoAt: iso("2026-07-19T12:00:00") }), null);
  assert.equal(untimedDayKey({ ...base, deletedAt: iso("2026-07-19T12:00:00") }), null);
});

test("untimedForDay picks only that day's tasks", () => {
  const todos = [
    { id: "a", title: "Renew passport", deadline: iso("2026-07-20T12:00:00") },
    { id: "b", title: "Call dentist", deadline: iso("2026-07-21T12:00:00") },
    {
      id: "c",
      title: "Standup",
      startTime: iso("2026-07-20T09:00:00"),
      endTime: iso("2026-07-20T09:15:00"),
    },
  ];
  const got = untimedForDay(todos, "2026-07-20");
  assert.deepEqual(got.map((t) => t.id), ["a"]);
});

test("tasks the planner already placed are not nudged about", () => {
  // They're visible on the grid via their own event row, so pointing at them
  // would be pointing at something already on screen.
  const todos = [{ id: "a", title: "Write report", deadline: iso("2026-07-20T12:00:00") }];
  assert.deepEqual(untimedForDay(todos, "2026-07-20", new Set(["a"])), []);
  assert.equal(untimedForDay(todos, "2026-07-20", new Set(["other"])).length, 1);
});

test("an empty placed set behaves like no set at all", () => {
  const todos = [{ id: "a", deadline: iso("2026-07-20T12:00:00") }];
  assert.equal(untimedForDay(todos, "2026-07-20", new Set()).length, 1);
});

test("the label names a single task and counts the rest", () => {
  assert.equal(untimedLabel([]), null);
  assert.equal(untimedLabel([{ title: "Renew passport" }]), "Renew passport");
  assert.equal(untimedLabel([{ title: "a" }, { title: "b" }]), "2 without a time");
});

test("a single untitled task still reads as something", () => {
  assert.equal(untimedLabel([{ title: "   " }]), "Untitled");
  assert.equal(untimedLabel([{}]), "Untitled");
});
