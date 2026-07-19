import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import GenericError from "@/core/server/errors/generic";
import { setImportGroups } from "@/src/lib/integrations/service";

const Params = z.object({ connectionId: z.string() });
// `selectedGroups: null` (or omitted) restores the "import everything" default;
// an array narrows the import to those group ids (e.g. TickTick project ids).
const Body = z.object({ selectedGroups: z.array(z.string()).nullable().optional() });

/**
 * Choose which import groups (e.g. TickTick projects) a connected account should
 * import from. Stored in that connection's cleartext `meta`; the plugin reads it
 * on the next pull. Scoped to a connection, so two accounts of the same provider
 * can import from different projects/calendars.
 */
const options: Endpoint = async (request) => {
  const { connectionId } = Params.parse(request.params);
  const { selectedGroups } = Body.parse(request.body ?? {});
  try {
    await setImportGroups(request.user.id, connectionId, selectedGroups ?? null);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    if (msg === "NOT_CONNECTED") throw new GenericError("Connect this integration first", 409);
    throw new GenericError(msg, 400);
  }
};

options.httpMethod = "POST";
options.path = "/connections/:connectionId/options";

export default options;
