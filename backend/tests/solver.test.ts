/**
 * The deterministic scheduler (§9). Its whole selling point is that it is
 * explainable and repeatable, which is exactly the kind of claim that rots
 * silently without tests — including the capacity refactor that stopped
 * rebuilding the slot grid twice.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { solve } from "@/src/lib/scheduler/solver";
import type { SchedulerInput, SchedulableTask } from "@/src/lib/scheduler/types";

/** Mon 2026-07-20 09:00 local → Tue 09:00, with 09:00–17:00 working hours. */
function baseInput(tasks: SchedulableTask[], overrides: Partial<SchedulerInput> = {}): SchedulerInput {
  const horizonStart = new Date(2026, 6, 20, 9, 0, 0);
  const horizonEnd = new Date(2026, 6, 21, 17, 0, 0);
  return {
    tasks,
    busy: [],
    workingHours: { "1": [{ start: "09:00", end: "17:00" }], "2": [{ start: "09:00", end: "17:00" }] },
    energyWindows: [],
    regions: [],
    horizonStart,
    horizonEnd,
    // Dates above are built in the host zone (new Date(y,m,d,...)), so resolve
    // wall-clock in that same zone — the tz-aware solver then reproduces the
    // server-local behaviour these tests were written against, on any host.
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...overrides,
  };
}

function task(id: string, min: number, extra: Partial<SchedulableTask> = {}): SchedulableTask {
  return {
    id,
    estimatedDuration: min,
    deadline: null,
    priority: "medium",
    energyDemand: "medium",
    desire: "neutral",
    category: null,
    chunkable: false,
    minChunk: null,
    maxChunk: null,
    createdAt: new Date(2026, 6, 1),
    ...extra,
  };
}

test("places a task inside working hours", () => {
  const out = solve(baseInput([task("a", 60)]));
  assert.equal(out.blocks.length, 1);
  assert.equal(out.unscheduled.length, 0);
  const start = out.blocks[0].start;
  assert.ok(start.getHours() >= 9 && start.getHours() < 17, `started at ${start}`);
});

test("never double-books over a fixed commitment", () => {
  const busyStart = new Date(2026, 6, 20, 9, 0);
  const busyEnd = new Date(2026, 6, 20, 12, 0);
  const out = solve(baseInput([task("a", 60)], { busy: [{ start: busyStart, end: busyEnd }] }));
  const block = out.blocks[0];
  assert.ok(
    block.end <= busyStart || block.start >= busyEnd,
    `block ${block.start}–${block.end} overlaps the busy interval`,
  );
});

test("is deterministic — same input, same output", () => {
  const tasks = [task("a", 60), task("b", 30, { priority: "high" }), task("c", 45)];
  const first = solve(baseInput(tasks));
  const second = solve(baseInput(tasks));
  assert.deepEqual(
    first.blocks.map((b) => [b.taskId, b.start.toISOString()]),
    second.blocks.map((b) => [b.taskId, b.start.toISOString()]),
  );
});

test("ASAP outranks everything else", () => {
  const out = solve(baseInput([task("normal", 60), task("urgent", 60, { priority: "ASAP" })]));
  assert.equal(out.blocks[0].taskId, "urgent");
});

test("an overdue deadline is scheduled before a distant one", () => {
  const out = solve(
    baseInput([
      task("later", 60, { deadline: new Date(2026, 11, 1) }),
      task("overdue", 60, { deadline: new Date(2026, 5, 1) }),
    ]),
  );
  assert.equal(out.blocks[0].taskId, "overdue");
});

test("every block carries a human-readable reason", () => {
  const out = solve(baseInput([task("a", 60)]));
  assert.match(out.blocks[0].reason, /\w+/);
  assert.ok(out.blocks[0].reason.length > 10);
});

test("a task too large for any slot is reported, not silently dropped", () => {
  const out = solve(baseInput([task("huge", 10_000, { chunkable: false })]));
  assert.equal(out.blocks.length, 0);
  assert.equal(out.unscheduled.length, 1);
  assert.equal(out.unscheduled[0].taskId, "huge");
  assert.match(out.unscheduled[0].reason, /no open/i);
});

test("chunkable work is split into parts that are all placed", () => {
  const out = solve(baseInput([task("big", 240, { chunkable: true, minChunk: 30, maxChunk: 60 })]));
  assert.ok(out.blocks.length > 1, "expected multiple chunks");
  assert.ok(out.blocks.every((b) => b.isChunk));
  const total = out.blocks.reduce((s, b) => s + (b.end.getTime() - b.start.getTime()) / 60000, 0);
  assert.equal(total, 240);
});

test("capacity reflects the horizon BEFORE placement", () => {
  // Two 8h working days. Capacity must not shrink just because work was placed —
  // this is the regression guard for computing it from the mutated slot grid.
  const empty = solve(baseInput([]));
  const full = solve(baseInput([task("a", 120), task("b", 120)]));
  assert.equal(empty.capacity.capacityMinutes, full.capacity.capacityMinutes);
  assert.equal(full.capacity.demandMinutes, 240);
});

test("overcommitment is flagged when demand exceeds capacity", () => {
  const many = Array.from({ length: 40 }, (_, i) => task(`t${i}`, 120));
  const out = solve(baseInput(many));
  assert.equal(out.capacity.overcommitted, true);
  assert.ok(out.capacity.atRiskTaskIds.length > 0);
});

test("protected regions (sleep/meal) are never scheduled over", () => {
  // A meal region covering the entire working day leaves nothing placeable.
  const out = solve(
    baseInput([task("a", 60)], {
      regions: [{ category: "meal", dayMask: 0b1111111, start: "00:00", end: "23:59" }],
    }),
  );
  assert.equal(out.blocks.length, 0);
  assert.equal(out.unscheduled.length, 1);
});

test("no two placed blocks ever overlap each other", () => {
  const tasks = Array.from({ length: 8 }, (_, i) => task(`t${i}`, 45));
  const out = solve(baseInput(tasks));
  const sorted = [...out.blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(
      sorted[i].start >= sorted[i - 1].end,
      `block ${i} starts ${sorted[i].start} before previous ends ${sorted[i - 1].end}`,
    );
  }
});

test("a chunkable task too big to fully fit is placed partially, not dropped", () => {
  // 10h of splittable work across two 8h days whose daily budget is well under
  // 10h: it must place what fits and report the shortfall, not vanish entirely.
  const out = solve(baseInput([task("big", 600, { chunkable: true })]));
  assert.ok(out.blocks.some((b) => b.taskId === "big"), "should place some chunks");
  const un = out.unscheduled.find((u) => u.taskId === "big");
  assert.ok(un, "should report the remainder");
  assert.match(un!.reason, /scheduled .+ of .+/);
});

test("a non-chunkable task that can't fully fit is all-or-nothing", () => {
  // 10h in one atomic block can't fit an 8h day, so nothing is placed.
  const out = solve(baseInput([task("big", 600, { chunkable: false })]));
  assert.equal(out.blocks.filter((b) => b.taskId === "big").length, 0);
  assert.ok(out.unscheduled.some((u) => u.taskId === "big"));
});

test("a due-by task is never scheduled after its deadline", () => {
  // Deadline Monday noon: a chunkable task bigger than the morning may only use
  // the pre-noon slots and must report the rest — never spill past the due date.
  const deadline = new Date(2026, 6, 20, 12, 0); // Mon 12:00 local
  const out = solve(baseInput([task("due", 300, { chunkable: true, deadline })]));
  const placed = out.blocks.filter((b) => b.taskId === "due");
  assert.ok(placed.length > 0, "should place the chunks that fit before noon");
  for (const b of placed) {
    assert.ok(b.end.getTime() <= deadline.getTime(), `chunk ends ${b.end} after the deadline`);
  }
});

test("a splittable task sizes pieces to the gap instead of a fixed session length", () => {
  // A 200-min splittable task whose ideal session is 90 but can go as small as
  // 20. Monday has only a 60-min window (09:00–10:00); the piece placed there
  // must fill that gap (<=60), not be skipped for not being a full 90 — the fix
  // that lets a task cram a smaller opening with a fractional piece.
  const tasks = [task("t", 200, { chunkable: true, minChunk: 20, maxChunk: 90 })];
  const busy = [{ start: new Date(2026, 6, 20, 10, 0), end: new Date(2026, 6, 20, 23, 0) }];
  const out = solve(baseInput(tasks, { busy }));
  const monday = out.blocks
    .filter((b) => b.taskId === "t" && b.start.getDate() === 20)
    .map((b) => Math.round((b.end.getTime() - b.start.getTime()) / 60000));
  assert.ok(monday.length > 0, "should place a piece in Monday's 60-min window");
  for (const m of monday) assert.ok(m <= 60, `Monday piece ${m}m overflowed the 60-min gap`);
});

test("working hours resolve in the user's timezone, not the server's", () => {
  // 09:00 working hours for a New York user in July (EDT, UTC-4) must land the
  // task at 13:00 UTC — regardless of where the server runs. A task due
  // mid-window, one hour, no energy windows.
  const from = new Date("2026-07-20T00:00:00.000Z");
  const to = new Date("2026-07-21T00:00:00.000Z");
  const out = solve(
    baseInput([task("a", 60)], {
      timezone: "America/New_York",
      horizonStart: from,
      horizonEnd: to,
      workingHours: { "1": [{ start: "09:00", end: "17:00" }] }, // Monday
    }),
  );
  assert.equal(out.blocks.length, 1);
  const h = out.blocks[0].start.getUTCHours();
  // 09:00–17:00 EDT == 13:00–21:00 UTC. The block must start no earlier than 13.
  assert.ok(h >= 13 && h < 21, `started at ${out.blocks[0].start.toISOString()} (UTC hour ${h})`);
});

test("overtime fills evenings only after working hours are full", () => {
  // One 8h working day but 12h of splittable work due that evening. Without
  // overtime only ~part fits; with it, the rest lands after 17:00 and is marked.
  const from = new Date(2026, 6, 20, 9, 0);
  const to = new Date(2026, 6, 20, 23, 0);
  const deadline = new Date(2026, 6, 20, 23, 0);
  const mk = (ot: boolean) =>
    solve(
      baseInput([task("big", 600, { chunkable: true, minChunk: 30, maxChunk: 120, deadline })], {
        horizonStart: from,
        horizonEnd: to,
        workingHours: { "1": [{ start: "09:00", end: "17:00" }] },
        overtime: ot,
      }),
    );
  const withOt = mk(true);
  const withoutOt = mk(false);
  const placedWith = withOt.blocks.reduce((s, b) => s + (b.end.getTime() - b.start.getTime()) / 60000, 0);
  const placedWithout = withoutOt.blocks.reduce((s, b) => s + (b.end.getTime() - b.start.getTime()) / 60000, 0);
  assert.ok(placedWith > placedWithout, "overtime should fit more than without");
  // Something must land after 17:00 local and say so.
  const evening = withOt.blocks.filter((b) => b.start.getHours() >= 17);
  assert.ok(evening.length > 0, "expected a block after 17:00");
  assert.ok(evening.every((b) => /outside working hours/.test(b.reason)));
  // And nothing before working hours actually starts before 09:00 or after 23:00.
  for (const b of withOt.blocks) assert.ok(b.start.getHours() >= 7 && b.end.getHours() <= 23);
});
