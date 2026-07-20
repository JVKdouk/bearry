"use client";

/**
 * Runs the "Mark complete" / "Reschedule" actions fired from a push
 * notification, so they act against the live sync store — completions queue
 * offline and reconcile like any other edit, and a repeating task rolls forward
 * server-side exactly as tapping its checkbox would.
 *
 * Two ways in, because a notification action can arrive with the app open or
 * closed:
 *   • a tab is open  -> the service worker postMessages the action here
 *   • nothing open   -> the SW opens a window with ?kuma-complete / ?kuma-reschedule,
 *                       and we pick it up from the URL on boot
 */

import { Suspense, useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { App as AntdApp } from "antd";
import { useSync } from "@/store/sync";
import { useUI } from "@/store/ui";

function NotificationActionsInner() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const update = useSync((s) => s.update);
  // The store must have restored from cache before we touch a block by id —
  // update() no-ops on an unknown id, which on a cold boot would silently drop
  // the completion.
  const hydrated = useSync((s) => s.hydrated);
  const openEditTask = useUI((s) => s.openEditTask);
  const { message } = AntdApp.useApp();
  // Each notification action runs once, even under a double-invoked effect.
  const handled = useRef<Set<string>>(new Set());

  const complete = useCallback(
    (id: string) => {
      // Same write the checkbox makes: the server advances a recurring task and
      // vacates its plan blocks; a one-off just closes.
      update("block", id, { status: "done" });
      message.success("Marked complete");
    },
    [update, message],
  );

  const reschedule = useCallback(
    (id: string) => {
      // The task/event drawer is where time is set — open it straight on the block.
      openEditTask(id);
    },
    [openEditTask],
  );

  // Cold open: the SW opened a fresh window with the action in the query string.
  useEffect(() => {
    const toComplete = params.get("kuma-complete");
    const toReschedule = params.get("kuma-reschedule");
    if (!toComplete && !toReschedule) return;
    if (!hydrated) return; // wait for the cached workspace before acting
    if (toComplete && !handled.current.has(`complete:${toComplete}`)) {
      handled.current.add(`complete:${toComplete}`);
      complete(toComplete);
    }
    if (toReschedule && !handled.current.has(`reschedule:${toReschedule}`)) {
      handled.current.add(`reschedule:${toReschedule}`);
      reschedule(toReschedule);
    }
    // Strip the param so a refresh or a Back doesn't fire the action twice.
    router.replace(pathname);
  }, [params, pathname, router, hydrated, complete, reschedule]);

  // Warm: a tab was already open and the SW messaged the action to it.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.type !== "kuma-action" || typeof d.blockId !== "string") return;
      if (d.action === "complete") complete(d.blockId);
      else if (d.action === "reschedule") reschedule(d.blockId);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [complete, reschedule]);

  return null;
}

export function NotificationActions() {
  // useSearchParams must sit under a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <NotificationActionsInner />
    </Suspense>
  );
}
