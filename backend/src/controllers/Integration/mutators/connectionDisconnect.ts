import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import { disconnectConnection } from "@/src/lib/integrations/service";

const Params = z.object({ connectionId: z.string() });

/** Disconnect ONE account and drop its stored credential. Other accounts of the
 *  same provider are untouched. */
const connectionDisconnect: Endpoint = async (request) => {
  const { connectionId } = Params.parse(request.params);
  await disconnectConnection(request.user.id, connectionId, request.sessionId);
  return { ok: true };
};

connectionDisconnect.httpMethod = "POST";
connectionDisconnect.path = "/connections/:connectionId/disconnect";

export default connectionDisconnect;
