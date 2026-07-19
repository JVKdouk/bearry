/**
 * Client-side recurrence: the repeat picker, human-readable labels, and
 * expansion of a stored rule into the occurrences a view needs to draw.
 *
 * Expansion has to happen here, not on the server, because the app is
 * offline-first — the calendar must render a recurring stand-up on a plane. The
 * engine itself is a byte-identical mirror of the backend's (see
 * `./recurrence/rrule.ts`), so both sides agree on which days a rule falls on;
 * a drift test fails the build if they diverge.
 *
 * Completion advancement stays server-side: that one *writes*, and a single
 * authority for writes is worth more than local responsiveness.
 */

import { describeRRule, occurrences, parseRRule } from "./recurrence/rrule";

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

/**
 * Describe a stored rule in words.
 *
 * Delegates to the mirrored engine rather than re-deriving the wording. This
 * used to be a second, hand-rolled parser living beside the real one — which
 * meant a rule the engine refused could still be described confidently, and the
 * two could disagree about what a rule meant.
 *
 * An unrecognised rule shows a neutral "Repeats" rather than claiming a
 * schedule it can't verify.
 */
export function describeRepeat(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return describeRRule(raw) ?? "Repeats";
}

/** The shape expansion needs — satisfied by both CalendarEvent and Todo rows. */
export interface Repeatable {
  id: string;
  recurrenceRule?: string | null;
}

export interface Occurrence<T> {
  item: T;
  /**
   * Stable per-occurrence identity. The first instance keeps the master's id so
   * existing click/drag/edit paths are untouched; later instances get a
   * suffixed key. Anything that writes must use `masterId`.
   */
  key: string;
  masterId: string;
  start: Date;
  end: Date;
  /** True for a generated instance — i.e. not the row actually stored. */
  isRepeat: boolean;
}

/** Hard ceiling on generated instances per item, so one bad rule can't hang a render. */
const MAX_PER_ITEM = 400;

/**
 * Expand items into the occurrences that overlap [from, to].
 *
 * Non-repeating items pass straight through when they overlap. Repeating ones
 * are walked from a point far enough back that an occurrence *starting* before
 * the window but still running inside it is not dropped — the long event whose
 * start scrolled off the top of the view is exactly the one you must not lose.
 */
export function expandRange<T extends Repeatable>(
  items: T[],
  from: Date,
  to: Date,
  bounds: (item: T) => { start: Date; end: Date } | null,
): Occurrence<T>[] {
  const out: Occurrence<T>[] = [];

  for (const item of items) {
    const b = bounds(item);
    if (!b) continue;
    const { start, end } = b;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

    const rule = item.recurrenceRule ? parseRRule(item.recurrenceRule) : null;
    if (!rule) {
      // Either a one-off or a rule this engine refuses to guess at. Both render
      // as a single block, which is the safe reading of an unknown rule.
      if (end >= from && start <= to) {
        out.push({ item, key: item.id, masterId: item.id, start, end, isRepeat: false });
      }
      continue;
    }

    const durationMs = Math.max(0, end.getTime() - start.getTime());
    const walkFrom = new Date(from.getTime() - durationMs - 1);
    const dates = occurrences(rule, start, { after: walkFrom, until: to, limit: MAX_PER_ITEM });

    for (const d of dates) {
      const oEnd = new Date(d.getTime() + durationMs);
      if (oEnd < from || d > to) continue;
      const first = d.getTime() === start.getTime();
      out.push({
        item,
        key: first ? item.id : `${item.id}::${d.getTime()}`,
        masterId: item.id,
        start: d,
        end: oEnd,
        isRepeat: !first,
      });
    }
  }

  return out;
}

/** True for a key produced by `expandRange` for a generated instance. */
export function isOccurrenceKey(key: string): boolean {
  return key.includes("::");
}

/** Recover the stored row's id from an occurrence key. */
export function masterIdOf(key: string): string {
  const i = key.indexOf("::");
  return i === -1 ? key : key.slice(0, i);
}
