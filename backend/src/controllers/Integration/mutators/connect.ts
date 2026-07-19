import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import GenericError from "@/core/server/errors/generic";
import { connectProvider } from "@/src/lib/integrations/service";

const Params = z.object({ providerId: z.string() });
const Body = z.object({
  code: z.string().optional(),
  secret: z.string().optional(),
  scopes: z.string().optional(),
  redirectUri: z.string().optional(),
});

/**
 * Connect any provider through the plugin registry. The provider validates the
 * input and returns a credential; the service stores it encrypted under the user
 * DEK (§5.2). Same endpoint for every integration — new providers need no route.
 */
const connect: Endpoint = async (request) => {
  const { providerId } = Params.parse(request.params);
  const input = Body.parse(request.body ?? {});
  try {
    await connectProvider(request.user.id, providerId, request.sessionId, input);
    return { connected: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    if (msg === "UNKNOWN_PROVIDER") throw new GenericError("Unknown integration", 404);
    if (msg === "PROVIDER_UNAVAILABLE") throw new GenericError("This integration isn’t available yet", 409);
    throw new GenericError(msg, 400);
  }
};

connect.httpMethod = "POST";
connect.path = "/:providerId/connect";

export default connect;
