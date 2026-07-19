"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { App as AntdApp, Button, Input, Tooltip } from "antd";
import {
  CheckCircleOutlined,
  InboxOutlined,
  PlusOutlined,
  SunOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useCollection } from "@/store/hooks";
import { useSync } from "@/store/sync";

// Palette used to auto-assign a color to newly created lists.
const LIST_PALETTE = [
  "#a855f7", "#4096ff", "#36cfc9", "#f759ab",
  "#ffa940", "#73d13d", "#597ef7", "#ff7875",
];

function Dot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 9,
        height: 9,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

function Row({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: React.ReactNode;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="side-row"
      data-active={active || undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        border: "none",
        background: active ? "rgba(168,85,247,0.14)" : "transparent",
        color: active ? "#d9b8ff" : "#c9c9d6",
        padding: "7px 10px",
        borderRadius: 9,
        cursor: "pointer",
        fontSize: 13.5,
        textAlign: "left",
        transition: "background 0.12s",
      }}
    >
      <span style={{ width: 16, display: "grid", placeItems: "center", fontSize: 14, opacity: 0.9 }}>
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      {count ? (
        <span style={{ fontSize: 12, color: active ? "#d9b8ff" : "#6f6f80", fontVariantNumeric: "tabular-nums" }}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

export function SidebarLists({ onNavigate }: { onNavigate?: () => void }) {
  const { message } = AntdApp.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const projects = useCollection("project");
  const todos = useCollection("todo");
  const create = useSync((s) => s.create);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const activeProjects = useMemo(
    () => projects.filter((p) => !p.archived).sort((a, b) => a.order - b.order),
    [projects],
  );

  const openTodos = useMemo(
    () => todos.filter((t) => t.status !== "done" && !t.letGoAt),
    [todos],
  );

  const counts = useMemo(() => {
    const byProject = new Map<string, number>();
    let noList = 0;
    let today = 0;
    const endToday = dayjs().endOf("day");
    for (const t of openTodos) {
      if (t.projectId) byProject.set(t.projectId, (byProject.get(t.projectId) ?? 0) + 1);
      else noList++;
      const when = t.startTime ?? t.deadline;
      if (when && dayjs(when).isBefore(endToday)) today++;
    }
    return { byProject, noList, today, all: openTodos.length };
  }, [openTodos]);

  const selected = params.get("list");
  const onLists = pathname.startsWith("/lists");
  const go = (href: string) => {
    router.push(href);
    onNavigate?.();
  };

  function addList() {
    const n = name.trim();
    if (!n) {
      setAdding(false);
      return;
    }
    const color = LIST_PALETTE[activeProjects.length % LIST_PALETTE.length];
    const id = create("project", {
      name: n,
      color,
      order: activeProjects.length,
      archived: false,
    });
    setName("");
    setAdding(false);
    message.success("List created");
    go(`/lists?list=${id}`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "4px 6px", display: "flex", flexDirection: "column", gap: 2 }}>
        <Row
          active={pathname === "/today"}
          icon={<SunOutlined />}
          label="Today"
          count={counts.today}
          onClick={() => go("/today")}
        />
        <Row
          active={onLists && (selected === "all" || selected === null)}
          icon={<UnorderedListOutlined />}
          label="All tasks"
          count={counts.all}
          onClick={() => go("/lists?list=all")}
        />
        <Row
          active={onLists && selected === "none"}
          icon={<InboxOutlined />}
          label="No list"
          count={counts.noList}
          onClick={() => go("/lists?list=none")}
        />
        <Row
          active={onLists && selected === "completed"}
          icon={<CheckCircleOutlined />}
          label="Completed"
          onClick={() => go("/lists?list=completed")}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px 6px",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.6, color: "#6f6f80", textTransform: "uppercase" }}>
          Lists
        </span>
        <Tooltip title="New list">
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined style={{ fontSize: 12, color: "#8f8fa2" }} />}
            onClick={() => setAdding(true)}
          />
        </Tooltip>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 6px 6px", display: "flex", flexDirection: "column", gap: 2 }}>
        {activeProjects.map((p) => (
          <Row
            key={p.id}
            active={onLists && selected === p.id}
            icon={<Dot color={p.color} />}
            label={p.name}
            count={counts.byProject.get(p.id)}
            onClick={() => go(`/lists?list=${p.id}`)}
          />
        ))}

        {adding && (
          <Input
            size="small"
            autoFocus
            placeholder="List name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={addList}
            onBlur={addList}
            style={{ margin: "4px 6px", width: "auto" }}
          />
        )}

        {activeProjects.length === 0 && !adding && (
          <button
            onClick={() => setAdding(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              border: "1px dashed #2a2a37",
              background: "transparent",
              color: "#6f6f80",
              padding: "9px 10px",
              borderRadius: 9,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            <PlusOutlined /> Create your first list
          </button>
        )}
      </div>
    </div>
  );
}
