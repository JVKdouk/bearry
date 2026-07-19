/**
 * Reading a duration the way someone would write one.
 *
 * The stepper moved in five-minute increments between a fixed set of presets,
 * which is fine for "half an hour" and absurd for anything long: entering a
 * fifteen-hour task meant 180 clicks, and the cap stopped at ten hours so it
 * was impossible anyway.
 *
 * People write durations in several ways and are not going to learn ours, so
 * this accepts all of the obvious ones and refuses the ambiguous ones rather
 * than guessing.
 */

/** Shortest thing worth scheduling; below this it's a thought, not a task. */
export const MIN_MINUTES = 1;

/**
 * A full day. The old ceiling was 600 (ten hours), which silently made the
 * five-hour splitting rule untestable from the UI — you couldn't enter a task
 * long enough to trigger it.
 */
export const MAX_MINUTES = 1440;

export function clampMinutes(minutes: number): number {
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes)));
}

/**
 * Parse a typed duration into minutes, or null if it isn't one.
 *
 * Accepted:
 *   "90"        → 90    (a bare number is minutes — the unit people mean)
 *   "90m"       → 90
 *   "2h"        → 120
 *   "1h30"      → 90
 *   "1h 30m"    → 90
 *   "1.5h"      → 90
 *   "1:30"      → 90
 *
 * Refused: anything with no digits, anything negative, and anything with
 * trailing junk. Returning null rather than a best guess matters here — a
 * misread duration doesn't fail loudly, it quietly gives the planner the wrong
 * number and every schedule after it is subtly wrong.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!text) return null;

  // "1:30" — clock notation.
  const clock = /^(\d+):([0-5]?\d)$/.exec(text);
  if (clock) {
    return finite(Number(clock[1]) * 60 + Number(clock[2]));
  }

  // "1h30", "1h30m", "2h", "1.5h"
  const hm = /^(\d+(?:\.\d+)?)h(\d+)?m?$/.exec(text);
  if (hm) {
    const hours = Number(hm[1]);
    const mins = hm[2] ? Number(hm[2]) : 0;
    // "1.5h30" is contradictory — a fractional hour AND minutes. Refuse rather
    // than pick one.
    if (hm[2] && !Number.isInteger(hours)) return null;
    return finite(hours * 60 + mins);
  }

  // "45m" or a bare "45"
  const m = /^(\d+(?:\.\d+)?)m?$/.exec(text);
  if (m) return finite(Number(m[1]));

  return null;
}

function finite(minutes: number): number | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return clampMinutes(minutes);
}

/**
 * How a duration should read back in the input while editing.
 *
 * Hours and minutes rather than a raw count, because "900" is unreadable and
 * "15h" is the thing the user was thinking.
 */
export function durationInputValue(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}
