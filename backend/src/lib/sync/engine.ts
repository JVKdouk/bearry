/**
 * Server-authoritative delta sync (§ Phase 2, item 8; §3 sync engine).
 *
 * Pull: every row for the user changed since the client's cursor, decrypted,
 * including tombstones (soft-deleted rows) so deletes propagate. Push: apply the
 * client's create/update/delete ops with last-writer-wins on `updatedAt`, the
 * server bumping `version` and staying authoritative on the merge.
 */

import database from "@/core/database";
import { jobCrypto, type RequestCrypto } from "@/src/lib/crypto/requestCrypto";
import { resolveAccess } from "@/src/lib/sharing/access";
import { authorizeBlockWrite } from "@/src/lib/sharing/writeAuthz";
import { nextAfter } from "@/src/lib/recurrence/rrule";
import { SYNCABLES, findSyncable, type SyncableEntity } from "./registry";
import { needsFullResync } from "./tombstones";
import { predatesSchemaEpoch } from "./epoch";

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
  // Two independent reasons to distrust a cursor: it may have missed a pruned
  // deletion, or it may predate the entity layout itself (todo/calendarEvent/
  // note became block). Either way the only correct answer is a bootstrap.
  const mustReset = needsFullResync(since, now) || predatesSchemaEpoch(since);
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

  // Shared lists: rows the user can reach through membership rather than
  // ownership. They live under other users' keys, so they're pulled and
  // decrypted separately, then merged into the same entity buckets — the client
  // can't tell a shared block from a personal one, and shouldn't have to.
  const shared = await sharedChanges(userId, since);
  for (const [entity, rows] of Object.entries(shared.changes)) {
    changes[entity] = [...(changes[entity] ?? []), ...rows];
  }
  if (shared.nextCursor) {
    hasMore = true;
    if (shared.nextCursor < cursor) cursor = shared.nextCursor;
  }

  return { cursor: cursor.toISOString(), changes, hasMore, ...(mustReset ? { reset: true as const } : {}) };
}

/**
 * Everything a user can see because a list was shared with them (or they shared
 * one and can see its roster), decrypted under the relevant owner's key.
 *
 * Kept separate from the ownership-scoped loop above because the access rules
 * and the key-per-owner decryption have nothing to do with "rows where userId =
 * me". Bounded by the same page limit so one enormous shared board can't blow
 * the response.
 */
async function sharedChanges(
  userId: string,
  since: Date | null,
): Promise<{ changes: Record<string, unknown[]>; nextCursor: Date | null }> {
  const access = await resolveAccess(userId);
  const memberIds = [...access.member.keys()];
  const ownedIds = [...access.owned];
  const changes: Record<string, unknown[]> = {};
  let nextCursor: Date | null = null;
  const bump = (c: Date | null) => {
    if (c && (!nextCursor || c < nextCursor)) nextCursor = c;
  };
  const sinceWhere = since ? { updatedAt: { gt: since } } : {};

  // A crypto context per owner, resolved lazily. Decrypting another user's rows
  // legitimately touches their key — the decrypt limiter counts distinct users,
  // and a person in a handful of shared lists is well inside its ceiling.
  const cryptos = new Map<string, RequestCrypto>();
  const cryptoFor = async (ownerId: string): Promise<RequestCrypto> => {
    let c = cryptos.get(ownerId);
    if (!c) {
      c = await jobCrypto(ownerId, `job:shared-pull:${userId}`, PAGE_LIMIT);
      cryptos.set(ownerId, c);
    }
    return c;
  };

  // Decrypt a batch of rows that may span several owners, grouping by each
  // row's userId so every row opens under the key it was sealed with.
  const decryptByOwner = async (model: string, rows: { userId: string }[]): Promise<unknown[]> => {
    const byOwner = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const list = byOwner.get(row.userId) ?? [];
      list.push(row as Record<string, unknown>);
      byOwner.set(row.userId, list);
    }
    const out: unknown[] = [];
    for (const [ownerId, group] of byOwner) {
      const c = await cryptoFor(ownerId);
      out.push(...c.decryptMany(model, group));
    }
    return out;
  };

  // Shared projects (I'm a member of, owned by others).
  if (memberIds.length > 0) {
    const projects = await database.project.findMany({
      where: { id: { in: memberIds }, ...sinceWhere },
      orderBy: { updatedAt: "asc" },
      take: PAGE_LIMIT + 1,
    });
    bump(pageCursor(projects));
    changes.project = await decryptByOwner("Project", capPage(projects) as { userId: string }[]);

    const blocks = await database.block.findMany({
      where: { projectId: { in: memberIds }, ...sinceWhere },
      orderBy: { updatedAt: "asc" },
      take: PAGE_LIMIT + 1,
    });
    bump(pageCursor(blocks));
    const blockPage = capPage(blocks);
    changes.block = await decryptByOwner("Block", blockPage as { userId: string }[]);

    // Steps of shared blocks. Scoped by blockId so a member only gets steps for
    // blocks they can already see.
    const blockIds = blockPage.map((b) => (b as { id: string }).id);
    if (blockIds.length > 0) {
      const steps = await database.taskStep.findMany({
        where: { blockId: { in: blockIds }, ...sinceWhere },
        orderBy: { updatedAt: "asc" },
        take: PAGE_LIMIT + 1,
      });
      bump(pageCursor(steps));
      changes.taskStep = await decryptByOwner("TaskStep", capPage(steps) as { userId: string }[]);
    }
  }

  // Rosters: membership rows for lists I'm in (co-members) and lists I own
  // (everyone I let in). Cleartext, so no decryption. The union is deduped by
  // id on the client's merge.
  const rosterProjectIds = [...new Set([...memberIds, ...ownedIds])];
  if (rosterProjectIds.length > 0) {
    const memberRows = await database.projectMember.findMany({
      where: { projectId: { in: rosterProjectIds }, ...sinceWhere },
      orderBy: { updatedAt: "asc" },
      take: PAGE_LIMIT + 1,
    });
    bump(pageCursor(memberRows));
    changes.projectMember = [
      ...(changes.projectMember ?? []),
      ...capPage(memberRows),
    ];
  }

  return { changes, nextCursor };
}

/** The cursor a capped page implies, or null when the page wasn't full. */
function pageCursor(rows: { updatedAt: Date }[]): Date | null {
  if (rows.length <= PAGE_LIMIT) return null;
  return rows[PAGE_LIMIT - 1].updatedAt;
}

/** The rows to actually return from a possibly-over-full page. */
function capPage<T>(rows: T[]): T[] {
  return rows.length > PAGE_LIMIT ? rows.slice(0, PAGE_LIMIT) : rows;
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

/**
 * Should completing this op roll a recurring task forward instead of closing it?
 *
 * A pure gate, extracted because the bug it now guards was invisible: the
 * entity was renamed from "todo" to "block" in the migration and this
 * comparison wasn't, so every recurring task silently stopped advancing on
 * completion and no test noticed. Only blocks recur, and only on being marked
 * done.
 */
export function shouldAdvanceRecurrence(entity: string, status: unknown): boolean {
  return entity === "block" && status === "done";
}

/**
 * Resolve who owns the write and under whose key it's stored.
 *
 * For blocks and their steps this consults the membership rules — a member's
 * edit to a shared list is stored under the *owner*, so it decrypts under one
 * key whoever wrote it. For everything else the actor owns their own row, as
 * before. Returns the owner id and the crypto bound to that owner, or a refusal
 * a member isn't allowed to make (a view member editing, a cross-owner move).
 */
async function resolveWrite(
  ctx: PushContext,
  entity: string,
  op: PushOp,
): Promise<{ ownerId: string; crypto: RequestCrypto } | { error: string }> {
  const accessView = {
    // Ownership from the fresh per-project lookup as well as the request-start
    // snapshot: a list created earlier in this same push batch isn't in the
    // snapshot yet, but its owner row exists in the DB, and the owner creating a
    // list and its first task in one batch must not be refused on the task.
    owns: (id: string) => ctx.access.owned.has(id) || ctx.ownerCache.get(id) === ctx.actor,
    roleOn: (id: string) => ctx.access.member.get(id),
  };

  if (entity === "block") {
    const existing = op.id
      ? await database.block.findUnique({
          where: { id: op.id },
          select: { userId: true, projectId: true },
        })
      : null;
    const data = op.data ?? {};
    const nextProjectId =
      op.op === "delete"
        ? undefined
        : ("projectId" in data ? (data.projectId as string | null) : existing ? undefined : null);

    // authorizeBlockWrite is pure and looks owners up synchronously, so prime
    // the cache for every project it might ask about first.
    if (existing?.projectId) await ownerOfProject(ctx, existing.projectId);
    if (typeof nextProjectId === "string") await ownerOfProject(ctx, nextProjectId);

    const decision = authorizeBlockWrite(
      ctx.actor,
      accessView,
      existing,
      nextProjectId,
      (pid) => ctx.ownerCache.get(pid) ?? null,
    );
    if (!decision.allowed) return { error: decision.reason };
    return { ownerId: decision.ownerId, crypto: await cryptoForOwner(ctx, decision.ownerId) };
  }

  if (entity === "taskStep") {
    // A step's owner is its block's owner; write access follows the block.
    let blockId = op.data?.blockId as string | undefined;
    if (!blockId && op.id) {
      const step = await database.taskStep.findUnique({
        where: { id: op.id },
        select: { blockId: true },
      });
      blockId = step?.blockId;
    }
    if (!blockId) return { error: "step has no block" };
    const block = await database.block.findUnique({
      where: { id: blockId },
      select: { userId: true, projectId: true },
    });
    if (!block) return { error: "step's block not found" };

    const canWrite =
      block.userId === ctx.actor ||
      (block.projectId !== null && ctx.access.owned.has(block.projectId)) ||
      (block.projectId !== null && ctx.access.member.get(block.projectId) === "write");
    if (!canWrite) return { error: "no write access to this task" };
    return { ownerId: block.userId, crypto: await cryptoForOwner(ctx, block.userId) };
  }

  return { ownerId: ctx.actor, crypto: ctx.actorCrypto };
}

/** Apply one client op with LWW conflict resolution. */
async function applyOp(ctx: PushContext, op: PushOp): Promise<PushOpResult> {
  const s = findSyncable(op.entity);
  if (!s) return { entity: op.entity, id: op.id ?? "", status: "error", message: "unknown entity" };

  try {
    // Who owns this write, under whose key, and may the actor make it at all.
    const resolved = await resolveWrite(ctx, op.entity, op);
    if ("error" in resolved) {
      return { entity: op.entity, id: op.id ?? "", status: "error", message: resolved.error };
    }
    const { ownerId, crypto } = resolved;

    if (op.op === "delete") {
      if (!op.id) return { entity: op.entity, id: "", status: "error", message: "delete needs id" };
      // Scoped by ownerId, not the actor: a member deleting a shared task acts
      // on the owner's row. resolveWrite already authorised it.
      const existing = await s.delegate.findFirst({
        where: { id: op.id, userId: ownerId },
        select: { version: true },
      });
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
    if (op.id && shouldAdvanceRecurrence(s.entity, writable.status)) {
      const advanced = await advanceRecurrence(ownerId, op.id, writable);
      if (advanced) writable = advanced;
    }

    const encrypted = crypto.encrypt(s.model, writable);

    if (op.id) {
      const existing = await s.delegate.findFirst({
        where: { id: op.id, userId: ownerId },
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
      // Client-generated id that doesn't exist yet → create with that id. On a
      // shared block, tag the actual author so "added by" survives being stored
      // under the owner.
      const created = await s.delegate.create({
        data: { ...encrypted, id: op.id, userId: ownerId, ...authorship(s.entity, ctx.actor, ownerId) },
        select: { id: true, version: true },
      });
      return { entity: op.entity, id: created.id, status: "applied", version: created.version };
    }

    const created = await s.delegate.create({
      data: { ...encrypted, userId: ownerId, ...authorship(s.entity, ctx.actor, ownerId) },
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

/** `createdById` for a block authored by someone other than its owner. */
function authorship(entity: string, actor: string, ownerId: string): Record<string, unknown> {
  if (entity !== "block" || actor === ownerId) return {};
  return { createdById: actor };
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
  const row = await database.block.findFirst({
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

  // The reminders move with it. The server is what advanced this task, so the
  // server has to carry its reminders forward too — otherwise the next
  // occurrence inherits reminders pointing at the previous one's time, already
  // marked delivered, and silently never fires again.
  await shiftReminders(userId, todoId, anchor, next);

  return out;
}

/**
 * Re-point a task's reminders after its occurrence moved.
 *
 * Each keeps its own lead time (an hour before stays an hour before), and
 * `delivered` resets so the new occurrence actually notifies. Reminders whose
 * new moment is already past are left delivered rather than firing immediately
 * on a task that just rolled forward.
 */
async function shiftReminders(
  userId: string,
  todoId: string,
  from: Date,
  to: Date,
): Promise<void> {
  const reminders = await database.reminder.findMany({
    where: { userId, targetType: "block", targetId: todoId, deletedAt: null },
    select: { id: true, offsetMinutes: true },
  });
  if (reminders.length === 0) return;

  const now = Date.now();
  await Promise.all(
    reminders.map((r) => {
      const fireAt = new Date(to.getTime() - r.offsetMinutes * 60_000);
      return database.reminder.update({
        where: { id: r.id },
        data: { fireAt, delivered: fireAt.getTime() <= now },
      });
    }),
  );
}

/**
 * Everything a push needs to know about sharing, resolved once per request.
 *
 * Membership and project owners are read once and cached, and each owner's
 * crypto context is built lazily. Without this a bulk push of many ops into a
 * shared list would re-query access and re-unwrap the owner's key per op.
 */
export interface PushContext {
  actor: string;
  access: import("@/src/lib/sharing/access").Access;
  /** The actor's own crypto; the fallback for personal content. */
  actorCrypto: RequestCrypto;
  /** owner userId -> crypto bound to that owner's key. */
  cryptoCache: Map<string, RequestCrypto>;
  /** projectId -> owner userId, cached. */
  ownerCache: Map<string, string | null>;
}

async function cryptoForOwner(ctx: PushContext, ownerId: string): Promise<RequestCrypto> {
  if (ownerId === ctx.actor) return ctx.actorCrypto;
  let c = ctx.cryptoCache.get(ownerId);
  if (!c) {
    c = await jobCrypto(ownerId, `job:shared-push:${ctx.actor}`, 100);
    ctx.cryptoCache.set(ownerId, c);
  }
  return c;
}

async function ownerOfProject(ctx: PushContext, projectId: string): Promise<string | null> {
  if (ctx.ownerCache.has(projectId)) return ctx.ownerCache.get(projectId)!;
  const row = await database.project.findUnique({
    where: { id: projectId },
    select: { userId: true },
  });
  const owner = row?.userId ?? null;
  ctx.ownerCache.set(projectId, owner);
  return owner;
}

/** Apply a batch of client ops; returns a per-op result the client reconciles. */
export async function push(
  userId: string,
  crypto: RequestCrypto,
  ops: PushOp[],
): Promise<PushOpResult[]> {
  const ctx: PushContext = {
    actor: userId,
    access: await resolveAccess(userId),
    actorCrypto: crypto,
    cryptoCache: new Map(),
    ownerCache: new Map(),
  };
  const results: PushOpResult[] = [];
  for (const op of ops) results.push(await applyOp(ctx, op));
  return results;
}
