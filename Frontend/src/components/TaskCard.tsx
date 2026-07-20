"use client";

import {
  CheckOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  RetweetOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { App as AntdApp } from "antd";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { Pill } from "./Pill";
import { useSync } from "@/store/sync";
import { useUI } from "@/store/ui";
import { useCollection } from "@/store/hooks";
import {
  durationLabel,
  LIFE_AREA_COLOR,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
} from "@/lib/format";
import { TEXT } from "@/lib/theme";
import { describeRepeat } from "@/lib/recurrence";
import { useSelection } from "@/store/selection";
import { useLongPress } from "@/lib/useLongPress";
import { useRowSwipe, ROW_SWIPE_COMMIT_PX } from "@/lib/useRowSwipe";
import type { Block } from "@/lib/types";

// The card is the app's core object: pills on top, a bold title, a time row,
// and a footer with its list. `featured` fills it with the accent gradient —
// used for the single "next up" task so the screen has one clear focal point.
export function TaskCard({
  todo,
  featured = false,
  showDate = true,
}: {
  todo: Block;
  featured?: boolean;
  showDate?: boolean;
}) {
  const update = useSync((s) => s.update);
  const remove = useSync((s) => s.remove);
  const openEditTask = useUI((s) => s.openEditTask);
  const { modal } = AntdApp.useApp();
  const router = useRouter();

  // Bulk selection. A long-press enters selection mode; while in it, a tap
  // toggles the card instead of opening it. Subscribing to `has(id)` rather
  // than the whole set keeps a card from re-rendering when a *different* card
  // is toggled.
  const selectionActive = useSelection((s) => s.active);
  const selected = useSelection((s) => s.ids.has(todo.id));
  const beginSelection = useSelection((s) => s.begin);
  const toggleSelection = useSelection((s) => s.toggle);
  const longPress = useLongPress(() => beginSelection(todo.id));

  const isEventKind = todo.kind === "event";

  // Swipe shortcuts: right reveals delete (confirmed first — a swipe is easy to
  // trigger by accident and delete isn't undoable here), left plans just this
  // task onto the week. An event is already fixed in time, so it has nothing to
  // plan; its left side is left disabled. Off entirely while selecting, where a
  // horizontal drag would fight the selection gesture.
  const swipe = useRowSwipe({
    enabled: !selectionActive,
    onRight: () =>
      modal.confirm({
        title: "Delete this task?",
        content: todo.title || "Untitled",
        okText: "Delete",
        okButtonProps: { danger: true },
        cancelText: "Cancel",
        onOk: () => remove("block", todo.id),
      }),
    onLeft: isEventKind
      ? undefined
      : () => router.push(`/calendar?plan=${Date.now()}&tasks=${todo.id}`),
  });

  const projects = useCollection("project");
  const project = projects.find((p) => p.id === todo.projectId);
  const repeatLabel = describeRepeat(todo.recurrenceRule);

  const isEvent = isEventKind;
  // An event has nothing to complete: it either hasn't happened yet or it has.
  // Treating "past" as done is the honest equivalent, and it's what stops a
  // finished meeting sitting in the list looking like an outstanding chore.
  const done = isEvent
    ? !!todo.endTime && dayjs(todo.endTime).isBefore(dayjs())
    : todo.status === "done";
  const timed = todo.startTime && todo.endTime;
  const when = todo.startTime ?? todo.deadline;

  const timeLabel = timed
    ? `${dayjs(todo.startTime).format("HH:mm")} – ${dayjs(todo.endTime).format("HH:mm")}`
    : when
      ? dayjs(when).format(showDate ? "MMM D" : "[Due] MMM D")
      : null;

  const dim = featured ? "rgba(255,255,255,0.85)" : TEXT.secondary;
  const titleColor = featured ? "#fff" : done ? TEXT.tertiary : TEXT.primary;

  function onCardClick() {
    // While selecting, a tap toggles. A long-press that just fired also ends in
    // a click, and so does a swipe — both are suppressed, otherwise the gesture
    // would also open (or toggle) the card it just acted on.
    if (longPress.didFire() || swipe.didSwipe()) return;
    if (selectionActive) toggleSelection(todo.id);
    else openEditTask(todo.id);
  }

  // One touch sequence drives both the hold (selection) and the swipe, so their
  // handlers are merged rather than one clobbering the other.
  const touchHandlers = {
    onTouchStart: (e: React.TouchEvent) => {
      longPress.handlers.onTouchStart(e);
      swipe.handlers.onTouchStart(e);
    },
    onTouchMove: (e: React.TouchEvent) => {
      longPress.handlers.onTouchMove(e);
      swipe.handlers.onTouchMove(e);
    },
    onTouchEnd: () => {
      longPress.handlers.onTouchEnd();
      swipe.handlers.onTouchEnd();
    },
    onTouchCancel: () => {
      longPress.handlers.onTouchCancel();
      swipe.handlers.onTouchCancel();
    },
    onMouseDown: longPress.handlers.onMouseDown,
    onMouseMove: longPress.handlers.onMouseMove,
    onMouseUp: longPress.handlers.onMouseUp,
    onMouseLeave: longPress.handlers.onMouseLeave,
  };

  const dx = swipe.dx;
  const rightArmed = dx >= ROW_SWIPE_COMMIT_PX; // swiping right → delete
  const leftArmed = dx <= -ROW_SWIPE_COMMIT_PX; // swiping left → plan

  return (
    <div style={{ position: "relative", borderRadius: 16, overflow: "hidden" }}>
      {/* What the swipe will do, revealed in the gap the sliding card opens up.
          The label brightens as you cross the commit distance so a release
          feels deliberate rather than a guess. */}
      {dx !== 0 && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 22px",
            background: dx > 0 ? "rgba(239,68,68,0.16)" : "rgba(229,137,63,0.16)",
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 13,
              fontWeight: 700,
              color: "#ef4444",
              opacity: dx > 0 ? (rightArmed ? 1 : 0.5) : 0,
            }}
          >
            <DeleteOutlined /> Delete
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 13,
              fontWeight: 700,
              color: "#e5893f",
              opacity: dx < 0 ? (leftArmed ? 1 : 0.5) : 0,
            }}
          >
            Plan <ThunderboltOutlined />
          </span>
        </div>
      )}
    <div
      className={`card card-interactive${featured ? " card-featured" : ""}${
        selected ? " card-selected" : ""
      }`}
      onClick={onCardClick}
      {...touchHandlers}
      style={{
        padding: 16,
        position: "relative",
        transform: `translateX(${dx}px)`,
        transition: swipe.settling ? "transform 0.18s ease-out" : "none",
        // We handle horizontal ourselves; hand vertical panning back to the
        // list so scrolling through cards is never stolen by the swipe.
        touchAction: "pan-y",
      }}
    >
      {/* A tick in the corner while selecting, in place of nothing — the card
          border also lights up (see .card-selected), but the tick is what makes
          "this one is chosen" unambiguous at a glance across a dozen cards. */}
      {selectionActive && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 22,
            height: 22,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: selected ? "#a855f7" : "transparent",
            border: `1.5px solid ${selected ? "transparent" : "#44445a"}`,
            color: "#fff",
            zIndex: 2,
          }}
        >
          {selected && <CheckOutlined style={{ fontSize: 12 }} />}
        </span>
      )}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* pills */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {todo.priority !== "medium" && (
              <Pill
                color={PRIORITY_COLOR[todo.priority]}
                tone={featured ? "onAccent" : "soft"}
              >
                {PRIORITY_LABEL[todo.priority]}
              </Pill>
            )}
            {todo.category && (
              <Pill
                color={LIFE_AREA_COLOR[todo.category]}
                tone={featured ? "onAccent" : "soft"}
              >
                {todo.category}
              </Pill>
            )}
            {todo.estimatedDuration ? (
              <Pill color={featured ? "#fff" : TEXT.tertiary} tone={featured ? "onAccent" : "soft"}>
                {durationLabel(todo.estimatedDuration)}
              </Pill>
            ) : null}
            {/* A repeating task behaves differently when you complete it, so say
                so on the card rather than surprising the user afterwards. */}
            {repeatLabel && (
              <Pill color={featured ? "#fff" : TEXT.tertiary} tone={featured ? "onAccent" : "soft"}>
                <RetweetOutlined style={{ fontSize: 10 }} /> {repeatLabel}
              </Pill>
            )}
          </div>

          {/* title */}
          <div
            style={{
              fontSize: 16.5,
              fontWeight: 700,
              lineHeight: 1.3,
              color: titleColor,
              // Struck through only for a task you completed. A past meeting
              // read as *cancelled* rather than *happened* — it dims and says
              // "Happened" instead, which is what actually occurred.
              textDecoration: done && !isEvent ? "line-through" : "none",
              wordBreak: "break-word",
            }}
          >
            {todo.title || "Untitled"}
          </div>

          {/* time row */}
          {timeLabel && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 8,
                fontSize: 13,
                color: dim,
              }}
            >
              <ClockCircleOutlined style={{ fontSize: 13 }} />
              {timeLabel}
            </div>
          )}
        </div>

        {/* Complete toggle — tasks only, and hidden while selecting, where the
            corner belongs to the selection tick and a tap means "select". */}
        {!isEvent && !selectionActive && (
        <button
          aria-label={done ? "Mark as not done" : "Mark as done"}
          onClick={(e) => {
            e.stopPropagation();
            update("block", todo.id, { status: done ? "todo" : "done" });
          }}
          // 44×44 hit area (a comfortable tap target) around a 30px circle; the
          // negative margin keeps the layout footprint the old size so nothing
          // shifts.
          style={{
            flexShrink: 0,
            width: 44,
            height: 44,
            margin: -7,
            padding: 0,
            border: "none",
            background: "transparent",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              background: done
                ? featured
                  ? "rgba(255,255,255,0.9)"
                  : "#a855f7"
                : "transparent",
              border: `1.5px solid ${
                done
                  ? "transparent"
                  : featured
                    ? "rgba(255,255,255,0.6)"
                    : "#33334a"
              }`,
              color: done ? (featured ? "#7c3aed" : "#fff") : "transparent",
              transition: "all 0.15s",
            }}
          >
            <CheckOutlined style={{ fontSize: 13 }} />
          </span>
        </button>
        )}
        {isEvent && done && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 11,
              color: featured ? "rgba(255,255,255,0.85)" : TEXT.tertiary,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <CheckOutlined style={{ fontSize: 11 }} />
            Happened
          </span>
        )}
      </div>

      {/* footer: which list this belongs to */}
      {project && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            marginTop: 12,
            paddingTop: 11,
            borderTop: `1px solid ${featured ? "rgba(255,255,255,0.22)" : "#20202b"}`,
            fontSize: 12.5,
            color: dim,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: featured ? "#fff" : project.color,
            }}
          />
          {project.name}
        </div>
      )}
    </div>
    </div>
  );
}
