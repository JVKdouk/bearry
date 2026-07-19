/**
 * Client-side recurrence helpers — presentation only.
 *
 * The authoritative engine lives on the server (`backend/src/lib/recurrence`),
 * and completion advancement happens there so the date maths has exactly one
 * tested implementation. This file deliberately does NOT expand occurrences: it
 * only offers the handful of rules the picker exposes and describes a stored
 * rule in words, which is all the UI needs.
 */

export interface RepeatOption {
  label: string;
  /** null = does not repeat */
  rule: string | null;
}

/** The presets, in the order they're offered. */
export function repeatOptions(weekdayIndex: number): RepeatOption[] {
  const code = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][weekdayIndex] ?? "MO";
  return [
    { label: "Does not repeat", rule: null },
    { label: "Every day", rule: "FREQ=DAILY" },
    { label: "Every weekday", rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
    { label: "Every week", rule: `FREQ=WEEKLY;BYDAY=${code}` },
    { label: "Every 2 weeks", rule: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${code}` },
    { label: "Every month", rule: "FREQ=MONTHLY" },
    { label: "Every year", rule: "FREQ=YEARLY" },
  ];
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/**
 * Describe a stored rule in words. Mirrors the server's `describeRRule`; kept
 * intentionally forgiving — an unrecognised rule shows a neutral "Repeats"
 * rather than claiming a schedule it can't verify.
 */
export function describeRepeat(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const body = raw.trim().replace(/^RRULE:/i, "");
  const parts = new Map<string, string>();
  for (const seg of body.split(";")) {
    const [k, v] = seg.split("=");
    if (k && v !== undefined) parts.set(k.toUpperCase(), v);
  }
  const freq = (parts.get("FREQ") ?? "").toUpperCase();
  const n = Number(parts.get("INTERVAL") ?? 1) || 1;
  const every = (unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);

  if (freq === "DAILY") return every("day");
  if (freq === "WEEKLY") {
    const days = (parts.get("BYDAY") ?? "")
      .split(",")
      .map((c) => DAY_CODES[c.trim().toUpperCase()])
      .filter((d) => d !== undefined);
    const isWeekdays = days.length === 5 && !days.includes(0) && !days.includes(6);
    if (isWeekdays && n === 1) return "Every weekday";
    const named = days.map((d) => DAY_NAMES[d]).join(", ");
    return named ? `${every("week")} on ${named}` : every("week");
  }
  if (freq === "MONTHLY") return every("month");
  if (freq === "YEARLY") return every("year");
  return "Repeats";
}
