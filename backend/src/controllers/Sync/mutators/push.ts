import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";
import { push, type PushOp } from "@/src/lib/sync/engine";

const Op = z.object({
  entity: z.string(),
  op: z.enum(["upsert", "delete"]),
  id: z.string().optional(),
  clientUpdatedAt: z.string().datetime().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const Body = z.object({
  ops: z.array(Op).max(500),
});

/**
 * Delta push: apply the client's offline queue with last-writer-wins. The server
 * bumps versions and returns a per-op result the client reconciles (applied /
 * skipped_stale / error), so the offline-first store never loses a write (§9
 * offline manager contract).
 */
const pushEndpoint: Endpoint = async (request) => {
  const { ops } = Body.parse(request.body);
  const crypto = await requestCrypto(request, Math.max(ops.length, 1));
  const results = await push(request.user.id, crypto, ops as PushOp[]);
  return { results };
};

pushEndpoint.httpMethod = "POST";
pushEndpoint.path = "/push";

export default pushEndpoint;
