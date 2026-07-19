import { Endpoint } from "@/core/server/endpoints/types";
import { blockContract } from "@/src/lib/integrations/schema/blocks";

/**
 * The canonical block contract every plugin must satisfy. Public-facing so a
 * future third-party plugin author can build against a stable, documented shape.
 */
const schema: Endpoint = async () => {
  return blockContract();
};

schema.httpMethod = "GET";
schema.path = "/schema";
schema.isPublic = true;

export default schema;
