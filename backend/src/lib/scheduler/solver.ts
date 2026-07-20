/**
 * The algorithmic auto-scheduler (§9) — the flagship, fully functional and fully
 * explainable with NO AI. A deterministic constraint solver places tasks into
 * open slots, is energy/capacity-aware (§9.4a), respects hard constraints
 * (fixed events, working hours, no double-booking, §9.3), chunks long tasks
 * (§7.3), and emits a plain-language reason for every decision from its own
 * decision trace (§9.6). Pure: operates on cleartext metadata, no DB, no keys.
 */

import {
  DEFAULT_PERSONA,
  commitmentFactor,
  effectiveSessionLength,
  minChunkFor,
  overrunBufferFor,
  sessionCapFor,
  weekendFactor,
  type Persona,
} from "./persona";
import { isChunkable } from "./chunking";
import type {
  SchedulerInput,
  ScheduleProposal,
  ScheduledBlock,
  SchedulableTask,
  EnergyLevel,
  FixedInterval,
  LifeArea,
  Region,
  TaskDependency,
} from "./types";

const PRIORITY_WEIGHT: Record<string, number> = { ASAP: 1000, high: 100, medium: 50, low: 20 };
const ENERGY_RANK: Record<EnergyLevel, number> = { high: 3, medium: 2, low: 1 };

/** Protected life areas — the scheduler never places tasks in these (§8.4). */
const HARD_OFF: ReadonlySet<LifeArea> = new Set<LifeArea>(["sleep", "meal"]);

const MS_PER_MIN = 60_000;

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function atLocalMinutes(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() + minutes * MS_PER_MIN);
}

/** A candidate open slot with the energy level and time-block region covering it. */
type FreeSlot = { start: Date; end: Date; energy: EnergyLevel; category: LifeArea | null };

/** Concrete intervals on `day` for the regions that pass `pred` (from dayMask + HH:MM). */
function regionIntervalsForDay(day: Date, regions: Region[]): { start: Date; end: Date }[] {
  const bit = 1 << day.getDay();
  const out: { start: Date; end: Date }[] = [];
  for (const r of regions) {
    if ((r.dayMask & bit) === 0) continue;
    const start = atLocalMinutes(day, hhmmToMinutes(r.start));
    const end = atLocalMinutes(day, hhmmToMinutes(r.end));
    if (end > start) out.push({ start, end });
  }
  return out;
}

/** Merge overlapping/adjacent windows into a minimal set (for availability). */
function unionWindows(wins: { start: Date; end: Date }[]): { start: Date; end: Date }[] {
  const sorted = [...wins].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: { start: Date; end: Date }[] = [];
  for (const w of sorted) {
    const last = merged.at(-1);
    if (last && w.start.getTime() <= last.end.getTime()) {
      if (w.end > last.end) last.end = new Date(w.end);
    } else {
      merged.push({ start: new Date(w.start), end: new Date(w.end) });
    }
  }
  return merged;
}

/** Which available-region category (if any) covers this instant (§8.4). */
function categoryAt(date: Date, availableRegions: Region[]): LifeArea | null {
  const bit = 1 << date.getDay();
  const mins = date.getHours() * 60 + date.getMinutes();
  for (const r of availableRegions) {
    if ((r.dayMask & bit) === 0) continue;
    if (mins >= hhmmToMinutes(r.start) && mins < hhmmToMinutes(r.end)) return r.category;
  }
  return null;
}

/** Energy level at a given instant from the windows (default medium). */
function energyAt(date: Date, windows: SchedulerInput["energyWindows"]): EnergyLevel {
  const weekdayBit = 1 << date.getDay();
  const mins = date.getHours() * 60 + date.getMinutes();
  for (const w of windows) {
    if ((w.dayMask & weekdayBit) === 0) continue;
    const s = hhmmToMinutes(w.start);
    const e = hhmmToMinutes(w.end);
    if (mins >= s && mins < e) return w.energyLevel;
  }
  return "medium";
}

/** Subtract busy intervals from a single window, yielding free sub-intervals. */
function subtractBusy(winStart: Date, winEnd: Date, busy: FixedInterval[]): { start: Date; end: Date }[] {
  const overlapping = busy
    .filter((b) => b.end > winStart && b.start < winEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const free: { start: Date; end: Date }[] = [];
  let cursor = winStart;
  for (const b of overlapping) {
    if (b.start > cursor) free.push({ start: cursor, end: new Date(Math.min(b.start.getTime(), winEnd.getTime())) });
    if (b.end > cursor) cursor = b.end;
  }
  if (cursor < winEnd) free.push({ start: cursor, end: winEnd });
  return free.filter((f) => f.end > f.start);
}

/**
 * Build the ordered list of free slots across the horizon: working-hours windows
 * per day, minus busy intervals, each split at energy-level boundaries so a slot
 * carries a single energy level (lets us place demanding work in high windows).
 */
function buildFreeSlots(input: SchedulerInput): FreeSlot[] {
  const slots: FreeSlot[] = [];
  const regions = input.regions ?? [];
  // Available regions define/extend schedulable time and tag it by life area;
  // protected regions (sleep/meal) are subtracted like busy time (§8.4).
  const availableRegions = regions.filter((r) => !HARD_OFF.has(r.category));
  const offRegions = regions.filter((r) => HARD_OFF.has(r.category));

  const day = new Date(input.horizonStart);
  day.setHours(0, 0, 0, 0);

  while (day <= input.horizonEnd) {
    // Availability = working-hours windows ∪ available time-block regions.
    const whWindows = (input.workingHours[String(day.getDay())] ?? []).map((w) => ({
      start: atLocalMinutes(day, hhmmToMinutes(w.start)),
      end: atLocalMinutes(day, hhmmToMinutes(w.end)),
    }));
    const availability = unionWindows([...whWindows, ...regionIntervalsForDay(day, availableRegions)]);
    // Busy = fixed commitments ∪ protected (off) regions on this day.
    const busyForDay: FixedInterval[] = [...input.busy, ...regionIntervalsForDay(day, offRegions)];

    for (const win of availability) {
      let winStart = win.start;
      let winEnd = win.end;
      // Clamp to the horizon.
      if (winEnd <= input.horizonStart || winStart >= input.horizonEnd) continue;
      if (winStart < input.horizonStart) winStart = input.horizonStart;
      if (winEnd > input.horizonEnd) winEnd = input.horizonEnd;

      for (const free of subtractBusy(winStart, winEnd, busyForDay)) {
        // Split each free interval at energy AND region-category boundaries by
        // walking in 15-min steps and grouping same-(energy,category) runs.
        let runStart = free.start;
        let runEnergy = energyAt(free.start, input.energyWindows);
        let runCat = categoryAt(free.start, availableRegions);
        for (let t = free.start.getTime() + 15 * MS_PER_MIN; t <= free.end.getTime(); t += 15 * MS_PER_MIN) {
          const at = new Date(t);
          const e = energyAt(at, input.energyWindows);
          const c = categoryAt(at, availableRegions);
          if (e !== runEnergy || c !== runCat) {
            slots.push({ start: runStart, end: at, energy: runEnergy, category: runCat });
            runStart = at;
            runEnergy = e;
            runCat = c;
          }
        }
        if (free.end > runStart) slots.push({ start: runStart, end: free.end, energy: runEnergy, category: runCat });
      }
    }
    day.setDate(day.getDate() + 1);
  }
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Scoring: ASAP first, then deadline urgency + priority + age + appetite. */
function taskScore(task: SchedulableTask, now: Date): number {
  let score = PRIORITY_WEIGHT[task.priority] ?? 50;
  if (task.deadline) {
    const hoursLeft = (task.deadline.getTime() - now.getTime()) / (MS_PER_MIN * 60);
    // Nearer deadlines score much higher; overdue is maximal urgency.
    score += hoursLeft <= 0 ? 500 : Math.max(0, 300 - hoursLeft);
  }
  const ageDays = (now.getTime() - task.createdAt.getTime()) / (MS_PER_MIN * 60 * 24);
  score += Math.min(50, ageDays * 2); // gentle anti-rot boost

  // Eat the frog: a task you're avoiding gets scheduled EARLIER, not later.
  // Left to drift it just accrues dread and blocks everything behind it, and
  // the early slots are the ones with the energy to actually start it. The
  // per-day cap below stops this turning the morning into a dread marathon.
  if (task.desire === "avoided") score += 60;
  // Something you want to do is the easiest thing to start, so it's useful
  // later in the day when momentum has run out — no boost needed.
  if (task.desire === "wanted") score -= 10;
  return score;
}

/** How well an energy window suits a task's demand (higher = better). */
function energyFit(demand: EnergyLevel, slotEnergy: EnergyLevel): number {
  // Demanding work wants high energy; low-demand fills troughs. Penalize
  // placing high-demand work in a low window.
  return -Math.abs(ENERGY_RANK[demand] - ENERGY_RANK[slotEnergy]);
}

/**
 * How well a slot's time-block region suits a task's life area (§8.4). A task
 * strongly prefers its matching region, will happily overflow into untagged
 * ("generic") time, and only spills into a *different* named region as a last
 * resort — this is "work tasks mostly on work blocks, but may extend out".
 */
function categoryFit(taskCat: LifeArea | null | undefined, slotCat: LifeArea | null): number {
  if (!taskCat) return 1; // no preference → every slot is equally fine
  if (slotCat === taskCat) return 2; // in its own block
  if (slotCat === null) return 1; // generic open time — fine to extend into
  return 0; // someone else's block (e.g. work task in family time) — avoid
}

function reasonFor(
  task: SchedulableTask,
  slot: FreeSlot,
  chunk: { index: number; count: number } | null,
): string {
  const parts: string[] = [];
  const time = slot.start.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  if (task.priority === "ASAP") parts.push("marked ASAP, so placed first");
  if (task.category && slot.category === task.category) parts.push(`in your ${task.category} block`);
  else if (task.category && slot.category && slot.category !== task.category) parts.push(`spilled out of your ${task.category} blocks (they were full)`);
  if (task.energyDemand === "high" && slot.energy === "high") parts.push("your high-energy window fits this deep-focus task");
  else if (task.energyDemand === "low" && slot.energy !== "high") parts.push("a low-energy slot suits this lighter task");
  if (task.deadline) {
    const daysLeft = Math.ceil((task.deadline.getTime() - slot.start.getTime()) / (MS_PER_MIN * 60 * 24));
    if (daysLeft <= 1) parts.push("due very soon");
    else parts.push(`ahead of its ${daysLeft}-day deadline`);
  }
  if (chunk) parts.push(`chunked into ${chunk.count} (part ${chunk.index}/${chunk.count}) — no single gap was long enough`);
  const why = parts.length > 0 ? parts.join("; ") : "earliest open slot in your working hours";
  return `${time} — ${why}.`;
}

/** Per-day running totals — this is what stops the calendar being carpeted. */
type DayState = {
  /** Minutes of work already committed on this day. */
  used: number;
  /** Ceiling for this day (weekday/weekend aware). */
  budget: number;
  /** Blocks placed — each one is another context switch. */
  sessions: number;
  sessionCap: number;
  /** Sessions since the last long break, for break escalation. */
  sinceLongBreak: number;
  /** How many `avoided` tasks have landed here already. */
  avoided: number;
  /** End of the most recent `avoided` block, to keep dread from clustering. */
  lastAvoidedEnd: Date | null;
};

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/** Reasons a day can refuse more work — surfaced so the UI can explain itself. */
type Refusal = "budget" | "sessions" | "dread" | "deadline" | null;

function dayStateFor(states: Map<string, DayState>, day: Date, p: Persona): DayState {
  const key = dayKey(day);
  const existing = states.get(key);
  if (existing) return existing;

  const factor = isWeekend(day) ? weekendFactor(p) : 1;
  const fresh: DayState = {
    used: 0,
    budget: Math.round(p.dailyMaxMinutes * commitmentFactor(p) * factor),
    sessions: 0,
    sessionCap: factor === 0 ? 0 : sessionCapFor(p),
    sinceLongBreak: 0,
    avoided: 0,
    lastAvoidedEnd: null,
  };
  states.set(key, fresh);
  return fresh;
}

/** At most this many dreaded blocks in one day, so a morning isn't all dread. */
function avoidedCapFor(p: Persona): number {
  return p.startDifficulty === "hard" ? 1 : 2;
}

/**
 * Place one session into the best slot that the day's budget still allows.
 *
 * The rules that produce breathing room live here: a day can refuse work
 * because its minute budget is spent, because it already holds as many separate
 * starts as this person can handle, or because it's had its share of dread.
 * Refusing is the feature — the previous version had no way to say no, so it
 * said yes eighteen times.
 */
function placeSession(
  task: SchedulableTask,
  /** Smallest piece worth placing here — a slot must hold at least this. */
  minMinutes: number,
  /** Ideal piece — the placed block fills the slot up to this, no more. */
  maxMinutes: number,
  slots: FreeSlot[],
  states: Map<string, DayState>,
  p: Persona,
  /** Nothing may start before this — the end of everything blocking it. */
  notBefore: Date | null,
  /** Nothing may finish after this — a due-by task's own deadline. */
  notAfter: Date | null,
): { start: Date; end: Date; energy: EnergyLevel; category: LifeArea | null; refusal: Refusal } {
  const minMs = minMinutes * MS_PER_MIN;
  const overrun = overrunBufferFor(p);
  const avoidedCap = avoidedCapFor(p);
  let refusal: Refusal = null;

  const feasible = slots
    .map((s) => {
      // A slot that merely *starts* too early is still usable from the floor
      // onward, so measure the room that's actually available to this task.
      const usableStart = notBefore && notBefore > s.start ? notBefore : s.start;
      return { s, usableStart, room: s.end.getTime() - usableStart.getTime() };
    })
    .filter((x) => {
      if (x.room < minMs) return false;
      // A due-by task earns nothing from work placed after it's due, so its
      // deadline is a hard ceiling. Without this the planner would fill a
      // 15h task onto the weekend past a Friday deadline — technically busy,
      // practically late.
      if (notAfter && x.usableStart.getTime() + minMs > notAfter.getTime()) {
        refusal = refusal ?? "deadline";
        return false;
      }
      const st = dayStateFor(states, x.usableStart, p);
      if (st.sessionCap === 0) return false; // e.g. weekends when opted out
      if (st.used + minMinutes > st.budget) {
        refusal = refusal ?? "budget";
        return false;
      }
      if (st.sessions + 1 > st.sessionCap) {
        refusal = refusal ?? "sessions";
        return false;
      }
      if (task.desire === "avoided") {
        if (st.avoided >= avoidedCap) {
          refusal = refusal ?? "dread";
          return false;
        }
        // Don't run two dreaded blocks back to back — that's how a plan gets
        // abandoned by 11am. Require a real gap after the previous one.
        if (st.lastAvoidedEnd) {
          const gapMs = x.usableStart.getTime() - st.lastAvoidedEnd.getTime();
          if (gapMs < (p.breakLength + 30) * MS_PER_MIN) return false;
        }
      }
      return true;
    });

  if (feasible.length === 0) {
    return { start: new Date(0), end: new Date(0), energy: "medium", category: null, refusal };
  }

  feasible.sort((a, b) => {
    // Earliest day dominates (keeps deadlines safe); within a day, prefer the
    // task's own time-block region, then energy fit, then earliest start.
    const dayA = Math.floor(a.usableStart.getTime() / (MS_PER_MIN * 60 * 24));
    const dayB = Math.floor(b.usableStart.getTime() / (MS_PER_MIN * 60 * 24));
    if (dayA !== dayB) return a.usableStart.getTime() - b.usableStart.getTime();
    const catA = categoryFit(task.category, a.s.category);
    const catB = categoryFit(task.category, b.s.category);
    if (catA !== catB) return catB - catA;
    // Something you're avoiding needs your best energy to get started at all,
    // so it outranks pure energy-demand fit for those tasks.
    const fitA = task.desire === "avoided" ? ENERGY_RANK[a.s.energy] : energyFit(task.energyDemand, a.s.energy);
    const fitB = task.desire === "avoided" ? ENERGY_RANK[b.s.energy] : energyFit(task.energyDemand, b.s.energy);
    if (fitA !== fitB) return fitB - fitA;
    return a.usableStart.getTime() - b.usableStart.getTime();
  });

  const slot = feasible[0].s;
  const start = new Date(feasible[0].usableStart);
  const st = dayStateFor(states, start, p);

  // Size the piece to fill what's actually here — up to the ideal max, but never
  // past the slot's room, the day's remaining budget, or the deadline. This is
  // what lets a splittable task drop a 120-minute piece into a 120-minute gap
  // instead of skipping it for not being a full session, and it's why the pieces
  // come out different sizes rather than a row of identical blocks.
  const roomMin = Math.floor((slot.end.getTime() - start.getTime()) / MS_PER_MIN);
  const budgetLeft = st.budget - st.used;
  const deadlineMin = notAfter
    ? Math.floor((notAfter.getTime() - start.getTime()) / MS_PER_MIN)
    : Number.POSITIVE_INFINITY;
  const minutes = Math.max(minMinutes, Math.min(maxMinutes, roomMin, budgetLeft, deadlineMin));
  const needMs = minutes * MS_PER_MIN;
  const end = new Date(start.getTime() + needMs);

  st.used += minutes;
  st.sessions += 1;
  st.sinceLongBreak += 1;
  if (task.desire === "avoided") {
    st.avoided += 1;
    st.lastAvoidedEnd = end;
  }

  // Reserve the recovery time after this block: a normal break, escalating to a
  // long one every few sessions, plus a landing strip for people who overrun.
  // Consuming it from the slot is what physically keeps the next block away.
  let rest = p.breakLength;
  if (st.sinceLongBreak >= p.longBreakEvery) {
    rest = Math.max(p.breakLength, p.longBreakLength);
    st.sinceLongBreak = 0;
  }
  const newStart = new Date(end.getTime() + (rest + overrun) * MS_PER_MIN);
  if (start.getTime() > slot.start.getTime()) {
    // We started partway in (waiting on a prerequisite). Keep the earlier gap as
    // its own slot so other work can still use it.
    const head: FreeSlot = { start: slot.start, end: start, energy: slot.energy, category: slot.category };
    if (head.end.getTime() - head.start.getTime() >= 5 * MS_PER_MIN) {
      slots.splice(slots.indexOf(slot), 0, head);
    }
  }
  if (newStart >= slot.end) slots.splice(slots.indexOf(slot), 1);
  else slot.start = newStart;

  return { start, end, energy: slot.energy, category: slot.category, refusal: null };
}

/**
 * Order tasks so every prerequisite comes before the task it blocks, while
 * otherwise preserving the caller's scoring order.
 *
 * Cycles are a real possibility — nothing stops a user linking A→B→A — and a
 * naive topological sort either loops forever or drops the whole cycle on the
 * floor. Here, any task still unresolved once no more can be emitted is
 * appended in score order and its edges reported, so a mistake degrades to
 * "scheduled without the constraint" rather than "silently disappeared".
 */
function orderByDependencies(
  ordered: SchedulableTask[],
  deps: TaskDependency[],
): { sequence: SchedulableTask[]; cyclic: Set<string> } {
  if (deps.length === 0) return { sequence: ordered, cyclic: new Set() };

  const present = new Set(ordered.map((t) => t.id));
  const blockers = new Map<string, Set<string>>(); // blocked -> its blockers
  for (const d of deps) {
    if (!present.has(d.blockedId) || !present.has(d.blockerId)) continue;
    if (d.blockerId === d.blockedId) continue; // self-edge: meaningless
    const set = blockers.get(d.blockedId) ?? new Set<string>();
    set.add(d.blockerId);
    blockers.set(d.blockedId, set);
  }
  if (blockers.size === 0) return { sequence: ordered, cyclic: new Set() };

  const emitted = new Set<string>();
  const sequence: SchedulableTask[] = [];
  const remaining = [...ordered];

  // Repeatedly emit the highest-scoring task whose blockers are all out.
  for (;;) {
    const idx = remaining.findIndex((t) => {
      const need = blockers.get(t.id);
      if (!need) return true;
      for (const b of need) if (!emitted.has(b)) return false;
      return true;
    });
    if (idx === -1) break;
    const [task] = remaining.splice(idx, 1);
    emitted.add(task.id);
    sequence.push(task);
  }

  // Whatever is left is in (or behind) a cycle.
  const cyclic = new Set(remaining.map((t) => t.id));
  sequence.push(...remaining);
  return { sequence, cyclic };
}

/** Run the solver. Deterministic given the input (§1.4 p5). */
export function solve(input: SchedulerInput): ScheduleProposal {
  const now = input.horizonStart;
  const persona = input.persona ?? DEFAULT_PERSONA;
  // Explicit per-call overrides still win, so existing callers and tests that
  // pass minBreak/maxFocus keep their behaviour.
  const p: Persona = {
    ...persona,
    breakLength: input.minBreak ?? persona.breakLength,
    sessionLength: input.maxFocus ?? persona.sessionLength,
  };
  const sessionLength = effectiveSessionLength(p);
  const personaMinChunk = minChunkFor(p);

  const slots = buildFreeSlots(input);
  // Capacity must reflect the horizon BEFORE anything is placed, and the
  // placement loop below mutates `slots` in place. Total it up front rather than
  // rebuilding the whole grid a second time afterwards: buildFreeSlots walks
  // every day in the horizon in 15-minute steps, so calling it twice doubled the
  // cost of every "plan my week" for a number that was already known here.
  const capacityMinutes = Math.round(
    slots.reduce((s, sl) => s + (sl.end.getTime() - sl.start.getTime()) / MS_PER_MIN, 0),
  );
  const scored = [...input.tasks].sort((a, b) => taskScore(b, now) - taskScore(a, now));
  // Prerequisites must be placed before the tasks they block, so the blocked
  // task can be given a start floor once its blocker's end time is known.
  const deps = input.dependencies ?? [];
  const { sequence: ordered, cyclic } = orderByDependencies(scored, deps);

  // blocked task -> the ids that must finish first
  const blockersOf = new Map<string, string[]>();
  for (const d of deps) {
    if (d.blockerId === d.blockedId) continue;
    blockersOf.set(d.blockedId, [...(blockersOf.get(d.blockedId) ?? []), d.blockerId]);
  }
  // Fixed floors from blockers that are already on the calendar.
  const blockerEnds = new Map<string, Date>(
    Object.entries(input.blockerEnds ?? {}).map(([id, v]) => [id, new Date(v)]),
  );
  /** When each task finishes, so dependents know their earliest possible start. */
  const finishedAt = new Map<string, Date>();
  /** Tasks that couldn't be placed — anything depending on them can't go either. */
  const unplaceable = new Set<string>();

  const blocks: ScheduledBlock[] = [];
  const unscheduled: ScheduleProposal["unscheduled"] = [];
  const dayStates = new Map<string, DayState>();

  for (const task of ordered) {
    // Resolve the dependency floor: this task cannot start until everything
    // blocking it has finished.
    const needs = blockersOf.get(task.id) ?? [];
    let notBefore: Date | null = null;
    let blockedByUnplaceable = false;
    for (const blockerId of needs) {
      if (unplaceable.has(blockerId)) {
        blockedByUnplaceable = true;
        break;
      }
      // A blocker already on the calendar pins the floor to when it actually
      // happens — this is the case that used to be waved through as "handled",
      // letting a dependent be planned days before its prerequisite.
      const fixed = blockerEnds.get(blockerId);
      if (fixed) {
        if (!notBefore || fixed > notBefore) notBefore = fixed;
        continue;
      }
      const end = finishedAt.get(blockerId);
      if (end) {
        if (!notBefore || end > notBefore) notBefore = end;
        continue;
      }
      // Unfinished, unplaced, and not scheduled in this run. The caller only
      // passes edges for blockers that genuinely still need doing, so there is
      // no safe time to put the dependent — refuse rather than guess.
      //
      // The exception is a dependency loop: it can never be satisfied, so
      // deferring on it would quietly bury both tasks forever. Place them and
      // disclose the loop instead — a user's mistake shouldn't cost them work.
      if (cyclic.has(task.id)) continue;
      blockedByUnplaceable = true;
      break;
    }

    if (blockedByUnplaceable) {
      unplaceable.add(task.id);
      unscheduled.push({
        taskId: task.id,
        reason:
          "it's waiting on another task that hasn't been scheduled yet — that one has to land first",
      });
      continue;
    }

    // A due-by task earns nothing from work scheduled after it's due, so cap
    // placement at its deadline. Overdue tasks (deadline already past) are the
    // exception — there's no future deadline to hold to, so place them ASAP.
    const deadlineCap =
      task.deadline && task.deadline.getTime() > now.getTime() ? task.deadline : null;

    // Greedy variable fill. A splittable task drops one piece at a time into the
    // best slot, each sized to fill that slot (up to a session's worth), rather
    // than pre-cutting equal pieces that then can't fit a smaller gap — the trap
    // that left an open afternoon unused because a 210-minute gap, split by an
    // energy boundary into 90 + 120, took no 125-minute chunk. A non-splittable
    // task is one atomic piece: fit it whole or not at all.
    const chunkable = isChunkable(task.chunkable, task.estimatedDuration);
    const maxChunkCap = Math.min(task.maxChunk ?? sessionLength, sessionLength);
    const willChunk = chunkable && task.estimatedDuration > maxChunkCap;
    const minChunkFloor = willChunk ? (task.minChunk ?? personaMinChunk) : task.estimatedDuration;

    type Raw = { start: Date; end: Date; energy: EnergyLevel; category: LifeArea | null };
    const rawPlaced: Raw[] = [];
    let failed = false;
    let refusal: Refusal = null;
    let remaining = task.estimatedDuration;
    let floor = notBefore;
    for (let guard = 0; remaining > 0 && guard < 500; guard++) {
      const maxSize = willChunk ? Math.min(maxChunkCap, remaining) : remaining;
      const minSize = willChunk ? Math.min(minChunkFloor, remaining) : remaining;
      const placement = placeSession(task, minSize, maxSize, slots, dayStates, p, floor, deadlineCap);
      if (placement.refusal !== null || placement.end.getTime() === 0) {
        failed = true;
        refusal = placement.refusal;
        break;
      }
      rawPlaced.push({
        start: placement.start,
        end: placement.end,
        energy: placement.energy,
        category: placement.category,
      });
      const placedMin = Math.round((placement.end.getTime() - placement.start.getTime()) / MS_PER_MIN);
      remaining -= placedMin;
      floor = placement.end;
      if (placedMin <= 0) break; // safety: never loop on a zero-length placement
    }

    // Now the piece count is known, so each block can say "3 of 7".
    const count = rawPlaced.length;
    const placedForTask: ScheduledBlock[] = rawPlaced.map((r, i) => ({
      taskId: task.id,
      start: r.start,
      end: r.end,
      reason: reasonFor(task, r, count > 1 ? { index: i + 1, count } : null),
      isChunk: count > 1,
      chunkIndex: count > 1 ? i + 1 : undefined,
      chunkCount: count > 1 ? count : undefined,
    }));

    if (failed && willChunk && placedForTask.length > 0) {
      // "Split across sittings" means spread it — so keep the sittings that
      // found a home and report the shortfall, instead of throwing away hours
      // that fit because the last ones didn't. Dropping the whole task is what
      // made a 15h block with real open afternoons schedule as *nothing*.
      blocks.push(...placedForTask);
      const last = placedForTask.at(-1);
      if (last) finishedAt.set(task.id, last.end);
      const placedMin = task.estimatedDuration - remaining;
      unscheduled.push({
        taskId: task.id,
        reason: `scheduled ${hoursLabel(placedMin)} of ${hoursLabel(task.estimatedDuration)} — the last ${hoursLabel(remaining)} ${partialShortfall(refusal)}`,
      });
    } else if (failed) {
      // Non-chunkable, or nothing placed at all: it's all-or-nothing. Roll back
      // any partial placement so we don't strand orphan chunks.
      unplaceable.add(task.id);
      unscheduled.push({
        taskId: task.id,
        reason: notBefore
          ? "no room left after the task it depends on — try moving its prerequisite earlier"
          : refusalReason(refusal, task, input),
      });
    } else {
      blocks.push(...placedForTask);
      const last = placedForTask.at(-1);
      if (last) finishedAt.set(task.id, last.end);
      // Placed, but its ordering couldn't be honoured. Say so on the block
      // rather than quietly implying the dependency was respected.
      if (cyclic.has(task.id) && last) {
        blocks[blocks.length - 1] = {
          ...last,
          reason: `${last.reason} (its dependencies form a loop, so the order couldn't be guaranteed)`,
        };
      }
    }
  }

  blocks.sort((a, b) => a.start.getTime() - b.start.getTime());

  // Total permitted work across the horizon — the honest denominator. Raw open
  // time flatters the plan; this is what the persona actually allows.
  const budgetMinutes = [...dayStates.values()].reduce((n, s) => n + s.budget, 0);

  return {
    blocks,
    unscheduled,
    capacity: computeCapacity(input, blocks, unscheduled, capacityMinutes, budgetMinutes),
  };
}

/** "2h 30m", "45m", "3h" — compact durations for the plan's explanations. */
function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** The tail clause for a partially-scheduled task: why the rest didn't fit. */
function partialShortfall(refusal: Refusal): string {
  if (refusal === "deadline") return "doesn't fit before it's due — extend the deadline, or clear some time that week";
  if (refusal === "budget") return "would push those days past their focus budget — raise it in Settings, or let something go";
  if (refusal === "sessions") return "would go over your daily session cap — extend a sitting, or give it another day";
  if (refusal === "dread") return "landed on days already carrying their share of avoided work";
  return "had no open slot left this week";
}

/** Explain, in the user's terms, why a task didn't make the plan. */
function refusalReason(refusal: Refusal, task: SchedulableTask, input: SchedulerInput): string {
  if (refusal === "deadline") {
    return "there isn't enough open time before it's due — extend the deadline, or clear some commitments that week";
  }
  if (refusal === "budget") {
    return "your days are already at their limit — this is protected downtime, not wasted space. Raise your daily focus budget in Settings, or let something go";
  }
  if (refusal === "sessions") {
    return "you've hit your cap on separate work sessions per day. Fewer, longer blocks suit you better — extend a session or move this to another day";
  }
  if (refusal === "dread") {
    return "you're already facing your share of avoided tasks that day, and stacking them is how a plan gets abandoned. It's queued for the next one";
  }
  return task.deadline && task.deadline < input.horizonEnd
    ? "no open, energy-appropriate slot before its deadline — consider extending the deadline or letting something go"
    : "no open slot in the planning horizon";
}

/**
 * Capacity vs. demand, energy-weighted (§9.4a, §9.5). Overcommitment is flagged
 * gently: which tasks are at risk, so the user can reprioritize rather than
 * silently miss a deadline.
 */
function computeCapacity(
  input: SchedulerInput,
  blocks: ScheduledBlock[],
  unscheduled: ScheduleProposal["unscheduled"],
  /** Pre-placement capacity, totalled by the caller from the same slot grid. */
  capacityMinutes: number,
  /** What the persona actually permits across the horizon. */
  budgetMinutes: number,
): ScheduleProposal["capacity"] {
  const demandMinutes = input.tasks.reduce((s, t) => s + t.estimatedDuration, 0);

  // At-risk: anything unscheduled, plus scheduled-past-deadline.
  const atRisk = new Set(unscheduled.map((u) => u.taskId));
  const lastChunkEnd = new Map<string, Date>();
  for (const b of blocks) {
    const prev = lastChunkEnd.get(b.taskId);
    if (!prev || b.end > prev) lastChunkEnd.set(b.taskId, b.end);
  }
  for (const t of input.tasks) {
    if (!t.deadline) continue;
    const end = lastChunkEnd.get(t.id);
    if (end && end > t.deadline) atRisk.add(t.id);
  }

  return {
    demandMinutes,
    capacityMinutes,
    budgetMinutes,
    // Overcommitment is judged against the BUDGET, not raw open time: a day with
    // eight free hours and a four-hour budget is full at four, and pretending
    // otherwise is exactly how the wall-of-blocks plan got built.
    overcommitted: demandMinutes > Math.min(capacityMinutes, budgetMinutes) || atRisk.size > 0,
    atRiskTaskIds: [...atRisk],
  };
}
