import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";
import { pull } from "@/src/lib/sync/engine";

const Query = z.object({
  since: z.string().datetime().optional(),
});

/**
 * Delta pull: everything changed since the client's cursor, decrypted in memory
 * for this active user (§5.3). A large decrypt batch is declared to the rate
 * limiter so a full bootstrap is bounded and audited like any bulk read.
 */
const pullEndpoint: Endpoint = async (request) => {
  const { since } = Query.parse(request.query ?? {});
  // Generous per-request record budget for a legitimate device sync.
  const crypto = await requestCrypto(request, 5_000);
  return pull(request.user.id, crypto, since ? new Date(since) : null);
};

pullEndpoint.httpMethod = "GET";
pullEndpoint.path = "/pull";

export default pullEndpoint;
