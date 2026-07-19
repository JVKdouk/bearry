/**
 * Forgiving defaults (§1.4 p8): a user who never opens settings still gets a
 * good schedule. On first need we seed a sensible ScheduleProfile (9–5 weekdays)
 * and a default energy profile (mornings high, post-lunch low) so energy-aware
 * scheduling works before any configuration (§9.4a).
 */

import database from "@/core/database";

/**
 * Weekdays 09:00–17:00 plus a lighter weekend window. `workingHours` is JSON
 * keyed by weekday index (0=Sun).
 *
 * Weekends are included on purpose: availability is `workingHours ∪ regions`,
 * so a Mon–Fri-only default left Saturday/Sunday with *zero* capacity — asking
 * the planner for "my day" on a weekend returned nothing at all and reported
 * every task as unplaceable. Life admin doesn't stop on Saturday.
 */
const DEFAULT_WORKING_HOURS = JSON.stringify({
  "0": [{ start: "10:00", end: "18:00" }],
  "1": [{ start: "09:00", end: "17:00" }],
  "2": [{ start: "09:00", end: "17:00" }],
  "3": [{ start: "09:00", end: "17:00" }],
  "4": [{ start: "09:00", end: "17:00" }],
  "5": [{ start: "09:00", end: "17:00" }],
  "6": [{ start: "10:00", end: "18:00" }],
});

const WEEKDAY_MASK = 0b0111110; // Mon–Fri (bit0=Sun … bit6=Sat)

/** Mornings deep-focus, early-afternoon trough, late-afternoon medium. */
const DEFAULT_ENERGY = [
  { start: "09:00", end: "12:00", energyLevel: "high" as const },
  { start: "13:00", end: "14:30", energyLevel: "low" as const },
  { start: "14:30", end: "17:00", energyLevel: "medium" as const },
];

/** Ensure the user has a schedule profile; create the default if missing. */
export async function ensureScheduleProfile(userId: string) {
  const existing = await database.scheduleProfile.findFirst({
    where: { userId, deletedAt: null },
  });
  if (existing) return existing;
  return database.scheduleProfile.create({
    data: { userId, name: "Default", workingHours: DEFAULT_WORKING_HOURS, timezone: "UTC" },
  });
}

/** Ensure the user has energy windows; seed the default profile if none. */
export async function ensureEnergyWindows(userId: string) {
  const existing = await database.energyWindow.findMany({
    where: { userId, deletedAt: null },
  });
  if (existing.length > 0) return existing;
  await database.energyWindow.createMany({
    data: DEFAULT_ENERGY.map((e) => ({
      userId,
      dayMask: WEEKDAY_MASK,
      start: e.start,
      end: e.end,
      energyLevel: e.energyLevel,
      source: "user" as const,
    })),
  });
  return database.energyWindow.findMany({ where: { userId, deletedAt: null } });
}
