"use client";

/**
 * The neighbouring period you see sliding in while you swipe the calendar.
 *
 * Deliberately a separate, simplified renderer rather than a second instance of
 * the real grid. The live grid carries drag-to-create, block dragging, region
 * editing and ref-indexed columns — reusing it for a peek would mean either
 * threading all of that through a shared component or having two interactive
 * grids competing for the same pointer.
 *
 * "Simplified" means *non-interactive*, not *approximate*. It draws the same
 * regions, the same overlap packing and the same block geometry as the live
 * grid, because anything it gets wrong is visible as a jolt at the end of the
 * gesture: the earlier version drew blocks full-width with no time-block bands,
 * so releasing a swipe made every overlapping event jump into its lane and the
 * background bands appear from nowhere. The whole point of a peek is that
 * finishing the swipe changes nothing.
 */

import type { Dayjs } from "dayjs";
import { DayColumnHeader } from "@/components/DayColumnHeader";
import type { CalendarBlock } from "@/lib/calendarTypes";

export interface PeekRegion {
  id: string;
  start: string;
  end: string;
  category: string;
  label?: string | null;
}

interface Props {
  days: Dayjs[];
  blocksForDay: (day: Dayjs) => CalendarBlock[];
  /** Same packing the live grid uses, so nothing shifts lane on release. */
  layoutDay: (blocks: CalendarBlock[]) => Map<string, { col: number; cols: number }>;
  /** Same geometry as the live grid, including the inter-block gap. */
  posFor: (start: Dayjs, end: Dayjs) => { top: number; height: number };
  /** Recurring time-block bands. Empty when the user has them hidden. */
  regionsForDay: (day: Dayjs) => PeekRegion[];
  regionColor: (category: string) => string;
  isProtected: (category: string) => boolean;
  hhmmToMin: (hhmm: string) => number;
  titleLines: (heightPx: number, tiny: boolean) => number;
  hours: number[];
  hourPx: number;
  showHeader: boolean;
  /** Same source as the live grid, so the nudge doesn't pop in on release. */
  untimedForDay: (day: Dayjs) => { id: string; title: string }[];
  colMinWidth: number;
  gridHeight: number;
  today: Dayjs;
  borderColor: string;
  textPrimary: string;
  /** In a 45px week column only one of time/name fits; the name wins. */
  tiny: boolean;
  /** Below this height a block has no room for its time as well as its name. */
  stackedMinPx: number;
}

export function CalendarPeek({
  days,
  blocksForDay,
  layoutDay,
  posFor,
  regionsForDay,
  regionColor,
  isProtected,
  hhmmToMin,
  titleLines,
  hours,
  hourPx,
  showHeader,
  untimedForDay,
  colMinWidth,
  gridHeight,
  today,
  borderColor,
  textPrimary,
  tiny,
  stackedMinPx,
}: Props) {
  return (
    <div style={{ display: "flex", flex: 1, pointerEvents: "none" }} aria-hidden>
      {days.map((day) => {
        const isToday = day.isSame(today, "day");
        const dayBlocks = blocksForDay(day);
        const lanes = layoutDay(dayBlocks);
        return (
          <div
            key={day.toISOString()}
            style={{ flex: 1, minWidth: colMinWidth, borderRight: `1px solid ${borderColor}` }}
          >
            {showHeader && (
              // The real component, not a copy of it: the peek exists so that
              // finishing a swipe changes nothing, and a hand-mirrored header
              // is exactly the kind of thing that drifts and then pops.
              <DayColumnHeader
                day={day}
                isToday={isToday}
                untimed={untimedForDay(day)}
                onOpenTask={() => {}}
                compact={tiny}
              />
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

              {regionsForDay(day).map((r, i) => {
                const top = (hhmmToMin(r.start) / 60) * hourPx;
                const height = ((hhmmToMin(r.end) - hhmmToMin(r.start)) / 60) * hourPx;
                if (height <= 0) return null;
                const color = regionColor(r.category);
                return (
                  <div
                    key={`${r.id}-${i}`}
                    style={{
                      position: "absolute",
                      top,
                      height,
                      left: 0,
                      right: 0,
                      zIndex: 0,
                      background: isProtected(r.category)
                        ? `repeating-linear-gradient(45deg, ${color}14 0 6px, transparent 6px 12px)`
                        : `${color}12`,
                      borderTop: `1px solid ${color}33`,
                      borderBottom: `1px solid ${color}22`,
                    }}
                  />
                );
              })}

              {dayBlocks.map((b) => {
                const { top, height } = posFor(b.start, b.end);
                const compact = height < stackedMinPx;
                const lane = lanes.get(b.id) ?? { col: 0, cols: 1 };
                const laneW = 100 / lane.cols;
                return (
                  <div
                    key={b.id}
                    style={{
                      position: "absolute",
                      top,
                      height,
                      left: `calc(${lane.col * laneW}% + 4px)`,
                      width: `calc(${laneW}% - 6px)`,
                      background: b.color + "26",
                      borderLeft: `3px solid ${b.color}`,
                      borderRadius: 8,
                      padding: tiny ? "1px 4px" : "3px 8px",
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "stretch",
                      justifyContent: "flex-start",
                      zIndex: 1,
                    }}
                  >
                    <span
                      style={{
                        fontSize: tiny ? 10 : compact ? 11 : 12,
                        color: textPrimary,
                        fontWeight: 600,
                        lineHeight: 1.22,
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitBoxOrient: "vertical",
                        WebkitLineClamp: titleLines(height, tiny),
                        wordBreak: "break-word",
                        minWidth: 0,
                      }}
                    >
                      {b.title}
                    </span>
                    {!tiny && !compact && (
                      <span
                        style={{
                          fontSize: 10.5,
                          color: b.color,
                          fontWeight: 700,
                          lineHeight: 1.25,
                          fontVariantNumeric: "tabular-nums",
                          marginTop: 1,
                        }}
                      >
                        {b.start.format("HH:mm")}
                      </span>
                    )}
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
