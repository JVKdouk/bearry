"use client";

/**
 * The head of one calendar column.
 *
 * Two jobs: say which day this is, and — the reason it exists in day view at
 * all — say what the column *isn't* showing. The grid can only draw something
 * with both a start and an end, so a task due today with no hour on it is
 * absent from the calendar entirely. Not smaller, not greyed: gone. Someone
 * planning their day off a grid that silently omits three commitments is being
 * misled by the tool they're trusting, and the fix isn't to invent a time for
 * those tasks — it's to admit they're there.
 */

import { Popover } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import { SURFACE, TEXT, SUNSET } from "@/lib/theme";
import { untimedLabel } from "@/lib/untimed";

export const DAY_HEADER_H = 52;

interface UntimedTask {
  id: string;
  title: string;
}

export function DayColumnHeader({
  day,
  isToday,
  untimed,
  onOpenTask,
  compact = false,
}: {
  day: Dayjs;
  isToday: boolean;
  untimed: UntimedTask[];
  onOpenTask: (id: string) => void;
  /** Week view on a phone: ~45px per column, so the nudge is a count alone. */
  compact?: boolean;
}) {
  const label = untimedLabel(untimed);

  return (
    <div
      style={{
        height: DAY_HEADER_H,
        position: "sticky",
        top: 0,
        zIndex: 3,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        borderBottom: `1px solid ${SURFACE.borderSoft}`,
        background: SURFACE.bg,
        overflow: "hidden",
      }}
    >
      <span style={{ fontSize: 10.5, color: TEXT.tertiary, letterSpacing: 0.4 }}>
        {/* "Today" rather than "MON", matching the day strip on the today page —
            the weekday name is the least useful thing to know about today. */}
        {isToday ? "TODAY" : day.format("ddd").toUpperCase()}
      </span>
      <span
        style={{
          display: "grid",
          placeItems: "center",
          minWidth: 24,
          height: 22,
          padding: "0 6px",
          borderRadius: 999,
          fontSize: 13.5,
          fontWeight: 700,
          color: isToday ? "#fff" : TEXT.primary,
          background: isToday ? SUNSET : "transparent",
        }}
      >
        {day.format("D")}
      </span>

      {label && (
        <Popover
          trigger="click"
          placement="bottom"
          title="No time set"
          content={
            <div style={{ maxWidth: 240, display: "flex", flexDirection: "column", gap: 2 }}>
              {untimed.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onOpenTask(t.id)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#c9c9d6",
                    fontSize: 12.5,
                    textAlign: "left",
                    padding: "4px 2px",
                    cursor: "pointer",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.title || "Untitled"}
                </button>
              ))}
              <span style={{ fontSize: 11, color: "#6f6f80", marginTop: 4, lineHeight: 1.45 }}>
                Due this day with no hour set, so the grid can&apos;t draw{" "}
                {untimed.length === 1 ? "it" : "them"}. Add a time to place{" "}
                {untimed.length === 1 ? "it" : "them"} here.
              </span>
            </div>
          }
        >
          <button
            type="button"
            aria-label={`${untimed.length} task${untimed.length === 1 ? "" : "s"} with no time on ${day.format("dddd D MMMM")}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              maxWidth: "100%",
              border: "none",
              background: "rgba(229,137,63,0.16)",
              color: "#e5893f",
              borderRadius: 999,
              padding: compact ? "0 5px" : "0 7px",
              height: 15,
              fontSize: 9.5,
              fontWeight: 600,
              cursor: "pointer",
              overflow: "hidden",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <ClockCircleOutlined style={{ fontSize: 8.5 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {compact ? untimed.length : label}
            </span>
          </button>
        </Popover>
      )}
    </div>
  );
}
