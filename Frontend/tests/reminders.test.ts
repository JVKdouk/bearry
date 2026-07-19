/**
 * Reminder scheduling rules.
 *
 * The failure modes here are asymmetric. A late reminder is a disappointment; a
 * duplicate, or one that fires at 3am for something that already happened, is
 * why people turn notifications off permanently and never turn them back on.
 * These tests encode that bias.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OFFSET_MINUTES,
  REMINDER_OFFSETS,
  chosenOffsets,
  fireAtFor,
  isOffsetUsable,
  offsetLabel,
  rescheduleReminders,
  usableOffsets,
} from "../src/lib/reminders";

const NOW = new Date("2026-07-20T09:00:00.000Z");
const iso = (d: Date) => d.toISOString();

test("the default reminder is at the time itself", () => {
  // Anything else would be a choice made on the user's behalf about how much
  // warning they want.
  assert.equal(DEFAULT_OFFSET_MINUTES, 0);
});

test("an offset counts backwards from the start", () => {
  const start = new Date("2026-07-20T15:00:00.000Z");
  assert.equal(iso(fireAtFor(start, 0)), "2026-07-20T15:00:00.000Z");
  assert.equal(iso(fireAtFor(start, 60)), "2026-07-20T14:00:00.000Z");
  assert.equal(iso(fireAtFor(start, 60 * 24)), "2026-07-19T15:00:00.000Z");
  assert.equal(iso(fireAtFor(start, 60 * 24 * 7)), "2026-07-13T15:00:00.000Z");
});

test("a string start is accepted as readily as a Date", () => {
  const a = fireAtFor("2026-07-20T15:00:00.000Z", 60);
  const b = fireAtFor(new Date("2026-07-20T15:00:00.000Z"), 60);
  assert.equal(iso(a), iso(b));
});

// --- what's offerable -------------------------------------------------------

test("an offset that would already have passed is not offered", () => {
  // "1 week before" on a task due tomorrow can only fire in the past.
  const tomorrow = new Date("2026-07-21T10:00:00.000Z");
  assert.ok(!isOffsetUsable(tomorrow, 60 * 24 * 7, NOW));
  assert.ok(isOffsetUsable(tomorrow, 60, NOW));
});

test("a far-off event offers every lead time", () => {
  const nextMonth = new Date("2026-08-20T10:00:00.000Z");
  assert.equal(usableOffsets(nextMonth, NOW).length, REMINDER_OFFSETS.length);
});

test("something starting in ten minutes offers only the immediate one", () => {
  const soon = new Date("2026-07-20T09:10:00.000Z");
  const offsets = usableOffsets(soon, NOW).map((o) => o.minutes);
  assert.deepEqual(offsets, [0]);
});

test("something already started offers nothing", () => {
  // A picker full of choices that cannot fire is worse than an empty one.
  const past = new Date("2026-07-20T08:00:00.000Z");
  assert.deepEqual(usableOffsets(past, NOW), []);
});

test("an offset exactly at the current moment is not usable", () => {
  // It would fire "now", which in practice means during the save.
  assert.ok(!isOffsetUsable(NOW, 0, NOW));
});

// --- duplicates -------------------------------------------------------------

test("offsets already chosen are reported so they can't be added twice", () => {
  const chosen = chosenOffsets([
    { id: "a", offsetMinutes: 0 },
    { id: "b", offsetMinutes: 60 },
  ]);
  assert.ok(chosen.has(0));
  assert.ok(chosen.has(60));
  assert.ok(!chosen.has(30));
});

test("a deleted reminder doesn't block re-adding that offset", () => {
  const chosen = chosenOffsets([{ id: "a", offsetMinutes: 60, deletedAt: "2026-07-19T00:00:00Z" }]);
  assert.ok(!chosen.has(60));
});

// --- rescheduling -----------------------------------------------------------

test("moving a task moves its reminders and keeps each lead time", () => {
  const reminders = [
    { id: "at", offsetMinutes: 0 },
    { id: "hour", offsetMinutes: 60 },
    { id: "day", offsetMinutes: 60 * 24 },
  ];
  const patches = rescheduleReminders(reminders, "2026-08-01T15:00:00.000Z", NOW);
  assert.equal(patches.find((p) => p.id === "at")!.fireAt, "2026-08-01T15:00:00.000Z");
  assert.equal(patches.find((p) => p.id === "hour")!.fireAt, "2026-08-01T14:00:00.000Z");
  assert.equal(patches.find((p) => p.id === "day")!.fireAt, "2026-07-31T15:00:00.000Z");
});

test("rescheduling into the future re-arms a reminder that already fired", () => {
  // Moving a task to next week should notify you again — otherwise the
  // reschedule silently costs you the reminder.
  const patches = rescheduleReminders([{ id: "r", offsetMinutes: 60 }], "2026-08-01T15:00:00.000Z", NOW);
  assert.equal(patches[0].delivered, false);
});

test("a reminder whose new moment is already past is left dormant", () => {
  // The alternative is a notification firing the instant you edit a task,
  // which reads as the app shouting at you for making a change.
  const patches = rescheduleReminders([{ id: "r", offsetMinutes: 60 }], "2026-07-20T09:30:00.000Z", NOW);
  assert.equal(patches[0].delivered, true);
});

test("clearing a task's date leaves reminders attached but unable to fire", () => {
  // Deleting them would silently discard the user's choices; firing them with
  // no time would be nonsense.
  const patches = rescheduleReminders([{ id: "r", offsetMinutes: 60 }], null, NOW);
  assert.equal(patches[0].fireAt, null);
  assert.equal(patches[0].delivered, true);
});

test("deleted reminders are not rescheduled", () => {
  const patches = rescheduleReminders(
    [{ id: "a", offsetMinutes: 0 }, { id: "b", offsetMinutes: 60, deletedAt: "x" }],
    "2026-08-01T15:00:00.000Z",
    NOW,
  );
  assert.equal(patches.length, 1);
  assert.equal(patches[0].id, "a");
});

// --- wording ----------------------------------------------------------------

test("every offered offset has a label", () => {
  for (const o of REMINDER_OFFSETS) {
    assert.ok(offsetLabel(o.minutes).length > 0, `no label for ${o.minutes}`);
  }
});

test("an offset outside the presets still reads sensibly", () => {
  // Imported or hand-edited values must not render as a bare number.
  assert.match(offsetLabel(45), /45 minutes before/);
  assert.match(offsetLabel(120), /2 hours before/);
  assert.match(offsetLabel(60 * 24 * 3), /3 days before/);
  assert.equal(offsetLabel(-5), "At the time");
});

test("singular and plural are right", () => {
  assert.match(offsetLabel(60), /1 hour before/);
  assert.match(offsetLabel(60 * 24), /1 day before/);
  assert.ok(!offsetLabel(60).includes("hours"));
  assert.ok(!offsetLabel(60 * 24).includes("days"));
});
