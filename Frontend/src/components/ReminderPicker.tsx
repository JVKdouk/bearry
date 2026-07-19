"use client";

/**
 * Setting when you get notified about something.
 *
 * Lives beside priority in the drawer's top bar rather than inside the schedule
 * popover, where it used to be. Reminders had ended up two levels deep in a menu
 * about *when the thing happens*, which is a different question from *when you
 * want to hear about it* — and on creation the control wasn't offered at all,
 * because there was no id to hang a reminder row on yet. Deciding to be reminded
 * is part of writing the thing down, not a follow-up visit.
 *
 * Offsets that can no longer fire are hidden rather than offered and silently
 * dropped, and offsets already set aren't offered twice — two notifications for
 * one thing reads as a bug even when the user asked for both.
 */

import { Select, Typography } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { useMemo } from "react";
import { chosenOffsets, offsetLabel, usableOffsets } from "@/lib/reminders";

const { Text } = Typography;

const ACCENT = "#e5893f";

export interface ReminderRow {
  id: string;
  offsetMinutes: number;
}

export function ReminderPicker({
  start,
  reminders,
  onAdd,
  onRemove,
}: {
  /** The moment reminders count back from. Null when nothing is scheduled. */
  start: Date | null;
  reminders: ReminderRow[];
  onAdd: (offsetMinutes: number) => void;
  onRemove: (id: string) => void;
}) {
  const available = useMemo(() => {
    if (!start) return [];
    const taken = chosenOffsets(reminders);
    return usableOffsets(start).filter((o) => !taken.has(o.minutes));
  }, [start, reminders]);

  // Without a date there is nothing to count back from, so the honest thing is
  // to say why the control is empty rather than show a picker that saves
  // nothing.
  if (!start) {
    return (
      <div style={{ width: 210, maxWidth: "100%" }}>
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          Give this a date first — a reminder needs a moment to count back from.
        </Text>
      </div>
    );
  }

  return (
    <div style={{ width: 210, maxWidth: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
      {reminders.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {reminders.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onRemove(r.id)}
              aria-label={`Remove reminder ${offsetLabel(r.offsetMinutes)}`}
              style={{
                border: "none",
                background: "transparent",
                color: ACCENT,
                fontSize: 12.5,
                cursor: "pointer",
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              {offsetLabel(r.offsetMinutes)}
              <CloseOutlined style={{ fontSize: 9, opacity: 0.7 }} />
            </button>
          ))}
        </div>
      )}

      <Select
        size="small"
        // Always empty: this is an "add one" action, not a field holding a
        // value. `undefined` rather than null, which antd warns about.
        value={undefined}
        placeholder={reminders.length > 0 ? "Add another" : "Add a reminder"}
        onChange={(m: number) => onAdd(m)}
        style={{ width: "100%" }}
        options={available.map((o) => ({ label: o.label, value: o.minutes }))}
        notFoundContent="Too soon for a reminder"
      />
    </div>
  );
}
