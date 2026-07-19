import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";

const Body = z.object({ endpoint: z.string().url().max(2000) });

/** Remove this device. Scoped by user so one account can't unregister another's. */
const unsubscribe: Endpoint = async (request) => {
  const { endpoint } = Body.parse(request.body);
  await database.pushSubscription.deleteMany({
    where: { endpoint, userId: request.user.id },
  });
  return { ok: true };
};

unsubscribe.httpMethod = "POST";
unsubscribe.path = "/unsubscribe";

export default unsubscribe;
