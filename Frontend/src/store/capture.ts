// Shared store for the capture inbox. The pending count drives the nav badge,
// so the shell and the Inbox page must read one list — not two fetches that
// drift apart the moment an item is accepted.
//
// Capture is the one feature that MUST never fail: the whole premise is that
// getting a thought out of your head is faster than holding it. So captures are
// queued locally and flushed later, exactly like the sync outbox — an offline
// capture is accepted instantly and shown in the inbox marked as pending.
// Triage (accept/dismiss) is queued the same way.

import { create } from "zustand";
import { api, isOfflineError } from "@/lib/api";
import { idbGet, idbSet, KEYS } from "@/lib/offlineDb";
import { isOffline } from "./network";
import type { AcceptOverrides, CaptureItem } from "@/lib/types";

/** A capture the user made that hasn't reached the server yet. */
type QueuedCapture =
  | { kind: "create"; localId: string; text: string; createdAt: string }
  | { kind: "accept"; id: string; type: string; overrides?: AcceptOverrides }
  | { kind: "dismiss"; id: string };

interface CaptureState {
  items: CaptureItem[];
  /** Locally-made captures awaiting upload, rendered optimistically. */
  queued: QueuedCapture[];
  loading: boolean;
  loaded: boolean;
  error: boolean;
  attach: (userId: string) => Promise<void>;
  load: (force?: boolean) => Promise<void>;
  capture: (text: string) => Promise<void>;
  accept: (id: string, type: string, overrides?: AcceptOverrides) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  /** Push everything queued. Called on reconnect. */
  flush: () => Promise<void>;
  clear: () => void;
}

let ownerId: string | null = null;

function localId(): string {
  return "q_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Render a queued create as an inbox item so the user sees it immediately. */
function asItem(q: Extract<QueuedCapture, { kind: "create" }>): CaptureItem {
  return {
    id: q.localId,
    rawContent: q.text,
    source: "manual",
    proposedType: "task", // the server classifies for real on upload
    suggestedProjectId: null,
    extractedFields: null,
    confidence: 0,
    classifierVersion: "pending",
    createdAt: q.createdAt,
    pending: true,
  };
}

export const useCapture = create<CaptureState>((set, get) => {
  async function persist() {
    if (!ownerId) return;
    await idbSet(KEYS.captureQueue(ownerId), get().queued);
  }

  return {
    items: [],
    queued: [],
    loading: false,
    loaded: false,
    error: false,

    /** Bind the store to a user and restore their queue from disk. */
    attach: async (userId) => {
      if (ownerId === userId) return;
      ownerId = userId;
      const queued = (await idbGet<QueuedCapture[]>(KEYS.captureQueue(userId))) ?? [];
      set({ queued: Array.isArray(queued) ? queued : [] });
      if (!isOffline()) void get().flush();
    },

    load: async (force) => {
      if (get().loading) return;
      if (get().loaded && !force) return;
      if (isOffline()) {
        // Offline the server list is unreachable; the queue is all we have and
        // it's already in state. Mark loaded so the UI stops spinning.
        set({ loaded: true, error: false });
        return;
      }
      set({ loading: true });
      try {
        const { items } = await api.captureList();
        set({ items, loaded: true, error: false });
      } catch (err) {
        set({ error: !isOfflineError(err) });
      } finally {
        set({ loading: false });
      }
    },

    /** Never fails: online it posts, offline it queues. Either way it's captured. */
    capture: async (text) => {
      const raw = text.trim();
      if (!raw) return;

      if (isOffline()) {
        const q: QueuedCapture = {
          kind: "create",
          localId: localId(),
          text: raw,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ queued: [...s.queued, q] }));
        await persist();
        return;
      }

      try {
        await api.captureCreate({ text: raw, source: "manual" });
        await get().load(true);
      } catch (err) {
        if (!isOfflineError(err)) throw err;
        // Lost the connection mid-request — queue rather than lose the thought.
        const q: QueuedCapture = {
          kind: "create",
          localId: localId(),
          text: raw,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ queued: [...s.queued, q] }));
        await persist();
      }
    },

    accept: async (id, type, overrides) => {
      // A queued (not-yet-uploaded) capture is triaged purely locally.
      const isLocal = get().queued.some((q) => q.kind === "create" && q.localId === id);
      if (isLocal) {
        // Accepting an unsent capture as anything but trash still needs the
        // server to classify + materialize it, so keep it queued; dropping it
        // here would silently lose the note.
        if (type === "trash") {
          set((s) => ({
            queued: s.queued.filter((q) => !(q.kind === "create" && q.localId === id)),
          }));
          await persist();
        }
        return;
      }

      set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
      if (isOffline()) {
        set((s) => ({ queued: [...s.queued, { kind: "accept", id, type, overrides }] }));
        await persist();
        return;
      }
      try {
        await api.captureAccept(id, { ...overrides, type });
      } catch (err) {
        if (!isOfflineError(err)) throw err;
        set((s) => ({ queued: [...s.queued, { kind: "accept", id, type, overrides }] }));
        await persist();
      }
    },

    dismiss: async (id) => {
      const isLocal = get().queued.some((q) => q.kind === "create" && q.localId === id);
      if (isLocal) {
        set((s) => ({
          queued: s.queued.filter((q) => !(q.kind === "create" && q.localId === id)),
        }));
        await persist();
        return;
      }

      set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
      if (isOffline()) {
        set((s) => ({ queued: [...s.queued, { kind: "dismiss", id }] }));
        await persist();
        return;
      }
      try {
        await api.captureDismiss(id);
      } catch (err) {
        if (!isOfflineError(err)) throw err;
        set((s) => ({ queued: [...s.queued, { kind: "dismiss", id }] }));
        await persist();
      }
    },

    /**
     * Upload the queue in order. Unlike sync/push there is no bulk capture
     * endpoint, so these go one at a time — but the queue is small by nature
     * (things you typed while offline) and order matters, since an accept must
     * follow the create it refers to.
     */
    flush: async () => {
      if (isOffline() || get().queued.length === 0) return;
      const batch = [...get().queued];
      const done = new Set<QueuedCapture>();

      for (const q of batch) {
        try {
          if (q.kind === "create") await api.captureCreate({ text: q.text, source: "manual" });
          else if (q.kind === "accept") await api.captureAccept(q.id, { ...q.overrides, type: q.type });
          else await api.captureDismiss(q.id);
          done.add(q);
        } catch (err) {
          if (isOfflineError(err)) break; // still down; keep the rest queued
          done.add(q); // server rejected it — retrying won't help
          console.warn("[capture] dropping queued item the server rejected", q, err);
        }
      }

      if (done.size) {
        set((s) => ({ queued: s.queued.filter((q) => !done.has(q)) }));
        await persist();
        await get().load(true); // pick up the server's real classification
      }
    },

    clear: () => {
      ownerId = null;
      set({ items: [], queued: [], loaded: false, error: false });
    },
  };
});

/** The inbox as the user should see it: server items plus anything still queued. */
export function useInboxItems(): CaptureItem[] {
  const items = useCapture((s) => s.items);
  const queued = useCapture((s) => s.queued);
  const optimistic = queued
    .filter((q): q is Extract<QueuedCapture, { kind: "create" }> => q.kind === "create")
    .map(asItem);
  return [...optimistic, ...items];
}
