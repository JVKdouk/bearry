/**
 * TickTick import: notes must not become to-dos, and repeats must not be guessed.
 *
 * TickTick serves notes and tasks from the same endpoint, distinguished only by
 * a `kind` flag. Treating everything as a task didn't just clutter the list — it
 * made reference material *schedulable*, so the planner started booking focus
 * time to "do" a note.
 *
 * These call the provider's own mapping. An earlier version of this file kept a
 * local copy of it, which meant the tests could pass while the real importer was
 * broken — the one thing a test must never do.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { validateBlocks } from "@/src/lib/integrations/schema/blocks";
import { mapProjectItems } from "@/src/lib/integrations/providers/ticktick";

type Block = Record<string, unknown>;
const map = (project: Parameters<typeof mapProjectItems>[0], items: Parameters<typeof mapProjectItems>[1]) =>
  mapProjectItems(project, items) as Block[];

test("an item flagged NOTE becomes a note, not a task", () => {
  const blocks = map({ id: "p1" }, [
    { id: "a", title: "Buy milk", kind: "TEXT" },
    { id: "b", title: "Meeting notes", content: "Ana said…", kind: "NOTE" },
  ]);
  assert.equal(blocks[0].type, "task");
  assert.equal(blocks[1].type, "note");
});

test("every item in a NOTE project becomes a note", () => {
  const blocks = map({ id: "p2", kind: "NOTE" }, [
    { id: "a", title: "Reference one" },
    { id: "b", title: "Reference two" },
  ]);
  assert.ok(blocks.every((b) => b.type === "note"), JSON.stringify(blocks));
});

test("a normal project still yields tasks", () => {
  const blocks = map({ id: "p3", kind: "TASK" }, [{ id: "a", title: "Pay rent" }]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "task");
});

test("a note with no title still imports, using a placeholder", () => {
  const blocks = map({ id: "p4", kind: "NOTE" }, [{ id: "a", content: "just body text" }]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].title, "(untitled note)");
  assert.equal(blocks[0].body, "just body text");
});

test("a titleless task is dropped rather than imported blank", () => {
  const blocks = map({ id: "p5" }, [{ id: "a", content: "orphan body", kind: "TEXT" }]);
  assert.equal(blocks.filter((b) => b.type === "task").length, 0);
});

test("a supported repeatFlag is carried through, without its RRULE: prefix", () => {
  const blocks = map({ id: "p7" }, [
    { id: "a", title: "Stand-up", repeatFlag: "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO" },
  ]);
  assert.equal(blocks[0].recurrenceRule, "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO");
});

test("TickTick's proprietary repeat forms are dropped, not half-understood", () => {
  // ERULE and lunar rules look RRULE-shaped but don't mean the same thing.
  // Importing one as a repeat would put the task on dates nobody chose; a task
  // that fails to repeat is merely noticeable.
  for (const flag of [
    "ERULE:NAME=CUSTOM;FREQ=WEEKLY",
    "RRULE:FREQ=WEEKLY;BYDAY=2FR",
    "RRULE:FREQ=HOURLY",
    "garbage",
  ]) {
    const blocks = map({ id: "p8" }, [{ id: "a", title: "T", repeatFlag: flag }]);
    assert.equal(blocks[0].recurrenceRule, undefined, `should have dropped: ${flag}`);
  }
});

test("a task with no repeatFlag has no rule at all", () => {
  const blocks = map({ id: "p9" }, [{ id: "a", title: "One-off" }]);
  assert.equal(blocks[0].recurrenceRule, undefined);
});

test("done status maps from TickTick's numeric code", () => {
  const blocks = map({ id: "p10" }, [
    { id: "a", title: "Finished", status: 2 },
    { id: "b", title: "Open", status: 0 },
  ]);
  assert.equal(blocks[0].status, "done");
  assert.equal(blocks[1].status, "todo");
});

test("the emitted blocks pass the platform's schema validation", () => {
  const blocks = map({ id: "p6" }, [
    { id: "a", title: "Do the thing", kind: "TEXT" },
    { id: "b", title: "A note", content: "body", kind: "NOTE" },
    { id: "c", title: "Repeating", repeatFlag: "RRULE:FREQ=DAILY" },
  ]);
  const { valid, errors } = validateBlocks(blocks);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(valid.length, 3);
});
