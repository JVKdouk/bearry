import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";

const Body = z.object({
  // Bulk "let go" clears a stale backlog in one tap (§1.4 p2, §8.2).
  ids: z.array(z.string()).min(1).max(1000),
  /** Undo: pass restore=true to bring let-go items back (§9.6 undo). */
  restore: z.boolean().optional(),
});

/**
 * Gently archive stale blocks without guilt — recoverable (§1.4 p2). This is
 * the one-tap "let go or reschedule" that breaks the doom loop; it never
 * deletes.
 */
const letGo: Endpoint = async (request) => {
  const { ids, restore } = Body.parse(request.body);
  const { count } = await database.block.updateMany({
    where: { id: { in: ids }, userId: request.user.id },
    data: { letGoAt: restore ? null : new Date() },
  });
  return { ok: true, count, restored: !!restore };
};

letGo.httpMethod = "POST";
letGo.path = "/let-go";

export default letGo;
