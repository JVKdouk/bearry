/**
 * Turning "remind me an hour before" into a moment.
 *
 * Kept pure and separate from the UI because the rules here are the ones that
 * decide whether a notification is useful or infuriating: reminders for things
 * that already happened, reminders that fire twice, reminders that survive
 * their task being rescheduled.
 */

/** Offsets offered in the UI, in minutes before the thing happens. */
export const REMINDER_OFFSETS = [
  { label: "At the time", minutes: 0 },
  { label: "10 minutes before", minutes: 10 },
  { label: "30 minutes before", minutes: 30 },
  { label: "1 hour before", minutes: 60 },
  { label: "1 day before", minutes: 60 * 24 },
  { label: "1 week before", minutes: 60 * 24 * 7 },
] as const;

/** The default when a task or event first gets a time. */
export const DEFAULT_OFFSET_MINUTES = 0;

export function offsetLabel(minutes: number): string {
  const known = REMINDER_OFFSETS.find((o) => o.minutes === minutes);
  if (known) return known.label;
  if (minutes <= 0) return "At the time";
  if (minutes < 60) return `${minutes} minutes before`;
  if (minutes < 60 * 24) {
    const h = Math.round(minutes / 60);
    return `${h} hour${h === 1 ? "" : "s"} before`;
  }
  const d = Math.round(minutes / (60 * 24));
  return `${d} day${d === 1 ? "" : "s"} before`;
}

/** When a reminder with this offset fires, for something starting at `start`. */
export function fireAtFor(start: Date | string, offsetMinutes: number): Date {
  const base = typeof start === "string" ? new Date(start) : start;
  return new Date(base.getTime() - offsetMinutes * 60_000);
}

/**
 * Is this offset worth offering for something starting at `start`?
 *
 * "1 week before" on a task due tomorrow would fire immediately — or, having
 * already passed, never. Offering a choice that cannot work is worse than
 * offering fewer choices, so the picker hides them.
 */
export function isOffsetUsable(
  start: Date | string,
  offsetMinutes: number,
  now: Date = new Date(),
): boolean {
  return fireAtFor(start, offsetMinutes).getTime() > now.getTime();
}

/** The offsets that can still fire, for a picker. */
export function usableOffsets(start: Date | string, now: Date = new Date()) {
  return REMINDER_OFFSETS.filter((o) => isOffsetUsable(start, o.minutes, now));
}

export interface ReminderLike {
  id: string;
  offsetMinutes: number;
  deletedAt?: string | null;
}

/**
 * Which offsets are already set, so the picker can show them as chosen and not
 * offer a duplicate. Two reminders at the same offset means two notifications
 * for one thing, which reads as a bug even when the user created both.
 */
export function chosenOffsets(reminders: ReminderLike[]): Set<number> {
  return new Set(reminders.filter((r) => !r.deletedAt).map((r) => r.offsetMinutes));
}

/**
 * Recompute every reminder's moment after the thing moved.
 *
 * Returns the patches to apply. `delivered` is reset for anything still in the
 * future: rescheduling a task to next week should notify you again, even if the
 * original reminder already fired.
 */
export function rescheduleReminders(
  reminders: ReminderLike[],
  start: Date | string | null,
  now: Date = new Date(),
): { id: string; fireAt: string | null; delivered: boolean }[] {
  return reminders
    .filter((r) => !r.deletedAt)
    .map((r) => {
      // No time means nothing to count back from; the reminder stays attached
      // to the task but can never fire, rather than being silently deleted.
      if (!start) return { id: r.id, fireAt: null, delivered: true };
      const fireAt = fireAtFor(start, r.offsetMinutes);
      return {
        id: r.id,
        fireAt: fireAt.toISOString(),
        delivered: fireAt.getTime() <= now.getTime(),
      };
    });
}
