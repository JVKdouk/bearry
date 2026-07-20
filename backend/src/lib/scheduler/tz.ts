/**
 * Timezone-correct wall-clock math for the scheduler, with no dependency.
 *
 * The server process runs in one zone; a user may live in another. Working
 * hours, energy windows and day boundaries are all *wall clock* — "09:00 on
 * Monday" — so they have to be resolved in the user's zone, not the server's.
 * The solver used to read the process-local clock (getHours/getDay), which is
 * only correct when the server and the user happen to share a zone.
 *
 * Everything here is built on one primitive: the offset of a zone at an instant,
 * derived from Intl. Offsets are DST-aware and always a whole number of minutes,
 * so the two conversions below are exact.
 */

/** Minutes east of UTC for `tz` at the instant `date` (DST-aware). */
export function offsetMinutes(date: Date, tz: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    return 0; // Unknown zone falls back to UTC rather than throwing mid-plan.
  }
  const p: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUTC - date.getTime()) / 60_000);
}

/** Local wall-clock parts of `date` in `tz`. `weekday` is 0=Sun … 6=Sat. */
export function zonedParts(
  date: Date,
  tz: string,
): { year: number; month: number; day: number; weekday: number; hour: number; minute: number } {
  // Shifting the instant by its zone offset and then reading UTC fields gives
  // the wall-clock the user sees — offsets being whole minutes makes this exact.
  const shifted = new Date(date.getTime() + offsetMinutes(date, tz) * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** The UTC instant of wall-clock `y-mo-d h:mi` in `tz` (`mo` is 1–12). DST-safe. */
export function zonedWallToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz: string,
): Date {
  // Guess by treating the wall clock as if it were UTC, correct by the zone's
  // offset, then re-check once: near a DST change the offset at the guess and at
  // the result can differ, and the second read lands on the right side of it.
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = offsetMinutes(new Date(guess), tz);
  let utc = guess - off1 * 60_000;
  const off2 = offsetMinutes(new Date(utc), tz);
  if (off2 !== off1) utc = guess - off2 * 60_000;
  return new Date(utc);
}

/** Day-of-week in `tz`: 0=Sun … 6=Sat. */
export function zonedWeekday(date: Date, tz: string): number {
  return zonedParts(date, tz).weekday;
}

/** Minutes since local midnight in `tz`. */
export function zonedMinutesOfDay(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  return p.hour * 60 + p.minute;
}

/** A stable key for the local calendar day in `tz`. */
export function zonedDayKey(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The UTC instant of local midnight on the day `date` falls in, in `tz`. */
export function zonedStartOfDay(date: Date, tz: string): Date {
  const p = zonedParts(date, tz);
  return zonedWallToUtc(p.year, p.month, p.day, 0, 0, tz);
}

/** Local midnight of the day after the one `dayMidnight` falls in, in `tz`. */
export function zonedNextDay(dayMidnight: Date, tz: string): Date {
  const p = zonedParts(dayMidnight, tz);
  // Date.UTC normalises day+1 across month and year ends.
  return zonedWallToUtc(p.year, p.month, p.day + 1, 0, 0, tz);
}
