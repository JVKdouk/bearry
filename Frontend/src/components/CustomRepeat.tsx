"use client";

/**
 * Building a repeat rule that isn't one of the presets.
 *
 * The presets cover most cases, but "every 10 days", "the second Sunday of the
 * month" and "24 January every year" are all things people genuinely want and
 * none of them can be expressed by picking from a list.
 *
 * The shape follows the frequency, because the meaningful question changes with
 * it: weekly asks *which days*, monthly asks *which day of the month, or which
 * weekday-of-the-month*, yearly asks *which date*. Showing all of those at once
 * would be a form; showing the one that applies is a decision.
 *
 * Everything here composes a rule string the engine actually accepts — the
 * options offered are exactly the options that work. A picker that can build a
 * rule the parser refuses would silently produce a task that never repeats.
 */

import { useEffect, useMemo, useState } from "react";
import { Button, InputNumber, Segmented, Select } from "antd";
import type { Dayjs } from "dayjs";
import { describeRRule, parseRRule, type Freq } from "@/lib/recurrence/rrule";

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ACCENT = "#e5893f";
const LINE = "#2a2a33";
const MUTED = "#a9a9b8";
const FAINT = "#6f6f80";

/** How a monthly rule picks its day. */
type MonthlyMode = "dayOfMonth" | "weekdayOfMonth";

interface Props {
  /** The rule being edited, if there is one. */
  value: string | null;
  /** The task's own date — the sensible default for every field. */
  anchor: Dayjs;
  onChange: (rule: string) => void;
  onCancel: () => void;
}

/** Which occurrence of its weekday `date` is within its month (1-based). */
function weekdayOrdinal(date: Dayjs): number {
  return Math.floor((date.date() - 1) / 7) + 1;
}

/** True when `date` is the last of its weekday in the month. */
function isLastWeekday(date: Dayjs): boolean {
  return date.add(7, "day").month() !== date.month();
}

export function CustomRepeat({ value, anchor, onChange, onCancel }: Props) {
  const existing = useMemo(() => parseRRule(value), [value]);

  const [freq, setFreq] = useState<Freq>(existing?.freq ?? "WEEKLY");
  const [interval, setInterval] = useState(existing?.interval ?? 1);
  const [days, setDays] = useState<number[]>(existing?.byDay ?? [anchor.day()]);
  const [monthlyMode, setMonthlyMode] = useState<MonthlyMode>(
    existing?.byDayPos ? "weekdayOfMonth" : "dayOfMonth",
  );
  const [dayOfMonth, setDayOfMonth] = useState(existing?.byMonthDay ?? anchor.date());
  const [nth, setNth] = useState<number>(
    existing?.byDayPos?.nth ?? (isLastWeekday(anchor) ? -1 : weekdayOrdinal(anchor)),
  );
  const [weekday, setWeekday] = useState<number>(existing?.byDayPos?.day ?? anchor.day());
  const [month, setMonth] = useState(existing?.byMonth ?? anchor.month() + 1);

  // Weekly with no day selected can't produce a rule, so keep at least one.
  useEffect(() => {
    if (freq === "WEEKLY" && days.length === 0) setDays([anchor.day()]);
  }, [freq, days.length, anchor]);

  const rule = useMemo(() => {
    const parts = [`FREQ=${freq}`];
    if (interval > 1) parts.push(`INTERVAL=${interval}`);

    if (freq === "WEEKLY" && days.length > 0) {
      parts.push(`BYDAY=${[...days].sort((a, b) => a - b).map((d) => DAY_CODES[d]).join(",")}`);
    }
    if (freq === "MONTHLY") {
      if (monthlyMode === "weekdayOfMonth") parts.push(`BYDAY=${nth}${DAY_CODES[weekday]}`);
      else parts.push(`BYMONTHDAY=${dayOfMonth}`);
    }
    if (freq === "YEARLY") {
      parts.push(`BYMONTH=${month}`);
      if (monthlyMode === "weekdayOfMonth") parts.push(`BYDAY=${nth}${DAY_CODES[weekday]}`);
      else parts.push(`BYMONTHDAY=${dayOfMonth}`);
    }
    return parts.join(";");
  }, [freq, interval, days, monthlyMode, dayOfMonth, nth, weekday, month]);

  // The engine is the authority on whether this is expressible. If it refuses,
  // saving is blocked rather than storing a rule that would never fire.
  const summary = describeRRule(rule);

  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }[freq];

  return (
    <div style={{ width: 288 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, color: MUTED }}>Every</span>
        <InputNumber
          size="small"
          min={1}
          max={freq === "DAILY" ? 365 : 52}
          value={interval}
          onChange={(n) => setInterval(n ?? 1)}
          style={{ width: 64 }}
          aria-label={`Repeat every N ${unit}s`}
        />
        <Select
          size="small"
          value={freq}
          onChange={(f: Freq) => setFreq(f)}
          style={{ flex: 1 }}
          options={[
            { label: interval === 1 ? "day" : "days", value: "DAILY" },
            { label: interval === 1 ? "week" : "weeks", value: "WEEKLY" },
            { label: interval === 1 ? "month" : "months", value: "MONTHLY" },
            { label: interval === 1 ? "year" : "years", value: "YEARLY" },
          ]}
        />
      </div>

      {freq === "WEEKLY" && (
        <Row label="On">
          <div style={{ display: "flex", gap: 4 }}>
            {DAY_INITIALS.map((initial, i) => {
              const on = days.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={DAY_FULL[i]}
                  aria-pressed={on}
                  onClick={() =>
                    setDays((d) => (on ? d.filter((x) => x !== i) : [...d, i]))
                  }
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    border: `1px solid ${on ? ACCENT : LINE}`,
                    background: on ? ACCENT : "transparent",
                    color: on ? "#1a1a1f" : MUTED,
                    fontSize: 12,
                    fontWeight: on ? 700 : 400,
                    cursor: "pointer",
                  }}
                >
                  {initial}
                </button>
              );
            })}
          </div>
        </Row>
      )}

      {(freq === "MONTHLY" || freq === "YEARLY") && (
        <>
          {freq === "YEARLY" && (
            <Row label="In">
              <Select
                size="small"
                value={month}
                onChange={setMonth}
                style={{ width: 132 }}
                options={MONTHS.map((m, i) => ({ label: m, value: i + 1 }))}
              />
            </Row>
          )}

          <Row label="On">
            <Segmented
              size="small"
              value={monthlyMode}
              onChange={(m) => setMonthlyMode(m as MonthlyMode)}
              options={[
                { label: "A date", value: "dayOfMonth" },
                { label: "A weekday", value: "weekdayOfMonth" },
              ]}
            />
          </Row>

          {monthlyMode === "dayOfMonth" ? (
            <Row label="Day">
              <InputNumber
                size="small"
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(n) => setDayOfMonth(n ?? 1)}
                style={{ width: 72 }}
                aria-label="Day of the month"
              />
            </Row>
          ) : (
            <Row label="The">
              <div style={{ display: "flex", gap: 6 }}>
                <Select
                  size="small"
                  value={nth}
                  onChange={setNth}
                  style={{ width: 88 }}
                  aria-label="Which occurrence"
                  options={[
                    { label: "first", value: 1 },
                    { label: "second", value: 2 },
                    { label: "third", value: 3 },
                    { label: "fourth", value: 4 },
                    { label: "last", value: -1 },
                  ]}
                />
                <Select
                  size="small"
                  value={weekday}
                  onChange={setWeekday}
                  style={{ width: 104 }}
                  aria-label="Weekday"
                  options={DAY_FULL.map((d, i) => ({ label: d, value: i }))}
                />
              </div>
            </Row>
          )}

          {monthlyMode === "dayOfMonth" && dayOfMonth > 28 && (
            // Being explicit beats a user discovering it in February.
            <p style={{ fontSize: 11, color: FAINT, margin: "6px 0 0" }}>
              Months without a {dayOfMonth}
              {ordinalSuffix(dayOfMonth)} are skipped rather than moved to the
              nearest day.
            </p>
          )}
        </>
      )}

      <div
        style={{
          marginTop: 14,
          paddingTop: 10,
          borderTop: `1px solid ${LINE}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 11.5, color: summary ? MUTED : "#d4726a", flex: 1 }}>
          {summary ?? "That combination isn't supported"}
        </span>
        <Button size="small" type="text" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="small"
          type="primary"
          disabled={!summary}
          onClick={() => onChange(rule)}
        >
          Set
        </Button>
      </div>
    </div>
  );
}

function ordinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return "th";
  return { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        marginTop: 10,
      }}
    >
      <span style={{ fontSize: 12.5, color: MUTED, flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  );
}
