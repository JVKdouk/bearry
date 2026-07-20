/**
 * Telling an appointment from a due-date.
 *
 * The bug this guards: a task carrying a specific time of day (an import's
 * due-with-time) was floated into a random work slot because the planner read
 * its deadline as "do by" rather than "happens at". The distinction is the
 * local time of day, and it has to be computed in the user's timezone — the
 * same instant is end-of-day for one user and mid-afternoon for another.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  deadlineIsAppointment,
  fixedInterval,
  isFixedInTime,
  localHourMinute,
} from "@/src/lib/scheduler/timedTask";

const SP = "America/Sao_Paulo"; // UTC-3, no DST currently

test("local time of day is read in the given timezone", () => {
  // 2026-07-20T20:59:59.999Z is 17:59 in São Paulo (UTC-3).
  const d = new Date("2026-07-20T20:59:59.999Z");
  assert.deepEqual(localHourMinute(d, SP), { hour: 17, minute: 59 });
  assert.deepEqual(localHourMinute(d, "UTC"), { hour: 20, minute: 59 });
});

test("a date-only deadline (end of day, local) is not an appointment", () => {
  // The app stores date-only as 23:59:59.999 local. In São Paulo that's
  // 02:59:59.999Z the next day — a naive UTC check would call it 02:59, an
  // "appointment", which is exactly the misread this avoids.
  const endOfDayLocal = new Date("2026-07-21T02:59:59.999Z");
  assert.equal(localHourMinute(endOfDayLocal, SP).hour, 23);
  assert.equal(deadlineIsAppointment(endOfDayLocal, SP), false);
});

test("midnight is also treated as date-only", () => {
  // Some imports use start-of-day for a date-only due.
  const midnightLocal = new Date("2026-07-21T03:00:00.000Z"); // 00:00 in SP
  assert.equal(deadlineIsAppointment(midnightLocal, SP), false);
});

test("a date-only deadline is recognised even when the profile timezone is wrong", () => {
  // 23:59 São Paulo = 02:59 UTC. With the profile left at the "UTC" default the
  // hour reads as a real time; the endOf('day') :59.999 fingerprint must still
  // classify it as a due-by date so the scheduler floats it, not pins it.
  const brazilEndOfDay = new Date("2026-07-25T02:59:59.999Z");
  assert.equal(deadlineIsAppointment(brazilEndOfDay, "UTC"), false);
  assert.equal(isFixedInTime({ deadline: brazilEndOfDay }, "UTC"), false);
});

test("a real time of day is an appointment", () => {
  const fivePmLocal = new Date("2026-07-24T20:00:00.000Z"); // 17:00 in SP
  assert.equal(deadlineIsAppointment(fivePmLocal, SP), true);
});

test("no deadline is not an appointment", () => {
  assert.equal(deadlineIsAppointment(null, SP), false);
  assert.equal(deadlineIsAppointment(undefined, SP), false);
});

test("a task with a start time is fixed regardless of deadline", () => {
  assert.equal(isFixedInTime({ startTime: new Date("2026-07-20T12:00:00Z") }, SP), true);
});

test("a task with an appointment deadline is fixed", () => {
  assert.equal(isFixedInTime({ deadline: new Date("2026-07-24T20:00:00Z") }, SP), true);
});

test("a task with only a date-only deadline is NOT fixed — it still floats", () => {
  // The planner should keep finding time before a genuine due date.
  assert.equal(isFixedInTime({ deadline: new Date("2026-07-21T02:59:59.999Z") }, SP), false);
});

test("a task with nothing is not fixed", () => {
  assert.equal(isFixedInTime({}, SP), false);
});

test("fixedInterval uses start/end when present", () => {
  const i = fixedInterval(
    { startTime: new Date("2026-07-20T12:00:00Z"), endTime: new Date("2026-07-20T13:00:00Z") },
    SP,
  );
  assert.equal(i?.start.toISOString(), "2026-07-20T12:00:00.000Z");
  assert.equal(i?.end.toISOString(), "2026-07-20T13:00:00.000Z");
});

test("fixedInterval derives an end from estimatedDuration for a half-timed task", () => {
  const i = fixedInterval(
    { startTime: new Date("2026-07-20T12:00:00Z"), estimatedDuration: 45 },
    SP,
  );
  assert.equal(i?.end.toISOString(), "2026-07-20T12:45:00.000Z");
});

test("fixedInterval for an appointment deadline blocks the run-up to it", () => {
  // "done by 17:00" claims the 30 minutes before 17:00.
  const i = fixedInterval(
    { deadline: new Date("2026-07-24T20:00:00Z"), estimatedDuration: 30 },
    SP,
  );
  assert.equal(i?.end.toISOString(), "2026-07-24T20:00:00.000Z");
  assert.equal(i?.start.toISOString(), "2026-07-24T19:30:00.000Z");
});

test("fixedInterval is null for a task with no time", () => {
  assert.equal(fixedInterval({ deadline: new Date("2026-07-21T02:59:59.999Z") }, SP), null);
  assert.equal(fixedInterval({}, SP), null);
});
