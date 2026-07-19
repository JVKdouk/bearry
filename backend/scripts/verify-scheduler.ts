/* Verify the algorithmic scheduler (run: yarn tsx scripts/verify-scheduler.ts). */
import assert from "node:assert";
import { solve } from "../src/lib/scheduler/solver";
import type { SchedulerInput, SchedulableTask, EnergyWindow } from "../src/lib/scheduler/types";

// Monday 2026-07-13, horizon = that week.
const horizonStart = new Date("2026-07-13T08:00:00");
const horizonEnd = new Date("2026-07-17T18:00:00");

const workingHours = {
  "1": [{ start: "09:00", end: "17:00" }],
  "2": [{ start: "09:00", end: "17:00" }],
  "3": [{ start: "09:00", end: "17:00" }],
  "4": [{ start: "09:00", end: "17:00" }],
  "5": [{ start: "09:00", end: "17:00" }],
};

const energyWindows: EnergyWindow[] = [
  { dayMask: 0b0111110, start: "09:00", end: "12:00", energyLevel: "high" },
  { dayMask: 0b0111110, start: "13:00", end: "14:30", energyLevel: "low" },
  { dayMask: 0b0111110, start: "14:30", end: "17:00", energyLevel: "medium" },
];

function task(p: Partial<SchedulableTask> & { id: string }): SchedulableTask {
  return {
    estimatedDuration: 60,
    priority: "medium",
    energyDemand: "medium",
    chunkable: false,
    createdAt: new Date("2026-07-10T09:00:00"),
    ...p,
  };
}

// 1. Energy-aware placement: a high-demand task lands in the morning high window.
let out = solve({
  tasks: [task({ id: "deep", energyDemand: "high", estimatedDuration: 90 })],
  busy: [],
  workingHours,
  energyWindows,
  horizonStart,
  horizonEnd,
} as SchedulerInput);
assert.equal(out.blocks.length, 1, "one block placed");
assert.ok(out.blocks[0].start.getHours() < 12, "deep work placed in the morning high-energy window");
assert.match(out.blocks[0].reason, /high-energy/, "reason explains the energy choice");

// 2. Fixed event avoidance + no double-booking.
out = solve({
  tasks: [task({ id: "t1", estimatedDuration: 60 })],
  busy: [{ start: new Date("2026-07-13T09:00:00"), end: new Date("2026-07-13T11:00:00") }],
  workingHours,
  energyWindows,
  horizonStart,
  horizonEnd,
} as SchedulerInput);
assert.ok(out.blocks[0].start >= new Date("2026-07-13T11:00:00"), "task scheduled after the fixed meeting");

// 3. ASAP overrides deadline ordering — placed first.
out = solve({
  tasks: [
    task({ id: "later", deadline: new Date("2026-07-13T12:00:00"), priority: "high" }),
    task({ id: "asap", priority: "ASAP" }),
  ],
  busy: [],
  workingHours,
  energyWindows,
  horizonStart,
  horizonEnd,
} as SchedulerInput);
assert.equal(out.blocks[0].taskId, "asap", "ASAP task scheduled first");

// 4. Chunking: a 3h chunkable task splits into ≤90m pieces across slots.
out = solve({
  tasks: [task({ id: "big", estimatedDuration: 180, chunkable: true, minChunk: 30, maxChunk: 90 })],
  busy: [],
  workingHours,
  energyWindows,
  horizonStart,
  horizonEnd,
} as SchedulerInput);
const bigBlocks = out.blocks.filter((b) => b.taskId === "big");
assert.ok(bigBlocks.length >= 2, "big task chunked into multiple blocks");
assert.ok(bigBlocks.every((b) => (b.end.getTime() - b.start.getTime()) / 60000 <= 90), "no chunk exceeds maxChunk");
assert.equal(bigBlocks.reduce((s, b) => s + (b.end.getTime() - b.start.getTime()) / 60000, 0), 180, "chunks sum to the full duration");

// 5. Overcommitment flagged when demand exceeds capacity.
out = solve({
  tasks: Array.from({ length: 40 }, (_, i) => task({ id: `x${i}`, estimatedDuration: 120 })),
  busy: [],
  workingHours,
  energyWindows,
  horizonStart,
  horizonEnd,
} as SchedulerInput);
assert.ok(out.capacity.overcommitted, "overcommitment detected");
assert.ok(out.unscheduled.length > 0, "some tasks surface as unscheduled, not silently dropped");

// 6. Deadline-risk: a task that can't fit before its deadline is flagged at-risk.
out = solve({
  tasks: [task({ id: "tight", estimatedDuration: 480, deadline: new Date("2026-07-13T17:00:00"), priority: "high" })],
  busy: [{ start: new Date("2026-07-13T09:00:00"), end: new Date("2026-07-13T16:30:00") }],
  workingHours,
  energyWindows,
  horizonStart,
  horizonEnd,
} as SchedulerInput);
assert.ok(out.capacity.atRiskTaskIds.includes("tight"), "at-risk task flagged");

// 7. Time blocking: a "work" task lands inside a work region, not the afternoon
//    personal region, even though both are open.
out = solve({
  tasks: [task({ id: "wt", category: "work", estimatedDuration: 60 })],
  busy: [],
  workingHours,
  energyWindows,
  regions: [
    { category: "work", dayMask: 0b0111110, start: "09:00", end: "12:00" },
    { category: "personal", dayMask: 0b0111110, start: "13:00", end: "17:00" },
  ],
  horizonStart,
  horizonEnd,
} as SchedulerInput);
assert.ok(out.blocks[0].start.getHours() < 12, "work task placed in the work block (morning)");
assert.match(out.blocks[0].reason, /work block/, "reason names the work block");

// 8. Extend out: with the work block full, a second work task spills into open
//    (generic) time rather than failing.
out = solve({
  tasks: [
    task({ id: "w1", category: "work", estimatedDuration: 180, chunkable: false }),
    task({ id: "w2", category: "work", estimatedDuration: 120, chunkable: false }),
  ],
  busy: [],
  workingHours, // 09:00–17:00 = generic overflow beyond the 09:00–11:00 work block
  energyWindows,
  regions: [{ category: "work", dayMask: 0b0111110, start: "09:00", end: "11:00" }],
  horizonStart,
  horizonEnd,
} as SchedulerInput);
assert.equal(out.blocks.filter((b) => b.taskId === "w2").length, 1, "second work task still scheduled (extended out)");

// 9. Protected region (sleep) is never scheduled into, even inside working hours.
out = solve({
  tasks: [task({ id: "any", estimatedDuration: 60 })],
  busy: [],
  workingHours: { "1": [{ start: "00:00", end: "23:59" }] }, // whole Monday open…
  energyWindows,
  regions: [{ category: "sleep", dayMask: 0b1111111, start: "00:00", end: "16:00" }], // …but morning is sleep
  horizonStart: new Date("2026-07-13T00:00:00"),
  horizonEnd: new Date("2026-07-13T23:59:00"),
} as SchedulerInput);
assert.ok(out.blocks.length === 0 || out.blocks[0].start.getHours() >= 16, "nothing scheduled during the sleep block");

console.log("✓ scheduler: all 9 checks passed");
console.log("  sample reason:", solve({
  tasks: [task({ id: "s", energyDemand: "high", estimatedDuration: 90, deadline: new Date("2026-07-15T17:00:00") })],
  busy: [], workingHours, energyWindows, horizonStart, horizonEnd,
} as SchedulerInput).blocks[0].reason);
