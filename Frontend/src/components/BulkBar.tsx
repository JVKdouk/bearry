"use client";

/**
 * The action bar that appears while tasks are selected.
 *
 * Sits at the bottom, above the mobile nav, and shows what you can do to the
 * selection: complete/reopen, set priority, move to a list, delete. Every
 * action goes through the pure planner in lib/bulk, so the bar is only wiring —
 * it decides nothing about which rows change.
 *
 * Mounted once in the shell rather than per page, because a selection can
 * outlive a scroll and the bar should never flicker or re-mount as cards below
 * it re-render.
 */

import { App as AntdApp, Dropdown, Popconfirm } from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  FlagOutlined,
  FolderOutlined,
  RotateLeftOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useSelection } from "@/store/selection";
import { useSync } from "@/store/sync";
import { useCollection } from "@/store/hooks";
import { allComplete, bulkSummary, planBulk, type BulkAction } from "@/lib/bulk";
import { PRIORITY_COLOR, PRIORITY_LABEL } from "@/lib/format";
import { ListIcon } from "@/components/ListIcon";
import type { Priority } from "@/lib/types";

const PRIORITIES: Priority[] = ["ASAP", "high", "medium", "low"];

export function BulkBar() {
  const { message } = AntdApp.useApp();
  const router = useRouter();
  const active = useSelection((s) => s.active);
  const ids = useSelection((s) => s.ids);
  const clear = useSelection((s) => s.clear);

  const blocks = useCollection("block");
  const projects = useCollection("project");
  const update = useSync((s) => s.update);
  const remove = useSync((s) => s.remove);

  // The actual rows behind the selected ids. A selected task can be deleted
  // from elsewhere (or by a sync) while the bar is open, so resolve against the
  // live collection rather than trusting the id set alone.
  const selected = useMemo(
    () => blocks.filter((b) => ids.has(b.id) && !b.deletedAt),
    [blocks, ids],
  );

  if (!active) return null;

  const count = selected.length;
  const everyoneDone = allComplete(selected);

  function apply(action: BulkAction) {
    const plan = planBulk(selected, action);
    for (const { id, patch } of plan.patches) update("block", id, patch);
    for (const id of plan.removals) remove("block", id);
    // Nothing changed (e.g. "complete" on an all-done selection) still counts
    // as done from the user's side — say so rather than looking inert.
    message.success(bulkSummary(action, count));
    clear();
  }

  // Only unfinished tasks can be planned — an event is already fixed in time,
  // and a done task has nothing left to schedule.
  const plannable = selected.filter((b) => b.kind === "task" && b.status !== "done");

  function planSelected() {
    if (plannable.length === 0) return;
    // Hand the subset to the calendar, which runs the deterministic solver over
    // just these and reviews the result as ghost blocks. The nonce makes each
    // request distinct so re-planning the same set fires again. AI diagnosis is
    // gated by count on the calendar side, so a small batch stays model-free.
    const query = `plan=${Date.now()}&tasks=${plannable.map((b) => b.id).join(",")}`;
    clear();
    router.push(`/calendar?${query}`);
  }

  const activeProjects = projects
    .filter((p) => !p.archived)
    .sort((a, b) => a.order - b.order);

  // Menu rows put the icon in a fixed-width column so the label always starts at
  // the same place, whatever the icon is — an antd glyph, a Lucide icon or an
  // emoji. Using antd's own `icon` slot let icons of different widths push the
  // text around, which is what read as "inconsistent".
  const menuRow = (icon: React.ReactNode, text: React.ReactNode) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <span
        style={{
          width: 18,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      {text}
    </span>
  );

  const moveItems = [
    {
      key: "__none__",
      label: menuRow(<FolderOutlined />, "No list"),
      onClick: () => apply({ type: "move", projectId: null }),
    },
    ...activeProjects.map((p) => ({
      key: p.id,
      label: menuRow(<ListIcon icon={p.icon} color={p.color} size={14} />, p.name),
      onClick: () => apply({ type: "move", projectId: p.id }),
    })),
  ];

  const priorityItems = PRIORITIES.map((p) => ({
    key: p,
    label: menuRow(<FlagOutlined style={{ color: PRIORITY_COLOR[p] }} />, PRIORITY_LABEL[p]),
    onClick: () => apply({ type: "priority", priority: p }),
  }));

  return (
    <div className="bulk-bar" role="toolbar" aria-label={`${count} selected`}>
      <button className="bulk-bar-close" aria-label="Cancel selection" onClick={clear}>
        <CloseOutlined />
      </button>
      <span className="bulk-bar-count">{count} selected</span>

      <div className="bulk-bar-actions">
        <button
          className="bulk-bar-action"
          disabled={plannable.length === 0}
          onClick={planSelected}
        >
          <ThunderboltOutlined />
          <span>Plan</span>
        </button>

        <button
          className="bulk-bar-action"
          disabled={count === 0}
          onClick={() => apply(everyoneDone ? { type: "reopen" } : { type: "complete" })}
        >
          {everyoneDone ? <RotateLeftOutlined /> : <CheckOutlined />}
          <span>{everyoneDone ? "Reopen" : "Complete"}</span>
        </button>

        <Dropdown menu={{ items: priorityItems }} trigger={["click"]} placement="top" disabled={count === 0}>
          <button className="bulk-bar-action">
            <FlagOutlined />
            <span>Priority</span>
          </button>
        </Dropdown>

        <Dropdown menu={{ items: moveItems }} trigger={["click"]} placement="top" disabled={count === 0}>
          <button className="bulk-bar-action">
            <FolderOutlined />
            <span>Move</span>
          </button>
        </Dropdown>

        <Popconfirm
          title={`Delete ${count} task${count === 1 ? "" : "s"}?`}
          okText="Delete"
          okButtonProps={{ danger: true }}
          onConfirm={() => apply({ type: "delete" })}
          disabled={count === 0}
          placement="top"
        >
          <button className="bulk-bar-action bulk-bar-danger" disabled={count === 0}>
            <DeleteOutlined />
            <span>Delete</span>
          </button>
        </Popconfirm>
      </div>
    </div>
  );
}
