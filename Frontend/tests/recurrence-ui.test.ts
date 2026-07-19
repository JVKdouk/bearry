/**
 * Client-side recurrence presentation.
 *
 * The picker's presets have to round-trip through the *server's* parser — a
 * preset the backend rejects would silently become a non-repeating task, which
 * is the worst kind of failure here: the UI says "Every week" and nothing ever
 * repeats.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { repeatOptions, describeRepeat } from "@/lib/recurrence";

test("every preset produces a rule the description understands", () => {
  for (const opt of repeatOptions(1)) {
    if (!opt.rule) continue;
    const described = describeRepeat(opt.rule);
    assert.ok(described, `no description for ${opt.rule}`);
    assert.notEqual(described, "Repeats", `${opt.label} fell back to the generic label`);
  }
});

test("presets anchor the weekly rules on the chosen weekday", () => {
  const wed = repeatOptions(3).find((o) => o.label === "Every week")!;
  assert.match(wed.rule!, /BYDAY=WE/);
  const sun = repeatOptions(0).find((o) => o.label === "Every week")!;
  assert.match(sun.rule!, /BYDAY=SU/);
});

test("'Does not repeat' is a null rule, not an empty string", () => {
  const none = repeatOptions(1)[0];
  assert.equal(none.rule, null, "empty string would be stored and read as a broken rule");
});

test("descriptions match the label the user picked", () => {
  const opts = repeatOptions(1); // Monday
  const expect: Record<string, string> = {
    "Every day": "Every day",
    "Every weekday": "Every weekday",
    "Every week": "Every week on Mon",
    "Every 2 weeks": "Every 2 weeks on Mon",
    "Every month": "Every month",
    "Every year": "Every year",
  };
  for (const o of opts) {
    if (!o.rule) continue;
    assert.equal(describeRepeat(o.rule), expect[o.label], o.label);
  }
});

test("an unknown rule degrades to a neutral label rather than lying", () => {
  assert.equal(describeRepeat("FREQ=HOURLY;INTERVAL=6"), "Repeats");
});

test("no rule means no label", () => {
  assert.equal(describeRepeat(null), null);
  assert.equal(describeRepeat(undefined), null);
  assert.equal(describeRepeat(""), null);
});

test("the RRULE: prefix is tolerated", () => {
  assert.equal(describeRepeat("RRULE:FREQ=DAILY"), "Every day");
});
