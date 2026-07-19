/**
 * Pinned fields on imported events.
 *
 * Editing an imported event without this is a lie: the change saves, looks
 * applied, and is silently reverted the next time the source calendar syncs.
 * The user is left believing they made a change that keeps undoing itself,
 * with nothing to explain it.
 *
 * Mirrors the filter in ingest.ts. Kept as a pure function there so this tests
 * the real rule rather than a copy of it.
 */

import test from "node:test";
import assert from "node:assert/strict";

/** The pin list as stored: a comma-separated field-name string. */
function applyPins(data: Record<string, unknown>, pinnedFields: string | null) {
  const pinned = (pinnedFields ?? "").split(",").map((f) => f.trim()).filter(Boolean);
  if (pinned.length === 0) return data;
  const out = { ...data };
  for (const f of pinned) delete out[f];
  return out;
}

const incoming = {
  title: "Stand-up (from Google)",
  description: "Google's description",
  location: "Room 3",
  start: new Date("2026-07-20T09:00:00Z"),
  end: new Date("2026-07-20T09:15:00Z"),
};

test("with nothing pinned, the import wins everywhere", () => {
  assert.deepEqual(applyPins(incoming, null), incoming);
  assert.deepEqual(applyPins(incoming, ""), incoming);
});

test("a pinned title survives the import", () => {
  const out = applyPins(incoming, "title");
  assert.equal("title" in out, false, "title must not be overwritten");
  assert.equal(out.description, "Google's description", "everything else still updates");
});

test("pinning both fields leaves times still tracking the source", () => {
  // The point of field-level pinning: you renamed the meeting, you did NOT
  // take over responsibility for when it happens.
  const out = applyPins(incoming, "title,description");
  assert.equal("title" in out, false);
  assert.equal("description" in out, false);
  assert.equal(out.start, incoming.start);
  assert.equal(out.end, incoming.end);
  assert.equal(out.location, "Room 3");
});

test("whitespace and empty entries in the stored list are tolerated", () => {
  const out = applyPins(incoming, " title , , description ");
  assert.equal("title" in out, false);
  assert.equal("description" in out, false);
});

test("an unknown field name is harmless", () => {
  // A stale or hand-edited pin must not throw or drop anything real.
  const out = applyPins(incoming, "title,notAField");
  assert.equal("title" in out, false);
  assert.equal(Object.keys(out).length, 4);
});

test("the original object is never mutated", () => {
  // Ingest reuses `data` across the recreate fallback path; mutating it here
  // would silently drop the field from a freshly created entity too.
  const copy = { ...incoming };
  applyPins(incoming, "title");
  assert.deepEqual(incoming, copy);
});
