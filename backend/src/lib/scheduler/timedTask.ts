/**
 * Telling a "do this by" deadline apart from a "this happens at" time.
 *
 * The scheduler floats a task with a deadline into a work slot before it — that
 * is the whole point of a due date. But a task can also carry a *specific time
 * of day*, and that is not a deadline to plan around; it is an appointment. A
 * task imported as "Pay taxes, due 17:00 on the 24th" should sit at 17:00, not
 * be dragged into a random free half-hour this week just because it isn't done.
 *
 * The distinction is the time of day. When the app records a *date only*, it
 * stores the deadline at the end of that day (23:59 local). Anything with a
 * meaningful time — an import's due-with-time, or an explicit pick — is an
 * appointment. Comparing in the user's own timezone is what makes this correct:
 * "23:59 local" is a different UTC instant for every user, and a naive UTC-hour
 * check would misread half the world's date-only deadlines as appointments.
 */

/** The local wall-clock hour and minute of an instant, in `timezone`. */
export function localHourMinute(
  date: Date,
  timezone: string,
): { hour: number; minute: number } {
  // Intl is the only thing that gets DST and odd offsets right without a
  // dependency; a fixed offset would drift twice a year.
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
  } catch {
    // An unknown timezone falls back to UTC rather than throwing mid-plan.
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
  }
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hour, minute };
}

/**
 * Does this deadline carry a real time of day, or is it just a date?
 *
 * End-of-day (23:59) and midnight (00:00) are the two shapes a date-only
 * deadline takes — the app writes the first, some imports the second — and both
 * mean "by this day", so both float. Everything else is an appointment.
 */
export function deadlineIsAppointment(
  deadline: Date | null | undefined,
  timezone: string,
): boolean {
  if (!deadline) return false;
  const { hour, minute } = localHourMinute(deadline, timezone);
  const endOfDay = hour === 23 && minute === 59;
  const startOfDay = hour === 0 && minute === 0;
  return !endOfDay && !startOfDay;
}

export interface TimedFields {
  startTime?: Date | null;
  endTime?: Date | null;
  deadline?: Date | null;
}

/**
 * Is this task pinned to a moment the planner must not move?
 *
 * Either it has a start time (already a placed block), or its deadline is an
 * appointment. Both mean "the user said when"; the scheduler leaves them alone
 * and treats them as busy instead.
 */
export function isFixedInTime(task: TimedFields, timezone: string): boolean {
  if (task.startTime) return true;
  return deadlineIsAppointment(task.deadline ?? null, timezone);
}

/**
 * The interval a fixed task occupies, for busy-time — or null if it has no
 * time at all (shouldn't happen for a fixed task, but keeps callers honest).
 *
 * A start/end pair is used as-is. A deadline-appointment has no duration of its
 * own, so it claims `estimatedDuration` minutes ending at the deadline: "be
 * done by 17:00" blocks the run-up to 17:00, which is when the work happens.
 */
export function fixedInterval(
  task: TimedFields & { estimatedDuration?: number | null },
  timezone: string,
): { start: Date; end: Date } | null {
  if (task.startTime) {
    const start = task.startTime;
    const end = task.endTime ?? new Date(start.getTime() + (task.estimatedDuration ?? 30) * 60_000);
    return { start, end };
  }
  if (deadlineIsAppointment(task.deadline ?? null, timezone) && task.deadline) {
    const end = task.deadline;
    const start = new Date(end.getTime() - (task.estimatedDuration ?? 30) * 60_000);
    return { start, end };
  }
  return null;
}
