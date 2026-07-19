"use client";

/**
 * What you get when you tap an event on the calendar.
 *
 * Tapping one previously did nothing at all — the click handler only fired for
 * tasks, so every meeting and every imported commitment was inert. Silence is
 * the worst response: it reads as the app being broken rather than as the item
 * being uneditable.
 *
 * Events aren't uniform, so this isn't uniform either:
 *
 *  • A planner block is a *representation* of a task. Tapping it opens the
 *    task — handled by the caller, which never gets as far as this component.
 *  • An imported event is owned by the source calendar. It's shown read-only,
 *    saying plainly why, because an edit here would be silently reverted on
 *    the next sync and that is worse than not offering the edit.
 *  • An event created here is editable and deletable.
 */

import { Button, Drawer, Popconfirm, Tag, Typography } from "antd";
import {
  ClockCircleOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  RetweetOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useSync } from "@/store/sync";
import { useRecord } from "@/store/hooks";
import { describeRepeat } from "@/lib/recurrence";
import { SURFACE } from "@/lib/theme";

const { Text, Paragraph } = Typography;

interface Props {
  eventId: string | null;
  onClose: () => void;
  isMobile: boolean;
}

export function EventDetail({ eventId, onClose, isMobile }: Props) {
  const event = useRecord("calendarEvent", eventId);
  const remove = useSync((s) => s.remove);

  const imported = event?.source === "google";
  const repeat = describeRepeat(event?.recurrenceRule);

  return (
    <Drawer
      open={!!eventId && !!event}
      onClose={onClose}
      placement={isMobile ? "bottom" : "right"}
      height={isMobile ? "auto" : undefined}
      width={isMobile ? undefined : 420}
      styles={{ body: { background: SURFACE.bg, paddingTop: 12 } }}
      title={null}
      closable
    >
      {event && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 19, lineHeight: 1.3 }}>{event.title || "Event"}</h3>
            {imported && (
              <Tag color="blue" style={{ marginTop: 8, marginInlineEnd: 0 }}>
                From your calendar
              </Tag>
            )}
          </div>

          <Field icon={<ClockCircleOutlined />}>
            {dayjs(event.start).format("ddd D MMM, HH:mm")} –{" "}
            {dayjs(event.end).format(
              dayjs(event.end).isSame(dayjs(event.start), "day") ? "HH:mm" : "ddd D MMM, HH:mm",
            )}
          </Field>

          {repeat && <Field icon={<RetweetOutlined />}>{repeat}</Field>}

          {event.location && <Field icon={<EnvironmentOutlined />}>{event.location}</Field>}

          {event.description && (
            <Paragraph style={{ margin: 0, fontSize: 13.5, whiteSpace: "pre-wrap" }}>
              {event.description}
            </Paragraph>
          )}

          {imported ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              This comes from a connected calendar, so it's edited there — changes
              made here would be overwritten on the next sync.
            </Text>
          ) : (
            <Popconfirm
              title="Delete this event?"
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => {
                remove("calendarEvent", event.id);
                onClose();
              }}
            >
              <Button danger type="text" icon={<DeleteOutlined />} style={{ alignSelf: "flex-start" }}>
                Delete
              </Button>
            </Popconfirm>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Field({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5 }}>
      <span style={{ color: "#7c7c8a", marginTop: 2 }}>{icon}</span>
      <span>{children}</span>
    </div>
  );
}
