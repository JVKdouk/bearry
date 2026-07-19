import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";
import { serializeBlock } from "@/src/lib/serialize/block";

const Query = z.object({
  kind: z.enum(["task", "event", "note"]).optional(),
  projectId: z.string().optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  /** ISO range, for the calendar: blocks that overlap [from, to). */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/**
 * Flat, decrypted block list. The client builds the nested tree from `parentId`
 * (§7.2). Overdue items are returned plainly — the *client* surfaces them
 * gently, never as a red pile-up (§1.4 p2).
 *
 * `kind` is a filter rather than three endpoints: the Today screen wants tasks
 * and events together, the Events tab wants one kind, and the calendar wants
 * anything that occupies time regardless of kind. One query answers all three.
 */
const listBlocks: Endpoint = async (request) => {
  const q = Query.parse(request.query ?? {});

  // A range asks "what occupies this window", which is a different question
  // from "what is due" — an untimed task has no place in it.
  const range =
    q.from || q.to
      ? {
          startTime: { not: null, ...(q.to ? { lt: new Date(q.to) } : {}) },
          ...(q.from ? { endTime: { gt: new Date(q.from) } } : {}),
        }
      : {};

  const rows = await database.block.findMany({
    where: {
      userId: request.user.id,
      deletedAt: null,
      letGoAt: null,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...range,
    },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    take: 1000,
  });

  const crypto = await requestCrypto(request, Math.max(rows.length, 1));
  const blocks = crypto
    .decryptMany("Block", rows as Record<string, unknown>[])
    .map((b) => serializeBlock(b));
  return { blocks };
};

listBlocks.httpMethod = "GET";
listBlocks.path = "/";

export default listBlocks;
