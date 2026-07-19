import { test } from "node:test";
import assert from "node:assert/strict";
import { allComplete, bulkSummary, planBulk } from "../src/lib/bulk";
import type { Block } from "../src/lib/types";

type Row = Pick<Block, "id" | "status" | "priority" | "projectId">;
const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  status: "todo",
  priority: "medium",
  projectId: null,
  ...over,
});

test("delete removes everything selected", () => {
  const plan = planBulk([row("a"), row("b")], { type: "delete" });
  assert.deepEqual(plan.removals, ["a", "b"]);
  assert.deepEqual(plan.patches, []);
});

test("complete skips tasks already done", () => {
  // Re-writing a done task to done is a pointless synced write and version bump.
  const plan = planBulk([row("a"), row("b", { status: "done" })], { type: "complete" });
  assert.deepEqual(plan.patches.map((p) => p.id), ["a"]);
  assert.deepEqual(plan.patches[0].patch, { status: "done" });
});

test("reopen only touches done tasks", () => {
  const plan = planBulk([row("a", { status: "done" }), row("b")], { type: "reopen" });
  assert.deepEqual(plan.patches.map((p) => p.id), ["a"]);
  assert.deepEqual(plan.patches[0].patch, { status: "todo" });
});

test("priority skips tasks already at that priority", () => {
  const plan = planBulk(
    [row("a", { priority: "high" }), row("b", { priority: "low" })],
    { type: "priority", priority: "high" },
  );
  assert.deepEqual(plan.patches.map((p) => p.id), ["b"]);
});

test("move normalises the no-project case", () => {
  // A listless task "moved to No list" is a no-op; a task already in the target
  // list is too.
  const plan = planBulk(
    [row("a", { projectId: null }), row("b", { projectId: "x" }), row("c", { projectId: "y" })],
    { type: "move", projectId: "x" },
  );
  assert.deepEqual(plan.patches.map((p) => p.id), ["a", "c"]);
  assert.equal(plan.patches[0].patch.projectId, "x");
});

test("moving to No list skips tasks that have no list", () => {
  const plan = planBulk(
    [row("a", { projectId: null }), row("b", { projectId: "x" })],
    { type: "move", projectId: null },
  );
  assert.deepEqual(plan.patches.map((p) => p.id), ["b"]);
  assert.equal(plan.patches[0].patch.projectId, null);
});

test("an action that changes nothing produces an empty plan", () => {
  const plan = planBulk([row("a", { status: "done" })], { type: "complete" });
  assert.deepEqual(plan.patches, []);
  assert.deepEqual(plan.removals, []);
});

test("allComplete reflects the selection", () => {
  assert.equal(allComplete([row("a", { status: "done" }), row("b", { status: "done" })]), true);
  assert.equal(allComplete([row("a", { status: "done" }), row("b")]), false);
  assert.equal(allComplete([]), false, "an empty selection is not 'all complete'");
});

test("summaries read in the past tense with a count", () => {
  assert.equal(bulkSummary({ type: "complete" }, 3), "Completed 3 tasks");
  assert.equal(bulkSummary({ type: "delete" }, 1), "Deleted 1 task");
  assert.equal(bulkSummary({ type: "priority", priority: "high" }, 2), "Set 2 tasks to high");
  assert.equal(bulkSummary({ type: "move", projectId: "x" }, 4), "Moved 4 tasks");
  assert.equal(bulkSummary({ type: "move", projectId: null }, 4), "Moved 4 tasks to No list");
});
