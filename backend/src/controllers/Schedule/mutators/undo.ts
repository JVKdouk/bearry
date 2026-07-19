import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import { undoBlocks } from "@/src/lib/scheduler/service";

const Body = z.object({ blockIds: z.array(z.string()).min(1).max(500) });

/**
 * One-tap undo (§1.4 p4, §9.6 step 5): reverse a plan by soft-deleting the
 * BearAI blocks it created. Undo is a first-class, always-available control —
 * the missing-undo-button complaint is a real Motion churn driver.
 */
const undo: Endpoint = async (request) => {
  const { blockIds } = Body.parse(request.body);
  const count = await undoBlocks(request.user.id, blockIds);
  return { ok: true, undone: count };
};

undo.httpMethod = "POST";
undo.path = "/undo";

export default undo;
