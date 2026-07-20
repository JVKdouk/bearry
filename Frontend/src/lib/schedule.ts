import type { Dayjs } from "dayjs";

/**
 * How a task relates to its date — the choice that used to be inferred (and so,
 * invisible) and is now explicit in the UI:
 *
 *  - "by": a deadline. The task floats; the planner finds time to do it BEFORE
 *          the end of that day. This is the flexible, plan-it-for-me case.
 *  - "at": a fixed appointment. It happens exactly at that time and the planner
 *          never moves it.
 */
export type ScheduleMode = "by" | "at";

/**
 * Turn a mode / date / time / duration choice into the block fields that store
 * it. The mode decides the shape rather than the presence of a time doing it
 * silently — picking a time no longer turns a "due by" task into a fixed
 * appointment behind the user's back.
 *
 *  - at  + date + time → a real interval (startTime/endTime), no deadline.
 *  - by  + date        → a due-by deadline at end of that day, no start.
 *  - no date           → unscheduled; only the estimate survives.
 *
 * ("at" with no time yet falls back to a due-by deadline — the popover keeps a
 * time set in that mode, so this is only a transient safety net.)
 *
 * Shared between the task drawer and the quick reschedule on the day view so
 * "when does this happen" is written the same way wherever it's set.
 */
export function schedulePatch(
  mode: ScheduleMode,
  date: Dayjs | null,
  time: Dayjs | null,
  duration: number,
) {
  const dur = duration || 30;
  if (!date) return { deadline: null, startTime: null, endTime: null, estimatedDuration: dur };

  if (mode === "at" && time) {
    const start = date.hour(time.hour()).minute(time.minute()).second(0).millisecond(0);
    const end = start.add(dur, "minute");
    return {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      deadline: null,
      estimatedDuration: dur,
    };
  }

  return {
    deadline: date.endOf("day").toISOString(),
    startTime: null,
    endTime: null,
    estimatedDuration: dur,
  };
}
