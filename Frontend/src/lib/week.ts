"use client";

import type { Dayjs } from "dayjs";
import { useCollection } from "@/store/hooks";

/** 0 = Sunday, 1 = Monday — matching dayjs's `.day()`. */
export type WeekStart = 0 | 1;

export const WEEK_START_KEY = "weekStartsOn";

/**
 * Start of the week containing `d`, for a Sunday- or Monday-based week.
 *
 * Kept out of dayjs's locale week-start (which is global and would leak across
 * every `.startOf("week")` in the app) and out of the isoWeek plugin (Monday
 * only). One explicit function, driven by the user's setting.
 */
export function startOfWeek(d: Dayjs, weekStartsOn: WeekStart): Dayjs {
  const diff = (d.day() - weekStartsOn + 7) % 7;
  return d.startOf("day").subtract(diff, "day");
}

export function endOfWeek(d: Dayjs, weekStartsOn: WeekStart): Dayjs {
  return startOfWeek(d, weekStartsOn).add(6, "day").endOf("day");
}

/** The user's configured week start — Sunday unless they've chosen Monday. */
export function useWeekStart(): WeekStart {
  const settings = useCollection("setting");
  const row = settings.find((s) => s.key === WEEK_START_KEY && !s.deletedAt);
  return row?.value === "1" ? 1 : 0;
}
