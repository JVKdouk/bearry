import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_CHUNK_MINUTES, chunkingLabel, isChunkable } from "../src/lib/chunking";

test("the threshold matches the planner's", () => {
  // Pinned literally on both sides. If these ever disagree the drawer promises
  // one thing and the scheduler does another, which is invisible until someone
  // wonders why their five-hour task didn't split.
  assert.equal(AUTO_CHUNK_MINUTES, 300);
});

test("undecided splits at five hours and above", () => {
  assert.equal(isChunkable(null, 299), false);
  assert.equal(isChunkable(null, 300), true);
  assert.equal(isChunkable(null, 900), true);
});

test("undefined is treated as undecided", () => {
  assert.equal(isChunkable(undefined, 900), true);
  assert.equal(isChunkable(undefined, 30), false);
});

test("an explicit choice wins in both directions", () => {
  assert.equal(isChunkable(false, 900), false);
  assert.equal(isChunkable(true, 15), true);
});

test("the label explains itself only when nobody has chosen", () => {
  // "Split: on" beside a switch the user never touched invites the question of
  // who turned it on, so the undecided copy answers it.
  assert.match(chunkingLabel(null, 900), /long enough/);
  assert.match(chunkingLabel(null, 30), /short enough/);
  assert.equal(chunkingLabel(true, 30), "Split across sittings");
  assert.equal(chunkingLabel(false, 900), "Kept in one sitting");
});

test("the label always agrees with the rule", () => {
  for (const choice of [null, undefined, true, false] as const) {
    for (const minutes of [15, 299, 300, 900]) {
      const on = isChunkable(choice, minutes);
      const label = chunkingLabel(choice, minutes);
      assert.equal(
        label.startsWith("Split"),
        on,
        `label "${label}" contradicts isChunkable(${choice}, ${minutes})`,
      );
    }
  }
});

test("zero and missing durations don't split", () => {
  // A task with no estimate shouldn't be quietly fragmented.
  assert.equal(isChunkable(null, 0), false);
});
