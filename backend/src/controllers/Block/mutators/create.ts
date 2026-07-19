import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";
import { serializeBlock } from "@/src/lib/serialize/block";

const Body = z.object({
  title: z.string().min(1).max(500),
  kind: z.enum(["task", "event", "note"]).optional(),
  projectId: z.string().nullish(),
  parentId: z.string().nullish(),
  body: z.string().nullish(),
  location: z.string().nullish(),
  // All optional with gentle defaults — a task is never blocked on estimating (§7.3).
  priority: z.enum(["ASAP", "high", "medium", "low"]).optional(),
  deadline: z.string().datetime().nullish(),
  startTime: z.string().datetime().nullish(),
  endTime: z.string().datetime().nullish(),
  estimatedDuration: z.number().int().min(1).max(1440).optional(),
  energyDemand: z.enum(["high", "medium", "low"]).optional(),
  chunkable: z.boolean().nullable().optional(),
  minChunk: z.number().int().nullish(),
  maxChunk: z.number().int().nullish(),
  isFixed: z.boolean().optional(),
});

/** Create a block. Only `title` is required (§1.4 p1, §7.3). */
const createBlock: Endpoint = async (request) => {
  const b = Body.parse(request.body);
  const crypto = await requestCrypto(request);

  const created = await database.block.create({
    data: crypto.encrypt("Block", {
      userId: request.user.id,
      kind: b.kind ?? "task",
      title: b.title,
      body: b.body ?? null,
      location: b.location ?? null,
      projectId: b.projectId ?? null,
      parentId: b.parentId ?? null,
      priority: b.priority ?? "medium",
      deadline: b.deadline ? new Date(b.deadline) : null,
      startTime: b.startTime ? new Date(b.startTime) : null,
      endTime: b.endTime ? new Date(b.endTime) : null,
      estimatedDuration: b.estimatedDuration ?? 30,
      energyDemand: b.energyDemand ?? "medium",
      // null, not false: "undecided" lets the duration rule apply, whereas false
      // would silently mean "never split this" for every block ever created.
      chunkable: b.chunkable ?? null,
      minChunk: b.minChunk ?? null,
      maxChunk: b.maxChunk ?? null,
      isFixed: b.isFixed ?? false,
    }),
  });

  return serializeBlock(crypto.decrypt("Block", created as Record<string, unknown>));
};

createBlock.httpMethod = "POST";
createBlock.path = "/";

export default createBlock;
