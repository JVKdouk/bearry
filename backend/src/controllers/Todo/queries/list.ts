import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";
import { serializeTodo } from "@/src/lib/serialize/todo";

const Query = z.object({
  projectId: z.string().optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
});

/**
 * Flat, decrypted todo list. The client builds the nested tree from
 * `parentTodoId` (§7.2). Overdue items are returned plainly — the *client*
 * surfaces them gently, never as a red pile-up (§1.4 p2).
 */
const listTodos: Endpoint = async (request) => {
  const q = Query.parse(request.query ?? {});
  const rows = await database.todo.findMany({
    where: {
      userId: request.user.id,
      deletedAt: null,
      letGoAt: null,
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(q.status ? { status: q.status } : {}),
    },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    take: 1000,
  });

  const crypto = await requestCrypto(request, Math.max(rows.length, 1));
  const todos = crypto.decryptMany("Todo", rows as Record<string, unknown>[]).map((t) => serializeTodo(t));
  return { todos };
};

listTodos.httpMethod = "GET";
listTodos.path = "/";

export default listTodos;
