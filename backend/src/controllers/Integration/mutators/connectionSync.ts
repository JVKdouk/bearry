import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import GenericError from "@/core/server/errors/generic";
import { syncConnection } from "@/src/lib/integrations/service";
import { SsrfBlockedError } from "@/src/lib/integrations/safeFetch";

const Params = z.object({ connectionId: z.string() });

/** Sync ONE connected account (see /:providerId/sync to do all of them). */
const connectionSync: Endpoint = async (request) => {
  const { connectionId } = Params.parse(request.params);
  try {
    return await syncConnection(request.user.id, connectionId, request.sessionId);
  } catch (err) {
    if (err instanceof SsrfBlockedError) throw new GenericError(err.message, 400);
    if (err instanceof Error && err.message === "UNKNOWN_PROVIDER") {
      throw new GenericError("Unknown integration", 404);
    }
    throw err;
  }
};

connectionSync.httpMethod = "POST";
connectionSync.path = "/connections/:connectionId/sync";

export default connectionSync;
