// Offline-first sync store. Mirrors the mobile offline manager against the same
// /sync/pull + /sync/push contract: local collections are the UI's source of
// truth, writes are optimistic and flushed to the server (coalesced), and a
// delta pull merges server changes (last-writer-wins, skipping locally-pending
// rows).
//
// Internally every collection is a uniform `Record<string, Row>`; typed access
// (per-entity record shapes) is layered on in `hooks.ts`.

import { create } from "zustand";
import { api, type PushOp } from "@/lib/api";
import { idbGet, idbSet, idbDel, KEYS } from "@/lib/offlineDb";
import { isOffline } from "./network";
import type { EntityName, SyncEntities } from "@/lib/types";

const ENTITIES: EntityName[] = [
  "project",
  "block",
  "projectMember",
  "taskStep",
  "reminder",
  "timeBlock",
  "energyWindow",
  "blockRegion",
  "link",
  "setting",
];

export type Row = {
  id: string;
  deletedAt?: string | null;
  updatedAt?: string;
  [k: string]: unknown;
};

export type RawCollections = Record<EntityName, Record<string, Row>>;

function emptyCollections(): RawCollections {
  return {
    project: {},
    block: {},
    projectMember: {},
    taskStep: {},
    reminder: {},
    timeBlock: {},
    energyWindow: {},
    blockRegion: {},
    link: {},
    setting: {},
  };
}

// Coalescing outbox keyed by `entity:id` so rapid edits collapse to one push.
type Pending = Map<string, PushOp>;

export type SyncStatus = "idle" | "syncing" | "offline" | "queued";

interface SyncState {
  collections: RawCollections;
  cursor: string | null;
  hydrated: boolean;
  status: SyncStatus;
  pendingCount: number;
  /**
   * Writes the server refused outright, which we gave up retrying.
   *
   * Dropping them is right — retrying byte-identical data the server has
   * already rejected never succeeds and turns the client into a load
   * generator. But dropping them *silently* means an edit disappears with no
   * trace outside the console, which in an offline-first app is
   * indistinguishable from losing the user's work. Surfaced so the UI can say
   * so, and cleared once acknowledged.
   */
  rejected: { entity: string; id: string; message?: string }[];
  acknowledgeRejected: () => void;

  /** Restore local state for this user, then refresh from the server if online. */
  bootstrap: (userId: string) => Promise<void>;
  pull: () => Promise<void>;
  reset: () => void;

  create: <K extends EntityName>(
    entity: K,
    data: Partial<SyncEntities[K]>,
  ) => string;
  update: <K extends EntityName>(
    entity: K,
    id: string,
    patch: Partial<SyncEntities[K]>,
  ) => void;
  remove: (entity: EntityName, id: string) => void;
  flush: () => Promise<void>;
}

const pending: Pending = new Map();
/** Consecutive server rejections per op key, so a poison op can't retry forever. */
const failures = new Map<string, number>();
const MAX_OP_ATTEMPTS = 5;

/**
 * Ops per push request. MUST NOT exceed the server's own cap (currently 500 in
 * Sync/mutators/push.ts) — it rejects a larger array outright with a 400.
 *
 * The client used to send its entire outbox in one request regardless of size.
 * Below the cap that's ideal: a week offline costs one round-trip. Above it,
 * every attempt was rejected wholesale and retried forever, so the queue could
 * never drain — the harder someone had worked offline, the more certainly none
 * of it synced. Chunking keeps the single-request case intact and makes the
 * large case merely take several trips.
 */
const MAX_OPS_PER_PUSH = 400;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

/**
 * Consecutive failed pushes, driving an exponential backoff with jitter.
 *
 * A flat 2s retry means that when the API goes down, every client in the world
 * retries twice a second in near-lockstep and keeps hammering the moment it
 * tries to come back up. Backing off spreads the load out, and the jitter stops
 * clients that failed together from returning together.
 */
let pushBackoff = 0;
/** Guards against overlapping pulls (the 60s poll racing the focus handler). */
let pulling = false;

/**
 * Follow a capped pull to completion, merging each page as it arrives so the UI
 * fills in progressively rather than waiting on the whole backlog. Bounded so a
 * server that always reports `hasMore` can't spin here forever.
 */
const MAX_PULL_PAGES = 50;

async function drainPages(
  since: string | undefined,
  merge: (changes: Record<string, unknown[]>) => void,
  onReset: () => void,
): Promise<string> {
  let cursor = since;
  let didReset = false;
  for (let page = 0; page < MAX_PULL_PAGES; page++) {
    const res = await api.pull(cursor);

    // Our cursor predated the server's tombstone retention, so deletions we
    // never saw may already be pruned. The server has answered with a full
    // bootstrap instead of a delta; anything we hold that isn't in it was
    // deleted while we were away. Clearing first is what stops those rows
    // lingering — and, worse, being pushed back as if they were new.
    //
    // Only on the first page: later pages of the same bootstrap would wipe the
    // rows the earlier ones just delivered.
    if (res.reset && !didReset) {
      didReset = true;
      onReset();
    }

    merge(res.changes);
    cursor = res.cursor;
    if (!res.hasMore) break;
  }
  return cursor as string;
}

function retryDelay(): number {
  if (pushBackoff === 0) return 2000;
  const capped = Math.min(2000 * 2 ** pushBackoff, 60_000);
  return Math.round(capped * (0.5 + Math.random() * 0.5)); // 50–100% jitter
}

/**
 * Everything the client needs to work with no network at all is persisted:
 * the outbox (queued writes), the collections (the workspace itself) and the
 * cursor (so a reconnect is a small delta, not a full re-download).
 *
 * Persisting the collections is what makes this genuinely offline-*first*
 * rather than merely offline-tolerant. Without them a reload on a train showed
 * an empty app, because the only copy of the user's data lived in a JS variable
 * and the bootstrap that would refill it needs the network.
 *
 * The cursor is only ever persisted TOGETHER with the collections it describes,
 * in that order (rows first, then the cursor). A cursor without its rows would
 * make the next delta pull skip everything the client is missing; if we crash
 * between the two writes the worst case is a cursor that is too old, which
 * re-delivers rows the merge is idempotent about.
 */
let ownerId: string | null = null; // user the persisted state belongs to
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced: typing a title shouldn't write the whole workspace per keystroke. */
function schedulePersistCollections(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void persistCollections(), 400);
}

async function persistCollections(): Promise<void> {
  if (!ownerId) return;
  const { collections, cursor } = useSync.getState();
  await idbSet(KEYS.collections(ownerId), collections);
  if (cursor) await idbSet(KEYS.cursor(ownerId), cursor);
}

async function persistOutbox(): Promise<void> {
  if (!ownerId) return;
  await idbSet(KEYS.outbox(ownerId), Array.from(pending.entries()));
}

/** Load the last known workspace for `userId`. Returns true if anything was found. */
async function restoreFor(userId: string): Promise<boolean> {
  ownerId = userId;
  const [collections, cursor, outbox] = await Promise.all([
    idbGet<RawCollections>(KEYS.collections(userId)),
    idbGet<string>(KEYS.cursor(userId)),
    idbGet<[string, PushOp][]>(KEYS.outbox(userId)),
  ]);

  // Queued writes for entities this version no longer knows about.
  //
  // Someone who was offline across the todo/note/calendarEvent → block change
  // comes back holding ops the server will refuse forever. Dropping them is
  // the only option — there is nothing to replay them against — but dropping
  // them *silently* would be an edit vanishing with no trace, which is exactly
  // what an offline-first app must never do. They're surfaced like any other
  // refused write.
  const stranded: { entity: string; id: string; message?: string }[] = [];
  if (Array.isArray(outbox)) {
    for (const [key, op] of outbox) {
      if (!key || !op || typeof op !== "object") continue;
      if (!(ENTITIES as string[]).includes(op.entity)) {
        stranded.push({
          entity: op.entity,
          id: op.id ?? "",
          message: "This change was made in an older version and could not be saved.",
        });
        continue;
      }
      pending.set(key, op);
    }
  }

  if (!collections) {
    if (stranded.length > 0) useSync.setState({ rejected: stranded });
    return false;
  }
  // Guard against a partially-written or schema-drifted blob: every entity key
  // must exist, or selectors would read undefined and crash the UI.
  const restored = emptyCollections();
  for (const entity of ENTITIES) {
    const map = collections[entity];
    if (map && typeof map === "object") restored[entity] = map;
  }
  useSync.setState({
    collections: restored,
    cursor: cursor ?? null,
    hydrated: true,
    pendingCount: pending.size,
    rejected: stranded,
  });
  return true;
}

/** Forget the persisted workspace (logout, or a different user signing in). */
async function clearPersisted(userId: string | null): Promise<void> {
  if (!userId) return;
  await Promise.all([
    idbDel(KEYS.collections(userId)),
    idbDel(KEYS.cursor(userId)),
    idbDel(KEYS.outbox(userId)),
  ]);
}

function genId(): string {
  return "c_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const useSync = create<SyncState>((set, get) => {
  function scheduleFlush() {
    void persistOutbox(); // durable before the debounce, not after the round-trip
    schedulePersistCollections(); // the optimistic row must survive a reload too
    set({ pendingCount: pending.size, status: pending.size ? "queued" : "idle" });
    if (flushTimer) clearTimeout(flushTimer);
    // No point scheduling a push we know will fail; the reconnect handler
    // flushes. The queue keeps growing safely in the meantime.
    if (isOffline()) {
      set({ status: "queued" });
      return;
    }
    flushTimer = setTimeout(() => void get().flush(), 600);
  }

  /**
   * Merge a whole pull in ONE store update. Merging entity-by-entity meant a
   * bootstrap published nine separate states, so every subscribed component
   * re-rendered nine times against partially-populated collections.
   */
  function mergeChanges(changes: Record<string, unknown>) {
    set((state) => {
      let touched = false;
      const next = { ...state.collections };
      for (const entity of ENTITIES) {
        const rows = (changes[entity] as Row[] | undefined) ?? [];
        if (rows.length === 0) continue;
        const map = { ...state.collections[entity] };
        for (const row of rows) {
          // Skip rows we have a pending local write for (LWW toward local).
          if (pending.has(`${entity}:${row.id}`)) continue;
          if (row.deletedAt) delete map[row.id];
          else map[row.id] = row;
        }
        next[entity] = map;
        touched = true;
      }
      return touched ? { collections: next } : {};
    });
    schedulePersistCollections();
  }

  return {
    collections: emptyCollections(),
    cursor: null,
    hydrated: false,
    status: "idle",
    pendingCount: 0,
    rejected: [],

    /**
     * Cache-first startup. Local state is restored and rendered BEFORE any
     * network call, so the app is usable immediately — instantly on a fast
     * connection, and at all on no connection. The network pull is then a
     * refresh on top of a working app rather than a precondition for one.
     */
    bootstrap: async (userId: string) => {
      // A different account on a shared device must never inherit the previous
      // one's cached workspace.
      if (ownerId && ownerId !== userId) {
        await clearPersisted(ownerId);
        pending.clear();
        set({ collections: emptyCollections(), cursor: null, pendingCount: 0 });
      }

      const hadLocal = await restoreFor(userId);
      set({ hydrated: true, status: pending.size ? "queued" : "idle" });

      if (isOffline()) {
        // Nothing to do but work locally; the reconnect handler will sync.
        set({ status: pending.size ? "queued" : "offline" });
        return;
      }

      set({ status: "syncing" });
      try {
        // With local state we only need the delta; without it, a full pull.
        const since = hadLocal ? (get().cursor ?? undefined) : undefined;
        const cursor = await drainPages(since, mergeChanges, () =>
          set({ collections: emptyCollections() }),
        );
        set({
          cursor,
          pendingCount: pending.size, // a restored outbox must show in the badge
          status: pending.size ? "queued" : "idle",
        });
        await persistCollections();
      } catch {
        // A failed bootstrap used to reject into the caller and strand the UI on
        // "syncing" forever. Stay usable on cached data; the poll retries.
        set({ status: pending.size ? "queued" : "offline" });
      }
      if (pending.size) void get().flush(); // drain a restored outbox
    },

    pull: async () => {
      if (pulling) return; // the 60s poll and the focus handler can overlap
      if (isOffline()) return; // don't burn a request we know will fail
      pulling = true;
      const since = get().cursor ?? undefined;
      try {
        set({ status: "syncing" });
        const cursor = await drainPages(since, mergeChanges, () =>
          set({ collections: emptyCollections() }),
        );
        set({ cursor, status: pending.size ? "queued" : "idle" });
        await persistCollections();
      } catch {
        set({ status: pending.size ? "queued" : "offline" });
      } finally {
        pulling = false;
      }
    },

    acknowledgeRejected: () => set({ rejected: [] }),

    reset: () => {
      // Logout: wipe both memory and disk. Leaving a cached workspace behind
      // would show the next person to sign in on this device the previous
      // user's tasks before their own first pull lands.
      const previous = ownerId;
      pending.clear();
      failures.clear();
      if (flushTimer) clearTimeout(flushTimer);
      if (persistTimer) clearTimeout(persistTimer);
      ownerId = null;
      void clearPersisted(previous);
      set({
        collections: emptyCollections(),
        cursor: null,
        hydrated: false,
        status: "idle",
        pendingCount: 0,
        rejected: [],
      });
    },

    create: (entity, data) => {
      const id = genId();
      const now = new Date().toISOString();
      const row = { id, ...data, updatedAt: now, createdAt: now } as Row;
      set((state) => ({
        collections: {
          ...state.collections,
          [entity]: { ...state.collections[entity], [id]: row },
        },
      }));
      pending.set(`${entity}:${id}`, {
        entity,
        op: "upsert",
        id,
        clientUpdatedAt: now,
        data: data,
      });
      scheduleFlush();
      return id;
    },

    update: (entity, id, patch) => {
      const now = new Date().toISOString();
      set((state) => {
        const existing = state.collections[entity][id];
        if (!existing) return {};
        const merged = { ...existing, ...patch, updatedAt: now } as Row;
        return {
          collections: {
            ...state.collections,
            [entity]: { ...state.collections[entity], [id]: merged },
          },
        };
      });
      const key = `${entity}:${id}`;
      const prev = pending.get(key);
      const data =
        prev?.op === "upsert"
          ? { ...prev.data, ...patch }
          : (patch as Record<string, unknown>);
      pending.set(key, { entity, op: "upsert", id, clientUpdatedAt: now, data });
      scheduleFlush();
    },

    remove: (entity, id) => {
      set((state) => {
        const map = { ...state.collections[entity] };
        delete map[id];
        return { collections: { ...state.collections, [entity]: map } };
      });
      pending.set(`${entity}:${id}`, { entity, op: "delete", id });
      scheduleFlush();
    },

    /**
     * Drain the whole outbox in ONE request. Every queued change across every
     * entity goes up as a single bulk `/sync/push` — a week offline still costs
     * one round-trip on reconnect, not one per edit.
     */
    flush: async () => {
      if (flushing || pending.size === 0) return;
      if (isOffline()) {
        set({ status: "queued", pendingCount: pending.size });
        return;
      }
      flushing = true;
      // Remember the exact op object sent for each key. While the push is in
      // flight the user can keep editing, which replaces the queued op with a
      // newer one under the SAME key — acknowledging by key alone would then
      // delete an edit that was never sent, and the next pull would overwrite
      // the user's text with the stale server copy. Only retire an entry if it
      // is still the identical object we transmitted.
      const sent = new Map<string, PushOp>();
      for (const [key, op] of pending) sent.set(key, op);
      // Oldest first, so a create is applied before anything referencing it.
      const batch = Array.from(sent.values()).slice(0, MAX_OPS_PER_PUSH);
      try {
        set({ status: "syncing" });
        const { results } = await api.push(batch);
        for (const r of results) {
          const key = `${r.entity}:${r.id}`;
          if (r.status === "error") {
            // A per-op error is the server REJECTING this write (unknown entity,
            // schema violation) — retrying byte-identical data will never
            // succeed. Left unbounded it re-sent every 2s forever, so one bad op
            // turned a client into a permanent load generator. Give it a few
            // attempts in case it was incidental, then drop it and move on.
            const attempts = (failures.get(key) ?? 0) + 1;
            if (attempts >= MAX_OP_ATTEMPTS) {
              failures.delete(key);
              if (pending.get(key) === sent.get(key)) pending.delete(key);
              console.warn(`[sync] dropping op after ${attempts} rejections: ${key} — ${r.message ?? "no detail"}`);
              set((state) => ({
                rejected: [...state.rejected, { entity: r.entity, id: r.id, message: r.message }],
              }));
            } else {
              failures.set(key, attempts);
            }
            continue;
          }
          failures.delete(key);
          if (pending.get(key) === sent.get(key)) pending.delete(key);
        }
        await persistOutbox();
        pushBackoff = 0; // the round-trip worked; drop back to fast retries
        set({
          pendingCount: pending.size,
          status: pending.size ? "queued" : "idle",
        });
      } catch {
        pushBackoff += 1;
        set({ status: pending.size ? "queued" : "offline" });
      } finally {
        flushing = false;
        // Only self-reschedule while we believe we're online; offline, the
        // reconnect handler owns restarting the drain. Otherwise a device in
        // airplane mode wakes up every couple of seconds to fail.
        if (pending.size && !isOffline()) {
          if (flushTimer) clearTimeout(flushTimer);
          // A backlog larger than one chunk isn't a failure, it's a queue —
          // continue straight away rather than serving the retry delay, which
          // exists to back off from errors. Waiting 2s per chunk would make a
          // long offline stretch take minutes to drain for no reason.
          const moreChunksReady = pushBackoff === 0 && pending.size > 0;
          flushTimer = setTimeout(
            () => void get().flush(),
            moreChunksReady ? 0 : retryDelay(),
          );
        }
      }
    },
  };
});
