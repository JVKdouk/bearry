/**
 * Digest period identity.
 *
 * This key is the whole idempotency mechanism: a user gets one digest per
 * period because a successful send records the period and a repeat run sees it.
 * If two different days produced the same key, someone would silently stop
 * receiving digests; if one day produced two keys, they'd get duplicates. A
 * duplicate is the worse failure — it erodes trust in every email the app sends.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { periodKey } from "@/src/lib/digest/runner";

test("consecutive days produce different keys", () => {
  const a = periodKey("day", new Date("2026-07-19T07:00:00Z"));
  const b = periodKey("day", new Date("2026-07-20T07:00:00Z"));
  assert.notEqual(a, b);
});

test("the same day produces the same key whatever the hour", () => {
  // The schedule checks hourly, so every tick within a day must agree.
  const morning = periodKey("day", new Date("2026-07-19T07:00:00Z"));
  const evening = periodKey("day", new Date("2026-07-19T23:59:00Z"));
  assert.equal(morning, evening);
});

test("consecutive weeks produce different keys", () => {
  const a = periodKey("week", new Date("2026-07-05T18:00:00Z"));
  const b = periodKey("week", new Date("2026-07-12T18:00:00Z"));
  assert.notEqual(a, b);
});

test("the same week produces one key across its days", () => {
  const days = ["08", "09", "10", "11"].map((d) =>
    periodKey("week", new Date(`2026-07-${d}T18:00:00Z`)),
  );
  assert.equal(new Set(days).size, 1, `week keys disagreed: ${days.join(", ")}`);
});

test("daily and weekly keys never collide", () => {
  // They're stored under different setting keys, but a collision would still be
  // a sign the encoding is ambiguous.
  const d = periodKey("day", new Date("2026-07-19T07:00:00Z"));
  const w = periodKey("week", new Date("2026-07-19T07:00:00Z"));
  assert.notEqual(d, w);
});

test("keys are stable across a year boundary", () => {
  const dec = periodKey("day", new Date("2026-12-31T07:00:00Z"));
  const jan = periodKey("day", new Date("2027-01-01T07:00:00Z"));
  assert.notEqual(dec, jan);
  assert.ok(jan > dec, "keys should sort chronologically");
});

test("a year of daily keys is unique on every day", () => {
  const seen = new Set<string>();
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 365; i++) {
    seen.add(periodKey("day", new Date(start + i * 86_400_000)));
  }
  assert.equal(seen.size, 365, "some days shared a key — those digests would be skipped");
});

test("every day of a week maps to that week's single key", () => {
  // The bug this replaced: counting weeks from 1 January puts a boundary
  // mid-week, so two days of the same week landed in different buckets and the
  // user received a second weekly digest days after the first.
  for (const sunday of ["2026-07-05", "2026-11-01", "2027-01-03"]) {
    const keys = new Set<string>();
    const base = new Date(`${sunday}T12:00:00Z`).getTime();
    for (let i = 0; i < 7; i++) {
      keys.add(periodKey("week", new Date(base + i * 86_400_000)));
    }
    assert.equal(keys.size, 1, `week of ${sunday} split across ${[...keys].join(", ")}`);
  }
});

test("adjacent weeks are always distinct, including across a year end", () => {
  const base = new Date("2026-12-27T12:00:00Z").getTime(); // a Sunday
  const a = periodKey("week", new Date(base));
  const b = periodKey("week", new Date(base + 7 * 86_400_000));
  assert.notEqual(a, b);
});

test("a year of weekly keys yields exactly one key per week", () => {
  const seen = new Set<string>();
  const start = Date.UTC(2026, 0, 4); // a Sunday
  for (let i = 0; i < 364; i++) seen.add(periodKey("week", new Date(start + i * 86_400_000)));
  assert.equal(seen.size, 52);
});
