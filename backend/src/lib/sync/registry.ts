/**
 * The set of models the mobile client syncs (§ Phase 2, item 8). Each entry maps
 * a client-facing entity name to its Prisma delegate and the model name the
 * crypto layer keys off. Encryption is transparent to the sync protocol — the
 * client only ever sees decrypted fields on pull and sends plaintext on push;
 * the wire is TLS and the at-rest columns are ciphertext.
 */

import database from "@/core/database";

export type SyncableEntity = {
  /** Client-facing name, also the SyncRecord.entityType. */
  entity: string;
  /** Model name for the field-crypto map. */
  model: string;
  /** Prisma delegate with the standard CRUD surface. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delegate: any;
  /** Fields a client is allowed to write (whitelist — ids/versions are server-set). */
  writable: readonly string[];
};

export const SYNCABLES: readonly SyncableEntity[] = [
  {
    entity: "project",
    model: "Project",
    delegate: database.project,
    writable: ["name", "color", "order", "archived"],
  },
  {
    entity: "todo",
    model: "Todo",
    delegate: database.todo,
    writable: [
      "projectId", "parentTodoId", "title", "notes", "status", "priority",
      "deadline", "startTime", "endTime", "category", "estimatedDuration",
      "energyDemand", "desire", "chunkable", "minChunk", "maxChunk", "recurrenceRule",
      "preferredWindows", "letGoAt", "order",
    ],
  },
  {
    entity: "note",
    model: "Note",
    delegate: database.note,
    writable: ["title", "bodyMarkdown"],
  },
  {
    entity: "taskStep",
    model: "TaskStep",
    delegate: database.taskStep,
    writable: ["todoId", "text", "order", "isFirstStep", "done"],
  },
  {
    entity: "link",
    model: "Link",
    delegate: database.link,
    writable: ["fromType", "fromId", "toType", "toId", "linkType"],
  },
  {
    entity: "calendarEvent",
    model: "CalendarEvent",
    delegate: database.calendarEvent,
    writable: ["source", "externalId", "title", "description", "location", "start", "end", "isFixed"],
  },
  {
    entity: "timeBlock",
    model: "TimeBlock",
    delegate: database.timeBlock,
    writable: ["label", "start", "end", "type", "recurrenceRule"],
  },
  {
    entity: "energyWindow",
    model: "EnergyWindow",
    delegate: database.energyWindow,
    writable: ["dayMask", "start", "end", "energyLevel", "source"],
  },
  {
    entity: "blockRegion",
    model: "BlockRegion",
    delegate: database.blockRegion,
    writable: ["label", "category", "dayMask", "start", "end"],
  },
  {
    entity: "setting",
    model: "Setting",
    delegate: database.setting,
    writable: ["key", "value"],
  },
];

export function findSyncable(entity: string): SyncableEntity | undefined {
  return SYNCABLES.find((s) => s.entity === entity);
}
