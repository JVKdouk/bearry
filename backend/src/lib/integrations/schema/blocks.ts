/**
 * Canonical "blocks" — the strict, versioned contract at the platform boundary
 * (§ integration plugin system).
 *
 * Every plugin, no matter what it talks to, must emit data as one of these
 * blocks. The platform validates each block against these schemas BEFORE it
 * touches any entity, so a misbehaving or third-party plugin can never write a
 * shape the rest of the app doesn't understand. Google Calendar → EventBlock;
 * Google Tasks / Todoist → TaskBlock; Notion → NoteBlock. Adding a new block
 * type is the only way to teach the platform a new kind of thing.
 *
 * Schemas are `.strict()` (unknown keys are rejected) and carry a `type`
 * discriminant so a mixed batch is unambiguous. `sourceId` is the plugin's
 * stable id for the item, used for idempotent re-import (see ingest.ts).
 */

import { z } from "zod";

/** Bump when a block's shape changes in a breaking way (for third-party plugins). */
export const BLOCK_SCHEMA_VERSION = 1;

const iso = z.string().datetime({ offset: true });

export const EventBlockSchema = z
  .object({
    type: z.literal("event"),
    sourceId: z.string().min(1).max(512),
    title: z.string().min(1).max(1000),
    start: iso,
    end: iso,
    allDay: z.boolean().default(false),
    location: z.string().max(1000).optional(),
    description: z.string().max(10_000).optional(),
    recurrenceRule: z.string().max(1000).optional(),
    url: z.string().url().max(2000).optional(),
  })
  .strict()
  .refine((e) => new Date(e.end) >= new Date(e.start), { message: "end must be on/after start" });

export const TaskBlockSchema = z
  .object({
    type: z.literal("task"),
    sourceId: z.string().min(1).max(512),
    title: z.string().min(1).max(1000),
    notes: z.string().max(10_000).optional(),
    due: iso.optional(),
    priority: z.enum(["ASAP", "high", "medium", "low"]).optional(),
    status: z.enum(["todo", "in_progress", "done"]).optional(),
    estimatedDuration: z.number().int().min(1).max(1440).optional(),
    url: z.string().url().max(2000).optional(),
  })
  .strict();

export const NoteBlockSchema = z
  .object({
    type: z.literal("note"),
    sourceId: z.string().min(1).max(512),
    title: z.string().min(1).max(1000),
    body: z.string().max(100_000),
    url: z.string().url().max(2000).optional(),
  })
  .strict();

/** The full set of block types the platform understands today. */
export const CanonicalBlockSchema = z.discriminatedUnion("type", [
  EventBlockSchema,
  TaskBlockSchema,
  NoteBlockSchema,
]);

export type EventBlock = z.infer<typeof EventBlockSchema>;
export type TaskBlock = z.infer<typeof TaskBlockSchema>;
export type NoteBlock = z.infer<typeof NoteBlockSchema>;
export type CanonicalBlock = z.infer<typeof CanonicalBlockSchema>;

export type BlockType = CanonicalBlock["type"];
export const BLOCK_TYPES: readonly BlockType[] = ["event", "task", "note"];

export type BlockValidationError = { index: number; sourceId?: string; message: string };

/**
 * Validate a raw batch from a plugin. Returns the blocks that passed and a list
 * of rejects (never throws) — the platform ingests the valid ones and surfaces
 * the rejects, so one bad row can't poison a whole sync.
 */
export function validateBlocks(raw: unknown[]): {
  valid: CanonicalBlock[];
  errors: BlockValidationError[];
} {
  const valid: CanonicalBlock[] = [];
  const errors: BlockValidationError[] = [];
  raw.forEach((item, index) => {
    const parsed = CanonicalBlockSchema.safeParse(item);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      const sourceId =
        item && typeof item === "object" && "sourceId" in item
          ? String((item as Record<string, unknown>).sourceId)
          : undefined;
      errors.push({ index, sourceId, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    }
  });
  return { valid, errors };
}

/** JSON Schema-ish export for third-party plugin docs (§ future). */
export function blockContract() {
  return {
    version: BLOCK_SCHEMA_VERSION,
    blockTypes: BLOCK_TYPES,
    fields: {
      event: ["sourceId", "title", "start", "end", "allDay", "location?", "description?", "recurrenceRule?", "url?"],
      task: ["sourceId", "title", "notes?", "due?", "priority?", "status?", "estimatedDuration?", "url?"],
      note: ["sourceId", "title", "body", "url?"],
    },
  };
}
