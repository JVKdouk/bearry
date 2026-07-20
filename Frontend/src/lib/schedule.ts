import type { Dayjs } from "dayjs";

/**
 * Turn a date / time / duration choice into the block fields that store it.
 *
 * The shape a task takes depends on how much you pinned down:
 *  - date + time  → a real interval (startTime/endTime), no deadline.
 *  - date only    → a due-by deadline at end of that day, no start.
 *  - neither      → unscheduled; only the estimate survives.
 *
 * Shared between the task drawer and the quick reschedule on the day view so
 * "when does this happen" is written the same way wherever it's set.
 */
export function schedulePatch(date: Dayjs | null, time: Dayjs | null, duration: number) {
  if (date && time) {
    const start = date.hour(time.hour()).minute(time.minute()).second(0).millisecond(0);
    const end = start.add(duration || 30, "minute");
    return {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      deadline: null,
      estimatedDuration: duration || 30,
    };
  }
  if (date) {
    return {
      deadline: date.endOf("day").toISOString(),
      startTime: null,
      endTime: null,
      estimatedDuration: duration || 30,
    };
  }
  return { deadline: null, startTime: null, endTime: null, estimatedDuration: duration || 30 };
}
