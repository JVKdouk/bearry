"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button, Tooltip } from "antd";
import {
  CheckCircleOutlined,
  InboxOutlined,
  PlusOutlined,
  SettingOutlined,
  SunOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useCollection } from "@/store/hooks";
import { ListDrawer } from "@/components/ListDrawer";
import { ListIcon } from "@/components/ListIcon";

function Row({
  active,
  icon,
  label,
  count,
  onClick,
  onSettings,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: React.ReactNode;
  count?: number;
  onClick: () => void;
  /** Present only on rows that have settings — a gear that appears on hover. */
  onSettings?: () => void;
}) {
  const row = (
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
        <span
          // Both this and the settings gear live at the right edge, and the
          // gear is positioned over the row — so the number was rendering
          // underneath it. It yields while the gear is visible.
          className={onSettings ? "side-row-count" : undefined}
          style={{ fontSize: 12, color: active ? "#d9b8ff" : "#6f6f80", fontVariantNumeric: "tabular-nums" }}
        >
          {count}
        </span>
      ) : null}
    </button>
  );

  if (!onSettings) return row;

  // The gear sits beside the row rather than inside it: a button inside a
  // button is invalid markup, and the two clicks mean genuinely different
  // things — open the list, versus change what the list is.
  return (
    <div className="side-row-wrap" style={{ position: "relative" }}>
      {row}
      <Tooltip title="List settings">
        <button
          aria-label={`Settings for ${typeof label === "string" ? label : "list"}`}
          className="side-row-gear"
          onClick={(e) => {
            e.stopPropagation();
            onSettings();
          }}
          style={{
            position: "absolute",
            right: 6,
            top: "50%",
            transform: "translateY(-50%)",
            border: "none",
            background: "transparent",
            color: "#8f8fa2",
            cursor: "pointer",
            padding: 4,
            lineHeight: 1,
            borderRadius: 6,
          }}
        >
          <SettingOutlined style={{ fontSize: 12 }} />
        </button>
      </Tooltip>
    </div>
  );
}

export function SidebarLists({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const projects = useCollection("project");
  const blocks = useCollection("block");

  // Creating and editing both open the same drawer: a list you just made and a
  // list you're fixing want the same controls, and two surfaces is how the two
  // drift. `null` id means create.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const activeProjects = useMemo(
    () => projects.filter((p) => !p.archived).sort((a, b) => a.order - b.order),
    [projects],
  );

  // Counts are about work, so they count tasks. An event isn't something you
  // can be behind on, and a note isn't something you do.
  const openTodos = useMemo(
    () => blocks.filter((t) => t.kind === "task" && t.status !== "done" && !t.letGoAt),
    [blocks],
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

  function openCreate() {
    setEditingId(null);
    setDrawerOpen(true);
  }

  function openSettings(id: string) {
    setEditingId(id);
    setDrawerOpen(true);
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
        <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Tooltip title="Manage lists">
            <Button
              type="text"
              size="small"
              aria-label="Manage lists"
              icon={<SettingOutlined style={{ fontSize: 12, color: "#8f8fa2" }} />}
              onClick={() => go("/lists/settings")}
            />
          </Tooltip>
          <Tooltip title="New list">
            <Button
              type="text"
              size="small"
              aria-label="New list"
              icon={<PlusOutlined style={{ fontSize: 12, color: "#8f8fa2" }} />}
              onClick={openCreate}
            />
          </Tooltip>
        </span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 6px 6px", display: "flex", flexDirection: "column", gap: 2 }}>
        {activeProjects.map((p) => {
          return (
            <Row
              key={p.id}
              active={onLists && selected === p.id}
              icon={<ListIcon icon={p.icon} color={p.color} size={15} />}
              label={p.name}
              count={counts.byProject.get(p.id)}
              onClick={() => go(`/lists?list=${p.id}`)}
              onSettings={() => openSettings(p.id)}
            />
          );
        })}

        {activeProjects.length === 0 && (
          <button
            onClick={openCreate}
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

      <ListDrawer
        open={drawerOpen}
        projectId={editingId}
        onClose={() => setDrawerOpen(false)}
        isMobile={!!onNavigate}
        onCreated={(id) => go(`/lists?list=${id}`)}
      />
    </div>
  );
}
