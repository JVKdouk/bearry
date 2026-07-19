/** Shared shape for a todo returned to the client (decrypted). */
export function serializeTodo(t: Record<string, unknown>) {
  return {
    id: t.id,
    projectId: t.projectId,
    parentTodoId: t.parentTodoId,
    title: t.title,
    notes: t.notes ?? null,
    status: t.status,
    priority: t.priority,
    deadline: t.deadline,
    estimatedDuration: t.estimatedDuration,
    energyDemand: t.energyDemand,
    chunkable: t.chunkable,
    minChunk: t.minChunk ?? null,
    maxChunk: t.maxChunk ?? null,
    recurrenceRule: t.recurrenceRule ?? null,
    preferredWindows: t.preferredWindows ?? null,
    letGoAt: t.letGoAt ?? null,
    order: t.order,
    updatedAt: t.updatedAt,
  };
}
