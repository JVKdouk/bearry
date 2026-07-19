"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  App as AntdApp,
  Button,
  Drawer,
  Empty,
  Grid,
  Popover,
  Segmented,
  Spin,
  Switch,
  Tag,
  Tooltip,
} from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  LeftOutlined,
  MoreOutlined,
  RightOutlined,
  ThunderboltOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import { api, errText } from "@/lib/api";
import { useCollection } from "@/store/hooks";
import { useSync } from "@/store/sync";
import { useUI } from "@/store/ui";
import { useIsOffline } from "@/store/network";
import { durationLabel, LIFE_AREA_COLOR } from "@/lib/format";
import { ACCENT, SUNSET, SURFACE, TEXT, WARM } from "@/lib/theme";
import { expandRange } from "@/lib/recurrence";
import { CalendarPeek } from "@/components/CalendarPeek";
import { MonthGrid } from "@/components/MonthGrid";
import { EventDetail } from "@/components/EventDetail";
import type { CalendarBlock as Block, CalendarView as View } from "@/lib/calendarTypes";
import {
  pinchDistance,
  pinchView,
  releaseOutcome,
  shouldClaim,
  trackOffset,
} from "@/lib/swipe";
import type { Diagnosis, FindingAction, ScheduledBlock, ScheduleProposal } from "@/lib/types";

dayjs.extend(isoWeek);

const DAY_START = 0;
const DAY_END = 23;
const HOUR_PX = 56;
const MIN_BLOCK_PX = 22;
const STACKED_MIN_PX = 38;
const OPEN_AT_HOUR = 6;
const HEADER_H = 46;
/** Must match the track's CSS transition below. */
const SWIPE_SETTLE_MS = 200;
const SNAP = 15;

/** The days a view shows for a given anchor. */
function daysFor(view: View, anchor: Dayjs): Dayjs[] {
  if (view === "day") return [anchor.startOf("day")];
  if (view === "3day")
    return Array.from({ length: 3 }, (_, i) => anchor.startOf("day").add(i, "day"));
  if (view === "month") {
    // Pad to whole weeks so the grid is rectangular and weekday columns line
    // up; the out-of-month days are rendered dimmed rather than blank.
    const first = anchor.startOf("month").startOf("isoWeek");
    const last = anchor.endOf("month").endOf("isoWeek");
    const n = last.diff(first, "day") + 1;
    return Array.from({ length: n }, (_, i) => first.add(i, "day"));
  }
  const start = anchor.startOf("isoWeek");
  return Array.from({ length: 7 }, (_, i) => start.add(i, "day"));
}

/** One period forward or back, in whatever unit the current view counts in. */
function shiftAnchor(view: View, anchor: Dayjs, dir: 1 | -1): Dayjs {
  if (view === "day") return anchor.add(dir, "day");
  if (view === "3day") return anchor.add(dir * 3, "day");
  if (view === "month") return anchor.add(dir, "month");
  return anchor.add(dir, "week");
}



interface DragState {
  day: Dayjs;
  top: number;
  startMin: number;
  curMin: number;
}



/** An in-flight drag of a proposed block. */
interface MoveDrag {
  key: string;
  durMin: number;
  /** Where inside the block the pointer grabbed it, so it doesn't jump. */
  grabOffsetMin: number;
  dayIdx: number;
  startMin: number;
  /** False until the pointer actually travels — a tap still means "exclude". */
  moved: boolean;
}

const snap = (min: number) => Math.round(min / SNAP) * SNAP;
const blockKey = (b: ScheduledBlock) => `${b.taskId}|${b.start}`;
const hhmmToMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
};
/** The scheduler never places work in these, so they read as "protected". */
const PROTECTED = new Set(["sleep", "meal"]);

const ACTION_LABEL: Record<FindingAction, string> = {
  add_working_hours: "Open scheduling settings",
  plan_next_working_day: "Try the next day",
  extend_deadlines: "Got it",
  let_something_go: "Got it",
  enrich_estimates: "Estimate them for me",
  adjust_rhythm: "Adjust how you work",
  none: "",
};

function CalendarInner() {
  const { message } = AntdApp.useApp();
  const params = useSearchParams();
  const events = useCollection("calendarEvent");
  const todos = useCollection("todo");
  const regions = useCollection("blockRegion");
  const openEditTask = useUI((s) => s.openEditTask);
  const openCreateTask = useUI((s) => s.openCreateTask);
  const showRegions = useUI((s) => s.showRegions);
  const setPlanOpen = useUI((s) => s.setPlanOpen);
  const setShowRegions = useUI((s) => s.setShowRegions);
  const pull = useSync((s) => s.pull);
  const update = useSync((s) => s.update);
  const router = useRouter();

  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  // Reading and editing the calendar is fully local; only the solver and the AI
  // estimates need the server.
  const offline = useIsOffline();

  const [anchor, setAnchor] = useState<Dayjs>(dayjs());
  const [view, setView] = useState<View>(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "3day" : "week",
  );
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  /**
   * Dragging a *proposed* block to a different time or day.
   *
   * The planner's ordering is a suggestion, not a verdict — you may want its
   * choices in a different order because you know something it doesn't. Moving
   * a ghost edits the proposal in place; nothing is written until you accept.
   */
  const [moveDrag, setMoveDrag] = useState<MoveDrag | null>(null);
  const moveDragRef = useRef<MoveDrag | null>(null);
  moveDragRef.current = moveDrag;
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);

  // ---- planning state ----
  const [proposal, setProposal] = useState<ScheduleProposal | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  /**
   * The diagnosis arrives after the plan does. It used to render above the
   * schedule, so when it landed it inserted three cards and shoved everything
   * you were reading down the screen. It lives behind its own tab now: the
   * schedule never moves, and the tab label carries the loading/count state
   * instead.
   */
  const [diagnosing, setDiagnosing] = useState(false);
  const [reviewTab, setReviewTab] = useState<"plan" | "warnings">("plan");

  const warningCount = diagnosis?.findings.length ?? 0;
  // Says what it knows rather than showing an empty count while it's thinking.
  const warningsLabel = diagnosing
    ? "Warnings…"
    : warningCount === 0
      ? "No warnings"
      : `${warningCount} warning${warningCount === 1 ? "" : "s"}`;
  const [enriching, setEnriching] = useState(false);

  // In day view the single column header just repeats the title, so drop it.
  const headerH = view === "day" ? 0 : HEADER_H;

  const scrollRef = useRef<HTMLDivElement>(null);
  // Wait a frame so the grid has laid out — scrolling before that gets clamped
  // to 0 and the day opens at midnight instead of the morning.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: OPEN_AT_HOUR * HOUR_PX });
    });
    return () => cancelAnimationFrame(id);
  }, [view]);

  // Keep the rail's ⚡ lit for as long as a proposal is on screen.
  useEffect(() => {
    setPlanOpen(!!proposal);
    return () => setPlanOpen(false);
  }, [proposal, setPlanOpen]);

  const [now, setNow] = useState(() => dayjs());
  useEffect(() => {
    const t = setInterval(() => setNow(dayjs()), 60_000);
    return () => clearInterval(t);
  }, []);

  const days = useMemo(() => daysFor(view, anchor), [anchor, view]);

  // The periods either side, so a swipe has something real to slide into view.
  const prevDays = useMemo(() => daysFor(view, shiftAnchor(view, anchor, -1)), [anchor, view]);
  const nextDays = useMemo(() => daysFor(view, shiftAnchor(view, anchor, 1)), [anchor, view]);

  const step = (dir: 1 | -1) => setAnchor((a) => shiftAnchor(view, a, dir));

  const titleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of todos) m.set(t.id, t.title);
    return m;
  }, [todos]);

  /**
   * The window we expand recurrence over. Padded a week either side of what's
   * on screen so stepping to the next period doesn't briefly render empty, and
   * so a swipe can show the neighbouring period mid-gesture.
   */
  const expandWindow = useMemo(() => {
    const r = rangeForView(view, anchor);
    return {
      from: r.start.subtract(7, "day").toDate(),
      to: r.end.add(7, "day").toDate(),
    };
  }, [view, anchor]);

  const blocks = useMemo<Block[]>(() => {
    const { from, to } = expandWindow;

    // Recurring rows are stored once and drawn many times. Expansion happens
    // client-side because the app has to work offline; the engine is a mirror
    // of the server's so both agree on the dates.
    const eventOccurrences = expandRange(events, from, to, (e) => ({
      start: new Date(e.start),
      end: new Date(e.end),
    }));

    const out: Block[] = eventOccurrences.map((o) => ({
      id: o.key,
      masterId: o.masterId,
      kind: "event",
      title: o.item.title || "Event",
      start: dayjs(o.start),
      end: dayjs(o.end),
      color: o.item.source === "google" ? "#4096ff" : WARM,
      isRepeat: o.isRepeat,
      bearaiTaskId: o.item.bearaiTaskId ?? null,
      source: o.item.source,
    }));

    // A repeating task shows its future occurrences too, but only the stored
    // one is completable — the rest are a preview of what completing it will
    // roll into, which is why `isRepeat` renders them muted.
    const schedulable = todos.filter(
      (t) => t.startTime && t.endTime && t.status !== "done" && !t.letGoAt,
    );
    for (const o of expandRange(schedulable, from, to, (t) => ({
      start: new Date(t.startTime!),
      end: new Date(t.endTime!),
    }))) {
      out.push({
        id: o.key,
        masterId: o.masterId,
        kind: "todo",
        title: o.item.title || "Task",
        start: dayjs(o.start),
        end: dayjs(o.end),
        color: ACCENT,
        isRepeat: o.isRepeat,
      });
    }

    return out;
  }, [events, todos, expandWindow]);

  const hours = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i);
  const gridHeight = hours.length * HOUR_PX;
  // 7 columns on a phone leaves ~45px per block — too narrow for any title, so
  // show the time alone rather than a row of "Pil…" ellipses. 3-day still fits.
  const tinyBlocks = isNarrow && view === "week";

  const viewOptions = [
    { label: "Day", value: "day" },
    { label: "3 days", value: "3day" },
    { label: "Week", value: "week" },
    { label: "Month", value: "month" },
  ];

  // The whole range must fit the viewport on mobile — squeeze, never scroll.
  const gridMinWidth = isNarrow ? 0 : view === "week" ? 760 : view === "3day" ? 420 : 0;
  const colMinWidth = isNarrow ? 0 : view === "day" ? 0 : 100;
  const gutterW = isNarrow ? 40 : 58;

  /**
   * Swipe-to-navigate.
   *
   * `dx` is the live finger offset; `settling` runs the CSS transition that
   * either completes the move or snaps back. The gesture is only *claimed*
   * once it's clearly horizontal (see lib/swipe), because this grid also
   * scrolls vertically — stealing a slightly-diagonal scroll makes the
   * calendar feel like it's fighting you.
   */
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [swipeDx, setSwipeDx] = useState(0);
  const [settling, setSettling] = useState(false);
  const swipeRef = useRef<{
    x0: number;
    y0: number;
    t0: number;
    claimed: boolean;
    width: number;
  } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  /** A live two-finger pinch, which changes how much time is on screen. */
  const pinchRef = useRef<{ startDist: number; from: View } | null>(null);

  function touchPoint(t: React.Touch) {
    return { x: t.clientX, y: t.clientY };
  }

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      // A pinch cancels any swipe in progress — you meant one or the other.
      swipeRef.current = null;
      setSwipeDx(0);
      pinchRef.current = {
        startDist: pinchDistance(touchPoint(e.touches[0]), touchPoint(e.touches[1])),
        from: view,
      };
      return;
    }
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    swipeRef.current = {
      x0: t.clientX,
      y0: t.clientY,
      t0: Date.now(),
      claimed: false,
      width: trackRef.current?.clientWidth ?? 0,
    };
    setSettling(false);
  }

  function onTouchMove(e: React.TouchEvent) {
    const p = pinchRef.current;
    if (p && e.touches.length === 2) {
      const dist = pinchDistance(touchPoint(e.touches[0]), touchPoint(e.touches[1]));
      const next = pinchView(p.from, p.startDist, dist);
      if (next !== view) {
        setView(next);
        // Re-baseline so a continuing pinch can step another level rather than
        // firing repeatedly off the same measurement.
        pinchRef.current = { startDist: dist, from: next };
      }
      return;
    }

    const s = swipeRef.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x0;
    const dy = t.clientY - s.y0;

    if (!s.claimed) {
      if (!shouldClaim(dx, dy)) return;
      s.claimed = true;
    }
    setSwipeDx(trackOffset(dx, s.width));
  }

  function onTouchEnd() {
    pinchRef.current = null;
    const s = swipeRef.current;
    swipeRef.current = null;
    if (!s?.claimed) return;

    const outcome = releaseOutcome(swipeDx, s.width, Date.now() - s.t0);
    setSettling(true);

    if (outcome === 0) {
      setSwipeDx(0);
      return;
    }

    // Finish the travel to the neighbouring period, then swap the anchor and
    // drop back to centre in the same frame. Resetting before the animation
    // ends produces a visible jump backwards.
    setSwipeDx(outcome === 1 ? -s.width : s.width);
    window.setTimeout(() => {
      setSettling(false);
      setSwipeDx(0);
      step(outcome === 1 ? 1 : -1);
    }, SWIPE_SETTLE_MS);
  }

  const blocksForDay = (day: Dayjs) => blocks.filter((b) => b.start.isSame(day, "day"));

  /**
   * What tapping a block opens.
   *
   * A planner-generated event is a *representation* of a task, so it opens the
   * task rather than a detail sheet describing the block. Everything else opens
   * as itself. Tapping an event used to do nothing at all, which read as the app
   * being broken rather than the item being uneditable.
   */
  function openBlock(b: Block) {
    if (b.kind === "todo") return openEditTask(b.masterId);
    if (b.bearaiTaskId) return openEditTask(b.bearaiTaskId);
    setOpenEventId(b.masterId);
  }

  /** Everything the peek needs to look like the grid without behaving like it. */
  const peekProps = {
    blocksForDay,
    hours,
    hourPx: HOUR_PX,
    headerH,
    showHeader: view === "week",
    colMinWidth,
    gridHeight,
    today: now,
    borderColor: SURFACE.borderSoft,
    bg: SURFACE.bg,
    textPrimary: TEXT.primary,
    textTertiary: TEXT.tertiary,
    todayBg: SUNSET,
    tiny: tinyBlocks,
  };

  const ghostsForDay = (day: Dayjs) =>
    (proposal?.blocks ?? []).filter((b) => dayjs(b.start).isSame(day, "day"));
  const minToPx = (min: number) => ((min - DAY_START * 60) / 60) * HOUR_PX;

  function posFor(start: Dayjs, end: Dayjs) {
    const startMin = Math.max(start.hour() * 60 + start.minute(), DAY_START * 60);
    const endMin = Math.min(end.hour() * 60 + end.minute(), (DAY_END + 1) * 60);
    return {
      top: minToPx(startMin),
      height: Math.max(minToPx(endMin) - minToPx(startMin), MIN_BLOCK_PX),
    };
  }

  /**
   * Side-by-side layout for overlapping blocks.
   *
   * Everything used to render full-width, so two events at the same time simply
   * covered each other — the later one won and the earlier one was invisible.
   * This is the standard calendar packing: walk blocks in start order, group
   * them into clusters that transitively overlap, and give every block in a
   * cluster its own column. A block that overlaps nothing still gets the full
   * width, so the common case looks exactly as before.
   *
   * Comparison uses the *rendered* geometry, not the raw times: a 5-minute event
   * is drawn at MIN_BLOCK_PX, so two near-adjacent short events visually collide
   * even though their times don't strictly overlap.
   */
  function layoutDay(dayBlocks: Block[]): Map<string, { col: number; cols: number }> {
    const out = new Map<string, { col: number; cols: number }>();
    const items = dayBlocks
      .map((b) => {
        const { top, height } = posFor(b.start, b.end);
        return { id: b.id, top, bottom: top + height };
      })
      .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

    let cluster: typeof items = [];
    let clusterBottom = -Infinity;

    const flush = () => {
      if (cluster.length === 0) return;
      // Greedy column assignment within the cluster.
      const colEnds: number[] = [];
      const assigned = new Map<string, number>();
      for (const it of cluster) {
        let col = colEnds.findIndex((end) => end <= it.top);
        if (col === -1) {
          col = colEnds.length;
          colEnds.push(it.bottom);
        } else {
          colEnds[col] = it.bottom;
        }
        assigned.set(it.id, col);
      }
      for (const [id, col] of assigned) out.set(id, { col, cols: colEnds.length });
      cluster = [];
      clusterBottom = -Infinity;
    };

    for (const it of items) {
      // A gap means the previous cluster is closed and can be sized.
      if (it.top >= clusterBottom) flush();
      cluster.push(it);
      clusterBottom = Math.max(clusterBottom, it.bottom);
    }
    flush();
    return out;
  }

  // Drag a proposed block to a new time/day. Bound at window level so the
  // pointer can leave the block (and the column) mid-drag.
  useEffect(() => {
    if (!moveDrag) return;

    const onMove = (e: PointerEvent) => {
      const md = moveDragRef.current;
      if (!md) return;

      // Which day column is the pointer over?
      let dayIdx = md.dayIdx;
      for (let i = 0; i < days.length; i++) {
        const el = colRefs.current[i];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right) {
          dayIdx = i;
          break;
        }
      }
      const el = colRefs.current[dayIdx];
      if (!el) return;
      const r = el.getBoundingClientRect();
      const minsAtPointer = ((e.clientY - r.top) / HOUR_PX) * 60 + DAY_START * 60;
      const raw = snap(minsAtPointer - md.grabOffsetMin);
      const startMin = Math.max(
        DAY_START * 60,
        Math.min(raw, (DAY_END + 1) * 60 - md.durMin),
      );
      // Only count it as a move once it actually lands somewhere else — a plain
      // tap must still mean "drop this block from the plan".
      const moved = md.moved || startMin !== md.startMin || dayIdx !== md.dayIdx;
      setMoveDrag({ ...md, dayIdx, startMin, moved });
    };

    const onUp = () => {
      const md = moveDragRef.current;
      setMoveDrag(null);
      if (!md) return;

      if (!md.moved) {
        setExcluded((sel) => {
          const next = new Set(sel);
          if (next.has(md.key)) next.delete(md.key);
          else next.add(md.key);
          return next;
        });
        return;
      }

      const newStart = days[md.dayIdx].startOf("day").add(md.startMin, "minute");
      const newEnd = newStart.add(md.durMin, "minute");
      const newKey = `${md.key.split("|")[0]}|${newStart.toISOString()}`;

      setProposal((p) =>
        p
          ? {
              ...p,
              blocks: p.blocks.map((b) =>
                blockKey(b) === md.key
                  ? {
                      ...b,
                      start: newStart.toISOString(),
                      end: newEnd.toISOString(),
                      reason: `${newStart.format("ddd, h:mm A")} — you moved this one here.`,
                    }
                  : b,
              ),
            }
          : p,
      );
      // The key embeds the start time, so a moved block gets a new identity —
      // carry any exclusion across or it would silently come back.
      setExcluded((sel) => {
        if (!sel.has(md.key)) return sel;
        const next = new Set(sel);
        next.delete(md.key);
        next.add(newKey);
        return next;
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [moveDrag, days]);

  // ---- planning actions ----
  const selected = useMemo(
    () => (proposal?.blocks ?? []).filter((b) => !excluded.has(blockKey(b))),
    [proposal, excluded],
  );
  const selectedMinutes = useMemo(
    () => selected.reduce((n, b) => n + dayjs(b.end).diff(dayjs(b.start), "minute"), 0),
    [selected],
  );
  const dropped = (proposal?.blocks.length ?? 0) - selected.length;

  // Chronological agenda grouping for the review sheet.
  const proposalByDay = useMemo(() => {
    if (!proposal) return [] as [string, ScheduledBlock[]][];
    const g = new Map<string, ScheduledBlock[]>();
    for (const b of proposal.blocks) {
      const k = dayjs(b.start).format("YYYY-MM-DD");
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(b);
    }
    for (const list of g.values()) list.sort((a, b) => a.start.localeCompare(b.start));
    return Array.from(g.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [proposal]);

  // Findings carry a machine-readable action so each one offers a real button
  // rather than just telling you what you should have done.
  async function runFindingAction(action: FindingAction) {
    if (action === "add_working_hours" || action === "adjust_rhythm") {
      router.push("/settings");
      return;
    }
    if (action === "plan_next_working_day") {
      setAnchor((a) => a.add(1, "day"));
      setReviewOpen(false);
      message.info("Moved to the next day — hit Plan again");
      return;
    }
    if (action === "enrich_estimates") {
      setEnriching(true);
      try {
        const { results } = await api.aiEnrich({ limit: 25 });
        for (const r of results) {
          update("todo", r.todoId, {
            estimatedDuration: r.estimatedDuration,
            energyDemand: r.energyDemand,
            category: r.category,
          });
        }
        const reminders = results.filter((r) => r.kind === "reminder").length;
        message.success(
          `Updated ${results.length} tasks` +
            (reminders ? ` · ${reminders} marked as reminders` : ""),
        );
        await runPlan();
      } catch (e) {
        message.error(errText(e, "Couldn't estimate tasks"));
      } finally {
        setEnriching(false);
      }
      return;
    }
    // extend_deadlines / let_something_go are judgement calls — the detail is
    // the whole advice, so there's nothing safe to automate.
    setReviewOpen(false);
  }

  const toggleBlock = (key: string) =>
    setExcluded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  /** The date range a given view shows, independent of React state timing. */
  function rangeForView(v: View, a: Dayjs): { start: Dayjs; end: Dayjs } {
    if (v === "day") return { start: a.startOf("day"), end: a.endOf("day") };
    if (v === "3day")
      return { start: a.startOf("day"), end: a.startOf("day").add(2, "day").endOf("day") };
    if (v === "month") return { start: a.startOf("month"), end: a.endOf("month") };
    return { start: a.startOf("isoWeek"), end: a.endOf("isoWeek") };
  }

  /**
   * What "plan" should cover, which depends entirely on how you asked for it.
   *
   *  • "week"  — the ⚡ nav item. Always a week, wherever you were. On a
   *    Saturday or Sunday it runs through the END of next week too, because a
   *    two-day plan on a Sunday evening isn't a plan, it's a rounding error.
   *  • "view"  — the Plan button on the calendar. Plans exactly what you're
   *    looking at, no more: if you deliberately opened a single day, that's the
   *    scope you asked for.
   *
   * The view is passed in rather than read from state: `setView` doesn't apply
   * until the next render, so a deep link that switched to the week view and
   * planned in the same tick would have planned the OLD view's range.
   */
  function planHorizon(
    scope: "week" | "view",
    forView: View,
  ): { from: Dayjs; to: Dayjs } {
    const today = dayjs();

    if (scope === "week") {
      const weekStart = today.startOf("isoWeek");
      const isWeekend = today.day() === 6 || today.day() === 0;
      const to = (isWeekend ? weekStart.add(1, "week") : weekStart).endOf("isoWeek");
      return { from: today, to };
    }

    // Month has no planning of its own — fall back to the week it anchors on.
    const effective: View = forView === "month" ? "week" : forView;
    const r = rangeForView(effective, anchor);
    return { from: r.start.isBefore(today) ? today : r.start, to: r.end };
  }

  async function runPlan(scope: "week" | "view" = "view") {
    // Planning a month isn't supported, so asking for it drops back to the week.
    const forView: View = scope === "week" ? "week" : view === "month" ? "week" : view;
    if (view === "month") setView("week");
    setPlanning(true);
    setApplied(false);
    try {
      const { from, to: rangeEnd } = planHorizon(scope, forView);
      const p = await api.plan({
        horizonStart: from.toISOString(),
        horizonEnd: rangeEnd.toISOString(),
      });
      setProposal(p);
      setExcluded(new Set());
      setDiagnosis(null);
      setDiagnosing(true);
      setReviewTab("plan");

      // Explain the plan — especially when it's empty. This is what turns
      // "couldn't place 21" into "you have no working hours on Saturday".
      void api
        .aiDiagnose({ horizonStart: from.toISOString(), horizonEnd: rangeEnd.toISOString() })
        .then(setDiagnosis)
        .catch(() => setDiagnosis({ headline: "", findings: [], usedAI: false }))
        .finally(() => setDiagnosing(false));

      // Nothing placed, or a phone (where 7 columns ≈ 45px each is unreadable):
      // open the agenda sheet, which carries the explanation.
      if (p.blocks.length === 0 || isNarrow) setReviewOpen(true);
    } catch (e) {
      message.error(errText(e, "Couldn't build a plan"));
    } finally {
      setPlanning(false);
    }
  }

  // Deep link: /calendar?plan=1 (the ⚡ nav item) starts planning immediately.
  const autoPlan = params.get("plan");
  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoPlan || autoRan.current) return;
    autoRan.current = true;
    // The ⚡ item means "plan my week" regardless of which view you left behind.
    setView("week");
    void runPlan("week");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlan]);

  async function acceptPlan() {
    if (!proposal || selected.length === 0) return;
    setApplying(true);
    try {
      await api.applyPlan(
        selected.map((b) => ({ taskId: b.taskId, start: b.start, end: b.end, reason: b.reason })),
      );
      await pull();
      setProposal(null);
      setExcluded(new Set());
      setApplied(true);
      message.success(`${selected.length} block${selected.length === 1 ? "" : "s"} added`);
    } catch (e) {
      message.error(errText(e, "Couldn't apply the plan"));
    } finally {
      setApplying(false);
    }
  }

  async function undoPlan() {
    try {
      await api.undoPlan();
      await pull();
      setApplied(false);
      message.success("Reverted");
    } catch (e) {
      message.error(errText(e, "Couldn't undo"));
    }
  }

  // ---- drag to create ----
  function yToMin(clientY: number, top: number) {
    const min = DAY_START * 60 + ((clientY - top) / HOUR_PX) * 60;
    return snap(Math.max(DAY_START * 60, Math.min(min, (DAY_END + 1) * 60)));
  }

  function onColumnMouseDown(e: React.MouseEvent, day: Dayjs) {
    if (e.button !== 0) return;
    // A press that started on a block or a proposed ghost is that element's
    // business. Tapping a ghost to drop it was re-emitting a synthesized
    // mousedown once React re-rendered, which landed on the column underneath
    // and opened the "new event" drawer instead of removing the block.
    if ((e.target as HTMLElement).closest("[data-block]")) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const m = yToMin(e.clientY, rect.top);
    setDrag({ day, top: rect.top, startMin: m, curMin: m });
  }

  useEffect(() => {
    if (!drag) return;
    function onMove(ev: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      setDrag({ ...d, curMin: yToMin(ev.clientY, d.top) });
    }
    function onUp() {
      const d = dragRef.current;
      if (!d) return;
      const a = Math.min(d.startMin, d.curMin);
      let b = Math.max(d.startMin, d.curMin);
      if (b - a < SNAP) b = a + 30;
      const start = d.day.startOf("day").add(a, "minute");
      const end = d.day.startOf("day").add(b, "minute");
      setDrag(null);
      openCreateTask({ startTime: start.toISOString(), endTime: end.toISOString() });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, openCreateTask]);

  const last = days[days.length - 1];
  const rangeLabel =
    view === "day"
      ? anchor.format("dddd, MMMM D")
      : view === "month"
        ? anchor.format("MMMM YYYY")
        : `${days[0].format("MMM D")} – ${last.format("MMM D, YYYY")}`;
  const shortLabel =
    view === "day"
      ? anchor.format("ddd, MMM D")
      : view === "month"
        ? anchor.format("MMMM YYYY")
        : `${days[0].format("MMM D")} – ${last.format("MMM D")}`;
  const showingToday = days.some((d) => d.isSame(now, "day"));

  // Recurring block regions rendered as background bands.
  const regionsForDay = (day: Dayjs) => {
    if (!showRegions) return [];
    const bit = 1 << day.day();
    return regions.filter((r) => (r.dayMask & bit) !== 0);
  };

  const nowMin = now.hour() * 60 + now.minute();

  // Group unplaced tasks by reason so identical text appears once.
  const unplacedByReason = useMemo(() => {
    if (!proposal) return [];
    const g = new Map<string, string[]>();
    for (const u of proposal.unscheduled) {
      if (!g.has(u.reason)) g.set(u.reason, []);
      g.get(u.reason)!.push(titleById.get(u.taskId) ?? "Task");
    }
    return Array.from(g.entries());
  }, [proposal, titleById]);

  const cap = proposal?.capacity;
  const utilization =
    cap && cap.capacityMinutes > 0
      ? Math.round((cap.demandMinutes / cap.capacityMinutes) * 100)
      : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="cal-header">
        {/* arrows flank the date; the date itself jumps back to today */}
        <div className="cal-datenav">
          <button className="cal-arrow" aria-label="Previous" onClick={() => step(-1)}>
            <LeftOutlined />
          </button>

          <h1 className="cal-h1">
            <button
              className="cal-title"
              title="Jump to today"
              onClick={() => setAnchor(dayjs())}
            >
              {isNarrow ? shortLabel : rangeLabel}
            </button>
          </h1>

          <button className="cal-arrow" aria-label="Next" onClick={() => step(1)}>
            <RightOutlined />
          </button>

          {/* explicit escape hatch on desktop, where there's room for it */}
          {!isNarrow && !showingToday && (
            <Button type="text" onClick={() => setAnchor(dayjs())} style={{ color: TEXT.secondary }}>
              Today
            </Button>
          )}
        </div>

        <div className="cal-controls">
          {/* Desktop has room for the controls inline; on a phone they'd break
              the single-line header, so they move into an overflow menu. */}
          {!isNarrow ? (
            <>
              <Segmented
                value={view}
                onChange={(v) => setView(v as View)}
                options={viewOptions}
              />
              <Button
                type={showRegions ? "primary" : "default"}
                onClick={() => setShowRegions(!showRegions)}
                title="Show your recurring time blocks behind the calendar"
              >
                Regions
              </Button>
            </>
          ) : (
            <Popover
              trigger="click"
              placement="bottomRight"
              content={
                <div style={{ display: "flex", flexDirection: "column", gap: 14, width: 210 }}>
                  <div>
                    <div className="section-label" style={{ marginBottom: 6 }}>
                      View
                    </div>
                    <Segmented
                      block
                      value={view}
                      onChange={(v) => setView(v as View)}
                      options={viewOptions}
                    />
                  </div>
                  <div
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
                  >
                    <span style={{ fontSize: 13, color: TEXT.secondary }}>Block regions</span>
                    <Switch size="small" checked={showRegions} onChange={setShowRegions} />
                  </div>
                </div>
              }
            >
              <button className="cal-arrow" aria-label="View options">
                <MoreOutlined />
              </button>
            </Popover>
          )}

          {/* The solver runs server-side against your full workload, so planning
              is one of the few things that genuinely needs a connection. Say so
              on the control itself rather than letting the tap fail. */}
          <Tooltip title={offline ? "Planning needs a connection" : "Plan your day"}>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={planning}
              disabled={offline}
              onClick={() => void runPlan("view")}
              style={
                offline
                  ? { border: "none" }
                  : { background: SUNSET, border: "none" }
              }
            >
              Plan
            </Button>
          </Tooltip>
        </div>
      </div>

      {view === "month" ? (
        // Month gets the same gesture surface, otherwise pinch is a one-way
        // trip: you could zoom out to the month and then be stuck there.
        // Only one branch is ever mounted, so they can share the ref.
        <div
          ref={trackRef}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            // No neighbouring month is rendered to peek at — twelve extra day
            // cells for a glance isn't worth it — but the grid still tracks the
            // finger so the gesture has feedback instead of jumping on release.
            transform: `translateX(${swipeDx}px)`,
            transition: settling ? `transform ${SWIPE_SETTLE_MS}ms ease-out` : "none",
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        >
        <MonthGrid
          days={days}
          anchor={anchor}
          now={now}
          blocks={blocks}
          onPickDay={(d) => {
            // Tapping a day drills in — a month cell can't show enough to act on.
            setAnchor(d);
            setView("day");
          }}
          onCreate={(d) =>
            openCreateTask({
              startTime: d.hour(9).minute(0).second(0).millisecond(0).toISOString(),
              endTime: d.hour(9).minute(30).second(0).millisecond(0).toISOString(),
            })
          }
          onOpenBlock={openBlock}
          roomForTime={!isNarrow}
        />
        </div>
      ) : (
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto" }}>
        <div style={{ display: "flex", minWidth: gridMinWidth }}>
          <div
            style={{
              width: gutterW,
              flexShrink: 0,
              borderRight: `1px solid ${SURFACE.borderSoft}`,
              paddingTop: headerH,
            }}
          >
            {hours.map((h) => (
              <div key={h} style={{ height: HOUR_PX, position: "relative" }}>
                <span
                  style={{
                    position: "absolute",
                    top: -7,
                    right: isNarrow ? 5 : 9,
                    fontSize: isNarrow ? 10 : 11,
                    color: TEXT.tertiary,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {isNarrow ? String(h).padStart(2, "0") : `${String(h).padStart(2, "0")}:00`}
                </span>
              </div>
            ))}
          </div>

          {/* The swipe viewport. Only the day columns travel — the hour gutter
              is a fixed reference and sliding it with them would be disorienting.
              Neighbouring periods are rendered either side so the gesture reveals
              real content rather than a blank panel that fills in on release. */}
          <div
            ref={trackRef}
            style={{ flex: 1, overflow: "hidden", position: "relative" }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
          >
            <div
              style={{
                display: "flex",
                transform: `translateX(${swipeDx}px)`,
                transition: settling ? `transform ${SWIPE_SETTLE_MS}ms ease-out` : "none",
                // Only pay for compositing while a gesture is actually in play.
                willChange: swipeDx !== 0 ? "transform" : undefined,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  right: "100%",
                  top: 0,
                  width: "100%",
                  display: "flex",
                }}
              >
                <CalendarPeek {...peekProps} days={prevDays} />
              </div>

              <div style={{ display: "flex", flex: 1, minWidth: 0 }}>
          {days.map((day) => {
            const isToday = day.isSame(now, "day");
            const dragActive = drag && drag.day.isSame(day, "day");
            const lo = dragActive ? Math.min(drag.startMin, drag.curMin) : 0;
            const hi = dragActive ? Math.max(drag.startMin, drag.curMin) : 0;
            const dayBlocks = blocksForDay(day);
            const dayLayout = layoutDay(dayBlocks);
            // Vertical spans already taken by a block, so a region label can
            // avoid being drawn underneath one.
            const occupied = dayBlocks.map((b) => {
              const { top, height } = posFor(b.start, b.end);
              return { top, bottom: top + height };
            });
            return (
              <div
                key={day.toISOString()}
                ref={(el) => {
                  colRefs.current[days.indexOf(day)] = el;
                }}
                style={{
                  flex: 1,
                  minWidth: colMinWidth,
                  borderRight: `1px solid ${SURFACE.borderSoft}`,
                }}
              >
                {view === "week" && (
                  <div
                    style={{
                      height: HEADER_H,
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
                    }}
                  >
                    <span style={{ fontSize: 10.5, color: TEXT.tertiary, letterSpacing: 0.4 }}>
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
                        color: isToday ? "#fff" : TEXT.primary,
                        background: isToday ? SUNSET : "transparent",
                      }}
                    >
                      {day.format("D")}
                    </span>
                  </div>
                )}

                <div
                  onMouseDown={(e) => onColumnMouseDown(e, day)}
                  style={{
                    position: "relative",
                    height: gridHeight,
                    // Deliberately the normal cursor: a crosshair over the whole
                    // grid implies "this is a drawing surface", when mostly you're
                    // reading it. Drag-to-create still works exactly as before.
                    cursor: "default",
                    userSelect: "none",
                  }}
                >
                  {hours.map((h) => (
                    <div
                      key={h}
                      style={{
                        height: HOUR_PX,
                        borderBottom: "1px solid #141420",
                        background: h < 6 || h >= 22 ? "rgba(255,255,255,0.012)" : "transparent",
                      }}
                    />
                  ))}

                  {/* recurring block regions, painted behind everything else */}
                  {regionsForDay(day).map((r, i) => {
                    const top = (hhmmToMin(r.start) / 60) * HOUR_PX;
                    const height = ((hhmmToMin(r.end) - hhmmToMin(r.start)) / 60) * HOUR_PX;
                    if (height <= 0) return null;
                    const color = LIFE_AREA_COLOR[r.category];
                    const isProtected = PROTECTED.has(r.category);
                    // Hide the caption if any block covers the strip it'd occupy.
                    const labelHidden = occupied.some(
                      (o) => o.top < top + 18 && o.bottom > top,
                    );
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
                          pointerEvents: "none",
                          // Protected areas (sleep/meal) are hatched — the
                          // scheduler never places work there.
                          background: isProtected
                            ? `repeating-linear-gradient(45deg, ${color}14 0 6px, transparent 6px 12px)`
                            : `${color}12`,
                          borderTop: `1px solid ${color}33`,
                          borderBottom: `1px solid ${color}22`,
                        }}
                      >
                        {/* The label sits at the top of the band, which is
                            exactly where an event starting on the hour lands —
                            "WORK" and "09:00 PR Reviews" were printing over each
                            other. The band's tint already carries the meaning,
                            so drop the text rather than stack it. */}
                        {height >= 26 && !tinyBlocks && !labelHidden && (
                          <span
                            style={{
                              fontSize: 9.5,
                              letterSpacing: 0.4,
                              textTransform: "uppercase",
                              color: `${color}cc`,
                              padding: "2px 5px",
                              display: "inline-block",
                              fontWeight: 600,
                            }}
                          >
                            {r.label || r.category}
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {isToday && (
                    <div
                      style={{
                        position: "absolute",
                        top: minToPx(nowMin),
                        left: 0,
                        right: 0,
                        height: 0,
                        borderTop: `2px solid ${WARM}`,
                        zIndex: 2,
                        pointerEvents: "none",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          left: -4,
                          top: -4,
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: WARM,
                          boxShadow: `0 0 8px ${WARM}`,
                        }}
                      />
                    </div>
                  )}

                  {dragActive && (
                    <div
                      style={{
                        position: "absolute",
                        top: minToPx(lo),
                        height: Math.max(minToPx(hi) - minToPx(lo), 6),
                        left: 4,
                        right: 4,
                        background: "rgba(168,85,247,0.25)",
                        border: "1px dashed rgba(168,85,247,0.7)",
                        borderRadius: 10,
                        pointerEvents: "none",
                        fontSize: 10.5,
                        color: "#d9b8ff",
                        padding: "3px 6px",
                      }}
                    >
                      {dayjs().startOf("day").add(lo, "minute").format("HH:mm")} –{" "}
                      {dayjs().startOf("day").add(hi, "minute").format("HH:mm")}
                    </div>
                  )}

                  {/* live preview of the block being dragged */}
                  {moveDrag?.moved && days[moveDrag.dayIdx]?.isSame(day, "day") && (
                    <div
                      className="ghost-block"
                      style={{
                        top: minToPx(moveDrag.startMin),
                        height: Math.max(
                          (moveDrag.durMin / 60) * HOUR_PX,
                          MIN_BLOCK_PX,
                        ),
                        left: tinyBlocks ? 2 : 14,
                        right: 2,
                        zIndex: 3,
                        borderStyle: "solid",
                        background: "rgba(168,85,247,0.28)",
                        padding: tinyBlocks ? "0 4px" : "2px 8px",
                        pointerEvents: "none",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: tinyBlocks ? 10 : 11,
                          fontWeight: 700,
                          color: "#efe3ff",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {days[moveDrag.dayIdx]
                          .startOf("day")
                          .add(moveDrag.startMin, "minute")
                          .format("HH:mm")}
                      </span>
                      {!tinyBlocks && (
                        <span
                          style={{
                            fontSize: 11.5,
                            color: "#efe3ff",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {titleById.get(moveDrag.key.split("|")[0]) ?? "Task"}
                        </span>
                      )}
                    </div>
                  )}

                  {/* existing commitments */}
                  {blocksForDay(day).map((b) => {
                    const { top, height } = posFor(b.start, b.end);
                    const compact = height < STACKED_MIN_PX;
                    // Share the width with anything it overlaps instead of
                    // covering it.
                    const lane = dayLayout.get(b.id) ?? { col: 0, cols: 1 };
                    const laneW = 100 / lane.cols;
                    return (
                      <div
                        key={b.id}
                        data-block="event"
                        title={`${b.start.format("HH:mm")}–${b.end.format("HH:mm")}  ${b.title}`}
                        onMouseDown={(e) => e.stopPropagation()}
                        role="button"
                        tabIndex={0}
                        aria-label={`${b.title}, ${b.start.format("HH:mm")} to ${b.end.format("HH:mm")}`}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openBlock(b);
                          }
                        }}
                        // A future occurrence opens the stored row: editing a
                        // repeating item edits the series.
                        onClick={() => openBlock(b)}
                        style={{
                          position: "absolute",
                          top,
                          height,
                          left: `calc(${lane.col * laneW}% + 4px)`,
                          width: `calc(${laneW}% - 6px)`,
                          background: b.color + "26",
                          borderLeft: `3px solid ${b.color}`,
                          borderRadius: 8,
                          padding: tinyBlocks ? "0 4px" : compact ? "0 8px" : "4px 8px",
                          overflow: "hidden",
                          display: "flex",
                          flexDirection: compact || tinyBlocks ? "row" : "column",
                          alignItems: compact || tinyBlocks ? "center" : "stretch",
                          gap: compact ? 6 : 0,
                          cursor: "pointer",
                          // A generated occurrence is a preview of a repeat, not
                          // something that exists yet — reading as slightly
                          // lighter keeps it from being mistaken for a
                          // separately-scheduled commitment.
                          opacity: b.isRepeat ? 0.72 : 1,
                        }}
                      >
                        {/* When only one of the two fits, show the NAME.
                            A 45px week column on a phone previously showed
                            "09:00" and dropped the title — but the block's
                            position in the grid already says when it is, and
                            the time is the only thing the layout can express
                            on its own. The name is the part that identifies
                            which commitment you're looking at. */}
                        {!tinyBlocks && (
                          <span
                            style={{
                              fontSize: 11,
                              color: b.color,
                              fontWeight: 700,
                              lineHeight: 1.2,
                              fontVariantNumeric: "tabular-nums",
                              flexShrink: 0,
                            }}
                          >
                            {b.start.format("HH:mm")}
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: tinyBlocks ? 10 : compact ? 11.5 : 12,
                            color: TEXT.primary,
                            lineHeight: 1.2,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: compact || tinyBlocks ? "nowrap" : "normal",
                            minWidth: 0,
                          }}
                        >
                          {b.title}
                        </span>
                      </div>
                    );
                  })}

                  {/* Proposed ghosts. Dropped ones are removed entirely rather
                      than greyed out, so the slot is genuinely free to tap and
                      put something else there. Restore them from Review. */}
                  {ghostsForDay(day)
                    .filter((g) => !excluded.has(blockKey(g)))
                    .map((g) => {
                      const start = dayjs(g.start);
                      const end = dayjs(g.end);
                      const { top, height } = posFor(start, end);
                      const compact = height < STACKED_MIN_PX;
                      const key = blockKey(g);
                      const title = titleById.get(g.taskId) ?? "Task";
                      return (
                        <div
                          key={key}
                          data-block="ghost"
                          className="ghost-block"
                          title={`${start.format("HH:mm")}–${end.format("HH:mm")}  ${title}\n${g.reason}\n\nDrag to move · tap to drop`}
                          onMouseDown={(e) => e.stopPropagation()}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            // Stops the browser synthesizing mousedown/click after
                            // a touch tap, which is what leaked through to the grid.
                            e.preventDefault();
                            // Grab offset keeps the block under the finger
                            // instead of snapping its top to the cursor.
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const grabOffsetMin = ((e.clientY - rect.top) / HOUR_PX) * 60;
                            setMoveDrag({
                              key,
                              durMin: end.diff(start, "minute"),
                              grabOffsetMin,
                              dayIdx: days.findIndex((d) => d.isSame(day, "day")),
                              startMin: start.hour() * 60 + start.minute(),
                              moved: false,
                            });
                          }}
                          style={{
                            top,
                            height,
                            touchAction: "none", // let us handle the drag, not the scroller
                            opacity: moveDrag?.key === key ? 0.25 : undefined,
                            left: tinyBlocks ? 2 : 14,
                            right: 2,
                            zIndex: 1,
                            padding: tinyBlocks ? "0 4px" : compact ? "0 8px" : "4px 8px",
                            display: "flex",
                            flexDirection: compact || tinyBlocks ? "row" : "column",
                            alignItems: compact || tinyBlocks ? "center" : "stretch",
                            gap: compact ? 6 : 0,
                          }}
                        >
                          <span
                            style={{
                              fontSize: tinyBlocks ? 10 : 11,
                              fontWeight: 700,
                              lineHeight: 1.2,
                              color: "#d9b8ff",
                              fontVariantNumeric: "tabular-nums",
                              flexShrink: 0,
                            }}
                          >
                            {start.format("HH:mm")}
                          </span>
                          {/* a truncated "Pil…" is noise, not information */}
                          {!tinyBlocks && (
                            <span
                              style={{
                                fontSize: compact ? 11.5 : 12,
                                lineHeight: 1.2,
                                color: TEXT.primary,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: compact ? "nowrap" : "normal",
                                minWidth: 0,
                              }}
                            >
                              {title}
                              {g.isChunk && g.chunkCount
                                ? ` (${(g.chunkIndex ?? 0) + 1}/${g.chunkCount})`
                                : ""}
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

              <div
                style={{
                  position: "absolute",
                  left: "100%",
                  top: 0,
                  width: "100%",
                  display: "flex",
                }}
              >
                <CalendarPeek {...peekProps} days={nextDays} />
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      <EventDetail
        eventId={openEventId}
        onClose={() => setOpenEventId(null)}
        isMobile={isNarrow}
      />

      {/* floating planning bar */}
      {proposal && (
        <div className="plan-bar">
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 150 }}>
            <span style={{ fontSize: 13, color: TEXT.primary }}>
              <strong>{selected.length}</strong> of {proposal.blocks.length} proposed ·{" "}
              {durationLabel(selectedMinutes) || "0m"}
            </span>
            {/* A short plan is now a deliberate outcome, not a failure. Without
                saying so, "9 of 18" reads as the planner giving up. */}
            {proposal.unscheduled.length > 0 ? (
              <span style={{ fontSize: 11.5, color: TEXT.secondary }}>
                {proposal.unscheduled.length} kept back to protect your breathing
                room — see Review
              </span>
            ) : (
              <span style={{ fontSize: 11.5, color: TEXT.secondary }}>
                Drag a block to move it · tap to drop it
              </span>
            )}
            {cap && !isNarrow && (
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div
                  style={{
                    flex: 1,
                    height: 5,
                    borderRadius: 999,
                    background: "#22222d",
                    overflow: "hidden",
                    minWidth: 70,
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(utilization, 100)}%`,
                      height: "100%",
                      background: cap.overcommitted
                        ? `linear-gradient(90deg, ${WARM} 0%, #ff4d4f 100%)`
                        : SUNSET,
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: 11.5,
                    color: cap.overcommitted ? WARM : TEXT.tertiary,
                    whiteSpace: "nowrap",
                  }}
                >
                  {utilization}%
                </span>
              </div>
            )}
          </div>

          {!isNarrow && (
            <span style={{ fontSize: 11.5, color: TEXT.tertiary, maxWidth: 140 }}>
              Tap a proposal to drop it
            </span>
          )}

          {dropped > 0 && (
            <Button
              size="small"
              type="text"
              onClick={() => setExcluded(new Set())}
              style={{ color: TEXT.secondary }}
            >
              {dropped} dropped · Restore
            </Button>
          )}

          <Button size="small" onClick={() => setReviewOpen(true)}>
            Review
          </Button>

          {proposal.unscheduled.length > 0 && !isNarrow && (
            <Popover
              trigger="click"
              placement="top"
              content={
                <div style={{ maxWidth: 320, display: "flex", flexDirection: "column", gap: 14 }}>
                  {unplacedByReason.map(([reason, titles], i) => (
                    <div key={i}>
                      <div style={{ fontSize: 12, color: TEXT.secondary, marginBottom: 6 }}>
                        {reason}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {titles.map((t, j) => (
                          <Tag key={j} bordered={false} style={{ margin: 0, background: "#17171f" }}>
                            {t}
                          </Tag>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              }
            >
              <Button size="small" type="text" style={{ color: TEXT.secondary }}>
                Couldn&apos;t place {proposal.unscheduled.length}
              </Button>
            </Popover>
          )}

          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <Button onClick={() => setProposal(null)}>Discard</Button>
            <Button
              type="primary"
              loading={applying}
              disabled={selected.length === 0}
              onClick={acceptPlan}
            >
              Accept {selected.length}
            </Button>
          </div>
        </div>
      )}

      {/* Readable agenda review — the primary surface on mobile, where the
          week grid can't show a title at all. */}
      <Drawer
        open={reviewOpen && !!proposal}
        onClose={() => setReviewOpen(false)}
        placement={isNarrow ? "bottom" : "right"}
        height={isNarrow ? "85%" : undefined}
        width={isNarrow ? undefined : 460}
        closeIcon={null}
        styles={{
          body: { padding: 0, background: SURFACE.bg },
          header: { display: "none" },
          content: {
            background: SURFACE.bg,
            borderTopLeftRadius: isNarrow ? 22 : 0,
            borderTopRightRadius: isNarrow ? 22 : 0,
          },
          mask: { background: "rgba(0,0,0,0.55)" },
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {isNarrow && (
            <div style={{ display: "grid", placeItems: "center", padding: "10px 0 2px", flexShrink: 0 }}>
              <span style={{ width: 38, height: 4, borderRadius: 999, background: "#33333f" }} />
            </div>
          )}

          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${SURFACE.borderSoft}` }}>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, letterSpacing: "-0.01em" }}>
              Proposed plan
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: TEXT.secondary }}>
              {selected.length} of {proposal?.blocks.length ?? 0} kept ·{" "}
              {durationLabel(selectedMinutes) || "0m"}
              {cap ? ` · ${utilization}% of capacity` : ""}
            </p>

            {/* The warnings count lives in the label, so the diagnosis
                arriving changes a few characters here rather than inserting
                cards above the schedule you were reading. */}
            <Segmented
              block
              size="small"
              value={reviewTab}
              onChange={(v) => setReviewTab(v as "plan" | "warnings")}
              style={{ marginTop: 12 }}
              options={[
                { label: "Schedule", value: "plan" },
                { label: warningsLabel, value: "warnings" },
              ]}
            />
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px 18px" }}>
            {reviewTab === "warnings" && diagnosing && (
              <div style={{ display: "grid", placeItems: "center", padding: "36px 0", gap: 10 }}>
                <Spin />
                <span style={{ fontSize: 12.5, color: TEXT.secondary }}>
                  Checking this plan over…
                </span>
              </div>
            )}

            {reviewTab === "warnings" && !diagnosing && warningCount === 0 && (
              <div style={{ display: "grid", placeItems: "center", padding: "36px 18px", gap: 8 }}>
                <span style={{ fontSize: 26 }}>✓</span>
                <span style={{ fontSize: 13.5, color: TEXT.primary }}>Nothing to flag</span>
                <span style={{ fontSize: 12.5, color: TEXT.secondary, textAlign: "center" }}>
                  This plan fits your rhythm and your capacity.
                </span>
              </div>
            )}

            {/* why the plan looks the way it does */}
            {reviewTab === "warnings" && diagnosis && diagnosis.findings.length > 0 && (
              <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                {diagnosis.findings.map((f, i) => {
                  const tone =
                    f.severity === "blocker" ? "#ff7875" : f.severity === "warning" ? WARM : ACCENT;
                  return (
                    <div
                      key={i}
                      style={{
                        borderRadius: 14,
                        border: `1px solid ${tone}33`,
                        background: `${tone}0f`,
                        padding: 12,
                      }}
                    >
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: tone }}>{f.title}</div>
                      <div style={{ fontSize: 12.5, color: TEXT.secondary, marginTop: 4, lineHeight: 1.5 }}>
                        {f.detail}
                      </div>
                      {f.action !== "none" && (
                        <Button
                          size="small"
                          style={{ marginTop: 9 }}
                          loading={f.action === "enrich_estimates" && enriching}
                          onClick={() => runFindingAction(f.action)}
                        >
                          {ACTION_LABEL[f.action]}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {reviewTab === "plan" && proposalByDay.length === 0 && (
              <Empty description="Nothing proposed" />
            )}

            {reviewTab === "plan" && proposalByDay.map(([dayKey, list]) => (
              <div key={dayKey} style={{ marginBottom: 20 }}>
                <div className="section-label" style={{ marginBottom: 8 }}>
                  {dayjs(dayKey).format("dddd, MMM D")}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {list.map((b) => {
                    const key = blockKey(b);
                    const off = excluded.has(key);
                    const title = titleById.get(b.taskId) ?? "Task";
                    const mins = dayjs(b.end).diff(dayjs(b.start), "minute");
                    return (
                      <div
                        key={key}
                        className="card card-interactive"
                        onClick={() => toggleBlock(key)}
                        style={{ padding: 12, opacity: off ? 0.45 : 1 }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 12.5,
                                color: off ? TEXT.tertiary : "#d9b8ff",
                                fontWeight: 700,
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {dayjs(b.start).format("HH:mm")}–{dayjs(b.end).format("HH:mm")}
                              <span style={{ color: TEXT.tertiary, fontWeight: 400 }}>
                                {" "}
                                · {durationLabel(mins)}
                              </span>
                            </div>
                            <div
                              style={{
                                fontSize: 15,
                                fontWeight: 700,
                                lineHeight: 1.3,
                                marginTop: 3,
                                color: off ? TEXT.tertiary : TEXT.primary,
                                textDecoration: off ? "line-through" : "none",
                                wordBreak: "break-word",
                              }}
                            >
                              {title}
                              {b.isChunk && b.chunkCount
                                ? ` (${(b.chunkIndex ?? 0) + 1}/${b.chunkCount})`
                                : ""}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: TEXT.tertiary,
                                marginTop: 5,
                                lineHeight: 1.45,
                              }}
                            >
                              {b.reason}
                            </div>
                          </div>
                          <span
                            aria-label={off ? "Restore" : "Drop"}
                            style={{
                              flexShrink: 0,
                              width: 28,
                              height: 28,
                              borderRadius: "50%",
                              display: "grid",
                              placeItems: "center",
                              fontSize: 11,
                              background: off ? "transparent" : ACCENT,
                              border: off ? "1.5px solid #33333f" : "none",
                              color: off ? TEXT.tertiary : "#fff",
                            }}
                          >
                            {off ? <CloseOutlined /> : <CheckOutlined />}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {(proposal?.unscheduled.length ?? 0) > 0 && (
              <div style={{ borderTop: `1px solid ${SURFACE.borderSoft}`, paddingTop: 14 }}>
                <div className="section-label" style={{ marginBottom: 10 }}>
                  Couldn&apos;t place {proposal!.unscheduled.length}
                </div>
                {unplacedByReason.map(([reason, titles], i) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: TEXT.secondary, marginBottom: 6 }}>
                      {reason}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {titles.map((t, j) => (
                        <Tag key={j} bordered={false} style={{ margin: 0, background: "#17171f" }}>
                          {t}
                        </Tag>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              padding: 14,
              borderTop: `1px solid ${SURFACE.borderSoft}`,
            }}
          >
            <Button
              block
              onClick={() => {
                setProposal(null);
                setReviewOpen(false);
              }}
            >
              Discard
            </Button>
            <Button
              block
              type="primary"
              loading={applying}
              disabled={selected.length === 0}
              onClick={async () => {
                await acceptPlan();
                setReviewOpen(false);
              }}
            >
              Accept {selected.length}
            </Button>
          </div>
        </div>
      </Drawer>

      {applied && !proposal && (
        <div className="plan-bar">
          <span style={{ fontSize: 13, color: TEXT.primary }}>Plan added to your calendar</span>
          <Button icon={<UndoOutlined />} onClick={undoPlan}>
            Undo
          </Button>
          <Button type="text" onClick={() => setApplied(false)}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <CalendarInner />
    </Suspense>
  );
}
