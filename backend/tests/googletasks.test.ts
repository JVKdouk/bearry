/**
 * Google Tasks import mapping.
 *
 * The interesting cases are the ones where Google's model and ours disagree:
 * its `due` is a *date*, not a moment; subtasks are separate rows with a parent
 * pointer; and deleted/untitled rows come back in the list rather than being
 * filtered server-side.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { validateBlocks } from "@/src/lib/integrations/schema/blocks";
import { toTaskBlock } from "@/src/lib/integrations/providers/googleTasks";

test("an ordinary task maps across", () => {
  const b = toTaskBlock({ id: "t1", title: "Pay rent", notes: "before the 5th" });
  assert.equal(b?.type, "task");
  assert.equal(b?.title, "Pay rent");
  assert.equal(b?.notes, "before the 5th");
  assert.equal(b?.status, "todo");
});

test("a completed task keeps its status", () => {
  assert.equal(toTaskBlock({ id: "t2", title: "Done thing", status: "completed" })?.status, "done");
  assert.equal(toTaskBlock({ id: "t3", title: "Open", status: "needsAction" })?.status, "todo");
});

test("a deleted task is skipped", () => {
  assert.equal(toTaskBlock({ id: "t4", title: "Gone", deleted: true }), null);
});

test("an untitled task is skipped rather than imported blank", () => {
  assert.equal(toTaskBlock({ id: "t5", title: "   " }), null);
  assert.equal(toTaskBlock({ id: "t6" }), null);
});

test("a subtask is skipped rather than flattened to top level", () => {
  // Importing it as its own task would silently double the list and lose the
  // relationship it had. Better absent than wrong.
  assert.equal(toTaskBlock({ id: "t7", title: "Step one", parent: "t1" }), null);
});

test("a due date becomes the END of that day, not midnight", () => {
  // Google's `due` means "this day". Taking it literally would present every
  // imported task as due at 00:00 — a deadline the user never set, and one
  // that reads as already overdue for the whole day it's actually due.
  const b = toTaskBlock({ id: "t8", title: "Report", due: "2026-07-20T00:00:00.000Z" });
  assert.ok(b?.due);
  const d = new Date(b.due);
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 6);
  assert.equal(d.getUTCDate(), 20);
  assert.equal(d.getUTCHours(), 23);
});

test("a task with no due date has none", () => {
  assert.equal(toTaskBlock({ id: "t9", title: "Someday" })?.due, undefined);
});

test("an unparseable due date is dropped, not passed through", () => {
  // A bad date must not become an Invalid Date that fails schema validation
  // downstream and takes the whole import with it.
  const b = toTaskBlock({ id: "t10", title: "Odd", due: "not-a-date" });
  assert.equal(b?.due, undefined);
});

test("oversized fields are truncated to the block contract's limits", () => {
  const b = toTaskBlock({ id: "t11", title: "x".repeat(5000), notes: "y".repeat(50_000) });
  assert.equal(b?.title.length, 1000);
  assert.equal(b?.notes?.length, 10_000);
});

test("mapped blocks pass the platform's schema validation", () => {
  const blocks = [
    toTaskBlock({ id: "a", title: "One", due: "2026-07-20T00:00:00.000Z" }),
    toTaskBlock({ id: "b", title: "Two", notes: "n", status: "completed" }),
  ].filter(Boolean);
  const { valid, errors } = validateBlocks(blocks as unknown[]);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(valid.length, 2);
});
