import { Endpoint } from "@/core/server/endpoints/types";
import { vapidPublicKey } from "@/src/lib/notifications/push";
import database from "@/core/database";

/**
 * What the client needs to decide whether to offer notifications at all.
 *
 * `enabled` is about the SERVER: without VAPID keys nothing can be delivered,
 * and a settings toggle that silently does nothing is worse than one that
 * explains itself. The device's own permission state is checked in the browser
 * — the server can't see it.
 */
const config: Endpoint = async (request) => {
  const publicKey = vapidPublicKey();
  const devices = await database.pushSubscription.count({
    where: { userId: request.user.id },
  });
  return { enabled: !!publicKey, publicKey, devices };
};

config.httpMethod = "GET";
config.path = "/config";

export default config;
