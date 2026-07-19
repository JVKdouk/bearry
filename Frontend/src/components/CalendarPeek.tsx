"use client";

/**
 * The neighbouring period you see sliding in while you swipe the calendar.
 *
 * Deliberately a separate, simplified renderer rather than a second instance of
 * the real grid. The live grid carries drag-to-create, block dragging, region
 * editing and ref-indexed columns — reusing it for a peek would mean either
 * threading all of that through a shared component or having two interactive
 * grids competing for the same pointer. A peek only has to be *recognisable*:
 * you're deciding whether to keep going, not reading detail.
 *
 * Anything it can't do is off: no pointer events, no drag targets, no ghosts.
 */

import type { Dayjs } from "dayjs";

export interface PeekBlock {
  id: string;
  start: Dayjs;
  end: Dayjs;
  color: string;
  title: string;
}

interface Props {
  days: Dayjs[];
  blocksForDay: (day: Dayjs) => PeekBlock[];
  hours: number[];
  hourPx: number;
  headerH: number;
  showHeader: boolean;
  colMinWidth: number;
  gridHeight: number;
  today: Dayjs;
  borderColor: string;
  bg: string;
  textPrimary: string;
  textTertiary: string;
  todayBg: string;
  /** In a 45px week column only one of time/name fits; the name wins. */
  tiny: boolean;
}

export function CalendarPeek({
  days,
  blocksForDay,
  hours,
  hourPx,
  headerH,
  showHeader,
  colMinWidth,
  gridHeight,
  today,
  borderColor,
  bg,
  textPrimary,
  textTertiary,
  todayBg,
  tiny,
}: Props) {
  return (
    <div style={{ display: "flex", flex: 1, pointerEvents: "none" }} aria-hidden>
      {days.map((day) => {
        const isToday = day.isSame(today, "day");
        return (
          <div
            key={day.toISOString()}
            style={{ flex: 1, minWidth: colMinWidth, borderRight: `1px solid ${borderColor}` }}
          >
            {showHeader && (
              <div
                style={{
                  height: headerH,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 1,
                  borderBottom: `1px solid ${borderColor}`,
                  background: bg,
                }}
              >
                <span style={{ fontSize: 10.5, color: textTertiary, letterSpacing: 0.4 }}>
                  {day.format("ddd").toUpperCase()}
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
                    color: isToday ? "#fff" : textPrimary,
                    background: isToday ? todayBg : "transparent",
                  }}
                >
                  {day.format("D")}
                </span>
              </div>
            )}

            <div style={{ position: "relative", height: gridHeight }}>
              {hours.map((h) => (
                <div
                  key={h}
                  style={{
                    height: hourPx,
                    borderBottom: "1px solid #141420",
                    background: h < 6 || h >= 22 ? "rgba(255,255,255,0.012)" : "transparent",
                  }}
                />
              ))}

              {blocksForDay(day).map((b) => {
                const startMin = b.start.hour() * 60 + b.start.minute();
                const endMin = b.end.hour() * 60 + b.end.minute();
                const top = ((startMin - hours[0] * 60) / 60) * hourPx;
                const height = Math.max(((endMin - startMin) / 60) * hourPx, 18);
                return (
                  <div
                    key={b.id}
                    style={{
                      position: "absolute",
                      top,
                      height,
                      left: 4,
                      right: 6,
                      background: b.color + "26",
                      borderLeft: `3px solid ${b.color}`,
                      borderRadius: 8,
                      padding: "2px 6px",
                      overflow: "hidden",
                      fontSize: 11,
                      color: textPrimary,
                      lineHeight: 1.2,
                    }}
                  >
                    {/* Matches the live grid: when only one fits, the name
                        wins — the block's position already conveys the time. */}
                    {!tiny && (
                      <span style={{ color: b.color, fontWeight: 700, fontSize: 10.5 }}>
                        {b.start.format("HH:mm")}
                      </span>
                    )}
                    <span style={{ marginLeft: tiny ? 0 : 5 }}>{b.title}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
