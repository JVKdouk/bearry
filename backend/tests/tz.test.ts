/**
 * Timezone wall-clock math (§9.7). The scheduler resolves working hours, energy
 * windows and day boundaries in the *user's* zone, not the server's, so these
 * helpers are load-bearing for every plan. The tests pin the behaviour that is
 * easy to get subtly wrong: DST transitions, day/week boundaries across an
 * offset, and the round-trip between an instant and its wall clock.
 *
 * They run identically on any host: every assertion is against a named zone
 * (America/Sao_Paulo, America/New_York, Europe/London) rather than the local
 * one, so a CI box in UTC and a laptop in GMT-3 agree.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  offsetMinutes,
  zonedParts,
  zonedWallToUtc,
  zonedWeekday,
  zonedMinutesOfDay,
  zonedDayKey,
  zonedStartOfDay,
  zonedNextDay,
} from "@/src/lib/scheduler/tz";

const SP = "America/Sao_Paulo";
const NY = "America/New_York";
const LON = "Europe/London";

test("offset is DST-aware in New York (winter vs summer)", () => {
  // Standard time (EST, -5) in January; daylight time (EDT, -4) in July.
  assert.equal(offsetMinutes(new Date("2026-01-15T12:00:00Z"), NY), -300);
  assert.equal(offsetMinutes(new Date("2026-07-15T12:00:00Z"), NY), -240);
});

test("an unknown zone falls back to UTC rather than throwing", () => {
  assert.equal(offsetMinutes(new Date("2026-07-15T12:00:00Z"), "Mars/Olympus"), 0);
});

test("wall-clock parts read in the user's zone, not UTC", () => {
  // 2026-07-15T02:00Z is 23:00 the previous day in São Paulo (-3).
  const p = zonedParts(new Date("2026-07-15T02:00:00Z"), SP);
  assert.equal(p.year, 2026);
  assert.equal(p.month, 7);
  assert.equal(p.day, 14);
  assert.equal(p.hour, 23);
  assert.equal(p.minute, 0);
});

test("wall→UTC round-trips through parts", () => {
  const utc = zonedWallToUtc(2026, 7, 15, 9, 30, NY); // 09:30 EDT = 13:30 UTC
  assert.equal(utc.toISOString(), "2026-07-15T13:30:00.000Z");
  const p = zonedParts(utc, NY);
  assert.deepEqual([p.year, p.month, p.day, p.hour, p.minute], [2026, 7, 15, 9, 30]);
});

test("spring-forward: 02:30 does not exist and is not silently mangled", () => {
  // London springs forward 2026-03-29 01:00→02:00. Asking for 02:30 (a gap
  // time) must still land on a real, stable instant that reads back sanely
  // rather than drifting by an hour on the second offset read.
  const utc = zonedWallToUtc(2026, 3, 29, 2, 30, LON);
  const back = zonedMinutesOfDay(utc, LON);
  // It resolves to a concrete minute-of-day; the point is it doesn't crash or
  // land on the wrong calendar day.
  assert.ok(back >= 0 && back < 24 * 60);
  assert.equal(zonedDayKey(utc, LON), "2026-3-29");
});

test("fall-back: the repeated 01:30 hour still resolves to a valid instant", () => {
  // London falls back 2026-10-25 02:00→01:00, so 01:30 happens twice. Either
  // choice is acceptable; it must be a real instant on the right day.
  const utc = zonedWallToUtc(2026, 10, 25, 1, 30, LON);
  assert.equal(zonedDayKey(utc, LON), "2026-10-25");
  assert.equal(zonedMinutesOfDay(utc, LON), 90);
});

test("weekday is computed in the user's zone across a date boundary", () => {
  // 2026-07-20 is a Monday. At 01:00Z it is still Sunday in São Paulo (-3 → 22:00 Sun).
  assert.equal(zonedWeekday(new Date("2026-07-20T01:00:00Z"), SP), 0); // Sunday
  assert.equal(zonedWeekday(new Date("2026-07-20T12:00:00Z"), SP), 1); // Monday
});

test("minutes-of-day is zero at local midnight and grows through the day", () => {
  const midnight = zonedWallToUtc(2026, 7, 15, 0, 0, SP);
  assert.equal(zonedMinutesOfDay(midnight, SP), 0);
  const nineThirty = zonedWallToUtc(2026, 7, 15, 9, 30, SP);
  assert.equal(zonedMinutesOfDay(nineThirty, SP), 570);
});

test("startOfDay is local midnight, and nextDay advances exactly 24h (no DST)", () => {
  const noon = new Date(zonedWallToUtc(2026, 7, 15, 12, 0, SP));
  const start = zonedStartOfDay(noon, SP);
  assert.equal(zonedMinutesOfDay(start, SP), 0);
  assert.equal(zonedDayKey(start, SP), "2026-7-15");
  const next = zonedNextDay(start, SP);
  assert.equal(zonedDayKey(next, SP), "2026-7-16");
  assert.equal(zonedMinutesOfDay(next, SP), 0);
});

test("nextDay crosses a DST boundary and still lands on local midnight", () => {
  // New York springs forward 2026-03-08. The day before is 23h long, so a naive
  // +24h would miss midnight; zonedNextDay must still land on 00:00 local.
  const before = zonedStartOfDay(new Date(zonedWallToUtc(2026, 3, 8, 12, 0, NY)), NY);
  const next = zonedNextDay(before, NY);
  assert.equal(zonedDayKey(next, NY), "2026-3-9");
  assert.equal(zonedMinutesOfDay(next, NY), 0);
});

test("nextDay normalises across month and year ends", () => {
  const dec31 = zonedStartOfDay(new Date(zonedWallToUtc(2026, 12, 31, 6, 0, SP)), SP);
  assert.equal(zonedDayKey(zonedNextDay(dec31, SP), SP), "2027-1-1");
});
