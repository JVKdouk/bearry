/**
 * Rules the custom editor can build must be rules the engine accepts.
 *
 * The editor composes an RRULE string from its controls. If any reachable
 * combination produced something the parser refuses, the task would appear to
 * repeat and then silently never fire — the exact failure the engine's
 * refuse-rather-than-guess contract exists to make visible, turned invisible
 * again by the UI offering it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { describeRRule, parseRRule } from "../src/lib/recurrence/rrule";

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Mirrors the composition in CustomRepeat. */
function build(o: {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval?: number;
  days?: number[];
  mode?: "dayOfMonth" | "weekdayOfMonth";
  dayOfMonth?: number;
  nth?: number;
  weekday?: number;
  month?: number;
}): string {
  const parts = [`FREQ=${o.freq}`];
  if ((o.interval ?? 1) > 1) parts.push(`INTERVAL=${o.interval}`);
  if (o.freq === "WEEKLY" && o.days?.length) {
    parts.push(`BYDAY=${[...o.days].sort((a, b) => a - b).map((d) => DAY_CODES[d]).join(",")}`);
  }
  if (o.freq === "MONTHLY" || o.freq === "YEARLY") {
    if (o.freq === "YEARLY") parts.push(`BYMONTH=${o.month ?? 1}`);
    if (o.mode === "weekdayOfMonth") parts.push(`BYDAY=${o.nth ?? 1}${DAY_CODES[o.weekday ?? 1]}`);
    else parts.push(`BYMONTHDAY=${o.dayOfMonth ?? 1}`);
  }
  return parts.join(";");
}

test("every combination the editor can reach parses", () => {
  const freqs = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
  const intervals = [1, 2, 10, 52];
  const nths = [1, 2, 3, 4, -1];
  let checked = 0;

  for (const freq of freqs) {
    for (const interval of intervals) {
      if (freq === "DAILY") {
        assert.ok(parseRRule(build({ freq, interval })), `DAILY/${interval}`);
        checked++;
        continue;
      }
      if (freq === "WEEKLY") {
        for (const days of [[1], [0, 6], [1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5, 6]]) {
          const rule = build({ freq, interval, days });
          assert.ok(parseRRule(rule), rule);
          checked++;
        }
        continue;
      }
      for (const dayOfMonth of [1, 15, 28, 31]) {
        const rule = build({ freq, interval, mode: "dayOfMonth", dayOfMonth, month: 2 });
        assert.ok(parseRRule(rule), rule);
        checked++;
      }
      for (const nth of nths) {
        for (let weekday = 0; weekday < 7; weekday++) {
          const rule = build({ freq, interval, mode: "weekdayOfMonth", nth, weekday, month: 5 });
          assert.ok(parseRRule(rule), rule);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 300, `only checked ${checked} combinations`);
});

test("every reachable combination also describes itself", () => {
  // A rule with no description would render a blank summary in the editor,
  // which reads as the control being broken.
  for (const rule of [
    build({ freq: "DAILY", interval: 10 }),
    build({ freq: "WEEKLY", interval: 2, days: [1, 4] }),
    build({ freq: "MONTHLY", mode: "weekdayOfMonth", nth: 2, weekday: 0 }),
    build({ freq: "MONTHLY", mode: "dayOfMonth", dayOfMonth: 15 }),
    build({ freq: "YEARLY", mode: "dayOfMonth", dayOfMonth: 24, month: 1 }),
    build({ freq: "YEARLY", mode: "weekdayOfMonth", nth: -1, weekday: 4, month: 11 }),
  ]) {
    const text = describeRRule(rule);
    assert.ok(text && text.length > 0, `no description for ${rule}`);
  }
});

test("the examples from the request all work", () => {
  const cases: [string, string][] = [
    ["weekly on Monday and Tuesday", build({ freq: "WEEKLY", days: [1, 2] })],
    ["yearly on 24 January", build({ freq: "YEARLY", mode: "dayOfMonth", dayOfMonth: 24, month: 1 })],
    ["every 10 days", build({ freq: "DAILY", interval: 10 })],
    ["monthly on the second Sunday", build({ freq: "MONTHLY", mode: "weekdayOfMonth", nth: 2, weekday: 0 })],
  ];
  for (const [name, rule] of cases) {
    assert.ok(parseRRule(rule), `${name} -> ${rule} was refused`);
  }
});
