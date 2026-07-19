/**
 * The gate that decides whether completing a task rolls its recurrence forward.
 *
 * This exists because the real bug was invisible: the sync entity was renamed
 * from "todo" to "block", the dispatch comparison was left as "todo", and every
 * recurring task silently stopped advancing on completion. No test touched the
 * DB path, so nothing failed. Pinning the gate as a pure predicate makes that
 * exact regression cost a red test rather than a silent outage.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { shouldAdvanceRecurrence } from "@/src/lib/sync/engine";

test("a block marked done advances", () => {
  assert.equal(shouldAdvanceRecurrence("block", "done"), true);
});

test("the retired entity names never advance", () => {
  // The precise shape of the bug: "todo" used to be the entity, and the check
  // was never updated.
  assert.equal(shouldAdvanceRecurrence("todo", "done"), false);
  assert.equal(shouldAdvanceRecurrence("calendarEvent", "done"), false);
  assert.equal(shouldAdvanceRecurrence("note", "done"), false);
});

test("only completion advances", () => {
  assert.equal(shouldAdvanceRecurrence("block", "todo"), false);
  assert.equal(shouldAdvanceRecurrence("block", "in_progress"), false);
  assert.equal(shouldAdvanceRecurrence("block", undefined), false);
});

test("other entities marked done do not advance", () => {
  // A project or a setting has no recurrence to advance.
  assert.equal(shouldAdvanceRecurrence("project", "done"), false);
  assert.equal(shouldAdvanceRecurrence("reminder", "done"), false);
});
