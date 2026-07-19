"use client";

import { useMemo, useState } from "react";
import { Button, Empty, Segmented } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { TaskCard } from "@/components/TaskCard";
import { useCollection } from "@/store/hooks";
import { useUI } from "@/store/ui";
import { TEXT } from "@/lib/theme";
import { nextQuarterHour } from "@/lib/convert";
import type { Block } from "@/lib/types";

/**
 * Everything that is going to happen to you, as a list.
 *
 * Deliberately the same shape as Lists — same cards, same sections, same
 * empty state — because an event and a task differ in what you do about them,
 * not in how you read them. The calendar answers "when is my day full"; this
 * answers "what is coming", which a grid is genuinely bad at once anything is
 * more than a week out.
 *
 * Planner blocks are excluded. They're events by kind, but each one exists to
 * give a task a time, and listing them here would fill the page with copies of
 * work that already appears under Lists.
 */
function Section({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span className="section-label">{label}</span>
        <span style={{ fontSize: 11.5, color: TEXT.tertiary }}>{count}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );
}

export default function EventsPage() {
  const blocks = useCollection("block");
  const openCreateTask = useUI((s) => s.openCreateTask);
  const [range, setRange] = useState<"upcoming" | "past">("upcoming");

  const events = useMemo(
    () => blocks.filter((b) => b.kind === "event" && !b.planForId && !b.letGoAt),
    [blocks],
  );

  const now = dayjs();
  const { upcoming, past } = useMemo(() => {
    const up: Block[] = [];
    const back: Block[] = [];
    for (const e of events) {
      // An event with no end can't be placed in time at all; treating it as
      // upcoming is kinder than hiding it, since the alternative is an event
      // that exists and appears nowhere.
      const ended = e.endTime ? dayjs(e.endTime).isBefore(now) : false;
      (ended ? back : up).push(e);
    }
    const byStart = (a: Block, b: Block) =>
      (a.startTime ?? "").localeCompare(b.startTime ?? "");
    up.sort(byStart);
    // Most recent first: looking back, the thing that just happened is the one
    // you're most likely looking for.
    back.sort((a, b) => byStart(b, a));
    return { upcoming: up, past: back };
  }, [events, now]);

  const shown = range === "upcoming" ? upcoming : past;

  // Grouped by day, so a week with three things on Tuesday reads as Tuesday
  // being busy rather than as three separate rows.
  const byDay = useMemo(() => {
    const m = new Map<string, Block[]>();
    for (const e of shown) {
      const key = e.startTime ? dayjs(e.startTime).format("YYYY-MM-DD") : "undated";
      const list = m.get(key);
      if (list) list.push(e);
      else m.set(key, [e]);
    }
    return [...m.entries()];
  }, [shown]);

  function dayLabel(key: string): string {
    if (key === "undated") return "No date";
    const d = dayjs(key);
    if (d.isSame(now, "day")) return "Today";
    if (d.isSame(now.add(1, "day"), "day")) return "Tomorrow";
    if (d.isSame(now.subtract(1, "day"), "day")) return "Yesterday";
    return d.format("dddd, MMM D");
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p className="hero-greeting">What&apos;s coming</p>
          <h1 className="hero-title">
            {upcoming.length} Event{upcoming.length === 1 ? "" : "s"}
          </h1>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            const start = nextQuarterHour();
            openCreateTask({
              startTime: start.toISOString(),
              endTime: new Date(start.getTime() + 60 * 60_000).toISOString(),
            });
          }}
          style={{ flexShrink: 0 }}
        >
          New event
        </Button>
      </div>

      <div style={{ marginTop: 18 }}>
        <Segmented
          value={range}
          onChange={(v) => setRange(v as "upcoming" | "past")}
          options={[
            { label: `Upcoming (${upcoming.length})`, value: "upcoming" },
            { label: `Past (${past.length})`, value: "past" },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <Empty
          image={null}
          description={
            <span style={{ color: TEXT.tertiary }}>
              {range === "upcoming"
                ? "Nothing on the horizon."
                : "Nothing has happened yet."}
            </span>
          }
          style={{ margin: "40px 0" }}
        />
      ) : (
        byDay.map(([key, items]) => (
          <Section key={key} label={dayLabel(key)} count={items.length}>
            {items.map((e) => (
              <TaskCard key={e.id} todo={e} showDate={false} />
            ))}
          </Section>
        ))
      )}
    </div>
  );
}
