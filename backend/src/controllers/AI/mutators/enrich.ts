import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";
import { enrichTasks, ENRICHER_VERSION, type EnrichInput } from "@/src/lib/ai/enrich";
import { aiAvailable } from "@/src/lib/ai/gemini";

const Body = z.object({
  /** Specific tasks, or omit to enrich the ones still on defaults. */
  todoIds: z.array(z.string()).max(50).optional(),
  limit: z.number().int().min(1).max(50).default(25),
});

/**
 * Suggest scheduling metadata (kind / duration / energy / category) for tasks.
 *
 * Returns suggestions only — nothing is written. The client applies what the
 * user accepts through the normal sync path, keeping the approve-don't-impose
 * contract the planner already follows.
 */
const enrich: Endpoint = async (request) => {
  const { todoIds, limit } = Body.parse(request.body ?? {});
  const userId = request.user.id;

  const rows = await database.todo.findMany({
    where: {
      userId,
      deletedAt: null,
      letGoAt: null,
      status: { not: "done" },
      ...(todoIds?.length
        ? { id: { in: todoIds } }
        : // Default target: everything still sitting on the untouched defaults.
          { estimatedDuration: 30, category: null }),
    },
    orderBy: { createdAt: "desc" },
    take: todoIds?.length ? todoIds.length : limit,
  });

  if (rows.length === 0) {
    return { results: [], usedAI: false, version: ENRICHER_VERSION };
  }

  // Titles/notes are encrypted at rest; decrypt in-memory for this request only.
  const crypto = await requestCrypto(request, rows.length);
  const decrypted = crypto.decryptMany("Todo", rows as unknown as Record<string, unknown>[]);

  const input: EnrichInput[] = decrypted.map((t) => ({
    id: String(t.id),
    title: String(t.title ?? ""),
    notes: (t.notes as string | null) ?? null,
    estimatedDuration: Number(t.estimatedDuration ?? 30),
    energyDemand: (t.energyDemand as EnrichInput["energyDemand"]) ?? "medium",
    category: (t.category as EnrichInput["category"]) ?? null,
  }));

  const results = await enrichTasks(userId, input);
  return {
    results,
    usedAI: results.some((r) => r.source === "ai"),
    aiAvailable: await aiAvailable(userId),
    version: ENRICHER_VERSION,
  };
};

enrich.httpMethod = "POST";
enrich.path = "/enrich";

export default enrich;
