import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import GenericError from "@/core/server/errors/generic";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";
import { serializeTodo } from "@/src/lib/serialize/todo";

const Params = z.object({ id: z.string() });
const Body = z.object({
  title: z.string().min(1).max(500).optional(),
  notes: z.string().nullish(),
  projectId: z.string().nullish(),
  parentTodoId: z.string().nullish(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  priority: z.enum(["ASAP", "high", "medium", "low"]).optional(),
  deadline: z.string().datetime().nullish(),
  estimatedDuration: z.number().int().min(1).max(1440).optional(),
  energyDemand: z.enum(["high", "medium", "low"]).optional(),
  chunkable: z.boolean().optional(),
  order: z.number().optional(),
});

const ENC_KEYS = new Set(["title", "notes"]);

/** Patch a todo (complete, reprioritize, reparent, reschedule fields). */
const updateTodo: Endpoint = async (request) => {
  const { id } = Params.parse(request.params);
  const b = Body.parse(request.body);
  const crypto = await requestCrypto(request);

  const existing = await database.todo.findFirst({
    where: { id, userId: request.user.id, deletedAt: null },
    select: { version: true },
  });
  if (!existing) throw new GenericError("Todo not found", 404);

  // Build the plaintext patch, coercing dates, then encrypt sensitive fields.
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    if (k === "deadline") patch[k] = v ? new Date(v as string) : null;
    else patch[k] = v;
  }
  const hasEncrypted = Object.keys(patch).some((k) => ENC_KEYS.has(k));
  const data = hasEncrypted ? crypto.encrypt("Todo", patch) : patch;

  const updated = await database.todo.update({
    where: { id },
    data: { ...data, version: (existing.version ?? 1) + 1 },
  });

  return serializeTodo(crypto.decrypt("Todo", updated as Record<string, unknown>));
};

updateTodo.httpMethod = "PATCH";
updateTodo.path = "/:id";

export default updateTodo;
