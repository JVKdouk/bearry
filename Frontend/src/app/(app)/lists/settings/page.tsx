"use client";

import { useMemo, useState } from "react";
import { Button, Empty, Grid, Segmented, Tooltip } from "antd";
import { PlusOutlined, SettingOutlined, UndoOutlined } from "@ant-design/icons";
import { ListDrawer } from "@/components/ListDrawer";
import { useCollection } from "@/store/hooks";
import { useSync } from "@/store/sync";
import { ListIcon } from "@/components/ListIcon";
import { TEXT } from "@/lib/theme";

/**
 * Everything about your lists in one place.
 *
 * The sidebar can show a list and open its settings, but it can't show you what
 * you *have* — archived lists are invisible there by design, ordering is
 * implicit, and counts are per-list rather than comparable. This is the page
 * you come to when the question is about the lists themselves rather than about
 * the work inside one.
 */
export default function ListSettingsPage() {
  const projects = useCollection("project");
  const blocks = useCollection("block");
  const update = useSync((s) => s.update);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showing, setShowing] = useState<"active" | "archived">("active");

  const counts = useMemo(() => {
    const m = new Map<string, { open: number; total: number }>();
    for (const b of blocks) {
      if (b.kind !== "task" || !b.projectId || b.deletedAt) continue;
      const c = m.get(b.projectId) ?? { open: 0, total: 0 };
      c.total += 1;
      if (b.status !== "done" && !b.letGoAt) c.open += 1;
      m.set(b.projectId, c);
    }
    return m;
  }, [blocks]);

  const shown = useMemo(
    () =>
      projects
        .filter((p) => (showing === "archived" ? p.archived : !p.archived))
        .sort((a, b) => a.order - b.order),
    [projects, showing],
  );

  const archivedCount = projects.filter((p) => p.archived).length;

  function openNew() {
    setEditingId(null);
    setDrawerOpen(true);
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
          <p className="hero-greeting">Organise</p>
          <h1 className="hero-title">Lists</h1>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openNew} style={{ flexShrink: 0 }}>
          New list
        </Button>
      </div>

      {archivedCount > 0 && (
        <div style={{ marginTop: 18 }}>
          <Segmented
            value={showing}
            onChange={(v) => setShowing(v as "active" | "archived")}
            options={[
              { label: `Active (${projects.length - archivedCount})`, value: "active" },
              { label: `Archived (${archivedCount})`, value: "archived" },
            ]}
          />
        </div>
      )}

      <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.length === 0 ? (
          <Empty
            image={null}
            description={
              <span style={{ color: TEXT.tertiary }}>
                {showing === "archived" ? "Nothing archived." : "No lists yet."}
              </span>
            }
            style={{ margin: "40px 0" }}
          >
            {showing === "active" && <Button onClick={openNew}>Create your first list</Button>}
          </Empty>
        ) : (
          shown.map((p) => {
            const c = counts.get(p.id) ?? { open: 0, total: 0 };
            return (
              <div
                key={p.id}
                className="card card-interactive"
                onClick={() => {
                  setEditingId(p.id);
                  setDrawerOpen(true);
                }}
                style={{ padding: 14, display: "flex", alignItems: "center", gap: 13 }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    flexShrink: 0,
                    borderRadius: 10,
                    display: "grid",
                    placeItems: "center",
                    background: `${p.color}1f`,
                    boxShadow: `0 0 0 1px ${p.color}55`,
                  }}
                >
                  <ListIcon icon={p.icon} color={p.color} size={18} />
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: TEXT.primary,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.name}
                  </div>
                  <div style={{ fontSize: 12.5, color: TEXT.tertiary, marginTop: 2 }}>
                    {/* Open vs total, because "12 tasks" hides whether they're
                        done — and a list that is finished reads very
                        differently from one that hasn't started. */}
                    {c.total === 0
                      ? "Empty"
                      : `${c.open} open · ${c.total} total`}
                  </div>
                </div>

                {p.archived ? (
                  <Tooltip title="Restore to the sidebar">
                    <Button
                      type="text"
                      icon={<UndoOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        update("project", p.id, { archived: false });
                      }}
                    />
                  </Tooltip>
                ) : (
                  <Tooltip title="Archive — hides it without touching the tasks">
                    <Button
                      type="text"
                      style={{ fontSize: 12, color: TEXT.tertiary }}
                      onClick={(e) => {
                        e.stopPropagation();
                        update("project", p.id, { archived: true });
                      }}
                    >
                      Archive
                    </Button>
                  </Tooltip>
                )}
                <SettingOutlined style={{ color: TEXT.tertiary, fontSize: 13 }} />
              </div>
            );
          })
        )}
      </div>

      <ListDrawer
        open={drawerOpen}
        projectId={editingId}
        onClose={() => setDrawerOpen(false)}
        isMobile={isMobile}
      />
    </div>
  );
}
