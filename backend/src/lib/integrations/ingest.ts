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

const ENTITY_FOR: Record<CanonicalBlock["type"], string> = {
  event: "CalendarEvent",
  task: "Todo",
  note: "Note",
};

/** Build the (plaintext) entity data for a block; caller encrypts + writes. */
function toEntityData(block: CanonicalBlock): Record<string, unknown> {
  switch (block.type) {
    case "event":
      return {
        source: "google", // external calendar events render as fixed/protected (§9.3)
        title: block.title,
        description: block.description ?? null,
        location: block.location ?? null,
        start: new Date(block.start),
        end: new Date(block.end),
        isFixed: true,
        recurrenceRule: block.recurrenceRule ?? null,
      };
    case "task":
      return {
        title: block.title,
        notes: block.notes ?? null,
        deadline: block.due ? new Date(block.due) : null,
        priority: block.priority ?? "medium",
        status: block.status ?? "todo",
        estimatedDuration: block.estimatedDuration ?? 30,
      };
    case "note":
      return { title: block.title, bodyMarkdown: block.body };
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
  const existingRows = sourceIds.length
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
  const idsByModel = new Map<string, string[]>();
  for (const block of blocks) {
    const existing = existingBySourceId.get(block.sourceId);
    if (!existing || existing.contentHash !== hashBlock(block)) continue;
    const model = ENTITY_FOR[block.type];
    const list = idsByModel.get(model) ?? [];
    list.push(existing.entityId);
    idsByModel.set(model, list);
  }
  await Promise.all(
    [...idsByModel].map(async ([model, ids]) => {
      const rows = await delegateFor(model).findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      for (const r of rows as { id: string }[]) liveEntityIds.add(r.id);
    }),
  );

  for (const block of blocks) {
    const model = ENTITY_FOR[block.type];
    const delegate = delegateFor(model);
    const hash = hashBlock(block);
    summary.byType[block.type] = (summary.byType[block.type] ?? 0) + 1;

    const existing = existingBySourceId.get(block.sourceId) ?? null;

    if (existing && existing.contentHash === hash) {
      // Unchanged since last import — but only skip if the entity still exists.
      // If it was deleted platform-side (e.g. the user cleared a first import,
      // then narrowed the project selection and re-synced), recreate it so the
      // selection actually takes effect instead of the re-sync being a no-op.
      if (liveEntityIds.has(existing.entityId)) { summary.skipped += 1; continue; }
    }

    const data = encryptRecord(model, userId, dek, toEntityData(block));

    if (existing) {
      // Update the previously-ingested entity in place. On failure the entity
      // was deleted platform-side, so recreate it and re-point the mapping.
      // Each branch writes the mapping exactly once — the previous version
      // issued a second, redundant update after the recreate had already
      // written entityId + contentHash.
      try {
        await delegate.update({ where: { id: existing.entityId }, data: { ...data } });
        await database.importedItem.update({ where: { id: existing.id }, data: { contentHash: hash } });
      } catch {
        const recreated = await delegate.create({ data: { ...data, userId }, select: { id: true } });
        await database.importedItem.update({
          where: { id: existing.id },
          data: { entityId: recreated.id, contentHash: hash },
        });
      }
      summary.updated += 1;
    } else {
      const created = await delegate.create({ data: { ...data, userId }, select: { id: true } });
      await database.importedItem.create({
        data: {
          userId,
          providerId,
          accountKey,
          sourceId: block.sourceId,
          blockType: block.type,
          entityType: model,
          entityId: created.id,
          contentHash: hash,
        },
      });
      summary.created += 1;
    }
  }

  return summary;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function delegateFor(model: string): any {
  if (model === "CalendarEvent") return database.calendarEvent;
  if (model === "Todo") return database.todo;
  if (model === "Note") return database.note;
  throw new Error(`No delegate for model ${model}`);
}
