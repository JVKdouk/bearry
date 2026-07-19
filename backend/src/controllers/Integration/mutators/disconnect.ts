import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import { disconnectProvider } from "@/src/lib/integrations/service";

const Params = z.object({ providerId: z.string() });

/** Disconnect a provider and drop its stored credential. */
const disconnect: Endpoint = async (request) => {
  const { providerId } = Params.parse(request.params);
  await disconnectProvider(request.user.id, providerId, request.sessionId);
  return { ok: true };
};

disconnect.httpMethod = "POST";
disconnect.path = "/:providerId/disconnect";

export default disconnect;
