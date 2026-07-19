import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import GenericError from "@/core/server/errors/generic";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";
import { serializeBlock } from "@/src/lib/serialize/block";

const Params = z.object({ id: z.string() });
const Body = z.object({
  title: z.string().min(1).max(500).optional(),
  // Converting between task, event and note is now this field and nothing
  // else. It used to be a delete, an insert, and re-pointing every step, link
  // and reminder that referenced the old row.
  kind: z.enum(["task", "event", "note"]).optional(),
  body: z.string().nullish(),
  location: z.string().nullish(),
  projectId: z.string().nullish(),
  parentId: z.string().nullish(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  priority: z.enum(["ASAP", "high", "medium", "low"]).optional(),
  deadline: z.string().datetime().nullish(),
  startTime: z.string().datetime().nullish(),
  endTime: z.string().datetime().nullish(),
  estimatedDuration: z.number().int().min(1).max(1440).optional(),
  energyDemand: z.enum(["high", "medium", "low"]).optional(),
  chunkable: z.boolean().nullable().optional(),
  isFixed: z.boolean().optional(),
  pinnedFields: z.string().nullish(),
  order: z.number().optional(),
});

const ENC_KEYS = new Set(["title", "body", "location"]);
const DATE_KEYS = new Set(["deadline", "startTime", "endTime"]);

/** Patch a block (complete, reprioritize, reparent, reschedule, convert). */
const updateBlock: Endpoint = async (request) => {
  const { id } = Params.parse(request.params);
  const b = Body.parse(request.body);
  const crypto = await requestCrypto(request);

  const existing = await database.block.findFirst({
    where: { id, userId: request.user.id, deletedAt: null },
    select: { version: true },
  });
  if (!existing) throw new GenericError("Block not found", 404);

  // Build the plaintext patch, coercing dates, then encrypt sensitive fields.
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    if (DATE_KEYS.has(k)) patch[k] = v ? new Date(v as string) : null;
    else patch[k] = v;
  }
  const hasEncrypted = Object.keys(patch).some((k) => ENC_KEYS.has(k));
  const data = hasEncrypted ? crypto.encrypt("Block", patch) : patch;

  const updated = await database.block.update({
    where: { id },
    data: { ...data, version: (existing.version ?? 1) + 1 },
  });

  return serializeBlock(crypto.decrypt("Block", updated as Record<string, unknown>));
};

updateBlock.httpMethod = "PATCH";
updateBlock.path = "/:id";

export default updateBlock;
