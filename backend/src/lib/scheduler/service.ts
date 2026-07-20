/**
 * Scheduler service: loads the user's cleartext scheduling metadata (durations,
 * deadlines, priorities, energy demand, busy times — NO decryption, §9.7),
 * runs the pure solver, and returns a proposal. Apply writes the accepted blocks
 * as BearAI CalendarEvents; undo reverses the last applied plan (§9.6).
 */

import database from "@/core/database";
import { solve } from "./solver";
import { isFixedInTime, fixedInterval } from "./timedTask";
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
  opts: { taskIds?: string[] } = {},
): Promise<ScheduleProposal> {
  // Plan only these tasks, when asked (swipe-to-plan a single card, or a bulk
  // selection). Everything else the user has still counts as busy/blocking —
  // we just don't propose slots for it. An empty allow-list would mean "plan
  // nothing", which is never the intent, so it's treated as "plan everything".
  const onlyIds =
    opts.taskIds && opts.taskIds.length > 0 ? new Set(opts.taskIds) : null;
  const [profile, energy, persona] = await Promise.all([
    ensureScheduleProfile(userId),
    ensureEnergyWindows(userId),
    loadPersona(userId),
  ]);

  // Everything the planner needs, in four reads instead of six.
  //
  // Merging todos and calendar events into one table collapsed the awkward
  // part of this: "a todo with a start and an end is really an event" used to
  // be a comment and a filter, and busy time had to be assembled from three
  // sources that could disagree. Now a block either occupies time or it
  // doesn't, whatever kind it is.
  //
  // These reads are independent, so they go out together. Run sequentially
  // they cost a round-trip each on what is already the slowest interaction in
  // the app; the work is identical, only the waiting differs.
  const [candidates, occupied, busyBlocks, depLinks, regions] = await Promise.all([
    // Schedulable candidates: actionable, unfinished, not let go. Events and
    // notes are excluded by kind rather than by inference.
    database.block.findMany({
      where: {
        userId,
        kind: "task",
        deletedAt: null,
        letGoAt: null,
        status: { not: "done" },
      },
      select: {
        id: true, estimatedDuration: true, deadline: true, priority: true, category: true,
        startTime: true, endTime: true, desire: true, status: true,
        energyDemand: true, chunkable: true, minChunk: true, maxChunk: true, createdAt: true,
      },
    }),

    // Anything that occupies time in the horizon is busy and immovable (§9.3):
    // meetings, imported events, timed tasks, and the planner's own accepted
    // blocks. `planForId` marks the last of those, which is also how we know a
    // task has already been scheduled and shouldn't be proposed again.
    //
    // Without that, accepting a plan and pressing Plan again re-proposed every
    // task at different hours: the accepted blocks counted as busy, but the
    // tasks behind them still looked unscheduled.
    database.block.findMany({
      where: {
        userId,
        deletedAt: null,
        letGoAt: null,
        startTime: { not: null, lt: horizonEnd },
        endTime: { gt: horizonStart },
      },
      select: { startTime: true, endTime: true, planForId: true },
    }),

    database.timeBlock.findMany({
      where: { userId, deletedAt: null, type: "busy", start: { lt: horizonEnd }, end: { gt: horizonStart } },
      select: { start: true, end: true },
    }),

    // Dependencies: "A blocks B" means B can't start until A is finished.
    // Stored as ordinary Link rows (§8.7) so they sync and need no bespoke table.
    database.link.findMany({
      where: { userId, deletedAt: null, linkType: "blocks", fromType: "block", toType: "block" },
      select: { fromId: true, toId: true },
    }),

    // Recurring time-blocking regions (work/sleep/family) shape where tasks land.
    database.blockRegion.findMany({
      where: { userId, deletedAt: null },
      select: { category: true, dayMask: true, start: true, end: true },
    }),
  ]);

  const busy = occupied.map((b) => ({ start: b.startTime!, end: b.endTime! }));
  // Tasks with a plan block already on the calendar are done being scheduled.
  const plannedTaskIds = new Set(
    occupied.map((b) => b.planForId).filter((id): id is string => !!id),
  );

  // Tasks the user pinned to a moment — a start time, or a deadline that
  // carries a real time of day (an import's "due 17:00", not a bare due date).
  // The planner must never relocate these; it excludes them from scheduling and
  // treats them as busy at their own time. Without this a task with a defined
  // time was floated into a random slot this week merely because it wasn't done.
  const tz = profile.timezone || "UTC";
  const nowMs = Date.now();
  const fixedTaskIds = new Set<string>();
  for (const t of candidates) {
    if (!isFixedInTime(t, tz)) continue;
    const interval = fixedInterval(t, tz);
    // A pin whose moment has already passed didn't happen — an overdue timed
    // task, or an appointment-shaped deadline now in the past. Leaving it fixed
    // strands it there forever (excluded from scheduling, too old to be busy);
    // instead let it fall through to the solver, which re-places it into the
    // future. Only a still-upcoming pin is honoured as immovable.
    if (!interval || interval.end.getTime() <= nowMs) continue;
    fixedTaskIds.add(t.id);
    if (interval.start < horizonEnd && interval.end > horizonStart) {
      busy.push(interval);
    }
  }

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
  const schedulable = candidates.filter(
    (t) =>
      // Only the tasks asked for, when a subset was named.
      (!onlyIds || onlyIds.has(t.id)) &&
      // Pinned to a time (start time, or an appointment-shaped deadline) — the
      // planner leaves it exactly where the user put it.
      !fixedTaskIds.has(t.id) &&
      !plannedTaskIds.has(t.id) &&
      t.estimatedDuration > 0 &&
      // The relevance cutoff keeps a "plan my week" from hoovering in things
      // due months out. A hand-picked task is the user saying "this one, now" —
      // honour it whatever its deadline.
      (!!onlyIds || !t.deadline || t.deadline <= relevanceCutoff),
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
    candidates.filter((t) => t.status === "done").map((t) => t.id),
  );

  // When each already-placed blocker actually finishes.
  const placedEnds = new Map<string, Date>();
  for (const b of occupied) {
    // A plan block finishes on behalf of the task it is doing; anything else
    // that occupies time finishes on its own behalf.
    const owner = b.planForId;
    if (!owner || !b.endTime) continue;
    const prev = placedEnds.get(owner);
    if (!prev || b.endTime > prev) placedEnds.set(owner, b.endTime);
  }
  for (const t of candidates) {
    if (!t.startTime || !t.endTime) continue;
    const prev = placedEnds.get(t.id);
    if (!prev || t.endTime > prev) placedEnds.set(t.id, t.endTime);
  }

  // Every todo the user still has open — used to tell "blocker we can't schedule
  // yet" apart from "blocker that no longer exists".
  const knownOpenIds = new Set(candidates.map((t) => t.id));

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

  const input: SchedulerInput = {
    tasks,
    busy: [...busy, ...busyBlocks],
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
 * Apply a proposal: write each placement as an event block tagged with the task
 * it is doing time for and the solver's reason. Returns the created ids so the
 * client (and undo) can track this plan. The title arrives already encrypted
 * from the endpoint, copied from the task it serves.
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
  const created = await database.block.createManyAndReturn({
    data: blocks.map((b) => ({
      userId,
      kind: "event" as const,
      source: "local" as const,
      title: b.titleCiphertext, // already encrypted by the endpoint
      startTime: new Date(b.start),
      endTime: new Date(b.end),
      estimatedDuration: Math.max(
        1,
        Math.round((new Date(b.end).getTime() - new Date(b.start).getTime()) / 60_000),
      ),
      isFixed: false,
      planForId: b.taskId,
      scheduleReason: b.reason,
    })),
    select: { id: true },
  });
  return created.map((r: { id: string }) => r.id);
}

/**
 * Undo: soft-delete planner-placed blocks by id (§9.6 one-tap undo).
 *
 * Scoped to blocks that are actually the planner's output — `planForId` is the
 * thing that makes a block ours to remove. Matching on source would now also
 * match everything the user made by hand, since both are `local`.
 */
export async function undoBlocks(userId: string, blockIds: string[]): Promise<number> {
  const { count } = await database.block.updateMany({
    where: { id: { in: blockIds }, userId, planForId: { not: null } },
    data: { deletedAt: new Date() },
  });
  return count;
}
