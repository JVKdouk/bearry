/**
 * The recurrence engine (§7.5).
 *
 * Recurrence bugs surface weeks later and are hard to attribute, so the rules
 * get pinned down here. The most important property isn't breadth of support —
 * it's that anything we DON'T fully support parses as null and degrades to a
 * one-off, rather than generating confidently wrong dates.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseRRule,
  formatRRule,
  occurrences,
  nextOccurrence,
  nextAfter,
  describeRRule,
} from "@/src/lib/recurrence/rrule";

const at = (s: string) => new Date(s);
const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const list = (ds: Date[]) => ds.map(fmt);

// --- parsing --------------------------------------------------------------

test("parses a simple daily rule", () => {
  assert.deepEqual(parseRRule("FREQ=DAILY"), { freq: "DAILY", interval: 1 });
});

test("accepts the RRULE: prefix", () => {
  assert.equal(parseRRule("RRULE:FREQ=WEEKLY")?.freq, "WEEKLY");
});

test("parses interval, byday, count and until", () => {
  const r = parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6")!;
  assert.equal(r.interval, 2);
  assert.deepEqual(r.byDay, [1, 3]);
  assert.equal(r.count, 6);
});

test("unsupported rules parse as null, never as a guess", () => {
  for (const bad of [
    "FREQ=HOURLY",              // unsupported frequency
    "FREQ=MONTHLY;BYDAY=2FR",   // positional weekday
    "FREQ=WEEKLY;BYDAY=XX",     // nonsense day
    "FREQ=MONTHLY;BYMONTHDAY=-1", // negative month day
    "FREQ=DAILY;INTERVAL=0",    // zero interval
    "GARBAGE",
    "",
    null,
  ]) {
    assert.equal(parseRRule(bad as string), null, `should reject: ${bad}`);
  }
});

test("BYDAY on a non-weekly frequency is refused rather than misread", () => {
  assert.equal(parseRRule("FREQ=DAILY;BYDAY=MO"), null);
});

test("format round-trips through parse", () => {
  for (const raw of [
    "FREQ=DAILY",
    "FREQ=DAILY;INTERVAL=3",
    "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU",
    "FREQ=MONTHLY;BYMONTHDAY=15",
    "FREQ=YEARLY",
  ]) {
    const parsed = parseRRule(raw)!;
    assert.ok(parsed, raw);
    assert.deepEqual(parseRRule(formatRRule(parsed)), parsed, raw);
  }
});

// --- expansion ------------------------------------------------------------

test("daily repeats every day", () => {
  const r = parseRRule("FREQ=DAILY")!;
  const got = occurrences(r, at("2026-07-20T09:00:00"), { limit: 3 });
  assert.deepEqual(list(got), ["2026-07-20", "2026-07-21", "2026-07-22"]);
});

test("interval skips periods", () => {
  const r = parseRRule("FREQ=DAILY;INTERVAL=3")!;
  const got = occurrences(r, at("2026-07-20T09:00:00"), { limit: 3 });
  assert.deepEqual(list(got), ["2026-07-20", "2026-07-23", "2026-07-26"]);
});

test("weekly on specific days", () => {
  // 2026-07-20 is a Monday.
  const r = parseRRule("FREQ=WEEKLY;BYDAY=MO,WE,FR")!;
  const got = occurrences(r, at("2026-07-20T09:00:00"), { limit: 4 });
  assert.deepEqual(list(got), ["2026-07-20", "2026-07-22", "2026-07-24", "2026-07-27"]);
});

test("fortnightly skips the intervening week", () => {
  const r = parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO")!;
  const got = occurrences(r, at("2026-07-20T09:00:00"), { limit: 3 });
  assert.deepEqual(list(got), ["2026-07-20", "2026-08-03", "2026-08-17"]);
});

test("weekly without BYDAY repeats on the start's own weekday", () => {
  const r = parseRRule("FREQ=WEEKLY")!;
  const got = occurrences(r, at("2026-07-22T09:00:00"), { limit: 2 }); // Wednesday
  assert.deepEqual(list(got), ["2026-07-22", "2026-07-29"]);
});

test("monthly keeps the day of month", () => {
  const r = parseRRule("FREQ=MONTHLY")!;
  const got = occurrences(r, at("2026-01-15T09:00:00"), { limit: 3 });
  assert.deepEqual(list(got), ["2026-01-15", "2026-02-15", "2026-03-15"]);
});

test("monthly SKIPS months without that day, rather than inventing one", () => {
  // The 31st: February and April have no 31st. Clamping to the 28th/30th would
  // silently move the task — RFC 5545 says skip.
  const r = parseRRule("FREQ=MONTHLY;BYMONTHDAY=31")!;
  const got = occurrences(r, at("2026-01-31T09:00:00"), { limit: 4 });
  assert.deepEqual(list(got), ["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31"]);
});

test("yearly repeats on the same date", () => {
  const r = parseRRule("FREQ=YEARLY")!;
  const got = occurrences(r, at("2026-03-09T09:00:00"), { limit: 3 });
  assert.deepEqual(list(got), ["2026-03-09", "2027-03-09", "2028-03-09"]);
});

test("29 Feb only recurs in leap years", () => {
  const r = parseRRule("FREQ=YEARLY")!;
  const got = occurrences(r, at("2024-02-29T09:00:00"), { limit: 3 });
  assert.deepEqual(list(got), ["2024-02-29", "2028-02-29", "2032-02-29"]);
});

test("time of day is preserved across occurrences", () => {
  const r = parseRRule("FREQ=DAILY")!;
  const got = occurrences(r, at("2026-07-20T14:30:00"), { limit: 2 });
  assert.equal(got[1].getHours(), 14);
  assert.equal(got[1].getMinutes(), 30);
});

// --- bounds ---------------------------------------------------------------

test("COUNT limits the series", () => {
  const r = parseRRule("FREQ=DAILY;COUNT=3")!;
  const got = occurrences(r, at("2026-07-20T09:00:00"), { limit: 99 });
  assert.equal(got.length, 3);
});

test("COUNT counts from the series start, not from `after`", () => {
  const r = parseRRule("FREQ=DAILY;COUNT=3")!;
  // Two have already passed, so only the third remains.
  const got = occurrences(r, at("2026-07-20T09:00:00"), { after: at("2026-07-21T23:00:00"), limit: 99 });
  assert.deepEqual(list(got), ["2026-07-22"]);
});

test("UNTIL ends the series", () => {
  const r = parseRRule("FREQ=DAILY;UNTIL=20260722T235959Z")!;
  const got = occurrences(r, at("2026-07-20T09:00:00"), { limit: 99 });
  assert.deepEqual(list(got), ["2026-07-20", "2026-07-21", "2026-07-22"]);
});

test("a range query is bounded on both ends", () => {
  const r = parseRRule("FREQ=DAILY")!;
  const got = occurrences(r, at("2026-07-01T09:00:00"), {
    after: at("2026-07-19T23:59:59"),
    until: at("2026-07-22T23:59:59"),
    limit: 99,
  });
  assert.deepEqual(list(got), ["2026-07-20", "2026-07-21", "2026-07-22"]);
});

test("expansion always terminates on a sparse rule", () => {
  const r = parseRRule("FREQ=YEARLY;INTERVAL=1;BYMONTH=2;BYMONTHDAY=30")!; // never occurs
  const got = occurrences(r, at("2026-01-01T09:00:00"), { limit: 5 });
  assert.deepEqual(got, [], "an impossible rule yields nothing, and returns");
});

// --- next-occurrence helpers ---------------------------------------------

test("nextOccurrence finds the following instance", () => {
  const r = parseRRule("FREQ=WEEKLY;BYDAY=MO")!;
  const next = nextOccurrence(r, at("2026-07-20T09:00:00"), at("2026-07-20T10:00:00"));
  assert.equal(fmt(next!), "2026-07-27");
});

test("nextOccurrence returns null once the series is exhausted", () => {
  const r = parseRRule("FREQ=DAILY;COUNT=2")!;
  assert.equal(nextOccurrence(r, at("2026-07-20T09:00:00"), at("2026-07-25T00:00:00")), null);
});

test("nextAfter on an unsupported rule is null, so callers treat it as one-off", () => {
  assert.equal(nextAfter("FREQ=HOURLY", at("2026-07-20T09:00:00"), at("2026-07-20T10:00:00")), null);
});

// --- description ----------------------------------------------------------

test("descriptions read like a person wrote them", () => {
  assert.equal(describeRRule("FREQ=DAILY"), "Every day");
  assert.equal(describeRRule("FREQ=DAILY;INTERVAL=2"), "Every 2 days");
  assert.equal(describeRRule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"), "Every weekday");
  assert.equal(describeRRule("FREQ=WEEKLY;BYDAY=MO,WE"), "Every week on Mon, Wed");
  assert.equal(describeRRule("FREQ=MONTHLY;BYMONTHDAY=15"), "Every month on day 15");
  assert.equal(describeRRule("FREQ=NONSENSE"), null);
});

// --- cross-boundary contract ---------------------------------------------

test("every rule the UI can produce is accepted by this parser", () => {
  // These strings are duplicated from Frontend/src/lib/recurrence.ts on
  // purpose: they cross a process boundary, and a preset the server rejects
  // would show "Every week" in the UI while never actually repeating. If the
  // picker gains an option, it belongs here too.
  const uiPresets = [
    "FREQ=DAILY",
    "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    "FREQ=WEEKLY;BYDAY=SU",
    "FREQ=WEEKLY;BYDAY=MO",
    "FREQ=WEEKLY;BYDAY=TU",
    "FREQ=WEEKLY;BYDAY=WE",
    "FREQ=WEEKLY;BYDAY=TH",
    "FREQ=WEEKLY;BYDAY=FR",
    "FREQ=WEEKLY;BYDAY=SA",
    "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
    "FREQ=MONTHLY",
    "FREQ=YEARLY",
  ];
  for (const raw of uiPresets) {
    assert.ok(parseRRule(raw), `server rejects a UI preset: ${raw}`);
    assert.ok(describeRRule(raw), `server can't describe a UI preset: ${raw}`);
  }
});

test("common third-party rules from real calendar feeds parse", () => {
  for (const raw of [
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR",   // Google weekly stand-up
    "FREQ=DAILY;COUNT=10",
    "FREQ=MONTHLY;BYMONTHDAY=1",
    "FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=25",
  ]) {
    assert.ok(parseRRule(raw), `should parse: ${raw}`);
  }
});

test("unknown parameters are refused rather than ignored", () => {
  // The failure that motivated this: TickTick's proprietary ERULE form parsed
  // cleanly as a plain weekly rule because the unrecognised part was skipped.
  // Half-understanding a rule puts tasks on days nobody chose.
  assert.equal(parseRRule("ERULE:NAME=CUSTOM;FREQ=WEEKLY"), null);
  assert.equal(parseRRule("FREQ=MONTHLY;BYSETPOS=-1;BYDAY=FR"), null);
  assert.equal(parseRRule("FREQ=YEARLY;BYWEEKNO=20"), null);
  assert.equal(parseRRule("FREQ=YEARLY;BYYEARDAY=100"), null);
  assert.equal(parseRRule("FREQ=DAILY;BYHOUR=9"), null);
});

test("WKST is accepted where it cannot change the result", () => {
  // Real feeds emit WKST constantly; refusing it outright would drop a large
  // share of ordinary rules to one-offs for no correctness gain.
  assert.ok(parseRRule("FREQ=WEEKLY;BYDAY=MO;WKST=MO"), "interval 1: week start is inert");
  assert.ok(parseRRule("FREQ=DAILY;WKST=MO"), "daily: no weeks being counted");
  assert.ok(parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;WKST=SU"), "matches our anchor");
});

test("WKST is refused where it WOULD change the result", () => {
  // Counting fortnights from Monday instead of Sunday shifts every occurrence.
  assert.equal(parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;WKST=MO"), null);
});

test("all supported parameters together still parse", () => {
  const r = parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10;WKST=SU");
  assert.ok(r);
  assert.equal(r.freq, "WEEKLY");
  assert.equal(r.interval, 2);
  assert.deepEqual(r.byDay, [1, 3]);
  assert.equal(r.count, 10);
});
