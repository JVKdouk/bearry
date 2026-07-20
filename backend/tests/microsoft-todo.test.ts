/** Mapping a Microsoft To Do task to a Bearry task block. */
import test from "node:test";
import assert from "node:assert/strict";
import { toTaskBlock } from "@/src/lib/integrations/providers/microsoftTodo";

test("maps title, notes and completed status", () => {
  const b = toTaskBlock({ id: "1", title: "  Pay invoice ", status: "completed", body: { content: "ref 42" } });
  assert.equal(b?.sourceId, "1");
  assert.equal(b?.title, "Pay invoice");
  assert.equal(b?.notes, "ref 42");
  assert.equal(b?.status, "done");
});

test("open task maps to todo", () => {
  assert.equal(toTaskBlock({ id: "2", title: "x", status: "notStarted" })?.status, "todo");
});

test("a due date becomes an end-of-day, timezone-proof deadline", () => {
  const b = toTaskBlock({ id: "3", title: "x", dueDateTime: { dateTime: "2026-07-24T00:00:00.0000000", timeZone: "UTC" } });
  // The :59.999 fingerprint is what the scheduler reads as a due-by date.
  assert.equal(b?.due, "2026-07-24T23:59:59.999Z");
});

test("an untitled task is skipped", () => {
  assert.equal(toTaskBlock({ id: "4", title: "   " }), null);
  assert.equal(toTaskBlock({ id: "", title: "x" }), null);
});
