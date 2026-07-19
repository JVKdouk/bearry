/**
 * Ingestion — the single trust boundary between plugins and platform data.
 *
 * Plugins hand the platform validated canonical blocks; THIS module is the only
 * place that turns a block into a real entity (EventBlock → CalendarEvent,
 * TaskBlock → Todo, NoteBlock → Note), encrypting sensitive fields under the
 * user DEK and deduping via the ImportedItem map so a re-sync updates instead of
 * duplicating. Because every provider funnels through here, the mapping from
 * "external world" to "our world" is auditable in one file.
 */

import { createHash } from "node:crypto";
import database from "@/core/database";
import { encryptRecord } from "@/src/lib/crypto/fieldCrypto";
import type { CanonicalBlock } from "./schema/blocks";

export type IngestSummary = {
  created: number;
  updated: number;
  skipped: number;
  byType: Record<string, number>;
};

function hashBlock(block: CanonicalBlock): string {
  return createHash("sha256").update(JSON.stringify(block)).digest("hex");
}

/**
 * Build the (plaintext) row for a canonical block; the caller encrypts and
 * writes it.
 *
 * There used to be a model-name lookup and a delegate switch here, because the
 * three types went to three tables with three different names for the body and
 * two for the time. All that indirection existed to answer a question that no
 * longer has more than one answer.
 */
function toEntityData(block: CanonicalBlock, providerId: string): Record<string, unknown> {
  const source = providerId === "google-calendar" || providerId === "google-tasks"
    ? "google"
    : providerId === "ticktick"
      ? "ticktick"
      : "local";

  switch (block.type) {
    case "event":
      return {
        kind: "event",
        source,
        title: block.title,
        body: block.description ?? null,
        location: block.location ?? null,
        startTime: new Date(block.start),
        endTime: new Date(block.end),
        estimatedDuration: Math.max(
          1,
          Math.round((new Date(block.end).getTime() - new Date(block.start).getTime()) / 60_000),
        ),
        // External calendar events render as fixed/protected (§9.3).
        isFixed: true,
        recurrenceRule: block.recurrenceRule ?? null,
      };
    case "task":
      return {
        kind: "task",
        source,
        title: block.title,
        body: block.notes ?? null,
        deadline: block.due ? new Date(block.due) : null,
        priority: block.priority ?? "medium",
        status: block.status ?? "todo",
        estimatedDuration: block.estimatedDuration ?? 30,
        recurrenceRule: block.recurrenceRule ?? null,
      };
    case "note":
      return { kind: "note", source, title: block.title, body: block.body };
  }
}

/**
 * Ingest validated blocks for a user. `dek` is the user's key (fetched once by
 * the caller through the decrypt guard). Idempotent per
 * (provider, account, sourceId) — `accountKey` is part of the key so two
 * connected accounts that see the SAME external item (e.g. both invited to one
 * Google event) each keep their own mapping instead of fighting over it.
 */
export async function ingestBlocks(
  userId: string,
  providerId: string,
  accountKey: string,
  blocks: CanonicalBlock[],
  dek: Buffer,
): Promise<IngestSummary> {
  const summary: IngestSummary = { created: 0, updated: 0, skipped: 0, byType: {} };

  // Load every existing mapping for this batch in ONE query instead of one per
  // block. A first Google/ICS sync is routinely hundreds or thousands of events,
  // and the per-block lookup made import cost a round-trip per item — the single
  // slowest thing a new user does. Keyed by sourceId, which is unique within
  // (user, provider, account).
  const sourceIds = [...new Set(blocks.map((b) => b.sourceId))];
  const existingRows = sourceIds.length > 0
    ? await database.importedItem.findMany({
        where: { userId, providerId, accountKey, sourceId: { in: sourceIds } },
      })
    : [];
  const existingBySourceId = new Map(existingRows.map((r) => [r.sourceId, r]));

  // The "unchanged" fast path still has to confirm the entity wasn't deleted
  // platform-side. Resolve that for the whole batch up front — one query per
  // entity model (at most three) rather than one per unchanged block, which is
  // the common case on every re-sync after the first.
  const liveEntityIds = new Set<string>();
  const candidateIds: string[] = [];
  for (const block of blocks) {
    const existing = existingBySourceId.get(block.sourceId);
    if (!existing || existing.contentHash !== hashBlock(block)) continue;
    candidateIds.push(existing.entityId);
  }
  if (candidateIds.length > 0) {
    const rows = await database.block.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true },
    });
    for (const r of rows) liveEntityIds.add(r.id);
  }

  for (const block of blocks) {
    const hash = hashBlock(block);
    summary.byType[block.type] = (summary.byType[block.type] ?? 0) + 1;

    const existing = existingBySourceId.get(block.sourceId) ?? null;

    // Unchanged since last import — but only skip if the entity still exists.
    // If it was deleted platform-side (e.g. the user cleared a first import,
    // then narrowed the project selection and re-synced), fall through and
    // recreate it, so the selection actually takes effect instead of the
    // re-sync being a silent no-op.
    const unchanged = existing?.contentHash === hash && liveEntityIds.has(existing.entityId);
    if (unchanged) {
      summary.skipped += 1;
      continue;
    }

    const data = encryptRecord("Block", userId, dek, toEntityData(block, providerId));

    if (existing) {
      // Update the previously-ingested entity in place. On failure the entity
      // was deleted platform-side, so recreate it and re-point the mapping.
      // Each branch writes the mapping exactly once — the previous version
      // issued a second, redundant update after the recreate had already
      // written entityId + contentHash.
      try {
        // Fields the user edited by hand are theirs now — the importer stops
        // overwriting them. Without this, editing an imported event is a lie:
        // the change saves, looks applied, and silently reverts on the next
        // sync. Everything untouched still tracks the source calendar.
        const writable = await withoutPinnedFields(existing.entityId, data);
        await database.block.update({ where: { id: existing.entityId }, data: writable });
        await database.importedItem.update({ where: { id: existing.id }, data: { contentHash: hash } });
      } catch {
        const recreated = await database.block.create({ data: { ...data, userId } as never, select: { id: true } });
        await database.importedItem.update({
          where: { id: existing.id },
          data: { entityId: recreated.id, contentHash: hash },
        });
      }
      summary.updated += 1;
    } else {
      const created = await database.block.create({ data: { ...data, userId } as never, select: { id: true } });
      await database.importedItem.create({
        data: {
          userId,
          providerId,
          accountKey,
          sourceId: block.sourceId,
          blockType: block.type,
          // Everything imported is a block now; `blockType` above still
          // records which kind it came in as.
          entityType: "Block",
          entityId: created.id,
          contentHash: hash,
        },
      });
      summary.created += 1;
    }
  }

  return summary;
}

/**
 * Drop any field the user has pinned on this block.
 *
 * Pins used to be an events-only idea because events were the only thing you
 * could both edit and have re-imported. That was never a property of events —
 * it was a property of imported things — and imported tasks and notes had the
 * same problem with no way to express it. Now they all can.
 */
async function withoutPinnedFields(
  entityId: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const row = await database.block.findUnique({
    where: { id: entityId },
    select: { pinnedFields: true },
  });
  const pinned = (row?.pinnedFields ?? "").split(",").map((f) => f.trim()).filter(Boolean);
  if (pinned.length === 0) return data;

  const out = { ...data };
  for (const field of pinned) delete out[field];
  return out;
}


