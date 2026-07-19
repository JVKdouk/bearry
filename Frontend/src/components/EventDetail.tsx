"use client";

/**
 * The event drawer.
 *
 * Deliberately the same shape as the task drawer — same top bar, same big
 * borderless title, same body-fills-the-height editor, same bottom toolbar,
 * same bottom-sheet-on-mobile / panel-on-desktop split. An event opening into
 * a differently-shaped surface makes the app feel like two apps.
 *
 * The interesting part is imported events. They're owned by the source
 * calendar, so anything the user types here would normally be reverted on the
 * next sync. Rather than making them read-only — or lying by accepting an edit
 * that quietly reverts — editing a field *pins* it: the importer stops
 * overwriting that one field and keeps updating everything else. The drawer
 * says so, because a rule the user can't see is a rule they'll be surprised by.
 */

import { useEffect, useState } from "react";
import { App as AntdApp, Button, Drawer, Popconfirm, Popover, Tooltip } from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  MoreOutlined,
  PushpinFilled,
  RetweetOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useSync } from "@/store/sync";
import { useRecord } from "@/store/hooks";
import { describeRepeat } from "@/lib/recurrence";
import { eventToNote, eventToTask } from "@/lib/convert";
import { durationLabel } from "@/lib/format";
import { SURFACE } from "@/lib/theme";
import type { CalendarEventEntity } from "@/lib/types";

/** Fields on an imported event that a local edit takes ownership of. */
type Pinnable = "title" | "description";

function pinsOf(event: Partial<CalendarEventEntity> | undefined): Set<string> {
  return new Set((event?.pinnedFields ?? "").split(",").map((f) => f.trim()).filter(Boolean));
}

interface Props {
  eventId: string | null;
  onClose: () => void;
  isMobile: boolean;
  /** Desktop calendar: float over the grid instead of squashing it. */
  overlay?: boolean;
}

export function EventDetail({ eventId, onClose, isMobile, overlay }: Props) {
  const { message } = AntdApp.useApp();
  const event = useRecord("calendarEvent", eventId);
  const update = useSync((s) => s.update);
  const create = useSync((s) => s.create);
  const remove = useSync((s) => s.remove);

  const open = !!eventId && !!event;
  const imported = event?.source === "google";
  const pins = pinsOf(event);

  // Local echo of the fields being typed into, so each keystroke doesn't have
  // to round-trip through the store before appearing.
  const [draft, setDraft] = useState<{ title: string; description: string }>({
    title: "",
    description: "",
  });

  useEffect(() => {
    if (!event) return;
    setDraft({ title: event.title ?? "", description: event.description ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  /**
   * Save a field and, on an imported event, record that the user now owns it.
   *
   * The pin is written in the same patch as the value. Splitting them would
   * leave a window where the edit exists unpinned and the next sync reverts it.
   */
  function editField(field: Pinnable, value: string) {
    if (!event) return;
    setDraft((d) => ({ ...d, [field]: value }));

    const patch: Partial<CalendarEventEntity> = { [field]: value || null };

    if (imported && !pins.has(field)) {
      patch.pinnedFields = [...pins, field].join(",");
    }
    update("calendarEvent", event.id, patch);
  }

  function unpin(field: Pinnable) {
    if (!event) return;
    const next = [...pins].filter((f) => f !== field);
    update("calendarEvent", event.id, { pinnedFields: next.join(",") || null });
    message.success(`"${field}" follows your calendar again from the next sync`);
  }

  function convertTo(target: "task" | "note") {
    if (!event) return;
    if (target === "task") {
      create("todo", eventToTask(event));
      message.success("Converted to a task");
    } else {
      create("note", eventToNote(event));
      message.success("Converted to a note");
    }
    remove("calendarEvent", event.id);
    onClose();
  }

  const repeat = describeRepeat(event?.recurrenceRule);
  const past = !!event && dayjs(event.end).isBefore(dayjs());
  const minutes = event
    ? Math.max(0, Math.round((dayjs(event.end).valueOf() - dayjs(event.start).valueOf()) / 60_000))
    : 0;

  const morePopover = (
    <Popover
      trigger="click"
      placement="topRight"
      content={
        <div style={{ display: "flex", flexDirection: "column", gap: 10, width: 232 }}>
          <div style={{ fontSize: 11.5, color: "#a9a9b8", letterSpacing: 0.3 }}>Convert to</div>
          <div style={{ display: "flex", gap: 6 }}>
            <Button size="small" style={{ flex: 1 }} onClick={() => convertTo("task")}>
              Task
            </Button>
            <Button size="small" style={{ flex: 1 }} onClick={() => convertTo("note")}>
              Note
            </Button>
          </div>
          <div style={{ fontSize: 11, color: "#6f6f80", lineHeight: 1.45 }}>
            A task is something you do. An event just happens, and completes
            itself once it has passed.
          </div>

          {imported && pins.size > 0 && (
            <div style={{ borderTop: "1px solid #2a2a33", paddingTop: 10 }}>
              <div style={{ fontSize: 11.5, color: "#a9a9b8", marginBottom: 6 }}>
                Your edits (not synced)
              </div>
              {[...pins].map((f) => (
                <Button
                  key={f}
                  size="small"
                  type="text"
                  style={{ padding: 0, height: 22, fontSize: 12 }}
                  onClick={() => unpin(f as Pinnable)}
                >
                  Restore {f} from calendar
                </Button>
              ))}
            </div>
          )}
        </div>
      }
    >
      <Tooltip title="More">
        <Button type="text" icon={<MoreOutlined />} />
      </Tooltip>
    </Popover>
  );

  const body = event ? (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "10px 14px 8px 18px",
          borderBottom: `1px solid ${SURFACE.borderSoft}`,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12.5, color: "#8f8fa2" }}>
          {dayjs(event.start).format("ddd D MMM · HH:mm")}
          {minutes > 0 ? ` · ${durationLabel(minutes)}` : ""}
        </span>
        {/* An event has no "done" to tick: it either hasn't happened yet or it
            has. Saying so is more honest than a checkbox that would imply you
            had something left to do about it. */}
        {past && (
          <span style={{ fontSize: 11.5, color: "#6f6f80" }}>
            <CheckOutlined style={{ marginRight: 4 }} />
            Happened
          </span>
        )}
        <div style={{ flex: 1 }} />
        {!isMobile && <Button type="text" icon={<CloseOutlined />} onClick={onClose} />}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "18px 22px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <input
          value={draft.title}
          onChange={(e) => editField("title", e.target.value)}
          placeholder="Untitled event"
          style={{
            width: "100%",
            border: "none",
            outline: "none",
            background: "transparent",
            color: "#f4f4f8",
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
            marginBottom: 10,
            flexShrink: 0,
          }}
        />

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14, flexShrink: 0 }}>
          {repeat && (
            <span className="pill" style={{ fontSize: 12 }}>
              <RetweetOutlined /> {repeat}
            </span>
          )}
          {event.location && (
            <span className="pill" style={{ fontSize: 12 }}>
              <EnvironmentOutlined /> {event.location}
            </span>
          )}
        </div>

        {imported && (
          <div
            style={{
              fontSize: 11.5,
              color: "#8f8fa2",
              lineHeight: 1.5,
              marginBottom: 12,
              flexShrink: 0,
            }}
          >
            {pins.size > 0 ? (
              <>
                <PushpinFilled style={{ color: "#e5893f", marginRight: 5 }} />
                You've edited {[...pins].join(" and ")} — kept as yours, while the
                rest still follows your calendar.
              </>
            ) : (
              <>From your calendar. Editing the title or description keeps your
              version instead of it being overwritten on the next sync.</>
            )}
          </div>
        )}

        <textarea
          value={draft.description}
          onChange={(e) => editField("description", e.target.value)}
          placeholder="Add a description…"
          style={{
            width: "100%",
            flex: "1 1 auto",
            minHeight: 140,
            border: "none",
            outline: "none",
            resize: "none",
            background: "transparent",
            color: "#c9c9d6",
            fontSize: 15,
            lineHeight: 1.65,
            fontFamily: "inherit",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderTop: `1px solid ${SURFACE.borderSoft}`,
          flexShrink: 0,
        }}
      >
        {morePopover}
        <div style={{ flex: 1 }} />
        <Popconfirm
          title="Delete this event?"
          description={imported ? "It will come back on the next sync." : undefined}
          okText="Delete"
          okButtonProps={{ danger: true }}
          onConfirm={() => {
            remove("calendarEvent", event.id);
            onClose();
          }}
        >
          <Button danger type="text" icon={<DeleteOutlined />} />
        </Popconfirm>
      </div>
    </div>
  ) : null;

  if (isMobile) {
    return (
      <Drawer
        placement="bottom"
        open={open}
        onClose={onClose}
        height="85%"
        maskClosable
        keyboard
        closeIcon={null}
        styles={{
          body: { padding: 0, background: SURFACE.bg },
          header: { display: "none" },
          content: {
            background: SURFACE.bg,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            overflow: "hidden",
          },
          mask: { background: "rgba(0,0,0,0.55)" },
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ display: "grid", placeItems: "center", padding: "10px 0 2px", flexShrink: 0 }}>
            <span style={{ width: 38, height: 4, borderRadius: 999, background: "#33333f" }} />
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>{body}</div>
        </div>
      </Drawer>
    );
  }

  if (!open) return null;

  if (overlay) {
    return (
      <>
        <div
          onClick={onClose}
          style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 30 }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: 420,
            background: "#0d0d13",
            borderLeft: `1px solid ${SURFACE.borderSoft}`,
            boxShadow: "-16px 0 40px rgba(0,0,0,0.4)",
            zIndex: 31,
          }}
        >
          {body}
        </div>
      </>
    );
  }

  return (
    <div style={{ width: 420, flexShrink: 0, borderLeft: `1px solid ${SURFACE.borderSoft}`, background: "#0d0d13" }}>
      {body}
    </div>
  );
}
