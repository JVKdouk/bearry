import { Endpoint } from "@/core/server/endpoints/types";
import { listForUser } from "@/src/lib/integrations/service";

/** Every registered provider + this user's connection status (§1.1). */
const listIntegrations: Endpoint = async (request) => {
  const integrations = await listForUser(request.user.id);
  return { integrations };
};

listIntegrations.httpMethod = "GET";
listIntegrations.path = "/";

export default listIntegrations;
