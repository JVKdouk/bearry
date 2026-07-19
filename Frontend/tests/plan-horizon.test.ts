/**
 * What "Plan" covers, which depends on how you asked for it.
 *
 *  • the ⚡ sidebar item  -> always a week (weekend rolls into next week)
 *  • the calendar's Plan  -> exactly the view you're looking at
 *
 * Mirrors planHorizon()/rangeForView() in the calendar page.
 */

import test from "node:test";
import assert from "node:assert/strict";
import dayjs, { type Dayjs } from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
dayjs.extend(isoWeek);

type View = "day" | "3day" | "week" | "month";

function rangeForView(v: View, a: Dayjs) {
  if (v === "day") return { start: a.startOf("day"), end: a.endOf("day") };
  if (v === "3day") return { start: a.startOf("day"), end: a.startOf("day").add(2, "day").endOf("day") };
  if (v === "month") return { start: a.startOf("month"), end: a.endOf("month") };
  return { start: a.startOf("isoWeek"), end: a.endOf("isoWeek") };
}

function planHorizon(scope: "week" | "view", forView: View, anchor: Dayjs, today: Dayjs) {
  if (scope === "week") {
    const weekStart = today.startOf("isoWeek");
    const isWeekend = today.day() === 6 || today.day() === 0;
    const to = (isWeekend ? weekStart.add(1, "week") : weekStart).endOf("isoWeek");
    return { from: today, to };
  }
  const effective: View = forView === "month" ? "week" : forView;
  const r = rangeForView(effective, anchor);
  return { from: r.start.isBefore(today) ? today : r.start, to: r.end };
}

const days = (a: Dayjs, b: Dayjs) => b.diff(a, "day");

// 2026-07-20 is a Monday; 07-25 Saturday; 07-26 Sunday.
const MON = dayjs("2026-07-20T10:00:00");
const SAT = dayjs("2026-07-25T10:00:00");
const SUN = dayjs("2026-07-26T10:00:00");
const WED = dayjs("2026-07-22T10:00:00");

test("sidebar plan on a weekday covers the rest of this week", () => {
  const { from, to } = planHorizon("week", "week", WED, WED);
  assert.equal(from.format("YYYY-MM-DD"), "2026-07-22");
  assert.equal(to.format("YYYY-MM-DD"), "2026-07-26", "should end Sunday of this week");
});

test("sidebar plan on a SATURDAY runs through the end of next week", () => {
  const { from, to } = planHorizon("week", "week", SAT, SAT);
  assert.equal(from.format("YYYY-MM-DD"), "2026-07-25");
  assert.equal(to.format("YYYY-MM-DD"), "2026-08-02", "weekend + next week");
  assert.ok(days(from, to) >= 7, "a Saturday plan must be more than a weekend");
});

test("sidebar plan on a SUNDAY also rolls into next week", () => {
  const { to } = planHorizon("week", "week", SUN, SUN);
  assert.equal(to.format("YYYY-MM-DD"), "2026-08-02");
});

test("sidebar plan ignores whichever view you were on", () => {
  const fromDayView = planHorizon("week", "day", MON, WED);
  const fromWeekView = planHorizon("week", "week", MON, WED);
  assert.equal(fromDayView.to.toISOString(), fromWeekView.to.toISOString());
});

test("calendar Plan in day view covers only that day", () => {
  const { from, to } = planHorizon("view", "day", WED, WED);
  assert.equal(to.format("YYYY-MM-DD"), "2026-07-22");
  assert.ok(days(from, to) < 1);
});

test("calendar Plan in 3-day view covers three days", () => {
  const { to } = planHorizon("view", "3day", MON, MON);
  assert.equal(to.format("YYYY-MM-DD"), "2026-07-22");
});

test("calendar Plan in week view covers that week, with no weekend extension", () => {
  const { to } = planHorizon("view", "week", SAT, SAT);
  assert.equal(to.format("YYYY-MM-DD"), "2026-07-26", "in-view planning must NOT roll into next week");
});

test("calendar Plan in month view falls back to the anchored week", () => {
  const { to } = planHorizon("view", "month", WED, WED);
  assert.equal(to.format("YYYY-MM-DD"), "2026-07-26", "month has no planning; use its week");
  assert.ok(days(dayjs("2026-07-01"), to) < 40);
});

test("planning never starts in the past", () => {
  // Viewing last week, but planning can't retroactively fill Monday.
  const lastWeek = dayjs("2026-07-13T09:00:00");
  const { from } = planHorizon("view", "week", lastWeek, WED);
  assert.ok(from >= WED, `from ${from} should be clamped to now`);
});

test("a future week is planned from its own start, not from today", () => {
  const nextWeek = dayjs("2026-08-03T09:00:00");
  const { from } = planHorizon("view", "week", nextWeek, WED);
  assert.equal(from.format("YYYY-MM-DD"), "2026-08-03");
});

test("month view spans whole weeks so the grid stays rectangular", () => {
  const first = dayjs("2026-07-15").startOf("month").startOf("isoWeek");
  const last = dayjs("2026-07-15").endOf("month").endOf("isoWeek");
  const n = last.diff(first, "day") + 1;
  assert.equal(n % 7, 0, `month grid must be whole weeks, got ${n} days`);
  assert.ok(n >= 28 && n <= 42);
});
