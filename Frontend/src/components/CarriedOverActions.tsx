"use client";

/**
 * The two ways to give a carried-over task a new home in time, sat just under
 * its card on the day view.
 *
 * A task that slipped past its date isn't a failure state — it just needs a new
 * time. So rather than shame it, the day view hands over the two moves that fix
 * it: pick a time yourself (the same schedule popover the drawer uses), or let
 * the scheduler fit it into your week. The scheduler can re-place it even though
 * it has a past due date — the date is gone, the work isn't done, so the only
 * useful thing to do with that date is replace it.
 */

import { useMemo, useState } from "react";
import { Popover } from "antd";
import { CalendarOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { SchedulePopover, type ScheduleValue } from "@/components/SchedulePopover";
import { schedulePatch } from "@/lib/schedule";
import { rescheduleReminders } from "@/lib/reminders";
import { useSync } from "@/store/sync";
import { useCollection } from "@/store/hooks";
import { TEXT, SURFACE } from "@/lib/theme";
import type { Block } from "@/lib/types";

const pill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 30,
  padding: "0 12px",
  borderRadius: 999,
  border: `1px solid ${SURFACE.border}`,
  background: "transparent",
  color: TEXT.secondary,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};

export function CarriedOverActions({ task }: { task: Block }) {
  const update = useSync((s) => s.update);
  const router = useRouter();
  const allReminders = useCollection("reminder");
  const [open, setOpen] = useState(false);

  const reminders = useMemo(
    () =>
      allReminders.filter(
        (r) => r.targetType === "block" && r.targetId === task.id && !r.deletedAt,
      ),
    [allReminders, task.id],
  );

  // Seed the popover from wherever the task currently sits in time.
  const date = task.startTime ? dayjs(task.startTime) : task.deadline ? dayjs(task.deadline) : null;
  const time = task.startTime ? dayjs(task.startTime) : null;
  const duration = task.estimatedDuration || 30;

  function moveReminders(start: Date | null) {
    for (const patch of rescheduleReminders(reminders, start)) {
      update("reminder", patch.id, { fireAt: patch.fireAt });
    }
  }

  function applySchedule(next: Partial<ScheduleValue>) {
    const d = next.date !== undefined ? next.date : date;
    const t = next.time !== undefined ? next.time : time;
    const dur = next.duration !== undefined ? next.duration : duration;
    update("block", task.id, {
      ...schedulePatch(d, t, dur),
      ...(next.recurrenceRule !== undefined ? { recurrenceRule: next.recurrenceRule } : {}),
    });
    if (next.date !== undefined || next.time !== undefined) {
      const start = d ? (t ? d.hour(t.hour()).minute(t.minute()) : d.hour(9).minute(0)) : null;
      moveReminders(start ? start.toDate() : null);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 8, marginBottom: 2, paddingLeft: 2 }}>
      <Popover
        trigger="click"
        placement="bottomLeft"
        open={open}
        onOpenChange={setOpen}
        content={
          <SchedulePopover
            value={{ date, time, duration, recurrenceRule: task.recurrenceRule ?? null }}
            onChange={applySchedule}
            onClear={() => {
              update("block", task.id, {
                ...schedulePatch(null, null, duration),
                recurrenceRule: null,
              });
              moveReminders(null);
            }}
            onClose={() => setOpen(false)}
          />
        }
      >
        <button type="button" style={pill}>
          <CalendarOutlined /> Reschedule
        </button>
      </Popover>

      <button
        type="button"
        style={pill}
        onClick={() => router.push(`/calendar?plan=${Date.now()}&tasks=${task.id}`)}
      >
        <ThunderboltOutlined /> Auto-schedule
      </button>
    </div>
  );
}
