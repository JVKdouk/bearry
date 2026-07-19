/**
 * The work-personality layer (§9.1a).
 *
 * The bug these exist to prevent: a "plan my week" that returns eighteen
 * back-to-back blocks with a token gap between them. That plan is technically
 * valid — every block fits in open time — which is exactly why it needs tests
 * rather than eyeballing. Breathing room is a property of the output, so it gets
 * asserted like one.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { solve } from "@/src/lib/scheduler/solver";
import { DEFAULT_PERSONA, personaFromSettings, type Persona } from "@/src/lib/scheduler/persona";
import type { SchedulerInput, SchedulableTask, Desire } from "@/src/lib/scheduler/types";

/** Mon 2026-07-20 → Fri, 09:00–18:00 every weekday, wide open. */
function input(tasks: SchedulableTask[], persona?: Partial<Persona>, days = 5): SchedulerInput {
  const horizonStart = new Date(2026, 6, 20, 9, 0, 0);
  const horizonEnd = new Date(2026, 6, 20 + days - 1, 18, 0, 0);
  const wh = { start: "09:00", end: "18:00" };
  return {
    tasks,
    busy: [],
    workingHours: { "0": [wh], "1": [wh], "2": [wh], "3": [wh], "4": [wh], "5": [wh], "6": [wh] },
    energyWindows: [],
    regions: [],
    horizonStart,
    horizonEnd,
    persona: { ...DEFAULT_PERSONA, ...persona },
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

/** Many small tasks — the shape that produced the wall-of-blocks screenshot. */
function manyTasks(n: number, min = 30, extra: Partial<SchedulableTask> = {}): SchedulableTask[] {
  return Array.from({ length: n }, (_, i) => task(`t${i}`, min, extra));
}

const dayOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function byDay(blocks: { start: Date }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of blocks) m.set(dayOf(b.start), (m.get(dayOf(b.start)) ?? 0) + 1);
  return m;
}

test("a day is never filled beyond its minute budget", () => {
  const out = solve(input(manyTasks(40)));
  const minutesPerDay = new Map<string, number>();
  for (const b of out.blocks) {
    const k = dayOf(b.start);
    const mins = (b.end.getTime() - b.start.getTime()) / 60000;
    minutesPerDay.set(k, (minutesPerDay.get(k) ?? 0) + mins);
  }
  // Default budget is 240 × 0.9 commitment = 216.
  for (const [day, mins] of minutesPerDay) {
    assert.ok(mins <= 216, `${day} got ${mins} minutes, over the 216 budget`);
  }
});

test("a day is never given more sessions than the persona allows", () => {
  const out = solve(input(manyTasks(40)));
  for (const [day, count] of byDay(out.blocks)) {
    assert.ok(count <= DEFAULT_PERSONA.maxSessionsPerDay, `${day} got ${count} blocks`);
  }
});

test("the wall-of-blocks regression: 40 tasks do not carpet one day", () => {
  const out = solve(input(manyTasks(40)));
  const counts = [...byDay(out.blocks).values()];
  const worst = Math.max(...counts);
  assert.ok(worst <= 5, `worst day had ${worst} blocks — that's a wall, not a plan`);
  // And crucially it should refuse work rather than cram it in.
  assert.ok(out.unscheduled.length > 0, "an over-full week should leave work unplaced");
});

test("consecutive blocks are separated by a real break", () => {
  const out = solve(input(manyTasks(20)));
  const sorted = [...out.blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
  for (let i = 1; i < sorted.length; i++) {
    if (dayOf(sorted[i].start) !== dayOf(sorted[i - 1].start)) continue;
    const gap = (sorted[i].start.getTime() - sorted[i - 1].end.getTime()) / 60000;
    // breakLength 15 + moderate overrun buffer 10 = 25 minutes of air.
    assert.ok(gap >= 25, `only ${gap} minutes between blocks — no breathing room`);
  }
});

test("a longer break arrives after a few sessions", () => {
  const out = solve(input(manyTasks(20)));
  const sorted = [...out.blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (dayOf(sorted[i].start) !== dayOf(sorted[i - 1].start)) continue;
    gaps.push((sorted[i].start.getTime() - sorted[i - 1].end.getTime()) / 60000);
  }
  assert.ok(
    gaps.some((g) => g >= DEFAULT_PERSONA.longBreakLength),
    `no long break in ${JSON.stringify(gaps)}`,
  );
});

test("hard-to-start means fewer, larger sessions", () => {
  const easy = solve(input(manyTasks(30), { startDifficulty: "easy" }));
  const hard = solve(input(manyTasks(30), { startDifficulty: "hard" }));
  const worstEasy = Math.max(...byDay(easy.blocks).values());
  const worstHard = Math.max(...byDay(hard.blocks).values());
  assert.ok(
    worstHard < worstEasy,
    `hard-to-start should get fewer starts per day (hard ${worstHard} vs easy ${worstEasy})`,
  );
});

test("hard-to-stop leaves a bigger landing strip after each block", () => {
  const gapsFor = (stopDifficulty: Persona["stopDifficulty"]) => {
    const out = solve(input(manyTasks(12), { stopDifficulty }));
    const sorted = [...out.blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      if (dayOf(sorted[i].start) !== dayOf(sorted[i - 1].start)) continue;
      gaps.push((sorted[i].start.getTime() - sorted[i - 1].end.getTime()) / 60000);
    }
    return Math.min(...gaps);
  };
  assert.ok(gapsFor("hard") > gapsFor("easy"), "hyperfocus needs room to overrun");
});

test("weekendMode 'none' keeps the weekend clear", () => {
  // A horizon spanning Sat + Sun.
  const sat = new Date(2026, 6, 25, 9, 0);
  const sun = new Date(2026, 6, 26, 18, 0);
  const wh = { start: "09:00", end: "18:00" };
  const out = solve({
    tasks: manyTasks(10),
    busy: [],
    workingHours: { "0": [wh], "6": [wh] },
    energyWindows: [],
    regions: [],
    horizonStart: sat,
    horizonEnd: sun,
    persona: { ...DEFAULT_PERSONA, weekendMode: "none" },
  });
  assert.equal(out.blocks.length, 0, "nothing should be scheduled on an opted-out weekend");
});

test("weekendMode 'light' schedules less than a full weekday", () => {
  const wh = { start: "09:00", end: "18:00" };
  const weekendOnly = (mode: Persona["weekendMode"]) =>
    solve({
      tasks: manyTasks(20),
      busy: [],
      workingHours: { "0": [wh], "6": [wh] },
      energyWindows: [],
      regions: [],
      horizonStart: new Date(2026, 6, 25, 9, 0),
      horizonEnd: new Date(2026, 6, 26, 18, 0),
      persona: { ...DEFAULT_PERSONA, weekendMode: mode },
    }).blocks.length;

  assert.ok(weekendOnly("light") < weekendOnly("full"), "a light weekend should hold less");
  assert.ok(weekendOnly("light") > 0, "a light weekend is not a closed one");
});

test("dreaded work is placed before wanted work", () => {
  const out = solve(
    input([
      task("fun", 30, { desire: "wanted" }),
      task("dread", 30, { desire: "avoided" }),
    ]),
  );
  const dread = out.blocks.find((b) => b.taskId === "dread");
  const fun = out.blocks.find((b) => b.taskId === "fun");
  assert.ok(dread && fun, "both should be scheduled");
  assert.ok(dread!.start < fun!.start, "eat the frog — the avoided task goes first");
});

test("dreaded tasks are never stacked back to back", () => {
  const out = solve(input(manyTasks(8, 30, { desire: "avoided" })));
  const sorted = [...out.blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
  for (let i = 1; i < sorted.length; i++) {
    if (dayOf(sorted[i].start) !== dayOf(sorted[i - 1].start)) continue;
    const gap = (sorted[i].start.getTime() - sorted[i - 1].end.getTime()) / 60000;
    assert.ok(gap >= DEFAULT_PERSONA.breakLength + 30, `dread stacked with only ${gap} min between`);
  }
});

test("only a couple of dreaded tasks land in any one day", () => {
  const out = solve(input(manyTasks(12, 30, { desire: "avoided" })));
  for (const [day, count] of byDay(out.blocks)) {
    assert.ok(count <= 2, `${day} got ${count} dreaded blocks — that's a dread marathon`);
  }
});

test("unplaced work explains itself in the user's terms", () => {
  const out = solve(input(manyTasks(40)));
  assert.ok(out.unscheduled.length > 0);
  const reasons = out.unscheduled.map((u) => u.reason).join(" | ");
  assert.match(
    reasons,
    /limit|session|avoided|deadline|no open slot/i,
    `unhelpful reasons: ${reasons}`,
  );
});

test("capacity reports the persona budget, not just raw open time", () => {
  const out = solve(input(manyTasks(40)));
  assert.ok(out.capacity.budgetMinutes! > 0);
  assert.ok(
    out.capacity.budgetMinutes! < out.capacity.capacityMinutes,
    "the gap between open time and budget IS the breathing room",
  );
  assert.equal(out.capacity.overcommitted, true);
});

test("persona settings are parsed and clamped from raw rows", () => {
  const p = personaFromSettings([
    { key: "persona.sessionLength", value: "90" },
    { key: "persona.dailyMaxMinutes", value: "999999" }, // absurd → clamped
    { key: "persona.startDifficulty", value: "hard" },
    { key: "persona.weekendMode", value: "banana" }, // invalid → default
    { key: "unrelated.key", value: "ignored" },
  ]);
  assert.equal(p.sessionLength, 90);
  assert.equal(p.dailyMaxMinutes, 960);
  assert.equal(p.startDifficulty, "hard");
  assert.equal(p.weekendMode, DEFAULT_PERSONA.weekendMode);
  assert.equal(p.breakLength, DEFAULT_PERSONA.breakLength); // unset → default
});

test("a bigger budget really does schedule more", () => {
  const small = solve(input(manyTasks(40), { dailyMaxMinutes: 120, maxSessionsPerDay: 3 }));
  const large = solve(input(manyTasks(40), { dailyMaxMinutes: 480, maxSessionsPerDay: 10 }));
  assert.ok(
    large.blocks.length > small.blocks.length,
    "the dials must actually move the outcome",
  );
});

test("still deterministic with a persona applied", () => {
  const tasks = manyTasks(15);
  const a = solve(input(tasks));
  const b = solve(input(tasks));
  assert.deepEqual(
    a.blocks.map((x) => [x.taskId, x.start.toISOString()]),
    b.blocks.map((x) => [x.taskId, x.start.toISOString()]),
  );
});

test("desire is respected without breaking priority", () => {
  // An ASAP task still wins even if it's something you want to do.
  const out = solve(
    input([
      task("asap", 30, { priority: "ASAP", desire: "wanted" }),
      task("dread", 30, { desire: "avoided" }),
    ]),
  );
  assert.equal(out.blocks[0].taskId, "asap", "ASAP must outrank the frog");
});

const _unusedDesire: Desire = "neutral";
void _unusedDesire;
