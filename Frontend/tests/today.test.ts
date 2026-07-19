import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canBeOverdue,
  currentOrNextIndex,
  hasEnded,
  isInProgress,
  partitionDay,
  whenOf,
  type DayBlock,
} from "../src/lib/today";

const NOW = new Date("2026-07-19T15:04:00.000Z");
const TODAY = "2026-07-19";
const fmt = (iso: string) => iso.slice(0, 10);

const ev = (id: string, start: string, end: string): DayBlock => ({
  id,
  kind: "event",
  startTime: start,
  endTime: end,
});
const task = (id: string, over: Partial<DayBlock> = {}): DayBlock => ({
  id,
  kind: "task",
  status: "todo",
  ...over,
});

// --- the reported bug -------------------------------------------------------

test("an event that already happened is never overdue", () => {
  // The screenshot: 27 finished meetings listed under OVERDUE.
  const past = ev("e", "2026-07-17T09:00:00.000Z", "2026-07-17T10:00:00.000Z");
  assert.equal(canBeOverdue(past), false);

  const { overdue } = partitionDay([past], TODAY, NOW, new Map(), TODAY, fmt);
  assert.deepEqual(overdue, []);
});

test("today's finished events drop off the day entirely", () => {
  const morning = ev("m", "2026-07-19T09:00:00.000Z", "2026-07-19T10:00:00.000Z");
  const { forDay, overdue } = partitionDay([morning], TODAY, NOW, new Map(), TODAY, fmt);
  assert.deepEqual(forDay, [], "a meeting that ended at 10 is not part of the day ahead");
  assert.deepEqual(overdue, [], "and it certainly isn't overdue");
});

test("today's remaining events stay", () => {
  const later = ev("l", "2026-07-19T16:00:00.000Z", "2026-07-19T17:00:00.000Z");
  const { forDay } = partitionDay([later], TODAY, NOW, new Map(), TODAY, fmt);
  assert.equal(forDay.length, 1);
});

test("an event in progress right now still counts as part of the day", () => {
  // 15:04 sits inside it — dropping this would hide the thing you're in.
  const running = ev("r", "2026-07-19T15:00:00.000Z", "2026-07-19T15:30:00.000Z");
  assert.equal(hasEnded(running, NOW), false);
  const { forDay } = partitionDay([running], TODAY, NOW, new Map(), TODAY, fmt);
  assert.equal(forDay.length, 1);
});

test("an event ending exactly now has ended", () => {
  const boundary = ev("b", "2026-07-19T14:00:00.000Z", "2026-07-19T15:04:00.000Z");
  assert.equal(hasEnded(boundary, NOW), true);
});

test("past days still show their finished events", () => {
  // Hiding them would leave every past day looking empty, which is worse than
  // the bug being fixed.
  const past = ev("p", "2026-07-17T09:00:00.000Z", "2026-07-17T10:00:00.000Z");
  const { forDay } = partitionDay([past], "2026-07-17", NOW, new Map(), TODAY, fmt);
  assert.equal(forDay.length, 1);
});

// --- overdue is tasks, and only tasks ---------------------------------------

test("an open task from a past day is overdue", () => {
  const late = task("t", { deadline: "2026-07-17T12:00:00.000Z" });
  const { overdue } = partitionDay([late], TODAY, NOW, new Map(), TODAY, fmt);
  assert.deepEqual(overdue.map((b) => b.id), ["t"]);
});

test("a done task is not overdue", () => {
  const done = task("t", { status: "done", deadline: "2026-07-17T12:00:00.000Z" });
  assert.equal(canBeOverdue(done), false);
  const { overdue } = partitionDay([done], TODAY, NOW, new Map(), TODAY, fmt);
  assert.deepEqual(overdue, []);
});

test("overdue only appears while looking at today", () => {
  const late = task("t", { deadline: "2026-07-17T12:00:00.000Z" });
  const { overdue } = partitionDay([late], "2026-07-20", NOW, new Map(), TODAY, fmt);
  assert.deepEqual(overdue, [], "Tuesday's backlog isn't what you opened Monday to see");
});

test("a task earlier today is not overdue — the day isn't over", () => {
  const earlier = task("t", { startTime: "2026-07-19T09:00:00.000Z" });
  const { overdue, forDay } = partitionDay([earlier], TODAY, NOW, new Map(), TODAY, fmt);
  assert.deepEqual(overdue, []);
  assert.equal(forDay.length, 1, "and it stays on the day — you can still do it");
});

// --- placement and dates ----------------------------------------------------

test("a task with no date lands in Anytime", () => {
  const { anytime, forDay, overdue } = partitionDay([task("t")], TODAY, NOW, new Map(), TODAY, fmt);
  assert.deepEqual(anytime.map((b) => b.id), ["t"]);
  assert.deepEqual(forDay, []);
  assert.deepEqual(overdue, []);
});

test("a planned task follows its planner block's day", () => {
  const planned = task("t");
  const plannedAt = new Map([["t", "2026-07-19T16:00:00.000Z"]]);
  assert.equal(whenOf(planned, plannedAt), "2026-07-19T16:00:00.000Z");
  const { forDay, anytime } = partitionDay([planned], TODAY, NOW, plannedAt, TODAY, fmt);
  assert.equal(forDay.length, 1);
  assert.deepEqual(anytime, []);
});

test("a start time wins over a deadline", () => {
  const b = task("t", {
    startTime: "2026-07-19T16:00:00.000Z",
    deadline: "2026-07-25T12:00:00.000Z",
  });
  assert.equal(whenOf(b), "2026-07-19T16:00:00.000Z");
});

// --- what to lead with ------------------------------------------------------

test("leads with whatever is in progress", () => {
  const items = [
    ev("a", "2026-07-19T09:00:00.000Z", "2026-07-19T10:00:00.000Z"),
    ev("b", "2026-07-19T15:00:00.000Z", "2026-07-19T15:30:00.000Z"),
    ev("c", "2026-07-19T17:00:00.000Z", "2026-07-19T18:00:00.000Z"),
  ];
  assert.equal(currentOrNextIndex(items, NOW), 1);
  assert.equal(isInProgress(items[1], NOW), true);
  assert.equal(isInProgress(items[0], NOW), false);
});

test("otherwise leads with the next thing, not the first", () => {
  // The bug behind the screenshot: featuring index 0 opened the screen on
  // something that finished hours ago.
  const items = [
    ev("a", "2026-07-19T09:00:00.000Z", "2026-07-19T10:00:00.000Z"),
    ev("b", "2026-07-19T17:00:00.000Z", "2026-07-19T18:00:00.000Z"),
  ];
  assert.equal(currentOrNextIndex(items, NOW), 1);
});

test("an undated item counts as 'next' when nothing is scheduled ahead", () => {
  const items = [ev("a", "2026-07-19T09:00:00.000Z", "2026-07-19T10:00:00.000Z"), task("t")];
  assert.equal(currentOrNextIndex(items, NOW), 1);
});

test("with everything behind us, it falls back to the first", () => {
  const items = [ev("a", "2026-07-19T09:00:00.000Z", "2026-07-19T10:00:00.000Z")];
  assert.equal(currentOrNextIndex(items, NOW), 0);
});

test("an empty day leads with nothing", () => {
  assert.equal(currentOrNextIndex([], NOW), -1);
});

test("an event with no end can't be in progress", () => {
  assert.equal(isInProgress({ id: "x", kind: "event", startTime: "2026-07-19T15:00:00.000Z" }, NOW), false);
});
