import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";
import { serializeTodo } from "@/src/lib/serialize/todo";

const Body = z.object({
  title: z.string().min(1).max(500),
  projectId: z.string().nullish(),
  parentTodoId: z.string().nullish(),
  notes: z.string().nullish(),
  // All optional with gentle defaults — a task is never blocked on estimating (§7.3).
  priority: z.enum(["ASAP", "high", "medium", "low"]).optional(),
  deadline: z.string().datetime().nullish(),
  estimatedDuration: z.number().int().min(1).max(1440).optional(),
  energyDemand: z.enum(["high", "medium", "low"]).optional(),
  chunkable: z.boolean().optional(),
  minChunk: z.number().int().nullish(),
  maxChunk: z.number().int().nullish(),
});

/** Create a todo. Only `title` is required (§1.4 p1, §7.3). */
const createTodo: Endpoint = async (request) => {
  const b = Body.parse(request.body);
  const crypto = await requestCrypto(request);

  const created = await database.todo.create({
    data: crypto.encrypt("Todo", {
      userId: request.user.id,
      title: b.title,
      notes: b.notes ?? null,
      projectId: b.projectId ?? null,
      parentTodoId: b.parentTodoId ?? null,
      priority: b.priority ?? "medium",
      deadline: b.deadline ? new Date(b.deadline) : null,
      estimatedDuration: b.estimatedDuration ?? 30,
      energyDemand: b.energyDemand ?? "medium",
      chunkable: b.chunkable ?? false,
      minChunk: b.minChunk ?? null,
      maxChunk: b.maxChunk ?? null,
    }),
  });

  return serializeTodo(crypto.decrypt("Todo", created as Record<string, unknown>));
};

createTodo.httpMethod = "POST";
createTodo.path = "/";

export default createTodo;
