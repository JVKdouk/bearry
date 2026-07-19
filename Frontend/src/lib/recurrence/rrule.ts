/**
 * A focused RFC 5545 RRULE engine (§7.5).
 *
 * Deliberately hand-written rather than pulling in a dependency. The rules this
 * app actually needs — "every day", "every weekday", "every 2 weeks on Tue and
 * Thu", "the 15th of each month", "annually" — are a small, well-defined subset,
 * and a focused implementation is something we can test exhaustively and reason
 * about. Recurrence bugs are the kind users notice a month later, so being able
 * to see the whole rule in one file matters more than covering every exotic
 * corner of the spec.
 *
 * The contract for anything outside that subset is the important part: parsing
 * returns null and the caller treats the task as a one-off. A rule we don't
 * fully understand must never silently generate *wrong* dates — a task that
 * doesn't repeat is a visible annoyance; a task that repeats on the wrong days
 * quietly corrupts a schedule.
 *
 * MIRRORED FILE. An identical copy lives at
 * `Frontend/src/lib/recurrence/rrule.ts`, because the app is offline-first: the
 * client has to expand a recurring event into its occurrences with no server to
 * ask. Two hand-maintained copies of date maths would drift, and drift here is
 * exactly the class of bug nobody notices for a month — so
 * `tests/recurrence-mirror.test.ts` asserts the two files are byte-identical
 * and fails the build if either side is edited alone. Edit this copy, then run
 * `npm run sync:rrule` to propagate.
 */

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface Rule {
  freq: Freq;
  /** Every N periods. Defaults to 1. */
  interval: number;
  /** Weekday numbers (0 = Sunday … 6 = Saturday). WEEKLY only. */
  byDay?: number[];
  /**
   * A positional weekday within the period — "the second Tuesday", "the last
   * Friday". MONTHLY/YEARLY only, and mutually exclusive with `byMonthDay`.
   *
   * `nth` is 1..4 counting forward or -1 counting back from the end. Fifth
   * occurrences are excluded deliberately: most months don't have one, so
   * "every 5th Monday" is a rule that mostly doesn't fire, which reads as
   * broken rather than as intended.
   */
  byDayPos?: { nth: number; day: number };
  /** Day-of-month (1–31). MONTHLY/YEARLY only. */
  byMonthDay?: number;
  /** Month (1–12). YEARLY only. */
  byMonth?: number;
  /** Stop after this many occurrences (inclusive of the first). */
  count?: number;
  /** Stop at/after this instant. */
  until?: Date;
}

const DAY_CODES: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};
const CODE_FOR_DAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/**
 * The parameters this engine implements. WKST is accepted but conditionally —
 * see below — because real feeds emit it constantly and rejecting it outright
 * would drop a large share of otherwise-supported rules to one-offs.
 */
const SUPPORTED_PARTS = new Set([
  "FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "COUNT", "UNTIL", "WKST",
]);

/** Parse an RRULE string. Returns null for anything unsupported or malformed. */
export function parseRRule(raw: string | null | undefined): Rule | null {
  if (!raw) return null;
  // Accept both "RRULE:FREQ=..." and a bare "FREQ=..." body.
  const body = raw.trim().replace(/^RRULE:/i, "");
  if (!body) return null;

  const parts = new Map<string, string>();
  for (const seg of body.split(";")) {
    const [k, v] = seg.split("=");
    if (!k || v === undefined) return null; // malformed: refuse rather than guess
    parts.set(k.trim().toUpperCase(), v.trim());
  }

  // Every parameter must be one we actually implement. Ignoring the ones we
  // don't know is how a rule gets HALF understood, which is the worst outcome:
  // TickTick's proprietary "ERULE:NAME=CUSTOM;FREQ=WEEKLY" parsed cleanly as a
  // plain weekly rule, and BYSETPOS / BYWEEKNO / BYYEARDAY all narrow a
  // recurrence in ways that make the rule fire on FEWER days than we'd compute.
  // Refusing outright degrades to a one-off, which is visible and harmless.
  for (const key of parts.keys()) {
    if (!SUPPORTED_PARTS.has(key)) return null;
  }

  const freqRaw = (parts.get("FREQ") ?? "").toUpperCase();
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freqRaw)) return null;
  const freq = freqRaw as Freq;

  const interval = parts.has("INTERVAL") ? Number(parts.get("INTERVAL")) : 1;
  if (!Number.isFinite(interval) || interval < 1 || interval > 366) return null;

  const rule: Rule = { freq, interval };

  if (parts.has("BYDAY")) {
    const codes = parts.get("BYDAY")!.split(",").map((c) => c.trim().toUpperCase());
    if (codes.length === 0) return null;

    // A positional form ("2FR" = second Friday, "-1SU" = last Sunday) means
    // something quite different from a plain weekday list, so the two are not
    // mixed: a single positional code, or a list of plain ones, never both.
    const positional = codes[0].match(/^(-?\d)([A-Z]{2})$/);
    if (positional) {
      if (codes.length > 1) return null; // "1MO,2TU" isn't a shape we implement
      const nth = Number(positional[1]);
      const day = DAY_CODES[positional[2]];
      // 5th and -2nd..-5th are refused: they'd skip most months, which reads as
      // a broken rule rather than an intended one.
      if (day === undefined || nth === 0 || nth > 4 || nth < -1) return null;
      rule.byDayPos = { nth, day };
    } else {
      const days: number[] = [];
      for (const c of codes) {
        if (!(c in DAY_CODES)) return null;
        days.push(DAY_CODES[c]);
      }
      rule.byDay = [...new Set(days)].sort((a, b) => a - b);
    }
  }

  if (parts.has("BYMONTHDAY")) {
    const d = Number(parts.get("BYMONTHDAY"));
    if (!Number.isInteger(d) || d < 1 || d > 31) return null; // negatives unsupported
    rule.byMonthDay = d;
  }

  if (parts.has("BYMONTH")) {
    const m = Number(parts.get("BYMONTH"));
    if (!Number.isInteger(m) || m < 1 || m > 12) return null;
    rule.byMonth = m;
  }

  if (parts.has("COUNT")) {
    const n = Number(parts.get("COUNT"));
    if (!Number.isInteger(n) || n < 1) return null;
    rule.count = n;
  }

  if (parts.has("UNTIL")) {
    const u = parseIcsDate(parts.get("UNTIL")!);
    if (!u) return null;
    rule.until = u;
  }

  // A plain weekday list only means something for weekly recurrence here; on
  // other frequencies it changes the expansion in ways this subset doesn't
  // implement. The positional form is the opposite — it's meaningless weekly.
  if (rule.byDay && freq !== "WEEKLY") return null;
  if (rule.byDayPos && freq !== "MONTHLY" && freq !== "YEARLY") return null;
  // "The second Tuesday" and "the 14th" are two different answers to the same
  // question; a rule carrying both is ambiguous, so refuse it.
  if (rule.byDayPos && rule.byMonthDay !== undefined) return null;

  // WKST names the day a week starts on, which only changes anything when whole
  // weeks are being counted — i.e. WEEKLY with INTERVAL > 1. Expansion anchors
  // on Sunday, so any other week start there would shift every occurrence by up
  // to six days. Everywhere else WKST is inert and safely ignored.
  const wkst = parts.get("WKST");
  if (wkst && freq === "WEEKLY" && interval > 1 && wkst.toUpperCase() !== "SU") {
    return null;
  }

  return rule;
}

/** Render a Rule back to an RRULE string (round-trips through parseRRule). */
export function formatRRule(rule: Rule): string {
  const parts: string[] = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.map((d) => CODE_FOR_DAY[d]).join(",")}`);
  if (rule.byDayPos) parts.push(`BYDAY=${rule.byDayPos.nth}${CODE_FOR_DAY[rule.byDayPos.day]}`);
  if (rule.byMonthDay) parts.push(`BYMONTHDAY=${rule.byMonthDay}`);
  if (rule.byMonth) parts.push(`BYMONTH=${rule.byMonth}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  if (rule.until) parts.push(`UNTIL=${toIcsDate(rule.until)}`);
  return parts.join(";");
}

/** "YYYYMMDD" or "YYYYMMDDTHHMMSSZ" → Date. */
function parseIcsDate(v: string): Date | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = "23", mi = "59", s = "59"] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIcsDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * The nth occurrence of a weekday in a month, or null when it doesn't exist.
 *
 * `nth` counts forward from 1, or -1 for the last one. Returning null rather
 * than clamping is the whole point: a month with only four Tuesdays has no
 * fifth, and inventing one would put the task on a date nobody chose.
 *
 * `month` may be out of range (e.g. 13) — the Date constructor rolls it into
 * the following year, which is what the callers' loops rely on.
 */
function nthWeekdayOf(year: number, month: number, nth: number, weekday: number): Date | null {
  if (nth === -1) {
    const last = new Date(year, month + 1, 0); // day 0 of next month = last of this
    const shift = (last.getDay() - weekday + 7) % 7;
    return new Date(year, month, last.getDate() - shift);
  }

  const first = new Date(year, month, 1);
  const shift = (weekday - first.getDay() + 7) % 7;
  const dayOfMonth = 1 + shift + (nth - 1) * 7;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  if (dayOfMonth > daysInMonth) return null;
  return new Date(year, month, dayOfMonth);
}

/** Copy `from`'s wall-clock time onto `day`. */
function withTimeOf(day: Date, from: Date): Date {
  const d = new Date(day);
  d.setHours(from.getHours(), from.getMinutes(), from.getSeconds(), 0);
  return d;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Occurrences of `rule` starting at `dtStart`, from `after` (exclusive) onward.
 *
 * Iterates candidates rather than computing closed-form dates: it's slower but
 * it's obviously correct, and the hard limit keeps a pathological rule (say
 * "every day until 2099" scanned over a decade) from spinning.
 */
export function occurrences(
  rule: Rule,
  dtStart: Date,
  opts: { after?: Date; until?: Date; limit?: number } = {},
): Date[] {
  const limit = opts.limit ?? 50;
  const after = opts.after ?? new Date(0);
  const hardEnd = opts.until;
  const out: Date[] = [];

  // Guard against runaway iteration on sparse rules (e.g. yearly + BYMONTH).
  const MAX_STEPS = 5000;
  let emitted = 0; // counts toward COUNT, including ones before `after`

  const push = (d: Date): "continue" | "stop" => {
    if (rule.until && d > rule.until) return "stop";
    emitted += 1;
    if (rule.count && emitted > rule.count) return "stop";
    if (d > after) {
      if (hardEnd && d > hardEnd) return "stop";
      out.push(d);
      if (out.length >= limit) return "stop";
    }
    return "continue";
  };

  if (rule.freq === "DAILY") {
    for (let i = 0, steps = 0; steps < MAX_STEPS; i += rule.interval, steps++) {
      const d = withTimeOf(new Date(dtStart.getTime() + i * DAY_MS), dtStart);
      if (push(d) === "stop") break;
      if (hardEnd && d > hardEnd) break;
    }
    return out;
  }

  if (rule.freq === "WEEKLY") {
    // Without BYDAY, repeat on dtStart's own weekday.
    const days = rule.byDay?.length ? rule.byDay : [dtStart.getDay()];
    // Anchor on the Sunday of dtStart's week so INTERVAL counts whole weeks.
    const weekAnchor = new Date(dtStart);
    weekAnchor.setDate(weekAnchor.getDate() - weekAnchor.getDay());
    weekAnchor.setHours(0, 0, 0, 0);

    outer: for (let w = 0, steps = 0; steps < MAX_STEPS; w += rule.interval, steps++) {
      const weekStart = new Date(weekAnchor.getTime() + w * 7 * DAY_MS);
      for (const dow of days) {
        const d = withTimeOf(new Date(weekStart.getTime() + dow * DAY_MS), dtStart);
        if (d < dtStart) continue; // days earlier in the first week
        if (push(d) === "stop") break outer;
      }
      if (hardEnd && weekStart > hardEnd) break;
    }
    return out;
  }

  if (rule.freq === "MONTHLY" && rule.byDayPos) {
    const { nth, day } = rule.byDayPos;
    for (let m = 0, steps = 0; steps < MAX_STEPS; m += rule.interval, steps++) {
      const found = nthWeekdayOf(
        dtStart.getFullYear(),
        dtStart.getMonth() + m,
        nth,
        day,
      );
      if (!found) continue; // no 4th Tuesday this month — skip, never invent one
      const d = withTimeOf(found, dtStart);
      if (d >= dtStart && push(d) === "stop") break;
      if (hardEnd && d > hardEnd) break;
    }
    return out;
  }

  if (rule.freq === "MONTHLY") {
    const dom = rule.byMonthDay ?? dtStart.getDate();
    for (let m = 0, steps = 0; steps < MAX_STEPS; m += rule.interval, steps++) {
      const base = new Date(dtStart.getFullYear(), dtStart.getMonth() + m, 1);
      // A month without that day (Feb 30th) is skipped, per RFC 5545 — NOT
      // clamped to the last day, which would invent an occurrence.
      const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
      if (dom > daysInMonth) {
        if (hardEnd && base > hardEnd) break;
        continue;
      }
      const d = withTimeOf(new Date(base.getFullYear(), base.getMonth(), dom), dtStart);
      if (d >= dtStart && push(d) === "stop") break;
      if (hardEnd && d > hardEnd) break;
    }
    return out;
  }

  // YEARLY
  const month = (rule.byMonth ?? dtStart.getMonth() + 1) - 1;

  if (rule.byDayPos) {
    const { nth, day } = rule.byDayPos;
    for (let y = 0, steps = 0; steps < MAX_STEPS; y += rule.interval, steps++) {
      const found = nthWeekdayOf(dtStart.getFullYear() + y, month, nth, day);
      if (!found) continue;
      const d = withTimeOf(found, dtStart);
      if (d >= dtStart && push(d) === "stop") break;
      if (hardEnd && d > hardEnd) break;
    }
    return out;
  }

  const dom = rule.byMonthDay ?? dtStart.getDate();
  for (let y = 0, steps = 0; steps < MAX_STEPS; y += rule.interval, steps++) {
    const year = dtStart.getFullYear() + y;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    if (dom > daysInMonth) continue; // 29 Feb in a non-leap year
    const d = withTimeOf(new Date(year, month, dom), dtStart);
    if (d >= dtStart && push(d) === "stop") break;
    if (hardEnd && d > hardEnd) break;
  }
  return out;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_NAMES_FULL = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

const ORDINALS: Record<number, string> = { 1: "first", 2: "second", 3: "third", 4: "fourth" };

/** "second Tuesday" / "last Friday" — how people say it out loud. */
function ordinalWeekday(pos: { nth: number; day: number }): string {
  const which = pos.nth === -1 ? "last" : (ORDINALS[pos.nth] ?? `${pos.nth}th`);
  return `${which} ${DAY_NAMES_FULL[pos.day]}`;
}

/** The next occurrence strictly after `after`, or null if the series has ended. */
export function nextOccurrence(
  rule: Rule,
  dtStart: Date,
  after: Date,
): Date | null {
  const [next] = occurrences(rule, dtStart, { after, limit: 1 });
  return next ?? null;
}

/** Convenience: parse + next, for callers holding a raw rule string. */
export function nextAfter(
  raw: string | null | undefined,
  dtStart: Date,
  after: Date,
): Date | null {
  const rule = parseRRule(raw);
  if (!rule) return null;
  return nextOccurrence(rule, dtStart, after);
}

/** Human-readable summary for the UI ("Every 2 weeks on Mon, Wed"). */
export function describeRRule(raw: string | null | undefined): string | null {
  const rule = parseRRule(raw);
  if (!rule) return null;
  const n = rule.interval;
  const every = (unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);

  let text: string;
  switch (rule.freq) {
  case "DAILY": {
  text = every("day");
  break;
  }
  case "WEEKLY": {
    const names = (rule.byDay ?? []).map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]);
    // "Every weekday" is how people actually say Mon–Fri.
    const isWeekdays = names.length === 5 && !names.includes("Sat") && !names.includes("Sun");
    text = isWeekdays && n === 1 ? "Every weekday" : every("week");
    if (names.length > 0 && !(isWeekdays && n === 1)) text += ` on ${names.join(", ")}`;
  
  break;
  }
  case "MONTHLY": {
    text = every("month");
    if (rule.byMonthDay) text += ` on day ${rule.byMonthDay}`;
    if (rule.byDayPos) text += ` on the ${ordinalWeekday(rule.byDayPos)}`;
    break;
  }
  default: {
    text = every("year");
    if (rule.byMonth) {
      const monthName = MONTH_NAMES[rule.byMonth - 1];
      text += rule.byDayPos
        ? ` on the ${ordinalWeekday(rule.byDayPos)} of ${monthName}`
        : ` on ${monthName} ${rule.byMonthDay ?? ""}`.trimEnd();
    } else if (rule.byDayPos) {
      text += ` on the ${ordinalWeekday(rule.byDayPos)}`;
    }
  }
  }

  if (rule.count) text += `, ${rule.count} times`;
  if (rule.until) text += `, until ${rule.until.toLocaleDateString()}`;
  return text;
}
