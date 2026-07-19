"use client";

import { useMemo } from "react";
import type { Dayjs } from "dayjs";
import { SURFACE, TEXT, SUNSET } from "@/lib/theme";
import type { CalendarBlock } from "@/lib/calendarTypes";

/**
 * Month view.
 *
 * Deliberately a different shape from the day/week grid rather than a squashed
 * version of it: at ~90px per cell an hour grid is unreadable, so a month cell
 * shows *what* is on each day, not when. It's an overview for spotting busy and
 * empty stretches — tapping a day drills into the day view to actually work.
 *
 * There is no planning here (a month is far past any honest planning horizon),
 * which is why the Plan button falls back to the week.
 */
export function MonthGrid({
  days,
  anchor,
  now,
  blocks,
  onPickDay,
  onCreate,
  onOpenBlock,
  roomForTime,
}: {
  days: Dayjs[];
  anchor: Dayjs;
  now: Dayjs;
  blocks: CalendarBlock[];
  onPickDay: (d: Dayjs) => void;
  onCreate: (d: Dayjs) => void;
  onOpenBlock: (block: CalendarBlock) => void;
  /** False on narrow screens, where a cell can't fit a time AND a name. */
  roomForTime: boolean;
}) {
  // One pass over the blocks instead of filtering per cell — a month is up to
  // 42 cells, and re-scanning every block for each of them is needless work.
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarBlock[]>();
    for (const b of blocks) {
      const k = b.start.format("YYYY-MM-DD");
      const list = m.get(k);
      if (list) list.push(b);
      else m.set(k, [b]);
    }
    for (const list of m.values()) list.sort((a, b) => a.start.valueOf() - b.start.valueOf());
    return m;
  }, [blocks]);

  const weeks: Dayjs[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* weekday header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          borderBottom: `1px solid ${SURFACE.borderSoft}`,
        }}
      >
        {days.slice(0, 7).map((d) => (
          <div
            key={d.toISOString()}
            style={{
              padding: "8px 6px",
              textAlign: "center",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              color: TEXT.secondary,
            }}
          >
            {d.format("ddd")}
          </div>
        ))}
      </div>

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))`,
          minHeight: 0,
        }}
      >
        {weeks.map((week, wi) => (
          <div
            key={wi}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              borderBottom: `1px solid ${SURFACE.borderSoft}`,
              minHeight: 0,
            }}
          >
            {week.map((d) => {
              const inMonth = d.isSame(anchor, "month");
              const isToday = d.isSame(now, "day");
              const items = byDay.get(d.format("YYYY-MM-DD")) ?? [];
              // Leave room for the "+N more" line rather than clipping silently.
              const shown = items.slice(0, 3);
              const hidden = items.length - shown.length;
              return (
                <div
                  key={d.toISOString()}
                  onClick={() => onPickDay(d)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onCreate(d);
                  }}
                  style={{
                    borderRight: `1px solid ${SURFACE.borderSoft}`,
                    padding: "4px 5px",
                    minWidth: 0,
                    minHeight: 0,
                    overflow: "hidden",
                    cursor: "pointer",
                    // Out-of-month days stay visible but recede, so the month's
                    // shape reads at a glance.
                    opacity: inMonth ? 1 : 0.35,
                    background: isToday ? "rgba(168,85,247,0.07)" : "transparent",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 2 }}>
                    <span
                      style={{
                        minWidth: 20,
                        height: 20,
                        borderRadius: 999,
                        display: "grid",
                        placeItems: "center",
                        fontSize: 12,
                        fontWeight: isToday ? 700 : 500,
                        padding: "0 5px",
                        color: isToday ? "#fff" : inMonth ? TEXT.primary : TEXT.secondary,
                        background: isToday ? SUNSET : "transparent",
                      }}
                    >
                      {d.format("D")}
                    </span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {shown.map((b) => (
                      <div
                        key={b.id}
                        title={`${b.start.format("HH:mm")} ${b.title}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${b.title} at ${b.start.format("HH:mm")}`}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onOpenBlock(b);
                          }
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenBlock(b);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 11,
                          lineHeight: 1.45,
                          color: TEXT.primary,
                          background: b.color + "22",
                          borderLeft: `2px solid ${b.color}`,
                          borderRadius: 4,
                          padding: "1px 4px",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {/* A month cell is ~90px wide, so the time and the
                            title compete for the same few characters. The title
                            is what identifies the thing — "09:00" tells you
                            nothing about which of your commitments it is — so
                            the time is dropped first when space is short and
                            kept only where the cell is genuinely wide. */}
                        {roomForTime && (
                          <span style={{ opacity: 0.8, fontVariantNumeric: "tabular-nums" }}>
                            {b.start.format("HH:mm")}
                          </span>
                        )}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{b.title}</span>
                      </div>
                    ))}
                    {hidden > 0 && (
                      <span style={{ fontSize: 10.5, color: TEXT.secondary, paddingLeft: 2 }}>
                        +{hidden} more
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
