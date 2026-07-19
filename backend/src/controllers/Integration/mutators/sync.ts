import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import GenericError from "@/core/server/errors/generic";
import { syncProvider } from "@/src/lib/integrations/service";
import { SsrfBlockedError } from "@/src/lib/integrations/safeFetch";

const Params = z.object({ providerId: z.string() });

/** Trigger a provider's sync run. Maps known plugin errors to clean 4xx. */
const sync: Endpoint = async (request) => {
  const { providerId } = Params.parse(request.params);
  try {
    return await syncProvider(request.user.id, providerId, request.sessionId);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      // Safe to surface: it names the policy, not internal state.
      throw new GenericError(err.message, 400);
    }
    if (err instanceof Error && err.message === "UNKNOWN_PROVIDER") {
      throw new GenericError("Unknown integration", 404);
    }
    throw err;
  }
};

sync.httpMethod = "POST";
sync.path = "/:providerId/sync";

export default sync;
