"use client";

import { useEffect, useMemo, useRef } from "react";
import dayjs, { type Dayjs } from "dayjs";

// Horizontal day selector. Starts a couple of days back so "today" sits just
// inside the strip, and auto-scrolls the selected day into view.
export function DateStrip({
  value,
  onChange,
  daysBefore = 2,
  daysAfter = 14,
  counts,
}: {
  value: Dayjs;
  onChange: (d: Dayjs) => void;
  daysBefore?: number;
  daysAfter?: number;
  counts?: Map<string, number>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const days = useMemo(() => {
    const start = dayjs().startOf("day").subtract(daysBefore, "day");
    return Array.from({ length: daysBefore + daysAfter + 1 }, (_, i) => start.add(i, "day"));
  }, [daysBefore, daysAfter]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [value]);

  return (
    <div
      ref={scroller}
      className="no-scrollbar"
      style={{ display: "flex", gap: 6, overflowX: "auto", padding: "2px 0" }}
    >
      {days.map((d) => {
        const active = d.isSame(value, "day");
        const isToday = d.isSame(dayjs(), "day");
        const n = counts?.get(d.format("YYYY-MM-DD")) ?? 0;
        return (
          <button
            key={d.toISOString()}
            ref={active ? activeRef : undefined}
            className="date-cell"
            data-active={active}
            data-today={isToday}
            onClick={() => onChange(d)}
          >
            <span className="dc-num">{d.format("D")}</span>
            <span className="dc-dow">{isToday ? "Today" : d.format("ddd")}</span>
            <span
              style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                marginTop: 2,
                background: n > 0 ? (active ? "#fff" : "#a855f7") : "transparent",
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
