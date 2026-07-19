"use client";

import { CheckOutlined, ClockCircleOutlined, RetweetOutlined } from "@ant-design/icons";
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
  const openEditTask = useUI((s) => s.openEditTask);

  // Bulk selection. A long-press enters selection mode; while in it, a tap
  // toggles the card instead of opening it. Subscribing to `has(id)` rather
  // than the whole set keeps a card from re-rendering when a *different* card
  // is toggled.
  const selectionActive = useSelection((s) => s.active);
  const selected = useSelection((s) => s.ids.has(todo.id));
  const beginSelection = useSelection((s) => s.begin);
  const toggleSelection = useSelection((s) => s.toggle);
  const longPress = useLongPress(() => beginSelection(todo.id));

  const projects = useCollection("project");
  const project = projects.find((p) => p.id === todo.projectId);
  const repeatLabel = describeRepeat(todo.recurrenceRule);

  const isEvent = todo.kind === "event";
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
    // a click, so it's suppressed — otherwise entering selection mode would
    // immediately toggle the card back off.
    if (longPress.didFire()) return;
    if (selectionActive) toggleSelection(todo.id);
    else openEditTask(todo.id);
  }

  return (
    <div
      className={`card card-interactive${featured ? " card-featured" : ""}${
        selected ? " card-selected" : ""
      }`}
      onClick={onCardClick}
      {...longPress.handlers}
      style={{ padding: 16, position: "relative" }}
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
          style={{
            flexShrink: 0,
            width: 30,
            height: 30,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
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
  );
}
