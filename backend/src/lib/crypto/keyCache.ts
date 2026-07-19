/**
 * Active-only DEK cache (§5.3).
 *
 * A user's DEK is unwrapped once at login and held here with a short TTL,
 * refreshed on activity. When the TTL lapses (or the user logs out) the DEK is
 * evicted and that user's content can no longer be decrypted without a fresh,
 * logged, rate-limited KEK unwrap. On a 3 a.m. takeover, only *currently active*
 * users' keys are warm — everything else costs a per-user unwrap that the audit
 * log and rate limiter observe.
 *
 * PRODUCTION NOTE: the spec puts this in Redis (memory-only, no disk
 * persistence, private-bound, auth + ACLs + TLS). This in-process Map is a
 * drop-in stand-in for single-node dev; the interface is deliberately
 * Redis-shaped (get/set-with-ttl/evict/flush) so swapping in ioredis is
 * mechanical. Keys never persist to disk here either.
 */

const DEFAULT_TTL_MS = Number(process.env.DEK_TTL_SECONDS ?? 20 * 60) * 1000;

type Entry = { dek: Buffer; expiresAt: number };

const store = new Map<string, Entry>();

function keyFor(userId: string): string {
  return `dek:${userId}`;
}

/**
 * Expiry is enforced lazily on read, which is enough for correctness but NOT for
 * the security property: a user who goes away leaves their DEK sitting in the
 * heap forever, because nothing ever reads that key again to evict it. That
 * quietly turns "active-only decryption" (§5.3) into "ever-active decryption" —
 * exactly the blast radius the design set out to bound — and leaks memory at a
 * rate proportional to the user base.
 *
 * So sweep proactively: every expired entry is zeroed and dropped on a timer, so
 * the warm set really is the currently-active set. `unref` keeps the timer from
 * holding the process open.
 */
const SWEEP_INTERVAL_MS = Number(process.env.DEK_SWEEP_SECONDS ?? 60) * 1000;

export function sweepExpiredDeks(now = Date.now()): number {
  let evicted = 0;
  for (const [key, entry] of store) {
    if (entry.expiresAt < now) {
      // Deliberately NOT zeroing the buffer here: a request that already fetched
      // this DEK holds the same reference, and scrubbing it mid-flight would
      // make that request decrypt garbage. Dropping the reference is enough —
      // GC reclaims it. Break-glass (below) is the one place we scrub, because
      // there killing in-flight work is the entire point.
      store.delete(key);
      evicted += 1;
    }
  }
  return evicted;
}

setInterval(() => sweepExpiredDeks(), SWEEP_INTERVAL_MS).unref();

/** Cache a freshly-unwrapped DEK for an active user. */
export function putDek(userId: string, dek: Buffer, ttlMs = DEFAULT_TTL_MS): void {
  store.set(keyFor(userId), { dek, expiresAt: Date.now() + ttlMs });
}

/**
 * Fetch a warm DEK, refreshing its TTL on the hit (activity keeps a session
 * alive). Returns null on a miss so the caller performs a logged, rate-limited
 * KEK unwrap instead of silently serving nothing.
 */
export function getDek(userId: string, ttlMs = DEFAULT_TTL_MS): Buffer | null {
  const entry = store.get(keyFor(userId));
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(keyFor(userId));
    return null;
  }
  entry.expiresAt = Date.now() + ttlMs; // sliding refresh on activity
  return entry.dek;
}

/** Evict one user's DEK (logout / TTL expiry). */
export function evictDek(userId: string): void {
  store.delete(keyFor(userId));
}

/**
 * Flush every DEK — half of break-glass (§5.4). After this, nothing is
 * decryptable until users re-authenticate and their DEKs are unwrapped again
 * (under the rotated KEK).
 */
export function flushAllDeks(): number {
  const n = store.size;
  // Break-glass: scrub the key material rather than waiting for GC. Any request
  // holding a reference is *meant* to fail from here on.
  for (const entry of store.values()) entry.dek.fill(0);
  store.clear();
  return n;
}

/** Number of currently-active (warm) DEKs — the takeover blast radius, live. */
export function activeDekCount(): number {
  return store.size;
}
