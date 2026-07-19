/**
 * Tasks that belong to a day but have no hour.
 *
 * The calendar grid can only draw something that has a start *and* an end, so a
 * task due Thursday with no time on it is invisible there — not deprioritised,
 * not collapsed, simply absent. That's the calendar quietly lying about how full
 * Thursday is, and it's the failure mode that makes someone plan a day around a
 * grid that was never showing them everything.
 *
 * These functions decide what's missing from a column so it can be surfaced as
 * a nudge rather than discovered on the day.
 */

import dayjs from "dayjs";

export interface UntimedCandidate {
  id: string;
  title?: string;
  status?: string;
  startTime?: string | null;
  endTime?: string | null;
  deadline?: string | null;
  letGoAt?: string | null;
  deletedAt?: string | null;
}

/**
 * The day this task sits on *if* it won't render as a block, else null.
 *
 * The half-timed case — a start with no end — is deliberately treated as
 * untimed rather than ignored. The grid requires both, so such a task is
 * invisible; it having a start time makes that more surprising, not less.
 */
export function untimedDayKey(t: UntimedCandidate): string | null {
  if (t.deletedAt || t.letGoAt) return null;
  if (t.status === "done") return null;

  // Drawable on the grid: not our problem.
  if (t.startTime && t.endTime) return null;

  const when = t.startTime ?? t.deadline;
  return when ? dayjs(when).format("YYYY-MM-DD") : null;
}

/**
 * Untimed tasks for one day.
 *
 * `placedTaskIds` are tasks the planner has already put on the calendar via
 * their own event rows — they're visible on the grid even though the task
 * itself carries no time, so nudging about them would be pointing at something
 * the user can already see.
 */
export function untimedForDay<T extends UntimedCandidate>(
  todos: T[],
  day: dayjs.Dayjs | Date | string,
  placedTaskIds?: Set<string> | ReadonlySet<string>,
): T[] {
  const key = dayjs(day).format("YYYY-MM-DD");
  return todos.filter(
    (t) => !placedTaskIds?.has(t.id) && untimedDayKey(t) === key,
  );
}

/**
 * How the nudge reads.
 *
 * Names the single case, because "1 task without a time" makes you open
 * something to find out what it is when the label could just have told you.
 */
export function untimedLabel(items: { title?: string }[]): string | null {
  if (items.length === 0) return null;
  if (items.length === 1) return items[0].title?.trim() || "Untitled";
  return `${items.length} without a time`;
}
