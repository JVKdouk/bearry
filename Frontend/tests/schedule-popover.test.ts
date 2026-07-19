/**
 * The scheduling popover's date logic.
 *
 * Both functions here are the kind that look obviously right and are wrong at
 * the edges — a month grid that starts on the wrong weekday, or a "this
 * weekend" shortcut that points at yesterday.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import dayjs from "dayjs";
import { monthMatrix, quickPicks } from "../src/components/SchedulePopover";

const at = (iso: string) => dayjs(iso);

test("the month grid always starts on a Monday", () => {
  // Every month of a year, including the ones that begin on a Sunday — the case
  // that breaks a naive `day()` offset.
  for (let m = 0; m < 12; m++) {
    const grid = monthMatrix(at(`2026-${String(m + 1).padStart(2, "0")}-01`));
    assert.equal(grid[0][0].day(), 1, `month ${m + 1} does not start on Monday`);
  }
});

test("every grid row holds exactly seven days", () => {
  const grid = monthMatrix(at("2026-02-01"));
  assert.ok(grid.every((w) => w.length === 7));
});

test("the grid covers the whole month", () => {
  const month = at("2026-07-01");
  const days = monthMatrix(month).flat().map((d) => d.format("YYYY-MM-DD"));
  for (let d = 1; d <= 31; d++) {
    const key = `2026-07-${String(d).padStart(2, "0")}`;
    assert.ok(days.includes(key), `missing ${key}`);
  }
});

test("the grid is contiguous, with no gaps or repeats", () => {
  const days = monthMatrix(at("2026-03-01")).flat();
  for (let i = 1; i < days.length; i++) {
    assert.equal(days[i].diff(days[i - 1], "day"), 1, `gap before index ${i}`);
  }
});

test("no trailing row made entirely of the next month", () => {
  // February 2026 starts on a Sunday, the case most likely to produce a wasted
  // final row that just makes the popover taller.
  for (const m of ["2026-02-01", "2026-03-01", "2026-11-01"]) {
    const grid = monthMatrix(at(m));
    const last = grid[grid.length - 1];
    const target = at(m).month();
    assert.ok(
      last.some((d) => d.month() === target),
      `${m}: last row contains no day of the month itself`,
    );
  }
});

test("a February in a leap year is fully covered", () => {
  const days = monthMatrix(at("2028-02-01")).flat().map((d) => d.format("YYYY-MM-DD"));
  assert.ok(days.includes("2028-02-29"));
});

test("shortcuts always offer today and tomorrow", () => {
  const labels = quickPicks(at("2026-07-15T10:00:00")).map((p) => p.label);
  assert.ok(labels.includes("Today"));
  assert.ok(labels.includes("Tomorrow"));
});

test("'Tonight' disappears once the evening has passed", () => {
  // Offering to schedule into an evening that's already over is an invitation
  // to fail — exactly the dynamic this app exists to avoid.
  const morning = quickPicks(at("2026-07-15T09:00:00")).map((p) => p.label);
  const lateNight = quickPicks(at("2026-07-15T23:30:00")).map((p) => p.label);
  assert.ok(morning.includes("Tonight"));
  assert.ok(!lateNight.includes("Tonight"));
});

test("'Tonight' lands in the evening of the current day", () => {
  const pick = quickPicks(at("2026-07-15T09:00:00")).find((p) => p.label === "Tonight");
  assert.ok(pick?.time);
  assert.equal(pick.time.hour(), 19);
  assert.equal(pick.date.format("YYYY-MM-DD"), "2026-07-15");
});

test("'This weekend' points at the coming Saturday", () => {
  // 2026-07-15 is a Wednesday.
  const pick = quickPicks(at("2026-07-15T09:00:00")).find((p) => p.label === "This weekend");
  assert.equal(pick?.date.format("YYYY-MM-DD"), "2026-07-18");
  assert.equal(pick?.date.day(), 6);
});

test("'This weekend' is dropped when it's already the weekend", () => {
  for (const d of ["2026-07-18T10:00:00", "2026-07-19T10:00:00"]) {
    const labels = quickPicks(at(d)).map((p) => p.label);
    assert.ok(!labels.includes("This weekend"), `${d} should not offer it`);
  }
});

test("every shortcut points at today or later, never the past", () => {
  for (let d = 13; d <= 19; d++) {
    const now = at(`2026-07-${d}T14:00:00`);
    for (const p of quickPicks(now)) {
      assert.ok(
        !p.date.isBefore(now.startOf("day")),
        `${now.format("ddd")}: "${p.label}" points backwards`,
      );
    }
  }
});
