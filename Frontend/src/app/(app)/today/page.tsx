"use client";

import { useMemo, useState } from "react";
import { Button, Empty } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { DateStrip } from "@/components/DateStrip";
import { TaskCard } from "@/components/TaskCard";
import { useCollection } from "@/store/hooks";
import { useUI } from "@/store/ui";
import { useAuth } from "@/store/auth";
import { TEXT, WARM } from "@/lib/theme";
import type { Block } from "@/lib/types";

/**
 * The day a block belongs on.
 *
 * A task the planner scheduled has no `startTime` of its own — the accepted
 * block is a separate row pointing back at it. Reading only the task made every
 * planned item fall into "Anytime", so work explicitly scheduled for Monday
 * showed up as unscheduled. `plannedAt` supplies that missing day.
 */
function dayKey(t: Block, plannedAt?: Map<string, string>): string | null {
  const when = t.startTime ?? plannedAt?.get(t.id) ?? t.deadline;
  return when ? dayjs(when).format("YYYY-MM-DD") : null;
}

function Section({
  label,
  count,
  tone,
  children,
}: {
  label: string;
  count?: number;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span className="section-label" style={tone ? { color: tone } : undefined}>
          {label}
        </span>
        {count !== undefined && (
          <span style={{ fontSize: 11.5, color: TEXT.tertiary }}>{count}</span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );
}

export default function TodayPage() {
  const blocks = useCollection("block");
  const openCreateTask = useUI((s) => s.openCreateTask);
  const { user } = useAuth();
  const [selected, setSelected] = useState<Dayjs>(dayjs().startOf("day"));

  // taskId -> the start of its earliest accepted plan block.
  const plannedAt = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of blocks) {
      if (!b.planForId || b.deletedAt || !b.startTime) continue;
      const prev = m.get(b.planForId);
      if (!prev || b.startTime < prev) m.set(b.planForId, b.startTime);
    }
    return m;
  }, [blocks]);

  /**
   * Tasks and events together, which is the whole point of the day view: what
   * you have to do and what is going to happen to you are the same question
   * when you're deciding whether today is survivable.
   *
   * Notes are excluded — they aren't on any day. Planner blocks are excluded
   * too: each one exists to give a task a time, and the task itself is already
   * in this list, so showing both would double every scheduled piece of work.
   */
  const open = useMemo(
    () =>
      blocks.filter(
        (b) =>
          b.kind !== "note" &&
          !b.planForId &&
          b.status !== "done" &&
          !b.letGoAt,
      ),
    [blocks],
  );

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of open) {
      const k = dayKey(t, plannedAt);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [open, plannedAt]);

  const byWhen = (a: Block, b: Block) =>
    (a.startTime ?? plannedAt.get(a.id) ?? a.deadline ?? "").localeCompare(
      b.startTime ?? plannedAt.get(b.id) ?? b.deadline ?? "",
    );

  const selectedKey = selected.format("YYYY-MM-DD");
  const isToday = selected.isSame(dayjs(), "day");

  const forDay = useMemo(
    () => open.filter((t) => dayKey(t, plannedAt) === selectedKey).sort(byWhen),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, selectedKey, plannedAt],
  );

  const overdue = useMemo(
    () =>
      isToday
        ? open
            .filter((t) => {
              const w = t.startTime ?? plannedAt.get(t.id) ?? t.deadline;
              return w && dayjs(w).isBefore(dayjs().startOf("day"));
            })
            .sort(byWhen)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, isToday, plannedAt],
  );

  const anytime = useMemo(
    () => open.filter((t) => !dayKey(t, plannedAt)),
    [open, plannedAt],
  );

  const heroCount = forDay.length;
  const greeting = user?.first_name ? `Hello, ${user.first_name} 👋` : "Hello 👋";
  // "Tasks" would now be a lie — half of these are events, which are not tasks
  // and cannot be completed. "Things" is vaguer and true.
  const heroNoun = `Thing${heroCount === 1 ? "" : "s"}`;
  const heroTitle = isToday
    ? `${heroCount} ${heroNoun} Today`
    : `${heroCount} ${heroNoun} · ${selected.format("MMM D")}`;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <p className="hero-greeting">{greeting}</p>
          <h1 className="hero-title">{heroTitle}</h1>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => openCreateTask({ deadline: selected.endOf("day").toISOString() })}
          style={{ flexShrink: 0 }}
        >
          New task
        </Button>
      </div>

      <div style={{ marginTop: 18 }}>
        <DateStrip value={selected} onChange={setSelected} counts={counts} />
      </div>

      {overdue.length > 0 && (
        <Section label="Overdue" count={overdue.length} tone={WARM}>
          {overdue.map((t) => (
            <TaskCard key={t.id} todo={t} />
          ))}
        </Section>
      )}

      <Section label={isToday ? "Today" : selected.format("dddd, MMM D")} count={forDay.length}>
        {forDay.length === 0 ? (
          <Empty
            image={null}
            description={
              <span style={{ color: TEXT.tertiary }}>
                Nothing scheduled{isToday ? " today" : ""} — enjoy the quiet.
              </span>
            }
            style={{ margin: "22px 0" }}
          >
            <Button
              onClick={() => openCreateTask({ deadline: selected.endOf("day").toISOString() })}
            >
              Add a task
            </Button>
          </Empty>
        ) : (
          forDay.map((t, i) => <TaskCard key={t.id} todo={t} featured={i === 0} />)
        )}
      </Section>

      {anytime.length > 0 && (
        <Section label="Anytime" count={anytime.length}>
          {anytime.map((t) => (
            <TaskCard key={t.id} todo={t} showDate={false} />
          ))}
        </Section>
      )}
    </div>
  );
}
