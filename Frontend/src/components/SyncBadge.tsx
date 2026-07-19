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
 *
 * The one case that DOES warrant alarm is a write the server refused outright.
 * We stop retrying those — resending byte-identical data the server has already
 * rejected never succeeds — but they used to disappear with nothing but a
 * console line, which in an offline-first app is indistinguishable from losing
 * the user's work. That is the only state here rendered as an error.
 */
export function SyncBadge() {
  const status = useSync((s) => s.status);
  const pendingOps = useSync((s) => s.pendingCount);
  const queuedCaptures = useCapture((s) => s.queued.length);
  const rejected = useSync((s) => s.rejected);
  const offline = useIsOffline();

  const waiting = pendingOps + queuedCaptures;

  let dot: "success" | "processing" | "warning" | "default" | "error" = "success";
  let label: string;
  let tip: string;

  if (rejected.length > 0) {
    // Deliberately ahead of the offline branch: a refused write is the one
    // thing here the user may actually need to redo, so it must not be hidden
    // behind a reassuring "saved on this device".
    dot = "error";
    label = `${rejected.length} not saved`;
    tip =
      `The server refused ${rejected.length} change${rejected.length === 1 ? "" : "s"}` +
      `${rejected[0].message ? ` (${rejected[0].message})` : ""}. ` +
      "They may need redoing — everything else is saved.";
  } else if (offline) {
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
