import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";

const Body = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
  label: z.string().max(120).optional(),
});

/**
 * Register this device for push.
 *
 * Upsert on the endpoint, because a browser re-subscribing produces the same
 * endpoint and must not accumulate duplicate rows — every duplicate is another
 * copy of every notification.
 *
 * The endpoint is also re-pointed at the current user: a shared device where
 * someone logs out and someone else logs in would otherwise keep delivering
 * the first person's reminders to the second person's browser.
 */
const subscribe: Endpoint = async (request) => {
  const { endpoint, keys, label } = Body.parse(request.body);

  await database.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId: request.user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      label: label ?? null,
    },
    update: {
      userId: request.user.id,
      p256dh: keys.p256dh,
      auth: keys.auth,
      label: label ?? null,
      failureCount: 0,
    },
  });

  return { ok: true };
};

subscribe.httpMethod = "POST";
subscribe.path = "/subscribe";

export default subscribe;
