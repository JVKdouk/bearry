"use client";

/**
 * The scheduling popover — when a task happens, how long it takes, whether it
 * repeats.
 *
 * The previous version stacked a DatePicker, a TimePicker, a number input and a
 * repeat select in a narrow column, which meant the most common action by far —
 * "tomorrow" — took a click, a calendar scan and a second click. This one leads
 * with the shortcuts that cover most scheduling, keeps the month grid visible
 * for everything else, and puts duration behind a tab because it's a different
 * question from *when*.
 *
 * Deliberately no Reminder row, though the reference design has one: reminders
 * exist as a table but have no delivery path and aren't even synced yet. A
 * control that looks like it sets an alarm and silently doesn't is worse than
 * its absence.
 */

import { useMemo, useState } from "react";
import { Button, Segmented, Select, TimePicker } from "antd";
import {
  CalendarOutlined,
  ClockCircleOutlined,
  RetweetOutlined,
  SunOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { repeatOptions } from "@/lib/recurrence";
import { durationLabel } from "@/lib/format";

const MUTED = "#a9a9b8";
const FAINT = "#6f6f80";
const LINE = "#2a2a33";
const ACCENT = "#e5893f";

/** Durations worth one tap. Anything else goes through the stepper. */
const DURATION_PRESETS = [15, 25, 30, 45, 60, 90, 120];

/** The evening slot a "tonight" shortcut lands on. */
const EVENING_HOUR = 19;

export interface ScheduleValue {
  date: Dayjs | null;
  time: Dayjs | null;
  duration: number;
  recurrenceRule: string | null;
}

interface Props {
  value: ScheduleValue;
  onChange: (next: Partial<ScheduleValue>) => void;
  onClear: () => void;
  onClose: () => void;
}

function startOfToday(): Dayjs {
  return dayjs().startOf("day");
}

/**
 * The shortcuts, in the order they're offered.
 *
 * "Later today" only appears while there's still evening left to schedule into
 * — offering it at 11pm would be an invitation to fail, which is precisely the
 * dynamic this app exists to avoid.
 */
export function quickPicks(now: Dayjs): { label: string; date: Dayjs; time?: Dayjs }[] {
  const today = now.startOf("day");
  const picks: { label: string; date: Dayjs; time?: Dayjs }[] = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: today.add(1, "day") },
  ];

  if (now.hour() < EVENING_HOUR) {
    picks.push({ label: "Tonight", date: today, time: today.hour(EVENING_HOUR) });
  }

  // "This weekend" means the coming Saturday; on a Saturday or Sunday that's
  // already now, so it'd be a no-op and is dropped.
  const dow = now.day();
  if (dow !== 0 && dow !== 6) {
    picks.push({ label: "This weekend", date: today.add(6 - dow, "day") });
  }

  picks.push({ label: "Next week", date: today.add(7, "day") });
  return picks;
}

/** The weeks to draw for `month`, padded to whole Monday-start rows. */
export function monthMatrix(month: Dayjs): Dayjs[][] {
  const first = month.startOf("month");
  // day() is 0=Sun; we lead with Monday, so Sunday sits at the end of the row.
  const lead = (first.day() + 6) % 7;
  const start = first.subtract(lead, "day");
  const weeks: Dayjs[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Dayjs[] = [];
    for (let d = 0; d < 7; d++) row.push(start.add(w * 7 + d, "day"));
    weeks.push(row);
    // Stop once we've covered the month — a trailing all-next-month row is
    // just noise that makes the popover taller for nothing.
    if (row[6].isAfter(month.endOf("month"))) break;
  }
  return weeks;
}

export function SchedulePopover({ value, onChange, onClear, onClose }: Props) {
  const [tab, setTab] = useState<"date" | "duration">("date");
  const [month, setMonth] = useState<Dayjs>(value.date ?? startOfToday());

  const now = dayjs();
  const today = now.startOf("day");
  const picks = useMemo(() => quickPicks(now), [now.format("YYYY-MM-DD-HH")]); // eslint-disable-line react-hooks/exhaustive-deps
  const weeks = useMemo(() => monthMatrix(month), [month]);

  const selectedKey = value.date?.format("YYYY-MM-DD");

  function pick(date: Dayjs, time?: Dayjs) {
    onChange({ date, ...(time ? { time } : {}) });
    setMonth(date);
  }

  return (
    <div style={{ width: 300 }}>
      <Segmented
        block
        size="small"
        value={tab}
        onChange={(v) => setTab(v as "date" | "duration")}
        options={[
          { label: "Date", value: "date", icon: <CalendarOutlined /> },
          { label: "Duration", value: "duration", icon: <ClockCircleOutlined /> },
        ]}
        style={{ marginBottom: 12 }}
      />

      {tab === "date" ? (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {picks.map((p) => {
              const active = selectedKey === p.date.format("YYYY-MM-DD");
              return (
                <button
                  key={p.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => pick(p.date, p.time)}
                  style={{
                    border: `1px solid ${active ? ACCENT : LINE}`,
                    background: active ? ACCENT + "22" : "transparent",
                    color: active ? ACCENT : MUTED,
                    borderRadius: 999,
                    padding: "3px 11px",
                    fontSize: 12,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {p.time ? <SunOutlined style={{ fontSize: 10 }} /> : null}
                  {p.label}
                </button>
              );
            })}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <Button
              type="text"
              size="small"
              aria-label="Previous month"
              onClick={() => setMonth(month.subtract(1, "month"))}
            >
              ‹
            </Button>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{month.format("MMMM YYYY")}</span>
            <Button
              type="text"
              size="small"
              aria-label="Next month"
              onClick={() => setMonth(month.add(1, "month"))}
            >
              ›
            </Button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <div
                key={i}
                style={{ textAlign: "center", fontSize: 10.5, color: FAINT, paddingBottom: 2 }}
              >
                {d}
              </div>
            ))}
            {weeks.flat().map((d) => {
              const key = d.format("YYYY-MM-DD");
              const selected = key === selectedKey;
              const isToday = key === today.format("YYYY-MM-DD");
              const outside = d.month() !== month.month();
              return (
                <button
                  key={key}
                  type="button"
                  // The visible label is a bare number, which out of context is
                  // meaningless read aloud — give the whole date.
                  aria-label={d.format("dddd D MMMM YYYY")}
                  aria-pressed={selected}
                  onClick={() => pick(d)}
                  style={{
                    aspectRatio: "1",
                    border: "none",
                    borderRadius: 7,
                    background: selected ? ACCENT : "transparent",
                    color: selected
                      ? "#1a1a1f"
                      : outside
                        ? "#4a4a56"
                        : isToday
                          ? ACCENT
                          : "#e8e8ef",
                    fontWeight: selected || isToday ? 700 : 400,
                    fontSize: 12.5,
                    cursor: "pointer",
                  }}
                >
                  {d.date()}
                </button>
              );
            })}
          </div>

          <Row icon={<ClockCircleOutlined />} label="Time">
            <TimePicker
              needConfirm={false}
              value={value.time}
              onChange={(t) => onChange({ time: t })}
              format="HH:mm"
              minuteStep={5}
              placeholder="Any time"
              variant="borderless"
              style={{ width: 110, textAlign: "right" }}
            />
          </Row>

          {/* Repeat needs a date to repeat FROM, so it only appears with one —
              a rule with no anchor is dead config. */}
          {value.date && (
            <Row icon={<RetweetOutlined />} label="Repeat">
              <Select
                size="small"
                variant="borderless"
                value={value.recurrenceRule ?? null}
                onChange={(rule) => onChange({ recurrenceRule: rule })}
                options={repeatOptions(value.date.day()).map((o) => ({
                  label: o.label,
                  value: o.rule,
                }))}
                style={{ width: 150 }}
              />
            </Row>
          )}
        </>
      ) : (
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {DURATION_PRESETS.map((m) => {
              const active = value.duration === m;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange({ duration: m })}
                  style={{
                    border: `1px solid ${active ? ACCENT : LINE}`,
                    background: active ? ACCENT + "22" : "transparent",
                    color: active ? ACCENT : MUTED,
                    borderRadius: 999,
                    padding: "3px 12px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {durationLabel(m)}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Button
              size="small"
              aria-label="Five minutes shorter"
              onClick={() => onChange({ duration: Math.max(5, value.duration - 5) })}
            >
              −
            </Button>
            <span
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: 15,
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {durationLabel(value.duration)}
            </span>
            <Button
              size="small"
              aria-label="Five minutes longer"
              onClick={() => onChange({ duration: Math.min(600, value.duration + 5) })}
            >
              +
            </Button>
          </div>

          <p style={{ fontSize: 11.5, color: FAINT, marginTop: 12, marginBottom: 0 }}>
            How long you expect this to take. The planner uses it to find a slot
            that actually fits.
          </p>
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 14,
          paddingTop: 10,
          borderTop: `1px solid ${LINE}`,
        }}
      >
        <Button
          type="text"
          size="small"
          danger
          disabled={!value.date && !value.time}
          onClick={onClear}
        >
          Clear
        </Button>
        <Button type="primary" size="small" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 8,
        paddingTop: 8,
        borderTop: `1px solid ${LINE}`,
      }}
    >
      <span style={{ fontSize: 12.5, color: MUTED, display: "flex", alignItems: "center", gap: 6 }}>
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}
