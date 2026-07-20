import { Endpoint } from "@/core/server/endpoints/types";
import GenericError from "@/core/server/errors/generic";
import { pushEnabled, sendToUser } from "@/src/lib/notifications/push";

/**
 * Send a notification right now.
 *
 * Worth an endpoint of its own: push has four independent failure points
 * (server keys, browser permission, service worker registration, the push
 * service itself) and no way to tell which one is broken from the outside.
 * This collapses "did it work?" into one button.
 */
const testPush: Endpoint = async (request) => {
  if (!pushEnabled()) throw new GenericError("Push isn't configured on this server", 503);

  const result = await sendToUser(request.user.id, {
    title: "Kuma",
    body: "Notifications are working.",
    url: "/today",
    tag: "test",
  });

  if (result.sent === 0) {
    throw new GenericError(
      result.pruned > 0
        ? "This device's subscription had expired — it's been removed, try enabling notifications again"
        : "No devices are registered for notifications yet",
      400,
    );
  }
  return result;
};

testPush.httpMethod = "POST";
testPush.path = "/test";

export default testPush;
