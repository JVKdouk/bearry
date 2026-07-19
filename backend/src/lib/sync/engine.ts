/**
 * Server-authoritative delta sync (§ Phase 2, item 8; §3 sync engine).
 *
 * Pull: every row for the user changed since the client's cursor, decrypted,
 * including tombstones (soft-deleted rows) so deletes propagate. Push: apply the
 * client's create/update/delete ops with last-writer-wins on `updatedAt`, the
 * server bumping `version` and staying authoritative on the merge.
 */

import database from "@/core/database";
import type { RequestCrypto } from "@/src/lib/crypto/requestCrypto";
import { nextAfter } from "@/src/lib/recurrence/rrule";
import { SYNCABLES, findSyncable, type SyncableEntity } from "./registry";
import { needsFullResync } from "./tombstones";

export type PullResult = {
  /** New cursor the client stores and sends next time. */
  cursor: string;
  /** Changed rows grouped by entity (decrypted; tombstones have deletedAt set). */
  changes: Record<string, unknown[]>;
  /** True when the page was capped — the client should pull again immediately. */
  hasMore: boolean;
  /**
   * The client's cursor predates tombstone retention, so deletions it never saw
   * may already have been pruned. It must discard local state and take this
   * response as a fresh bootstrap; continuing from its own cursor would leave
   * deleted rows resurrectable. See lib/sync/tombstones.ts.
   */
  reset?: true;
};

/**
 * Maximum rows returned per entity in one pull. A bootstrap used to be
 * unbounded: every row the user has ever created, across ten tables, decrypted
 * and serialized into a single JSON response. For a long-time user that is a
 * multi-megabyte response and a decrypt burst; on a phone it is also a spike of
 * memory the tab may not survive. Paging keeps any one response bounded.
 */
const PAGE_LIMIT = Number(process.env.SYNC_PAGE_LIMIT ?? 2000);

/**
 * Return what the user changed since `since` (null = full bootstrap).
 *
 * When a page is capped, `cursor` advances only as far as the data actually
 * returned and `hasMore` is set, so the client resumes exactly where it stopped
 * instead of skipping the remainder.
 */
export async function pull(
  userId: string,
  crypto: RequestCrypto,
  since: Date | null,
): Promise<PullResult> {
  const now = new Date();
  const changes: Record<string, unknown[]> = {};

  // A cursor older than tombstone retention can't be trusted to have seen every
  // deletion, so serve a full bootstrap instead of a delta and tell the client
  // to throw away what it has. Downgrading to a full pull here is what makes
  // pruning safe at all.
  const mustReset = needsFullResync(since, now);
  if (mustReset) since = null;

  // Fetch every entity's delta concurrently rather than serially — a full
  // bootstrap touches ~10 tables and these are independent reads.
  const results = await Promise.all(
    SYNCABLES.map(async (s) => {
      const where = since ? { userId, updatedAt: { gt: since } } : { userId };
      // One extra row tells us whether more exist without a second count query.
      const rows = (await s.delegate.findMany({
        where,
        orderBy: { updatedAt: "asc" },
        take: PAGE_LIMIT + 1,
      })) as { updatedAt: Date }[];

      if (rows.length <= PAGE_LIMIT) {
        return { entity: s.entity, model: s.model, rows, nextCursor: null as Date | null };
      }

      // Truncate on a timestamp boundary. Cutting mid-timestamp would strand
      // every row sharing that millisecond, because the next pull asks for
      // `updatedAt > cursor` and would step straight over them.
      const page = rows.slice(0, PAGE_LIMIT);
      // Non-empty by construction: we only get here when rows exceeded the
      // page limit, so the page is exactly PAGE_LIMIT rows.
      const boundary = page.at(-1)!.updatedAt.getTime();
      let cut = page.length;
      while (cut > 0 && page[cut - 1].updatedAt.getTime() === boundary) cut -= 1;

      // Degenerate case: the entire page shares one timestamp. Trimming would
      // return nothing and loop forever, so keep the page and accept that the
      // next pull may re-send those rows (the merge is idempotent).
      const kept = cut === 0 ? page : page.slice(0, cut);
      const nextCursor = kept.at(-1)!.updatedAt; // `kept` is page, or a slice of >= 1
      return { entity: s.entity, model: s.model, rows: kept, nextCursor };
    }),
  );

  // The shared cursor can only advance as far as the *least* complete entity,
  // otherwise a capped table's remainder is skipped.
  let cursor = now;
  let hasMore = false;
  for (const r of results) {
    if (r.nextCursor) {
      hasMore = true;
      if (r.nextCursor < cursor) cursor = r.nextCursor;
    }
  }

  for (const r of results) {
    changes[r.entity] = crypto.decryptMany(r.model, r.rows as Record<string, unknown>[]);
  }

  return { cursor: cursor.toISOString(), changes, hasMore, ...(mustReset ? { reset: true as const } : {}) };
}

export type PushOp = {
  entity: string;
  op: "upsert" | "delete";
  id?: string;
  /** Client's last-known updatedAt for the row (drives LWW). */
  clientUpdatedAt?: string;
  data?: Record<string, unknown>;
};

export type PushOpResult = {
  entity: string;
  id: string;
  status: "applied" | "skipped_stale" | "error";
  version?: number;
  message?: string;
};

function pickWritable(s: SyncableEntity, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of s.writable) if (k in data) out[k] = data[k];
  return out;
}

/** Apply one client op with LWW conflict resolution. */
async function applyOp(
  userId: string,
  crypto: RequestCrypto,
  op: PushOp,
): Promise<PushOpResult> {
  const s = findSyncable(op.entity);
  if (!s) return { entity: op.entity, id: op.id ?? "", status: "error", message: "unknown entity" };

  try {
    if (op.op === "delete") {
      if (!op.id) return { entity: op.entity, id: "", status: "error", message: "delete needs id" };
      const existing = await s.delegate.findFirst({ where: { id: op.id, userId } });
      if (!existing) return { entity: op.entity, id: op.id, status: "applied" }; // already gone
      const updated = await s.delegate.update({
        where: { id: op.id },
        data: { deletedAt: new Date(), version: (existing.version ?? 1) + 1 },
        select: { version: true },
      });
      return { entity: op.entity, id: op.id, status: "applied", version: updated.version };
    }

    let writable = pickWritable(s, op.data ?? {});

    // Completing a repeating task advances the series instead of ending it.
    //
    // This lives server-side deliberately: it's the one place that always runs,
    // whatever client you used, and it keeps the date maths in a single tested
    // implementation rather than duplicating an RRULE engine into the browser.
    // Offline you'll briefly see the task as done, then it reappears on its next
    // date once the write syncs — which is exactly what happened: that
    // occurrence *was* completed, and the series continues.
    if (s.entity === "todo" && op.id && writable.status === "done") {
      const advanced = await advanceRecurrence(userId, op.id, writable);
      if (advanced) writable = advanced;
    }

    const encrypted = crypto.encrypt(s.model, writable);

    if (op.id) {
      const existing = await s.delegate.findFirst({
        where: { id: op.id, userId },
        select: { version: true, updatedAt: true },
      });
      if (existing) {
        // Last-writer-wins: reject a client update older than the server's row.
        if (op.clientUpdatedAt && new Date(op.clientUpdatedAt) < existing.updatedAt) {
          return { entity: op.entity, id: op.id, status: "skipped_stale", version: existing.version };
        }
        const updated = await s.delegate.update({
          where: { id: op.id },
          data: { ...encrypted, version: (existing.version ?? 1) + 1, deletedAt: null },
          select: { version: true },
        });
        return { entity: op.entity, id: op.id, status: "applied", version: updated.version };
      }
      // Client-generated id that doesn't exist yet → create with that id.
      const created = await s.delegate.create({
        data: { ...encrypted, id: op.id, userId },
        select: { id: true, version: true },
      });
      return { entity: op.entity, id: created.id, status: "applied", version: created.version };
    }

    const created = await s.delegate.create({
      data: { ...encrypted, userId },
      select: { id: true, version: true },
    });
    return { entity: op.entity, id: created.id, status: "applied", version: created.version };
  } catch (err) {
    return {
      entity: op.entity,
      id: op.id ?? "",
      status: "error",
      message: err instanceof Error ? err.message : "unknown error",
    };
  }
}

/**
 * If this todo repeats, roll it to its next occurrence rather than closing it.
 *
 * Returns replacement fields, or null when the task doesn't repeat (or the
 * series has ended, in which case completing it really is the end).
 */
async function advanceRecurrence(
  userId: string,
  todoId: string,
  writable: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const row = await database.todo.findFirst({
    where: { id: todoId, userId },
    select: { recurrenceRule: true, deadline: true, startTime: true, endTime: true },
  });
  if (!row?.recurrenceRule) return null;

  // Anchor on whatever date the task currently carries; without one there's no
  // series to walk, so treat it as a plain task.
  const anchor = row.startTime ?? row.deadline;
  if (!anchor) return null;

  const next = nextAfter(row.recurrenceRule, anchor, anchor);
  if (!next) return null; // unsupported rule, or the series is over

  const out: Record<string, unknown> = { ...writable, status: "todo" };
  if (row.startTime && row.endTime) {
    const durationMs = row.endTime.getTime() - row.startTime.getTime();
    out.startTime = next;
    out.endTime = new Date(next.getTime() + durationMs);
    if (row.deadline) out.deadline = next;
  } else {
    out.deadline = next;
  }
  return out;
}

/** Apply a batch of client ops; returns a per-op result the client reconciles. */
export async function push(
  userId: string,
  crypto: RequestCrypto,
  ops: PushOp[],
): Promise<PushOpResult[]> {
  const results: PushOpResult[] = [];
  for (const op of ops) results.push(await applyOp(userId, crypto, op));
  return results;
}
