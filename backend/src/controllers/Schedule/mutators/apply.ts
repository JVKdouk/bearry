import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";
import { applyPlan } from "@/src/lib/scheduler/service";

const Block = z.object({
  taskId: z.string(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  reason: z.string(),
});
const Body = z.object({ blocks: z.array(Block).max(200) });

/**
 * Apply an accepted proposal (§9.6 step 6). Each block becomes a BearAI
 * CalendarEvent whose (encrypted) title mirrors the source task's title. Returns
 * the created block ids so the client can offer one-tap undo (§9.6 step 5) via
 * /schedule/undo. If Google write-back is enabled, these are the events synced.
 */
const apply: Endpoint = async (request) => {
  const { blocks } = Body.parse(request.body);
  const crypto = await requestCrypto(request, Math.max(blocks.length, 1));

  // Decrypt each source task's title once, then re-encrypt as the event title so
  // the calendar block reads meaningfully while staying sealed at rest.
  const taskIds = [...new Set(blocks.map((b) => b.taskId))];
  const todoRows = await database.block.findMany({
    where: { id: { in: taskIds }, userId: request.user.id },
    select: { id: true, title: true },
  });
  const titleById = new Map(
    crypto.decryptMany("Block", todoRows as Record<string, unknown>[]).map((t) => [t.id as string, t.title as string]),
  );

  const prepared = blocks.map((b) => {
    const title = titleById.get(b.taskId) ?? "Scheduled task";
    const enc = crypto.encrypt("CalendarEvent", { title });
    return { ...b, titleCiphertext: enc.title as string };
  });

  const createdIds = await applyPlan(request.user.id, prepared);
  return { appliedBlockIds: createdIds };
};

apply.httpMethod = "POST";
apply.path = "/apply";

export default apply;
