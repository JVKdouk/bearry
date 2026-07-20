/**
 * Web Push delivery.
 *
 * Notifications are the one thing this app does that reaches a user when
 * they're not looking at it, which makes the failure modes asymmetric: a
 * missed reminder is a disappointment, a duplicate or a wrong one at 3am is a
 * reason to turn notifications off permanently and never turn them back on.
 * Everything here is biased accordingly — claim delivery before sending, prune
 * dead devices aggressively, and never retry a push the service has rejected.
 *
 * VAPID keys live in the environment. That's what makes the subscription rows
 * safe to store in cleartext: an endpoint is only usable by someone holding the
 * private key, so a database dump alone cannot push anything to anyone.
 */

import webpush from "web-push";
import database from "@/core/database";

let configured: boolean | null = null;

/**
 * Whether push is usable at all.
 *
 * Memoised because it's checked on every sweep tick, and because configuring
 * web-push twice with the same keys is pointless work.
 */
export function pushEnabled(): boolean {
  if (configured !== null) return configured;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:noreply@kuma.day";

  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  } catch (err) {
    // Malformed keys shouldn't take the server down — push simply stays off
    // and the settings page reports it as unavailable.
    console.error("VAPID configuration rejected; push disabled", err);
    configured = false;
  }
  return configured;
}

/** The public key the browser needs to subscribe. Null when push is off. */
export function vapidPublicKey(): string | null {
  return pushEnabled() ? (process.env.VAPID_PUBLIC_KEY ?? null) : null;
}

/** Test hook: forget the memoised configuration. */
export function resetPushConfig(): void {
  configured = null;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Where clicking should land. Relative, so it works on any deployment. */
  url?: string;
  /**
   * Collapses same-subject notifications on the device: a reminder that fires
   * while an earlier one for the same task is still on screen replaces it
   * rather than stacking a second copy.
   */
  tag?: string;
}

/**
 * How many consecutive failures before a subscription is dropped.
 *
 * More than one, because a single failure is usually the network rather than
 * the device being gone. Not many more, because every retry against a dead
 * endpoint is a wasted request on every reminder.
 */
const MAX_FAILURES = 3;

export type SendResult = { sent: number; failed: number; pruned: number };

/**
 * Send to every device the user has registered.
 *
 * A user with a phone and a laptop should get it on both — a reminder that
 * arrives only on the device you aren't holding is worse than none.
 */
export async function sendToUser(userId: string, payload: PushPayload): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0, pruned: 0 };
  if (!pushEnabled()) return result;

  const subs = await database.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return result;

  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        );
        result.sent += 1;
        // Clearing the counter matters: a device that fails twice on a flaky
        // network and then succeeds should not be one failure from deletion
        // for the rest of its life.
        if (sub.failureCount > 0 || !sub.lastUsedAt) {
          await database.pushSubscription.update({
            where: { id: sub.id },
            data: { failureCount: 0, lastUsedAt: new Date() },
          });
        }
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;

        // 404/410 are the push service saying this endpoint is permanently
        // gone — the app was uninstalled or permission revoked. Retrying is
        // meaningless, so drop it immediately rather than counting to three.
        if (status === 404 || status === 410) {
          await database.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          result.pruned += 1;
          return;
        }

        result.failed += 1;
        const failures = sub.failureCount + 1;
        if (failures >= MAX_FAILURES) {
          await database.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          result.pruned += 1;
        } else {
          await database.pushSubscription
            .update({ where: { id: sub.id }, data: { failureCount: failures } })
            .catch(() => {});
        }
      }
    }),
  );

  return result;
}
