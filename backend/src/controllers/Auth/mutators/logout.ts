import { Endpoint } from "@/core/server/endpoints/types";
import { logout } from "@/src/lib/auth/session";
import { clearAuthCookie } from "@/src/lib/authCookie";

/** Evict the DEK from the active cache and expire the session (§5.3). */
const logoutEndpoint: Endpoint = async (request, reply) => {
  await logout(request.sessionId, request.user.id);
  clearAuthCookie(reply);
  return reply.status(200).send({ ok: true });
};

logoutEndpoint.httpMethod = "POST";
logoutEndpoint.path = "/logout";

export default logoutEndpoint;
