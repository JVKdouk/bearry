/**
 * Scheduler service: loads the user's cleartext scheduling metadata (durations,
 * deadlines, priorities, energy demand, busy times — NO decryption, §9.7),
 * runs the pure solver, and returns a proposal. Apply writes the accepted blocks
 * as BearAI CalendarEvents; undo reverses the last applied plan (§9.6).
 */

import database from "@/core/database";
import { solve } from "./solver";
import { ensureScheduleProfile, ensureEnergyWindows } from "./defaults";
import { loadPersona } from "./persona";
import type { SchedulerInput, SchedulableTask, ScheduleProposal } from "./types";

/**
 * How far past the planning horizon a deadline may sit and still be worth
 * pulling forward. Two weeks lets you get ahead on genuinely upcoming work
 * without dragging in far-future items (birthdays, annual admin).
 */
const RELEVANCE_LOOKAHEAD_DAYS = 14;

export async function planForUser(
  userId: string,
  horizonStart: Date,
  horizonEnd: Date,
): Promise<ScheduleProposal> {
  const [profile, energy, persona] = await Promise.all([
    ensureScheduleProfile(userId),
    ensureEnergyWindows(userId),
    loadPersona(userId),
  ]);

  // Not-done, not-let-go todos (cleartext metadata only). A todo with a
  // start+end is an already-placed *timed* item (an "event"): it's busy, not
  // schedulable. Everything else is a candidate the solver can place.
  //
  // These six reads are independent of each other, so they go out together.
  // Run sequentially they cost six round-trips on what is already the slowest
  // interaction in the app; the work is identical, only the waiting differs.
  const [todos, alreadyPlanned, events, blocks, depLinks, regions] = await Promise.all([
    database.todo.findMany({
      where: { userId, deletedAt: null, letGoAt: null, status: { not: "done" } },
      select: {
        id: true, estimatedDuration: true, deadline: true, priority: true, category: true,
        startTime: true, endTime: true, desire: true, status: true,
        energyDemand: true, chunkable: true, minChunk: true, maxChunk: true, createdAt: true,
      },
    }),

    // Tasks that ALREADY have accepted plan blocks are done being scheduled.
    // Without this, accepting a plan and pressing Plan again re-proposed every
    // task a second time at different hours — the accepted blocks were counted
    // as busy, but the tasks behind them still looked unscheduled, so the
    // planner dutifully found them new homes and you ended up with duplicates.
    database.calendarEvent.findMany({
      where: {
        userId,
        deletedAt: null,
        source: "bearai",
        bearaiTaskId: { not: null },
        // Anything still ahead of us counts; past blocks shouldn't pin a task
        // forever if it was never actually done.
        end: { gt: horizonStart },
      },
      select: { bearaiTaskId: true },
    }),

    // Everything already on the calendar in the horizon is busy/immovable
    // (§9.3) — including fixed meetings (source=google / isFixed), which the
    // solver never schedules over.
    database.calendarEvent.findMany({
      where: { userId, deletedAt: null, start: { lt: horizonEnd }, end: { gt: horizonStart } },
      select: { start: true, end: true, bearaiTaskId: true },
    }),

    database.timeBlock.findMany({
      where: { userId, deletedAt: null, type: "busy", start: { lt: horizonEnd }, end: { gt: horizonStart } },
      select: { start: true, end: true },
    }),

    // Dependencies: "A blocks B" means B can't start until A is finished.
    // Stored as ordinary Link rows (§8.7) so they sync and need no bespoke table.
    database.link.findMany({
      where: { userId, deletedAt: null, linkType: "blocks", fromType: "todo", toType: "todo" },
      select: { fromId: true, toId: true },
    }),

    // Recurring time-blocking regions (work/sleep/family) shape where tasks land.
    database.blockRegion.findMany({
      where: { userId, deletedAt: null },
      select: { category: true, dayMask: true, start: true, end: true },
    }),
  ]);
  const timedTodos = todos.filter((t) => t.startTime && t.endTime);

  const plannedTaskIds = new Set(
    alreadyPlanned.map((e) => e.bearaiTaskId).filter((id): id is string => !!id),
  );

  // Only tasks that are actually *relevant* to this horizon are candidates.
  // The solver is a greedy fill — it places every task that fits — so without
  // this it happily packs leftover space with things due months away (a
  // birthday 289 days out was being scheduled into today). Scoring already
  // ranks those last, but "last" still means "scheduled" while slots remain.
  //
  // Relevant = overdue, OR due within the horizon plus a short lookahead (so
  // you can legitimately get ahead), OR undated backlog work.
  const relevanceCutoff = new Date(
    horizonEnd.getTime() + RELEVANCE_LOOKAHEAD_DAYS * 24 * 60 * 60_000,
  );
  // estimatedDuration <= 0 marks a *reminder* — a date to remember with no work
  // to perform (birthdays, renewals). Those belong on the day, not in a block.
  const schedulable = todos.filter(
    (t) =>
      !(t.startTime && t.endTime) &&
      !plannedTaskIds.has(t.id) &&
      t.estimatedDuration > 0 &&
      (!t.deadline || t.deadline <= relevanceCutoff),
  );


  const schedulableIds = new Set(schedulable.map((t) => t.id));

  /**
   * A blocker sits in exactly one of three states, and conflating the middle one
   * with the first is what let a dependent be scheduled BEFORE its prerequisite:
   *
   *  1. Finished — imposes no constraint at all.
   *  2. Already placed (accepted plan block, or a timed todo) — imposes a HARD
   *     floor at the time it actually happens. This was previously lumped in
   *     with "finished", so a task blocked by something already scheduled for
   *     Monday was free to land on Sunday.
   *  3. Open and not in this run — nothing can be guaranteed, so the dependent
   *     has to wait rather than be placed on a guess.
   */
  const finishedIds = new Set<string>(
    todos.filter((t) => t.status === "done").map((t) => t.id),
  );

  // When each already-placed blocker actually finishes.
  const placedEnds = new Map<string, Date>();
  for (const e of events) {
    if (!e.bearaiTaskId) continue;
    const prev = placedEnds.get(e.bearaiTaskId);
    if (!prev || e.end > prev) placedEnds.set(e.bearaiTaskId, e.end);
  }
  for (const t of timedTodos) {
    if (!t.endTime) continue;
    const prev = placedEnds.get(t.id);
    if (!prev || t.endTime > prev) placedEnds.set(t.id, t.endTime);
  }

  // Every todo the user still has open — used to tell "blocker we can't schedule
  // yet" apart from "blocker that no longer exists".
  const knownOpenIds = new Set(todos.map((t) => t.id));

  const relevantDeps = depLinks.filter(
    (l) =>
      schedulableIds.has(l.toId) &&
      l.fromId !== l.toId &&
      !finishedIds.has(l.fromId) && // done: drop the edge entirely
      (knownOpenIds.has(l.fromId) || placedEnds.has(l.fromId)), // else it's gone
  );

  const tasks: SchedulableTask[] = schedulable.map((t) => ({
    id: t.id,
    estimatedDuration: t.estimatedDuration,
    deadline: t.deadline,
    priority: t.priority,
    energyDemand: t.energyDemand,
    desire: t.desire,
    category: t.category,
    chunkable: t.chunkable,
    minChunk: t.minChunk,
    maxChunk: t.maxChunk,
    createdAt: t.createdAt,
  }));

  // Timed todos in the horizon are immovable busy blocks, like calendar events.
  const timedBusy = timedTodos
    .filter((t) => t.startTime! < horizonEnd && t.endTime! > horizonStart)
    .map((t) => ({ start: t.startTime!, end: t.endTime! }));

  const input: SchedulerInput = {
    tasks,
    busy: [...events, ...blocks, ...timedBusy],
    workingHours: JSON.parse(profile.workingHours),
    energyWindows: energy.map((e) => ({
      dayMask: e.dayMask, start: e.start, end: e.end, energyLevel: e.energyLevel,
    })),
    regions: regions.map((r) => ({ category: r.category, dayMask: r.dayMask, start: r.start, end: r.end })),
    horizonStart,
    horizonEnd,
    persona,
    // Edges whose blocker is finished (or no longer exists) are dropped above,
    // so everything left here is a constraint the solver must honour.
    dependencies: relevantDeps.map((l) => ({ blockerId: l.fromId, blockedId: l.toId })),
    /** Blockers already on the calendar: the dependent must start after these. */
    blockerEnds: Object.fromEntries(placedEnds),
  };

  return solve(input);
}

/**
 * Apply a proposal: write each block as a BearAI CalendarEvent tagged with its
 * source task and the solver's reason. Returns the created block ids so the
 * client (and undo) can track this plan. Title is a lightweight reference — the
 * event's own title is encrypted from the task title by the caller when needed.
 */
export async function applyPlan(
  userId: string,
  blocks: { taskId: string; start: string; end: string; reason: string; titleCiphertext: string }[],
): Promise<string[]> {
  if (blocks.length === 0) return [];

  // One insert for the whole plan instead of a round-trip per block. Applying a
  // week could previously mean a hundred sequential inserts, and a failure
  // halfway left a partially-applied plan the user could not fully undo.
  // `createManyAndReturn` gives back the ids undo needs while letting Prisma
  // generate them, so no second id format leaks into the table.
  const created = await database.calendarEvent.createManyAndReturn({
    data: blocks.map((b) => ({
      userId,
      source: "bearai",
      title: b.titleCiphertext, // already encrypted by the endpoint
      start: new Date(b.start),
      end: new Date(b.end),
      isFixed: false,
      bearaiTaskId: b.taskId,
      scheduleReason: b.reason,
    })),
    select: { id: true },
  });
  return created.map((r) => r.id);
}

/** Undo: soft-delete BearAI blocks by id (§9.6 one-tap undo). */
export async function undoBlocks(userId: string, blockIds: string[]): Promise<number> {
  const { count } = await database.calendarEvent.updateMany({
    where: { id: { in: blockIds }, userId, source: "bearai" },
    data: { deletedAt: new Date() },
  });
  return count;
}
