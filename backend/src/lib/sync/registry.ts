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
    writable: ["name", "color", "icon", "order", "archived"],
  },
  {
    entity: "block",
    model: "Block",
    delegate: database.block,
    // One entity where there were three. `kind` is client-writable because
    // converting a task into a note or an event is now exactly that write —
    // no delete, no re-insert, no re-pointing of steps and reminders.
    //
    // `pinnedFields` is client-writable on purpose: editing an imported
    // event's title is the act that pins it, and the client is what knows the
    // user did that. It names fields, never content, so a bad value can at
    // worst stop the importer updating a field — never leak or corrupt one.
    //
    // `legacyAadModel` is deliberately absent. It says which key a row's
    // ciphertext is sealed under; a client that could set it could make the
    // server try to open content under the wrong AAD.
    writable: [
      "kind", "projectId", "parentId", "title", "body", "location",
      "status", "priority", "deadline", "startTime", "endTime", "category",
      "estimatedDuration", "energyDemand", "desire", "chunkable", "minChunk",
      "maxChunk", "recurrenceRule", "preferredWindows", "letGoAt", "order",
      "source", "externalId", "pinnedFields", "isFixed", "planForId",
      "scheduleReason",
    ],
  },
  {
    entity: "taskStep",
    model: "TaskStep",
    delegate: database.taskStep,
    writable: ["blockId", "text", "order", "isFirstStep", "done"],
  },
  {
    entity: "link",
    model: "Link",
    delegate: database.link,
    writable: ["fromType", "fromId", "toType", "toId", "linkType"],
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
    entity: "reminder",
    model: "Reminder",
    delegate: database.reminder,
    // `delivered` is deliberately absent: the server owns it, and letting a
    // client reset it would let a device replay every notification it ever
    // received. `fireAt` IS writable because the client computes it from the
    // task's time and the chosen offset, offline, like everything else here.
    writable: ["targetType", "targetId", "kind", "triggerSpec", "fireAt", "offsetMinutes"],
  },
  {
    entity: "setting",
    model: "Setting",
    delegate: database.setting,
    writable: ["key", "value"],
  },
  {
    // Read-only from the client's side: memberships are created and changed
    // through the sharing endpoints, never pushed. An empty writable list means
    // any client attempt to write one is refused, which is what we want — a
    // client can't grant itself a role by faking a row.
    entity: "projectMember",
    model: "ProjectMember",
    delegate: database.projectMember,
    writable: [],
  },
];

export function findSyncable(entity: string): SyncableEntity | undefined {
  return SYNCABLES.find((s) => s.entity === entity);
}
