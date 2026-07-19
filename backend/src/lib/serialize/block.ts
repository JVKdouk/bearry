/**
 * The shape a block takes on the wire (decrypted).
 *
 * One serializer where there were three. `serializeTodo` named the body
 * `notes`, the event endpoint called it `description`, and notes called it
 * `bodyMarkdown` — three names for the same field meant every consumer had to
 * know which kind it was holding before it could read the text.
 */
export function serializeBlock(b: Record<string, unknown>) {
  return {
    id: b.id,
    kind: b.kind,
    projectId: b.projectId ?? null,
    parentId: b.parentId ?? null,
    title: b.title,
    body: b.body ?? null,
    location: b.location ?? null,
    status: b.status,
    priority: b.priority,
    deadline: b.deadline ?? null,
    startTime: b.startTime ?? null,
    endTime: b.endTime ?? null,
    category: b.category ?? null,
    estimatedDuration: b.estimatedDuration,
    energyDemand: b.energyDemand,
    desire: b.desire,
    chunkable: b.chunkable ?? null,
    minChunk: b.minChunk ?? null,
    maxChunk: b.maxChunk ?? null,
    recurrenceRule: b.recurrenceRule ?? null,
    preferredWindows: b.preferredWindows ?? null,
    letGoAt: b.letGoAt ?? null,
    order: b.order,
    source: b.source,
    externalId: b.externalId ?? null,
    pinnedFields: b.pinnedFields ?? null,
    isFixed: b.isFixed,
    planForId: b.planForId ?? null,
    scheduleReason: b.scheduleReason ?? null,
    updatedAt: b.updatedAt,
    // `legacyAadModel` is intentionally never serialized: it describes how the
    // row is encrypted at rest, which is nobody's business but the server's.
  };
}
