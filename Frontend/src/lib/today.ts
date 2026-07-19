/**
 * What belongs on the day screen, and what has stopped belonging there.
 *
 * The rules are small and were wrong in a way that made the screen actively
 * misleading: every event that had already happened was being listed as
 * *overdue*, struck through, twenty-seven of them, above a heading that said
 * "0 Things Today". An event cannot be overdue — it isn't something you failed
 * to do, it's something that occurred — and a finished meeting is not a debt.
 *
 * Pure and separate from the page because this is date arithmetic against
 * "now", which is exactly the kind of logic that breaks silently at a boundary
 * nobody was looking at.
 */

export interface DayBlock {
  id: string;
  kind: "task" | "event" | "note";
  status?: string;
  startTime?: string | null;
  endTime?: string | null;
  deadline?: string | null;
}

/** The moment a block sits at, following the planner's placement if it has one. */
export function whenOf(b: DayBlock, plannedAt?: Map<string, string>): string | null {
  return b.startTime ?? plannedAt?.get(b.id) ?? b.deadline ?? null;
}

/**
 * Has this event already finished?
 *
 * Events only. A task with a start time in the past is late, which is a
 * different thing entirely and the whole reason the two can't share a rule.
 */
export function hasEnded(b: DayBlock, now: Date): boolean {
  if (b.kind !== "event") return false;
  const end = b.endTime ?? b.startTime;
  return !!end && new Date(end).getTime() <= now.getTime();
}

/**
 * Can this block be late at all?
 *
 * Only a task. This is the fix for the twenty-seven: an event was landing in
 * "Overdue" purely because its time had passed, which is true of every event
 * that has ever happened.
 */
export function canBeOverdue(b: DayBlock): boolean {
  return b.kind === "task" && b.status !== "done";
}

export interface DayPartition<T extends DayBlock> {
  /** Tasks from before today that are still open. */
  overdue: T[];
  /** What's on the selected day, minus anything that's already over. */
  forDay: T[];
  /** Open tasks with no date at all. */
  anytime: T[];
}

/**
 * Split the workspace into the three sections the day screen shows.
 *
 * `now` is passed in rather than read, so the boundaries are testable.
 */
export function partitionDay<T extends DayBlock>(
  blocks: T[],
  selectedKey: string,
  now: Date,
  plannedAt: Map<string, string>,
  todayKey: string,
  format: (iso: string) => string,
): DayPartition<T> {
  const isToday = selectedKey === todayKey;
  const overdue: T[] = [];
  const forDay: T[] = [];
  const anytime: T[] = [];

  for (const b of blocks) {
    const when = whenOf(b, plannedAt);

    if (!when) {
      anytime.push(b);
      continue;
    }

    const key = format(when);

    if (key === selectedKey) {
      // Today only: something that has already finished is not part of the day
      // ahead of you. On any other day the whole day is either past or future,
      // and hiding finished events would leave yesterday looking empty.
      if (isToday && hasEnded(b, now)) continue;
      forDay.push(b);
      continue;
    }

    // Late work is only shown while looking at today — on Thursday, Tuesday's
    // backlog is not what you came to see.
    if (isToday && key < todayKey && canBeOverdue(b)) overdue.push(b);
  }

  return { overdue, forDay, anytime };
}

/**
 * The item to lead with: whatever is happening now, else the next thing.
 *
 * Returns an index into an already time-sorted list, or -1 when nothing is
 * ahead. The featured card used to be simply the first item, which after a
 * morning of meetings meant the screen opened on something that finished hours
 * ago.
 */
export function currentOrNextIndex(items: DayBlock[], now: Date): number {
  const t = now.getTime();

  for (let i = 0; i < items.length; i++) {
    const b = items[i];
    const start = b.startTime ? new Date(b.startTime).getTime() : null;
    const end = b.endTime ? new Date(b.endTime).getTime() : null;
    // In progress right now.
    if (start !== null && end !== null && start <= t && end > t) return i;
  }

  for (let i = 0; i < items.length; i++) {
    const when = items[i].startTime ?? items[i].deadline;
    if (!when || new Date(when).getTime() > t) return i;
  }

  return items.length > 0 ? 0 : -1;
}

/** Is this block happening right now? Used to label the leading card. */
export function isInProgress(b: DayBlock, now: Date): boolean {
  if (!b.startTime || !b.endTime) return false;
  const t = now.getTime();
  return new Date(b.startTime).getTime() <= t && new Date(b.endTime).getTime() > t;
}
