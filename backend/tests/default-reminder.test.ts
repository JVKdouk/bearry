/**
 * The shared "when should the default reminder fire" rule (defaultReminder.ts).
 *
 * Used by import ingestion and the backfill, so its edges are the ones that
 * decide whether someone gets a useful ping, a 3am one, or none — exactly the
 * things worth pinning down in tests.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { defaultReminderFireAt, type RemindableBlock } from "@/src/lib/notifications/defaultReminder";

const NOW = new Date("2026-07-20T12:00:00Z");
const SP = "America/Sao_Paulo"; // UTC-3, no DST in July

function block(overrides: Partial<RemindableBlock>): RemindableBlock {
  return { kind: "event", startTime: null, deadline: null, recurrenceRule: null, ...overrides };
}

test("a future start fires at the start", () => {
  const start = new Date("2026-07-21T15:00:00Z");
  assert.deepEqual(defaultReminderFireAt(block({ startTime: start }), SP, NOW), start);
});

test("a past start gets no reminder", () => {
  const start = new Date("2026-07-19T15:00:00Z");
  assert.equal(defaultReminderFireAt(block({ startTime: start }), SP, NOW), null);
});

test("a bare task (no start, no deadline) gets nothing", () => {
  assert.equal(defaultReminderFireAt(block({ kind: "task" }), SP, NOW), null);
});

test("a deadline-only task fires at 9am local on the due date, not midnight", () => {
  // A date-only deadline is stored as end-of-day LOCAL (schedulePatch does
  // date.endOf("day")): "due 2026-07-25" for a São Paulo user is 23:59:59.999
  // local = 2026-07-26T02:59Z. The reminder must land at 09:00 local that day =
  // 12:00 UTC, never at the small hours.
  const deadline = new Date("2026-07-26T02:59:59.999Z");
  const fire = defaultReminderFireAt(block({ kind: "task", deadline }), SP, NOW);
  assert.equal(fire?.toISOString(), "2026-07-25T12:00:00.000Z");
});

test("a deadline-only reminder that would land in the past is dropped", () => {
  // "due 2026-07-19", end-of-day local: 9am local on it is already gone.
  const deadline = new Date("2026-07-20T02:59:59.999Z");
  assert.equal(defaultReminderFireAt(block({ kind: "task", deadline }), SP, NOW), null);
});

test("an event ignores a deadline — only a real start counts", () => {
  // Belt-and-braces: the 9am rule is task-only.
  const deadline = new Date("2026-07-26T02:59:59.999Z");
  assert.equal(defaultReminderFireAt(block({ kind: "event", deadline }), SP, NOW), null);
});

test("a recurring event whose anchor is still ahead fires at the anchor", () => {
  const start = new Date("2026-07-22T13:00:00Z");
  const fire = defaultReminderFireAt(
    block({ startTime: start, recurrenceRule: "FREQ=WEEKLY" }),
    SP,
    NOW,
  );
  assert.deepEqual(fire, start);
});

test("a recurring event with a past anchor fires at the next future occurrence", () => {
  // Weekly from a Monday two weeks ago; the next occurrence after now is upcoming.
  const start = new Date("2026-07-06T13:00:00Z"); // a past Monday
  const fire = defaultReminderFireAt(
    block({ startTime: start, recurrenceRule: "FREQ=WEEKLY" }),
    SP,
    NOW,
  );
  assert.ok(fire, "should find a future occurrence");
  assert.ok(fire!.getTime() >= NOW.getTime(), `next occurrence ${fire!.toISOString()} is in the past`);
  // Weekly cadence keeps the same wall-clock time of day.
  assert.equal(fire!.getUTCHours(), 13);
  assert.equal(fire!.getUTCMinutes(), 0);
});

test("a recurring series that has ended gets nothing", () => {
  const start = new Date("2026-06-01T13:00:00Z");
  const fire = defaultReminderFireAt(
    block({ startTime: start, recurrenceRule: "FREQ=WEEKLY;COUNT=2" }), // ends mid-June
    SP,
    NOW,
  );
  assert.equal(fire, null);
});

test("a recurring deadline task advances on the due date at 9am local", () => {
  const deadline = new Date("2026-07-07T02:59:59.999Z"); // "due Mon 2026-07-06", end-of-day SP
  const fire = defaultReminderFireAt(
    block({ kind: "task", deadline, recurrenceRule: "FREQ=WEEKLY" }),
    SP,
    NOW,
  );
  assert.ok(fire, "should find a future occurrence");
  assert.ok(fire!.getTime() >= NOW.getTime());
  // 9am São Paulo == 12:00 UTC, preserved across occurrences.
  assert.equal(fire!.toISOString().slice(11, 19), "12:00:00");
});
