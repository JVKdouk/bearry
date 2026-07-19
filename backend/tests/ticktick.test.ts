/**
 * TickTick import: notes must not become to-dos.
 *
 * TickTick serves notes and tasks from the same endpoint, distinguished only by
 * a `kind` flag. Treating everything as a task didn't just clutter the list — it
 * made reference material *schedulable*, so the planner started booking focus
 * time to "do" a note.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { validateBlocks } from "@/src/lib/integrations/schema/blocks";

/** Mirrors the mapping in providers/ticktick.ts. */
function mapItems(
  project: { id: string; kind?: string },
  items: { id: string; title?: string; content?: string; kind?: string; status?: number }[],
) {
  const blocks: Record<string, unknown>[] = [];
  const projectIsNotes = (project.kind ?? "").toUpperCase() === "NOTE";
  for (const t of items) {
    const title = (t.title ?? "").trim();
    const body = (t.content ?? "").slice(0, 10_000);
    if (!title && !body) continue;
    const isNote = projectIsNotes || (t.kind ?? "").toUpperCase() === "NOTE";
    if (isNote) {
      blocks.push({ type: "note", sourceId: t.id, title: title || "(untitled note)", body: body || title });
      continue;
    }
    if (!title) continue;
    blocks.push({ type: "task", sourceId: t.id, title, status: t.status === 2 ? "done" : "todo" });
  }
  return blocks;
}

test("an item flagged NOTE becomes a note, not a task", () => {
  const blocks = mapItems({ id: "p1" }, [
    { id: "a", title: "Buy milk", kind: "TEXT" },
    { id: "b", title: "Meeting notes", content: "Ana said…", kind: "NOTE" },
  ]);
  assert.equal(blocks[0].type, "task");
  assert.equal(blocks[1].type, "note");
});

test("every item in a NOTE project becomes a note", () => {
  const blocks = mapItems({ id: "p2", kind: "NOTE" }, [
    { id: "a", title: "Reference one" },
    { id: "b", title: "Reference two" },
  ]);
  assert.ok(blocks.every((b) => b.type === "note"), JSON.stringify(blocks));
});

test("a normal project still yields tasks", () => {
  const blocks = mapItems({ id: "p3", kind: "TASK" }, [{ id: "a", title: "Pay rent" }]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "task");
});

test("a note with no title still imports, using a placeholder", () => {
  const blocks = mapItems({ id: "p4", kind: "NOTE" }, [{ id: "a", content: "just body text" }]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].title, "(untitled note)");
  assert.equal(blocks[0].body, "just body text");
});

test("a titleless task is dropped rather than imported blank", () => {
  const blocks = mapItems({ id: "p5" }, [{ id: "a", content: "orphan body", kind: "TEXT" }]);
  // No title and it isn't a note — there's nothing actionable to create.
  assert.equal(blocks.filter((b) => b.type === "task").length, 0);
});

test("the emitted blocks pass the platform's schema validation", () => {
  const blocks = mapItems({ id: "p6" }, [
    { id: "a", title: "Do the thing", kind: "TEXT" },
    { id: "b", title: "A note", content: "body", kind: "NOTE" },
  ]);
  const { valid, errors } = validateBlocks(blocks);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(valid.length, 2);
});
