/**
 * When a block's default "at the time" reminder should fire — one rule, shared
 * by everything that creates that default server-side (import ingestion and the
 * one-off backfill), so they can't drift from each other or from the client.
 *
 * It mirrors the client's create-flow default (TaskDetail):
 *
 *  • A start time fires at the start.
 *  • A deadline-only task fires at 9am local on the due date — never at the
 *    stored midnight, because a 3am notification is the surest way to get
 *    reminders turned off for good. The user's zone is needed for that one hour,
 *    which is why `tz` is a parameter.
 *  • A recurring block fires for its next occurrence at/after `now`, skipping any
 *    that have already passed (a backlog of missed pings is worse than silence).
 *
 * Returns null when there's nothing to count back from (a bare task), when the
 * only moment is already in the past (non-recurring), or when a recurring series
 * has no occurrence left.
 */

import { nextAfter } from "@/src/lib/recurrence/rrule";
import { zonedParts, zonedWallToUtc } from "@/src/lib/scheduler/tz";

export interface RemindableBlock {
  kind: string;
  startTime: Date | null;
  deadline: Date | null;
  recurrenceRule: string | null;
}

/** Hour of day a deadline-only task's reminder lands on, in the user's zone. */
const DEADLINE_HOUR = 9;

export function defaultReminderFireAt(
  block: RemindableBlock,
  tz: string,
  now: Date,
): Date | null {
  // The moment the (first / anchor) occurrence sits at.
  let base: Date | null = null;
  if (block.startTime) {
    base = block.startTime;
  } else if (block.kind === "task" && block.deadline) {
    // 9am local on the deadline's calendar day — the client's exact rule.
    const p = zonedParts(block.deadline, tz);
    base = zonedWallToUtc(p.year, p.month, p.day, DEADLINE_HOUR, 0, tz);
  }
  if (!base) return null;

  if (block.recurrenceRule) {
    // The anchor is already ahead — fire for it directly.
    if (base.getTime() > now.getTime()) return base;
    // Otherwise jump to the first occurrence at or after now. nextAfter is
    // strictly-after, so nudge back a millisecond to keep an occurrence landing
    // exactly on `now`. Null means the series has ended.
    return nextAfter(block.recurrenceRule, base, new Date(now.getTime() - 1));
  }

  // One-shot: only worth a reminder if it hasn't happened yet.
  return base.getTime() > now.getTime() ? base : null;
}
