"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Empty, Segmented, Tooltip } from "antd";
import {
  AppstoreOutlined,
  BarsOutlined,
  CheckCircleOutlined,
  FieldTimeOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { TaskCard } from "@/components/TaskCard";
import { Pill } from "@/components/Pill";
import { useCollection } from "@/store/hooks";
import { useSync } from "@/store/sync";
import { useUI, type ListView } from "@/store/ui";
import { PRIORITY_COLOR, PRIORITY_LABEL } from "@/lib/format";
import type { Todo, TodoStatus } from "@/lib/types";

const VIEW_OPTS = [
  { value: "list", icon: <BarsOutlined />, label: "List" },
  { value: "board", icon: <AppstoreOutlined />, label: "Board" },
  { value: "timeline", icon: <FieldTimeOutlined />, label: "Timeline" },
];

const COLUMNS: { key: TodoStatus; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "done", label: "Done" },
];

function priorityRank(p: Todo["priority"]) {
  return ({ ASAP: 0, high: 1, medium: 2, low: 3 } as const)[p];
}

function ListsInner() {
  const params = useSearchParams();
  const listKey = params.get("list") ?? "all";

  const projects = useCollection("project");
  const todos = useCollection("todo");
  const openCreateTask = useUI((s) => s.openCreateTask);
  const listViews = useUI((s) => s.listViews);
  const setListView = useUI((s) => s.setListView);

  const view: ListView = listViews[listKey] ?? "list";
  const project = projects.find((p) => p.id === listKey);
  const isCompleted = listKey === "completed";

  const title = useMemo(() => {
    if (listKey === "all") return "All tasks";
    if (listKey === "none") return "No list";
    if (listKey === "completed") return "Completed";
    return project?.name ?? "List";
  }, [listKey, project]);

  const scoped = useMemo(() => {
    let list = todos.filter((t) => !t.letGoAt);
    if (isCompleted) {
      list = list.filter((t) => t.status === "done");
    } else if (listKey === "none") {
      list = list.filter((t) => !t.projectId);
    } else if (listKey !== "all") {
      list = list.filter((t) => t.projectId === listKey);
    }
    return list;
  }, [todos, listKey, isCompleted]);

  const defaultProjectId = project ? project.id : undefined;
  const addTask = () =>
    openCreateTask(defaultProjectId ? { projectId: defaultProjectId } : undefined);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {project && (
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: project.color }} />
          )}
          <h1 className="hero-title">{title}</h1>
          <span style={{ fontSize: 14, color: "#6f6f80" }}>{scoped.filter((t) => t.status !== "done").length}</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {!isCompleted && (
            <Segmented
              value={view}
              onChange={(v) => setListView(listKey, v as ListView)}
              options={VIEW_OPTS.map((o) => ({
                value: o.value,
                label: (
                  <Tooltip title={o.label}>
                    <span style={{ padding: "0 2px" }}>{o.icon}</span>
                  </Tooltip>
                ),
              }))}
            />
          )}
          <Button type="primary" icon={<PlusOutlined />} onClick={addTask}>
            New task
          </Button>
        </div>
      </div>

      {isCompleted ? (
        <CompletedView todos={scoped} />
      ) : view === "board" ? (
        <BoardView todos={scoped} onAdd={addTask} />
      ) : view === "timeline" ? (
        <TimelineView todos={scoped} />
      ) : (
        <ListLayout todos={scoped} onAdd={addTask} />
      )}
    </div>
  );
}

function ListLayout({ todos, onAdd }: { todos: Todo[]; onAdd: () => void }) {
  const open = todos
    .filter((t) => t.status !== "done")
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || (a.deadline ?? "~").localeCompare(b.deadline ?? "~"));
  if (open.length === 0) {
    return (
      <Empty
        image={<CheckCircleOutlined style={{ fontSize: 48, color: "#2f2f3d" }} />}
        description={<span style={{ color: "#7c7c8a" }}>Nothing here yet</span>}
      >
        <Button type="primary" onClick={onAdd}>Add a task</Button>
      </Empty>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {open.map((t, i) => (
        <TaskCard key={t.id} todo={t} featured={i === 0} />
      ))}
    </div>
  );
}

function CompletedView({ todos }: { todos: Todo[] }) {
  // Copy before sorting: `todos` is the array memoized by useCollection, and
  // sorting in place mutates the store's derived state for every other view.
  const done = [...todos].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  if (done.length === 0) return <Empty description="No completed tasks yet" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {done.map((t) => (
        <TaskCard key={t.id} todo={t} />
      ))}
    </div>
  );
}

// ---- Board (kanban) -------------------------------------------------------

function BoardView({ todos, onAdd }: { todos: Todo[]; onAdd: () => void }) {
  const update = useSyncUpdate();
  const [dragId, setDragId] = useState<string | null>(null);

  const byCol = useMemo(() => {
    const m: Record<TodoStatus, Todo[]> = { todo: [], in_progress: [], done: [] };
    for (const t of todos) m[t.status].push(t);
    for (const k of Object.keys(m) as TodoStatus[])
      m[k].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
    return m;
  }, [todos]);

  return (
    <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8, alignItems: "flex-start" }}>
      {COLUMNS.map((col) => (
        <div
          key={col.key}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragId) update("todo", dragId, { status: col.key });
            setDragId(null);
          }}
          style={{
            flex: "0 0 300px",
            background: "#0f0f16",
            border: "1px solid #1c1c26",
            borderRadius: 14,
            padding: 12,
            minHeight: 160,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, padding: "0 2px" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#c9c9d6" }}>
              {col.label} <span style={{ color: "#6f6f80", fontWeight: 400 }}>{byCol[col.key].length}</span>
            </span>
            {col.key === "todo" && (
              <Button type="text" size="small" icon={<PlusOutlined />} onClick={onAdd} />
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {byCol[col.key].map((t) => (
              <BoardCard key={t.id} todo={t} onDragStart={() => setDragId(t.id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BoardCard({ todo, onDragStart }: { todo: Todo; onDragStart: () => void }) {
  const openEditTask = useUI((s) => s.openEditTask);
  const done = todo.status === "done";
  const when = todo.startTime ?? todo.deadline;
  return (
    <div
      className="card card-interactive"
      draggable
      onDragStart={onDragStart}
      onClick={() => openEditTask(todo.id)}
      style={{ padding: 13, borderRadius: 14 }}
    >
      {todo.priority !== "medium" && (
        <div style={{ marginBottom: 7 }}>
          <Pill color={PRIORITY_COLOR[todo.priority]}>{PRIORITY_LABEL[todo.priority]}</Pill>
        </div>
      )}
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 1.35,
          color: done ? "#6f6f80" : "#f4f4f8",
          textDecoration: done ? "line-through" : "none",
          wordBreak: "break-word",
        }}
      >
        {todo.title || "Untitled"}
      </div>
      {when && (
        <div style={{ fontSize: 11.5, color: "#6f6f80", marginTop: 6 }}>
          {dayjs(when).format("MMM D")}
        </div>
      )}
    </div>
  );
}

// ---- Timeline (light gantt) ----------------------------------------------

const TL_DAYS = 14;
const COL_W = 46;

function TimelineView({ todos }: { todos: Todo[] }) {
  const openEditTask = useUI((s) => s.openEditTask);
  const start = dayjs().startOf("day");
  const days = Array.from({ length: TL_DAYS }, (_, i) => start.add(i, "day"));

  const scheduled = todos
    .filter((t) => t.status !== "done" && (t.startTime || t.deadline))
    .sort((a, b) => (a.startTime ?? a.deadline ?? "").localeCompare(b.startTime ?? b.deadline ?? ""));
  const unscheduled = todos.filter((t) => t.status !== "done" && !t.startTime && !t.deadline);

  function bar(t: Todo) {
    const when = dayjs(t.startTime ?? t.deadline!);
    const dayIdx = when.diff(start, "day");
    if (dayIdx < 0 || dayIdx >= TL_DAYS) return null;
    const timed = !!t.startTime && !!t.endTime;
    const span = timed ? Math.max(1, Math.ceil(dayjs(t.endTime!).diff(when, "hour") / 24)) : 1;
    return (
      <div
        onClick={() => openEditTask(t.id)}
        style={{
          position: "absolute",
          left: dayIdx * COL_W + 3,
          width: span * COL_W - 6,
          top: 6,
          height: 22,
          background: timed ? "rgba(168,85,247,0.9)" : "rgba(64,150,255,0.2)",
          border: timed ? "none" : "1px solid rgba(64,150,255,0.5)",
          borderRadius: 6,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          padding: "0 6px",
          fontSize: 11,
          color: timed ? "#fff" : "#9cc5ff",
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        {t.title || "Untitled"}
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid #1c1c26", borderRadius: 14, overflow: "hidden", background: "#0f0f16" }}>
      <div style={{ display: "flex", overflowX: "auto" }}>
        <div style={{ width: 200, flexShrink: 0, borderRight: "1px solid #1c1c26" }}>
          <div style={{ height: 34, borderBottom: "1px solid #1c1c26", display: "flex", alignItems: "center", padding: "0 14px", fontSize: 12, color: "#6f6f80" }}>
            Task
          </div>
          {scheduled.map((t) => (
            <div key={t.id} style={{ height: 34, borderBottom: "1px solid #17171f", display: "flex", alignItems: "center", padding: "0 14px", fontSize: 13, color: "#c9c9d6", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
              {t.title || "Untitled"}
            </div>
          ))}
        </div>
        <div style={{ minWidth: TL_DAYS * COL_W }}>
          <div style={{ display: "flex", height: 34, borderBottom: "1px solid #1c1c26" }}>
            {days.map((d) => {
              const isToday = d.isSame(dayjs(), "day");
              return (
                <div key={d.toISOString()} style={{ width: COL_W, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: isToday ? "rgba(168,85,247,0.08)" : "transparent", borderRight: "1px solid #17171f" }}>
                  <span style={{ fontSize: 10, color: "#6f6f80" }}>{d.format("dd")[0]}</span>
                  <span style={{ fontSize: 12, color: isToday ? "#d9b8ff" : "#a9a9b8" }}>{d.format("D")}</span>
                </div>
              );
            })}
          </div>
          {scheduled.map((t) => (
            <div key={t.id} style={{ position: "relative", height: 34, borderBottom: "1px solid #17171f", display: "flex" }}>
              {days.map((d) => {
                const isToday = d.isSame(dayjs(), "day");
                return <div key={d.toISOString()} style={{ width: COL_W, flexShrink: 0, borderRight: "1px solid #14141c", background: isToday ? "rgba(168,85,247,0.04)" : "transparent" }} />;
              })}
              {bar(t)}
            </div>
          ))}
        </div>
      </div>
      {scheduled.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "#6f6f80", fontSize: 13 }}>
          No dated tasks in the next {TL_DAYS} days.
        </div>
      )}
      {unscheduled.length > 0 && (
        <div style={{ borderTop: "1px solid #1c1c26", padding: "12px 16px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, color: "#6f6f80", textTransform: "uppercase", marginBottom: 8 }}>
            Unscheduled ({unscheduled.length})
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {unscheduled.map((t) => (
              <button
                key={t.id}
                onClick={() => openEditTask(t.id)}
                style={{ background: "#15151d", border: "1px solid #22222d", borderRadius: 8, padding: "5px 10px", fontSize: 12.5, color: "#c9c9d6", cursor: "pointer" }}
              >
                {t.title || "Untitled"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function useSyncUpdate() {
  return useSync((s) => s.update);
}

export default function ListsPage() {
  return (
    <Suspense fallback={null}>
      <ListsInner />
    </Suspense>
  );
}
