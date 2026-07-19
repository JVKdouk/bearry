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
const list = (ds: Date[]) => ds.map((d) => fmt(d));

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
    "FREQ=MONTHLY;BYDAY=5FR",   // a 5th weekday most months don't have
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

// --- positional weekdays ("the second Tuesday") ----------------------------

test("monthly on the second Tuesday lands on the right dates", () => {
  const r = parseRRule("FREQ=MONTHLY;BYDAY=2TU");
  assert.ok(r);
  assert.deepEqual(r.byDayPos, { nth: 2, day: 2 });
  // Second Tuesdays: 14 Jul 2026, 11 Aug, 8 Sep, 13 Oct.
  const got = occurrences(r, new Date(2026, 6, 14, 9, 0), { limit: 4, after: new Date(2026, 6, 1) });
  assert.deepEqual(
    got.map((d) => fmt(d)),
    ["2026-07-14", "2026-08-11", "2026-09-08", "2026-10-13"],
  );
});

test("monthly on the first Monday", () => {
  const r = parseRRule("FREQ=MONTHLY;BYDAY=1MO")!;
  const got = occurrences(r, new Date(2026, 0, 5, 9, 0), { limit: 3, after: new Date(2026, 0, 1) });
  assert.deepEqual(got.map((d) => fmt(d)), ["2026-01-05", "2026-02-02", "2026-03-02"]);
});

test("monthly on the LAST Friday counts back from the month's end", () => {
  const r = parseRRule("FREQ=MONTHLY;BYDAY=-1FR")!;
  assert.deepEqual(r.byDayPos, { nth: -1, day: 5 });
  // Last Fridays: 31 Jul 2026, 28 Aug, 25 Sep.
  const got = occurrences(r, new Date(2026, 6, 31, 9, 0), { limit: 3, after: new Date(2026, 6, 1) });
  assert.deepEqual(got.map((d) => fmt(d)), ["2026-07-31", "2026-08-28", "2026-09-25"]);
});

test("the last weekday is found whether the month has four or five of them", () => {
  // The bug a naive "day 22 + offset" implementation produces.
  const r = parseRRule("FREQ=MONTHLY;BYDAY=-1SU")!;
  const got = occurrences(r, new Date(2026, 0, 25, 9, 0), { limit: 4, after: new Date(2026, 0, 1) });
  for (const d of got) {
    assert.equal(d.getDay(), 0, `${fmt(d)} is not a Sunday`);
    // Adding a week must leave the month — that's what makes it the last one.
    const next = new Date(d.getTime() + 7 * 86_400_000);
    assert.notEqual(next.getMonth(), d.getMonth(), `${fmt(d)} is not the LAST Sunday`);
  }
});

test("a month without a 4th of that weekday is skipped, never invented", () => {
  // February 2026 starts on a Sunday, so it has exactly four Sundays and no
  // fifth. Asking for a 4th is fine; the point is that nothing is fabricated.
  const r = parseRRule("FREQ=MONTHLY;BYDAY=4SA")!;
  const got = occurrences(r, new Date(2026, 0, 24, 9, 0), { limit: 6, after: new Date(2026, 0, 1) });
  for (const d of got) {
    assert.equal(d.getDay(), 6, `${fmt(d)} is not a Saturday`);
    assert.ok(d.getDate() >= 22 && d.getDate() <= 28, `${fmt(d)} isn't the 4th Saturday`);
  }
});

test("yearly on the second Sunday of a named month", () => {
  const r = parseRRule("FREQ=YEARLY;BYMONTH=5;BYDAY=2SU")!;
  const got = occurrences(r, new Date(2026, 4, 10, 9, 0), { limit: 3, after: new Date(2026, 0, 1) });
  assert.deepEqual(got.map((d) => fmt(d)), ["2026-05-10", "2027-05-09", "2028-05-14"]);
  for (const d of got) assert.equal(d.getDay(), 0);
});

test("an interval applies to positional rules too", () => {
  const r = parseRRule("FREQ=MONTHLY;INTERVAL=3;BYDAY=1WE")!;
  const got = occurrences(r, new Date(2026, 0, 7, 9, 0), { limit: 3, after: new Date(2026, 0, 1) });
  assert.deepEqual(got.map((d) => fmt(d)), ["2026-01-07", "2026-04-01", "2026-07-01"]);
});

test("positional rules keep the start's time of day", () => {
  const r = parseRRule("FREQ=MONTHLY;BYDAY=2TU")!;
  const got = occurrences(r, new Date(2026, 6, 14, 14, 30), { limit: 2, after: new Date(2026, 6, 1) });
  for (const d of got) {
    assert.equal(d.getHours(), 14);
    assert.equal(d.getMinutes(), 30);
  }
});

test("positional forms are refused where they'd be meaningless or ambiguous", () => {
  assert.equal(parseRRule("FREQ=WEEKLY;BYDAY=2TU"), null, "weekly + positional is nonsense");
  assert.equal(parseRRule("FREQ=DAILY;BYDAY=2TU"), null);
  assert.equal(
    parseRRule("FREQ=MONTHLY;BYDAY=2TU;BYMONTHDAY=14"),
    null,
    "two different answers to the same question",
  );
  assert.equal(parseRRule("FREQ=MONTHLY;BYDAY=1MO,2TU"), null, "a list of positionals");
  assert.equal(parseRRule("FREQ=MONTHLY;BYDAY=5MO"), null, "a 5th mostly doesn't exist");
  assert.equal(parseRRule("FREQ=MONTHLY;BYDAY=-2FR"), null, "only the LAST is supported");
  assert.equal(parseRRule("FREQ=MONTHLY;BYDAY=0MO"), null);
  assert.equal(parseRRule("FREQ=MONTHLY;BYDAY=2XX"), null, "not a weekday");
});

test("positional rules round-trip through format and parse", () => {
  for (const raw of [
    "FREQ=MONTHLY;BYDAY=2TU",
    "FREQ=MONTHLY;BYDAY=-1FR",
    "FREQ=YEARLY;BYMONTH=5;BYDAY=2SU",
    "FREQ=MONTHLY;INTERVAL=2;BYDAY=3WE",
  ]) {
    const parsed = parseRRule(raw)!;
    assert.ok(parsed, raw);
    const reparsed = parseRRule(formatRRule(parsed));
    assert.deepEqual(reparsed, parsed, `${raw} did not round-trip`);
  }
});

test("positional rules describe themselves the way people say them", () => {
  assert.equal(describeRRule("FREQ=MONTHLY;BYDAY=2TU"), "Every month on the second Tuesday");
  assert.equal(describeRRule("FREQ=MONTHLY;BYDAY=-1FR"), "Every month on the last Friday");
  assert.equal(
    describeRRule("FREQ=YEARLY;BYMONTH=5;BYDAY=2SU"),
    "Every year on the second Sunday of May",
  );
});

test("a yearly rule on a fixed date describes its month and day", () => {
  assert.equal(describeRRule("FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=24"), "Every year on January 24");
});
