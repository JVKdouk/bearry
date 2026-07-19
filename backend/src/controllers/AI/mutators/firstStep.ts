import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";
import { suggestFirstSteps } from "@/src/lib/ai/firstStep";
import GenericError from "@/core/server/errors/generic";

import { chargeAi } from "@/src/lib/security/aiBudget";

const Body = z.object({ todoId: z.string() });

/**
 * Suggest the first concrete moves for a stalled task. Returns suggestions
 * only; the client writes accepted ones as TaskSteps through sync, so they stay
 * offline-first and encrypted like any other user content.
 */
const firstStep: Endpoint = async (request) => {
  const { todoId } = Body.parse(request.body ?? {});
  const userId = request.user.id;
  chargeAi(userId, 1);

  const row = await database.block.findFirst({
    where: { id: todoId, userId, deletedAt: null },
  });
  if (!row) throw new GenericError("Task not found", 404);

  const crypto = await requestCrypto(request, 1);
  const t = crypto.decrypt("Block", row as unknown as Record<string, unknown>);

  const suggestion = await suggestFirstSteps(userId, {
    title: String(t.title ?? ""),
    notes: (t.notes as string | null) ?? null,
    estimatedDuration: Number(t.estimatedDuration ?? 30),
  });

  // `available` now means "steps were produced", which is what the client
  // actually needs to know. It used to mean "AI is configured", so a rate-limited
  // provider returned available:true with an empty list and the UI told the user
  // their task couldn't be broken down — blaming their content for our outage.
  return {
    steps: suggestion.steps,
    available: suggestion.steps.length > 0,
    source: suggestion.source,
    aiUsed: suggestion.source === "ai",
  };
};

firstStep.httpMethod = "POST";
firstStep.path = "/first-step";

export default firstStep;
