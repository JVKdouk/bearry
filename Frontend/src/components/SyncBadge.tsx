"use client";

import { Badge, Tooltip } from "antd";
import { useSync } from "@/store/sync";
import { useCapture } from "@/store/capture";
import { useIsOffline } from "@/store/network";

/**
 * Connectivity + queue state in one glance.
 *
 * The tone matters here: offline is a normal operating mode for this app, not an
 * error. The wording says the work is safe ("saved on this device") rather than
 * raising an alarm, because the user has done nothing wrong and nothing is lost.
 */
export function SyncBadge() {
  const status = useSync((s) => s.status);
  const pendingOps = useSync((s) => s.pendingCount);
  const queuedCaptures = useCapture((s) => s.queued.length);
  const offline = useIsOffline();

  const waiting = pendingOps + queuedCaptures;

  let dot: "success" | "processing" | "warning" | "default" = "success";
  let label: string;
  let tip: string;

  if (offline) {
    dot = waiting ? "warning" : "default";
    label = waiting ? `Offline · ${waiting}` : "Offline";
    tip = waiting
      ? `Offline — ${waiting} change${waiting === 1 ? "" : "s"} saved on this device and queued to sync`
      : "Offline — your work is saved on this device and syncs when you reconnect";
  } else if (status === "syncing") {
    dot = "processing";
    label = "Syncing…";
    tip = "Syncing with the server";
  } else if (waiting) {
    dot = "warning";
    label = `${waiting} pending`;
    tip = `${waiting} change${waiting === 1 ? "" : "s"} waiting to sync`;
  } else {
    label = "Synced";
    tip = "Everything is saved to the server";
  }

  return (
    <Tooltip title={tip}>
      <Badge
        status={dot}
        text={<span style={{ color: "#a9a9b8", fontSize: 12 }}>{label}</span>}
      />
    </Tooltip>
  );
}
