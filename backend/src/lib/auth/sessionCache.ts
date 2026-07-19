/**
 * Short-TTL session cache.
 *
 * Every authenticated request used to cost one `session.findUnique` + join to
 * users. That is the single most-executed query in the system — at a 60s sync
 * poll per open tab, tens of thousands of users generate that query tens of
 * thousands of times a minute for data that changes only at login and logout.
 *
 * The TTL is deliberately short. A cached session is a window in which a
 * revoked session still authenticates, so it is measured in seconds, and logout
 * evicts explicitly (below) rather than waiting for expiry. Session *expiry*
 * itself is re-checked on every hit against the cached `expires_at`, so an
 * expiring session is never served past its own deadline.
 *
 * PRODUCTION NOTE: like the DEK cache and the decrypt limiter, this is
 * per-process. With several API instances, a logout on instance A leaves
 * instance B serving the session for up to TTL_MS. Moving these three caches to
 * a shared Redis is the same piece of work and should happen together.
 */

import type { SafeUser } from "@/core/middlewares/auth";

const TTL_MS = Number(process.env.SESSION_CACHE_SECONDS ?? 30) * 1000;
const SWEEP_INTERVAL_MS = 60_000;

type Entry = { user: SafeUser; expiresAt: Date; cachedUntil: number };

const store = new Map<string, Entry>();

export function getCachedSession(sessionId: string): { user: SafeUser; expiresAt: Date } | null {
  const hit = store.get(sessionId);
  if (!hit) return null;
  if (hit.cachedUntil < Date.now()) {
    store.delete(sessionId);
    return null;
  }
  return { user: hit.user, expiresAt: hit.expiresAt };
}

export function putCachedSession(sessionId: string, user: SafeUser, expiresAt: Date): void {
  store.set(sessionId, { user, expiresAt, cachedUntil: Date.now() + TTL_MS });
}

/** Called on logout so a revoked session stops authenticating immediately. */
export function evictCachedSession(sessionId: string): void {
  store.delete(sessionId);
}

export function flushSessionCache(): number {
  const n = store.size;
  store.clear();
  return n;
}

function sweep(now = Date.now()): number {
  let dropped = 0;
  for (const [id, entry] of store) {
    if (entry.cachedUntil < now) {
      store.delete(id);
      dropped += 1;
    }
  }
  return dropped;
}

setInterval(() => sweep(), SWEEP_INTERVAL_MS).unref();

export { sweep as sweepSessionCache };
