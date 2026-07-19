/**
 * Converting between tasks, notes and events.
 *
 * Every one of these destroys information — that's what makes it a conversion
 * rather than a re-tag. The tests pin down exactly what survives, because the
 * failure mode is someone converting a task and finding their notes gone with
 * no way back.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eventToNote,
  eventToTask,
  kindOf,
  nextQuarterHour,
  noteToTask,
  taskToEvent,
  taskToNote,
} from "../src/lib/convert";

const FALLBACK = new Date("2026-07-20T10:00:00.000Z");

test("a timed task is recognised as an event, an untimed one as a task", () => {
  assert.equal(kindOf({ startTime: "2026-07-20T09:00:00Z", endTime: "2026-07-20T10:00:00Z" }), "event");
  assert.equal(kindOf({ startTime: null, endTime: null }), "task");
  assert.equal(kindOf({ startTime: "2026-07-20T09:00:00Z", endTime: null }), "task");
});

// --- task <-> note ---------------------------------------------------------

test("task to note keeps the title and carries the notes into the body", () => {
  const n = taskToNote({ title: "Read Q3 report", notes: "pages 4-12 matter" });
  assert.equal(n.title, "Read Q3 report");
  assert.equal(n.bodyMarkdown, "pages 4-12 matter");
});

test("a task with no notes converts to an empty note, not an undefined one", () => {
  // An undefined body would render as "undefined" in the editor.
  assert.equal(taskToNote({ title: "Thing" }).bodyMarkdown, "");
});

test("note to task puts the body in notes and takes neutral defaults", () => {
  const t = noteToTask({ title: "Ideas", bodyMarkdown: "one\ntwo" });
  assert.equal(t.title, "Ideas");
  assert.equal(t.notes, "one\ntwo");
  assert.equal(t.status, "todo");
  // A converted note carries no evidence about effort — inventing a number
  // would feed the planner an estimate nobody chose.
  assert.equal(t.estimatedDuration, 30);
  assert.equal(t.priority, "medium");
});

test("an empty note body becomes null notes, not an empty string", () => {
  assert.equal(noteToTask({ title: "T", bodyMarkdown: "" }).notes, null);
});

test("a round trip through note and back preserves title and body", () => {
  const original = { title: "Round trip", notes: "keep me" };
  const back = noteToTask(taskToNote(original));
  assert.equal(back.title, original.title);
  assert.equal(back.notes, original.notes);
});

// --- task <-> event --------------------------------------------------------

test("a timed task converts to an event at exactly its own time", () => {
  const e = taskToEvent(
    { title: "Call", startTime: "2026-07-20T14:00:00.000Z", endTime: "2026-07-20T14:45:00.000Z" },
    FALLBACK,
  );
  assert.equal(e.start, "2026-07-20T14:00:00.000Z");
  assert.equal(e.end, "2026-07-20T14:45:00.000Z");
});

test("an untimed task with a deadline lands on that day, not at midnight", () => {
  // Midnight is a time nobody chose and reads as already overdue.
  const e = taskToEvent({ title: "Renew", deadline: "2026-07-25T23:59:00.000Z" }, FALLBACK);
  const start = new Date(e.start!);
  assert.equal(start.getHours(), 9);
});

test("a task with neither time nor deadline uses the supplied fallback", () => {
  const e = taskToEvent({ title: "Someday" }, FALLBACK);
  assert.equal(e.start, FALLBACK.toISOString());
});

test("duration comes from the estimate when the task isn't already timed", () => {
  const e = taskToEvent({ title: "Deep work", estimatedDuration: 90 }, FALLBACK);
  const mins = (new Date(e.end!).getTime() - new Date(e.start!).getTime()) / 60_000;
  assert.equal(mins, 90);
});

test("a converted event is fixed — you decided to hold that time", () => {
  assert.equal(taskToEvent({ title: "X" }, FALLBACK).isFixed, true);
});

test("an event converts back to a task keeping its time and length", () => {
  const t = eventToTask({
    title: "Retro",
    description: "notes here",
    start: "2026-07-20T15:00:00.000Z",
    end: "2026-07-20T16:30:00.000Z",
  });
  assert.equal(t.startTime, "2026-07-20T15:00:00.000Z");
  assert.equal(t.endTime, "2026-07-20T16:30:00.000Z");
  assert.equal(t.estimatedDuration, 90);
  assert.equal(t.notes, "notes here");
  assert.equal(t.status, "todo");
});

test("task to event and back preserves the time", () => {
  const original = {
    title: "Stable",
    startTime: "2026-07-20T11:00:00.000Z",
    endTime: "2026-07-20T12:00:00.000Z",
  };
  const back = eventToTask(taskToEvent(original, FALLBACK));
  assert.equal(back.startTime, original.startTime);
  assert.equal(back.endTime, original.endTime);
});

test("event to note keeps the description as the body", () => {
  const n = eventToNote({ title: "Workshop", description: "bring laptop" });
  assert.equal(n.title, "Workshop");
  assert.equal(n.bodyMarkdown, "bring laptop");
});

// --- edges -----------------------------------------------------------------

test("an untitled thing never converts to a blank title", () => {
  // A record with no title is unfindable, which is worse than a placeholder.
  assert.equal(taskToNote({ title: "   " }).title, "Untitled");
  assert.equal(noteToTask({}).title, "Untitled");
  assert.equal(taskToEvent({}, FALLBACK).title, "Untitled");
  assert.equal(eventToTask({}).title, "Untitled");
});

test("an event with no times converts to a task with a sane duration", () => {
  const t = eventToTask({ title: "Orphan" });
  assert.equal(t.estimatedDuration, 30);
  assert.equal(t.startTime, null);
});

test("a zero-length event never becomes a zero-minute task", () => {
  const t = eventToTask({
    title: "Instant",
    start: "2026-07-20T09:00:00.000Z",
    end: "2026-07-20T09:00:00.000Z",
  });
  assert.ok(t.estimatedDuration! >= 5, "a task the planner can't fit anywhere is useless");
});

test("the fallback start is rounded up to a quarter hour", () => {
  // 14:37 is when someone tapped a button, not when they meant to start.
  assert.equal(nextQuarterHour(new Date("2026-07-20T14:37:00")).getMinutes(), 45);
  assert.equal(nextQuarterHour(new Date("2026-07-20T14:00:00")).getMinutes(), 15);
  assert.equal(nextQuarterHour(new Date("2026-07-20T14:59:00")).getMinutes(), 0);
});

test("rounding past the hour rolls the hour forward", () => {
  const d = nextQuarterHour(new Date("2026-07-20T14:59:00"));
  assert.equal(d.getHours(), 15);
});
