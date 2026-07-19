"use client";

/**
 * Creating and editing a list.
 *
 * Creating used to be an inline text field in the sidebar that took a name and
 * nothing else — so a list arrived with a colour it never chose and no way to
 * set one, and editing was impossible. Deliberately the same surface for both:
 * a list you just made and a list you're fixing want exactly the same controls,
 * and having two of them is how the two drift.
 *
 * Same bottom-sheet-on-mobile / panel-on-desktop split as the task drawer, for
 * the same reason — a second shape of drawer makes the app feel like two apps.
 */

import { useEffect, useState } from "react";
import { App as AntdApp, Button, Drawer, Input, Popconfirm } from "antd";
import { CloseOutlined, DeleteOutlined } from "@ant-design/icons";
import { useSync } from "@/store/sync";
import { useCollection } from "@/store/hooks";
import { cleanName, LIST_ICONS, LIST_PALETTE, nextColor, normalizeIcon } from "@/lib/lists";
import { SURFACE } from "@/lib/theme";
import type { Project } from "@/lib/types";

interface Props {
  open: boolean;
  /** null = creating. */
  projectId: string | null;
  onClose: () => void;
  isMobile: boolean;
  /** Called with the new id after a create, so the caller can navigate to it. */
  onCreated?: (id: string) => void;
}

export function ListDrawer({ open, projectId, onClose, isMobile, onCreated }: Props) {
  const { message } = AntdApp.useApp();
  const projects = useCollection("project");
  const blocks = useCollection("block");
  const create = useSync((s) => s.create);
  const update = useSync((s) => s.update);
  const remove = useSync((s) => s.remove);

  const editing = projectId ? projects.find((p) => p.id === projectId) : undefined;
  const isCreate = !projectId;

  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(LIST_PALETTE[0]);
  const [icon, setIcon] = useState<string | null>(null);

  // Seed whenever the drawer opens or switches list.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setColor(editing.color);
      setIcon(normalizeIcon(editing.icon));
      return;
    }
    setName("");
    setColor(nextColor(projects.filter((p) => !p.archived).length));
    setIcon(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const trimmed = cleanName(name);
  const canSave = !!trimmed;

  // How many tasks would be orphaned by deleting this list. Said out loud in
  // the confirm rather than discovered afterwards.
  const taskCount = projectId
    ? blocks.filter((b) => b.projectId === projectId && !b.deletedAt && !b.letGoAt).length
    : 0;

  function save() {
    if (!trimmed) return;
    const patch: Partial<Project> = { name: trimmed, color, icon: normalizeIcon(icon) };

    if (isCreate) {
      const id = create("project", {
        ...patch,
        order: projects.filter((p) => !p.archived).length,
        archived: false,
      });
      message.success("List created");
      onCreated?.(id);
    } else if (projectId) {
      update("project", projectId, patch);
    }
    onClose();
  }

  function del() {
    if (!projectId) return;
    // The tasks survive: deleting a list is a statement about the grouping,
    // not about the work in it. They fall back to "No list".
    remove("project", projectId);
    message.success(
      taskCount > 0
        ? `List deleted — ${taskCount} task${taskCount === 1 ? "" : "s"} moved to No list`
        : "List deleted",
    );
    onClose();
  }

  const body = (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderBottom: `1px solid ${SURFACE.borderSoft}`,
        }}
      >
        <span style={{ flex: 1, fontSize: 13, color: "#a9a9b8" }}>
          {isCreate ? "New list" : "List settings"}
        </span>
        <Button type="text" aria-label="Close" icon={<CloseOutlined />} onClick={onClose} />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 22px" }}>
        {/* The name leads, at the same weight as a task title — it's the one
            field that must be filled, and the only one with no sane default. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <span
            aria-hidden
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              fontSize: icon ? 18 : 0,
              background: icon ? "transparent" : color,
              boxShadow: icon ? "none" : `0 0 0 1px ${color}55`,
            }}
          >
            {icon}
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="List name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) save();
            }}
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "#f4f4f8",
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: "-0.02em",
            }}
          />
        </div>

        <div style={sectionLabel}>Colour</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginBottom: 22 }}>
          {LIST_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: c,
                cursor: "pointer",
                border: color === c ? "2px solid #fff" : "2px solid transparent",
                boxShadow: color === c ? `0 0 0 2px ${c}` : "none",
              }}
            />
          ))}
        </div>

        <div style={sectionLabel}>
          Icon
          {icon && (
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: 16, fontSize: 11, marginLeft: 8 }}
              onClick={() => setIcon(null)}
            >
              clear
            </Button>
          )}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(38px, 1fr))",
            gap: 6,
            marginBottom: 12,
          }}
        >
          {LIST_ICONS.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={`Icon ${e}`}
              aria-pressed={icon === e}
              onClick={() => setIcon(icon === e ? null : e)}
              style={{
                height: 38,
                borderRadius: 9,
                fontSize: 18,
                cursor: "pointer",
                background: icon === e ? "rgba(168,85,247,0.18)" : "transparent",
                border: `1px solid ${icon === e ? "rgba(168,85,247,0.5)" : "#24242f"}`,
              }}
            >
              {e}
            </button>
          ))}
        </div>
        {/* Anything, not just the grid — the grid is a shortcut, not a limit. */}
        <Input
          size="small"
          placeholder="…or paste any emoji"
          value={icon ?? ""}
          onChange={(e) => setIcon(e.target.value || null)}
          style={{ maxWidth: 200 }}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderTop: `1px solid ${SURFACE.borderSoft}`,
        }}
      >
        {!isCreate && (
          <Popconfirm
            title="Delete this list?"
            description={
              taskCount > 0
                ? `${taskCount} task${taskCount === 1 ? "" : "s"} will move to No list.`
                : undefined
            }
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={del}
          >
            <Button type="text" danger aria-label="Delete list" icon={<DeleteOutlined />} />
          </Popconfirm>
        )}
        <div style={{ flex: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button type="primary" disabled={!canSave} onClick={save}>
          {isCreate ? "Create" : "Save"}
        </Button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer
        placement="bottom"
        open={open}
        onClose={onClose}
        height="80%"
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

  return (
    <Drawer
      placement="right"
      open={open}
      onClose={onClose}
      width={420}
      closeIcon={null}
      styles={{
        body: { padding: 0, background: "#0d0d13" },
        header: { display: "none" },
        content: { background: "#0d0d13" },
      }}
    >
      {body}
    </Drawer>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.6,
  textTransform: "uppercase",
  color: "#6f6f80",
  marginBottom: 10,
};
