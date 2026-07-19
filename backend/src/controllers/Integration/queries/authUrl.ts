import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import { authUrlFor } from "@/src/lib/integrations/service";
import { signOAuthState } from "@/src/lib/integrations/oauthState";

const Params = z.object({ providerId: z.string() });

/** OAuth consent URL for an oauth2 provider (null if not oauth2 / not wired).
 *  The redirect URI is the backend callback (fixed per provider); we embed a
 *  signed `state` so the public callback can re-identify this user. */
const authUrl: Endpoint = async (request) => {
  const { providerId } = Params.parse(request.params);
  const state = signOAuthState({ userId: request.user.id, providerId });
  const url = await authUrlFor(providerId, state);
  return { url };
};

authUrl.httpMethod = "GET";
authUrl.path = "/:providerId/auth-url";

export default authUrl;
