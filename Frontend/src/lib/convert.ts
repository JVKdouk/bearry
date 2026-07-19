/**
 * Turning one kind of block into another.
 *
 * A captured thought rarely arrives as the right shape. "Read the Q3 report"
 * starts as a task, turns out to be reference material, and becomes a note.
 * "Dentist" is a task until you book it, at which point it's an event that
 * happens whether or not you do anything.
 *
 * This used to build a whole new record and delete the old one, because the
 * three kinds lived in three tables — which meant steps, links, reminders and
 * the id itself all had to be dealt with, and a failure between the two writes
 * lost the content outright. Now a conversion is a patch on the same row, so
 * everything pointing at it keeps pointing at it.
 *
 * The rules about what a conversion *changes* are still the interesting part,
 * so they live here and are tested rather than being inline in a menu handler.
 */

import type { Block, BlockKind } from "./types";

/** Round up to the next quarter hour — a sane default start for an event. */
export function nextQuarterHour(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setSeconds(0, 0);
  // Always forward, including from an exact quarter. Rounding 09:15:30 down to
  // 09:15 handed back a "next" start that had already passed.
  d.setMinutes(d.getMinutes() + (15 - (d.getMinutes() % 15)));
  return d;
}

/**
 * The patch that turns `block` into `kind`.
 *
 * Returns only what changes. Fields that no longer apply are actively cleared
 * rather than left to linger: a note that kept a deadline would still show up
 * as overdue, and an event that kept `status: done` would look completed the
 * moment it was converted back.
 */
export function convertTo(
  block: Pick<Block, "kind" | "startTime" | "endTime" | "deadline" | "estimatedDuration">,
  kind: BlockKind,
  fallbackStart: Date = nextQuarterHour(),
): Partial<Block> {
  if (kind === block.kind) return {};

  if (kind === "note") {
    // A note is not actionable and holds no time, so everything that only
    // means something for the other two is cleared.
    return {
      kind: "note",
      startTime: null,
      endTime: null,
      deadline: null,
      recurrenceRule: null,
      status: "todo",
      isFixed: false,
    };
  }

  if (kind === "task") {
    // Times are kept. A task with a start and an end is a scheduled task,
    // which is a perfectly good thing to be — dropping them would throw away
    // the one piece of information an event actually carried.
    return { kind: "task", status: "todo", isFixed: false };
  }

  // An event occupies time whether or not you act, so it must have a start.
  // Prefer what the block already carries: its own schedule, then its deadline,
  // then the caller's fallback (usually "now, rounded").
  const start = block.startTime
    ? new Date(block.startTime)
    : block.deadline
      ? new Date(block.deadline)
      : fallbackStart;

  const minutes = Math.max(1, block.estimatedDuration || 30);
  const end = block.endTime && block.startTime
    ? new Date(block.endTime)
    : new Date(start.getTime() + minutes * 60_000);

  return {
    kind: "event",
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    // Its length is now a fact rather than an estimate.
    estimatedDuration: Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000)),
    deadline: null,
    status: "todo",
  };
}

/**
 * Does converting to `kind` discard anything the user would miss?
 *
 * Only steps, and only when leaving `task` — nothing else is lost now that the
 * row survives. Worth saying out loud in the confirm rather than discovering
 * afterwards.
 */
export function convertLoses(from: BlockKind, to: BlockKind, stepCount: number): string | null {
  if (from === to) return null;
  if (from === "task" && stepCount > 0) {
    return `${stepCount} step${stepCount === 1 ? "" : "s"} will be removed`;
  }
  return null;
}
