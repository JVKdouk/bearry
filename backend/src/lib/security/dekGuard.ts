/**
 * The decrypt guard — `getUserDEK()` from §5.8, and the choke point every
 * decryption path goes through.
 *
 * Flow: Redis/cache hit → return warm DEK (free, fast). Miss → charge the rate
 * limiter, KEK-unwrap the stored DEK, write an audit row, cache it, return it.
 * So the cheap common path is invisible and unbounded, while the expensive
 * per-user unwrap that a takeover attacker must do en masse is exactly what the
 * limiter throttles and the audit log records.
 */

import database from "@/core/database";
import { unwrapDek } from "@/src/lib/crypto/kek";
import { getDek, putDek } from "@/src/lib/crypto/keyCache";
import { chargeDecrypt } from "./rateLimiter";
import { writeAudit } from "./auditLog";

export type DecryptActor = {
  /** Session id, or a whitelisted job identity (e.g. "job:summary"). */
  sessionId: string;
  /** Freeform context for the audit trail (route, job name, …). */
  context?: string;
};

/**
 * Resolve a user's DEK for the current request/job. On a cache miss this is a
 * logged, rate-limited KEK unwrap; the returned key stays in memory only.
 *
 * `recordCount` lets a batch read declare how many records it will decrypt so
 * the limiter bounds volume, not just distinct users — pass the row count for a
 * bulk decrypt so a full-table dump trips the ceiling.
 */
export async function getUserDEK(
  userId: string,
  actor: DecryptActor,
  recordCount = 1,
): Promise<Buffer> {
  const warm = getDek(userId);
  if (warm) {
    // Warm-path batch decrypts still count toward the record ceiling so a
    // takeover that logs in first can't dump everything for free.
    if (recordCount > 1) chargeDecrypt(actor.sessionId, userId, recordCount);
    return warm;
  }

  // Cold path: charge the limiter BEFORE unwrapping so an abusive sweep is
  // stopped at the ceiling instead of after the work is done.
  chargeDecrypt(actor.sessionId, userId, recordCount);

  const user = await database.user.findUnique({
    where: { id: userId },
    select: { wrappedDEK: true },
  });
  if (!user?.wrappedDEK) {
    throw new Error(`No wrapped DEK for user ${userId}`);
  }

  const dek = unwrapDek(user.wrappedDEK, userId);
  putDek(userId, dek);

  await writeAudit({
    userId,
    actorSessionId: actor.sessionId,
    action: recordCount > 1 ? "batch_decrypt" : "dek_unwrap",
    recordCount,
    requestContext: actor.context,
  });

  return dek;
}
