import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampMinutes,
  durationInputValue,
  MAX_MINUTES,
  MIN_MINUTES,
  parseDuration,
} from "../src/lib/duration";

test("a bare number is minutes", () => {
  // The unit people mean when they type "90" into a duration box.
  assert.equal(parseDuration("90"), 90);
  assert.equal(parseDuration("5"), 5);
});

test("explicit minutes", () => {
  assert.equal(parseDuration("90m"), 90);
  assert.equal(parseDuration("45 m"), 45);
});

test("hours", () => {
  assert.equal(parseDuration("2h"), 120);
  assert.equal(parseDuration("1h"), 60);
});

test("hours and minutes, however they're spaced", () => {
  assert.equal(parseDuration("1h30"), 90);
  assert.equal(parseDuration("1h30m"), 90);
  assert.equal(parseDuration("1h 30m"), 90);
  assert.equal(parseDuration("1h 30"), 90);
});

test("fractional hours", () => {
  assert.equal(parseDuration("1.5h"), 90);
  assert.equal(parseDuration("0.5h"), 30);
});

test("clock notation", () => {
  assert.equal(parseDuration("1:30"), 90);
  assert.equal(parseDuration("0:45"), 45);
  assert.equal(parseDuration("15:00"), 900);
});

test("case and whitespace don't matter", () => {
  assert.equal(parseDuration("  2H  "), 120);
  assert.equal(parseDuration("1H30M"), 90);
});

test("a fifteen-hour task is expressible", () => {
  // The old ceiling was 600 minutes, which made the five-hour splitting rule
  // impossible to reach from the UI at all.
  assert.equal(parseDuration("15h"), 900);
  assert.ok(MAX_MINUTES >= 900);
});

test("ambiguous input is refused rather than guessed", () => {
  // A fractional hour AND minutes contradicts itself. Guessing would hand the
  // planner a wrong number that never fails loudly.
  assert.equal(parseDuration("1.5h30"), null);
});

test("nonsense is refused", () => {
  for (const bad of ["", "   ", "abc", "h", "m", "-30", "30x", "1h30x", "1:99", "::"]) {
    assert.equal(parseDuration(bad), null, `"${bad}" should be refused`);
  }
});

test("zero is not a duration", () => {
  assert.equal(parseDuration("0"), null);
  assert.equal(parseDuration("0m"), null);
  assert.equal(parseDuration("0h"), null);
});

test("absurd values clamp instead of being refused", () => {
  // Someone typing "9999" meant "a lot", not "nothing" — clamping keeps the
  // intent, refusing discards it.
  assert.equal(parseDuration("9999"), MAX_MINUTES);
  assert.equal(parseDuration("100h"), MAX_MINUTES);
});

test("clampMinutes keeps values in range and whole", () => {
  assert.equal(clampMinutes(0), MIN_MINUTES);
  assert.equal(clampMinutes(-50), MIN_MINUTES);
  assert.equal(clampMinutes(99999), MAX_MINUTES);
  assert.equal(clampMinutes(30.4), 30);
  assert.equal(clampMinutes(30.6), 31);
});

test("the input reads back in the form it was typed", () => {
  assert.equal(durationInputValue(30), "30m");
  assert.equal(durationInputValue(59), "59m");
  assert.equal(durationInputValue(60), "1h");
  assert.equal(durationInputValue(90), "1h30m");
  assert.equal(durationInputValue(900), "15h");
});

test("every value the input shows can be parsed back", () => {
  // The round trip is what makes editing safe: typing nothing and blurring
  // must not change the value.
  for (const m of [1, 5, 30, 45, 59, 60, 61, 90, 120, 300, 900, 1440]) {
    assert.equal(parseDuration(durationInputValue(m)), m, `round trip failed for ${m}`);
  }
});
