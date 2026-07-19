/**
 * Expansion is what turns one stored row into the blocks you actually see, so
 * its edges are the ones that produce "my stand-up vanished" reports: an event
 * that starts before the window but runs into it, the boundary instances, and
 * the identity of a generated occurrence versus the row it came from.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { expandRange, isOccurrenceKey, masterIdOf } from "../src/lib/recurrence";

type Row = { id: string; recurrenceRule?: string | null; start: string; end: string };

const bounds = (r: Row) => ({ start: new Date(r.start), end: new Date(r.end) });

function row(over: Partial<Row> = {}): Row {
  return {
    id: "e1",
    start: "2026-07-06T09:00:00.000Z", // a Monday
    end: "2026-07-06T09:30:00.000Z",
    ...over,
  };
}

test("a non-repeating row inside the window renders exactly once", () => {
  const out = expandRange([row()], new Date("2026-07-01"), new Date("2026-07-31"), bounds);
  assert.equal(out.length, 1);
  assert.equal(out[0].isRepeat, false);
  assert.equal(out[0].key, "e1", "the single instance keeps the row's own id");
});

test("a non-repeating row outside the window is dropped", () => {
  const out = expandRange([row()], new Date("2026-08-01"), new Date("2026-08-31"), bounds);
  assert.deepEqual(out, []);
});

test("a weekly rule fills the window", () => {
  const r = row({ recurrenceRule: "FREQ=WEEKLY;BYDAY=MO" });
  const out = expandRange([r], new Date("2026-07-01"), new Date("2026-07-31T23:59:59Z"), bounds);
  const days = out.map((o) => o.start.toISOString().slice(0, 10));
  assert.deepEqual(days, ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"]);
});

test("every occurrence keeps the stored row's duration", () => {
  const r = row({ end: "2026-07-06T10:45:00.000Z", recurrenceRule: "FREQ=WEEKLY;BYDAY=MO" });
  const out = expandRange([r], new Date("2026-07-01"), new Date("2026-07-31T23:59:59Z"), bounds);
  for (const o of out) {
    assert.equal(o.end.getTime() - o.start.getTime(), 105 * 60_000);
  }
});

test("only the first instance is the stored row; the rest are marked as repeats", () => {
  const r = row({ recurrenceRule: "FREQ=WEEKLY;BYDAY=MO" });
  const out = expandRange([r], new Date("2026-07-01"), new Date("2026-07-31T23:59:59Z"), bounds);
  assert.equal(out[0].isRepeat, false);
  assert.ok(out.slice(1).every((o) => o.isRepeat));
  assert.ok(out.every((o) => o.masterId === "e1"));
});

test("occurrence keys are unique and resolve back to the stored row", () => {
  const r = row({ recurrenceRule: "FREQ=DAILY" });
  const out = expandRange([r], new Date("2026-07-06"), new Date("2026-07-12T23:59:59Z"), bounds);
  const keys = out.map((o) => o.key);
  assert.equal(new Set(keys).size, keys.length, "keys collide — React would drop blocks");
  for (const k of keys) assert.equal(masterIdOf(k), "e1");
  assert.equal(isOccurrenceKey(out[0].key), false);
  assert.ok(isOccurrenceKey(out[1].key));
});

test("an occurrence that STARTS before the window but runs into it is kept", () => {
  // The event you'd otherwise lose: it began yesterday and is still running
  // when the window opens. Walking only forward from `from` would miss it.
  const r = row({
    start: "2026-07-06T22:00:00.000Z",
    end: "2026-07-07T03:00:00.000Z",
    recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
  });
  const out = expandRange(
    [r],
    new Date("2026-07-07T00:00:00Z"),
    new Date("2026-07-07T23:59:59Z"),
    bounds,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].start.toISOString(), "2026-07-06T22:00:00.000Z");
});

test("a rule the engine refuses to parse renders once, never guessed at", () => {
  // Wrong dates are worse than no repeat: this must degrade to the stored row.
  const r = row({ recurrenceRule: "FREQ=WEEKLY;BYDAY=2FR" });
  const out = expandRange([r], new Date("2026-07-01"), new Date("2026-07-31"), bounds);
  assert.equal(out.length, 1);
  assert.equal(out[0].isRepeat, false);
});

test("UNTIL ends the series inside the window", () => {
  const r = row({ recurrenceRule: "FREQ=WEEKLY;BYDAY=MO;UNTIL=20260714T000000Z" });
  const out = expandRange([r], new Date("2026-07-01"), new Date("2026-07-31T23:59:59Z"), bounds);
  assert.deepEqual(
    out.map((o) => o.start.toISOString().slice(0, 10)),
    ["2026-07-06", "2026-07-13"],
  );
});

test("COUNT is honoured across the window", () => {
  const r = row({ recurrenceRule: "FREQ=DAILY;COUNT=3" });
  const out = expandRange([r], new Date("2026-07-01"), new Date("2026-07-31"), bounds);
  assert.equal(out.length, 3);
});

test("rows with unparseable dates are skipped rather than rendered as Invalid Date", () => {
  const r = row({ start: "not-a-date", end: "also-not" });
  const out = expandRange([r], new Date("2026-07-01"), new Date("2026-07-31"), bounds);
  assert.deepEqual(out, []);
});

test("a bounds function returning null skips the row", () => {
  const out = expandRange([row()], new Date("2026-07-01"), new Date("2026-07-31"), () => null);
  assert.deepEqual(out, []);
});

test("a daily rule over a month view stays bounded", () => {
  const r = row({ recurrenceRule: "FREQ=DAILY" });
  const out = expandRange([r], new Date("2026-07-01"), new Date("2026-07-31T23:59:59Z"), bounds);
  assert.equal(out.length, 26, "6 Jul through 31 Jul inclusive");
});
