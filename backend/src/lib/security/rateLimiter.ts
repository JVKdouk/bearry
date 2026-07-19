/**
 * Decrypt rate limiter (§5.4) — the single most important control for slowing a
 * takeover.
 *
 * Per-actor caps on (a) how many *distinct users'* DEKs may be unwrapped and
 * (b) how many records may be decrypted, within a sliding window. A `SELECT *`
 * -style dump of the whole user base trips the limiter and alerts instead of
 * completing. Legitimate bulk jobs (the nightly summary, §10.1) run under a
 * whitelisted actor identity with its own, higher ceiling.
 *
 * PRODUCTION NOTE: counters belong in Redis so they're shared across API
 * instances; this in-process implementation is the single-node stand-in with a
 * Redis-shaped surface.
 */

const WINDOW_MS = Number(process.env.DECRYPT_WINDOW_SECONDS ?? 60) * 1000;

/**
 * Default ceilings for an ordinary user session. The `distinctUsers` cap is the
 * true anti-mass-exfiltration control (§5.4) — a takeover sweeping the user base
 * trips it at 5 users regardless of volume. The `records` cap is a generous
 * secondary guard: one active user's own device sync legitimately decrypts many
 * thousands of their own rows, so it's sized for that, not for cross-user bulk.
 */
const DEFAULT_LIMITS = {
  distinctUsers: Number(process.env.DECRYPT_MAX_USERS ?? 5),
  records: Number(process.env.DECRYPT_MAX_RECORDS ?? 100_000),
};

/** Elevated ceilings for whitelisted batch identities (summary/planning jobs). */
const JOB_LIMITS = {
  distinctUsers: Number(process.env.JOB_DECRYPT_MAX_USERS ?? 100_000),
  records: Number(process.env.JOB_DECRYPT_MAX_RECORDS ?? 5_000_000),
};

const JOB_ACTORS = new Set(
  (process.env.DECRYPT_JOB_ACTORS ?? "job:summary,job:planning")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

type Bucket = {
  windowStart: number;
  users: Set<string>;
  records: number;
};

const buckets = new Map<string, Bucket>();

/**
 * Buckets are keyed by actor (a session id), and a session that decrypts once
 * and never returns leaves its bucket — plus the Set of user ids it touched —
 * resident forever. Sessions live 30 days and every login mints a new one, so
 * without a sweep this Map grows without bound for the lifetime of the process.
 *
 * A bucket older than one full window carries no information (the next
 * `bucketFor` would reset it anyway), so dropping it is free.
 */
const SWEEP_INTERVAL_MS = Number(process.env.DECRYPT_SWEEP_SECONDS ?? 300) * 1000;

export function sweepStaleBuckets(now = Date.now()): number {
  let dropped = 0;
  for (const [actor, bucket] of buckets) {
    if (now - bucket.windowStart >= WINDOW_MS) {
      buckets.delete(actor);
      dropped += 1;
    }
  }
  return dropped;
}

setInterval(() => sweepStaleBuckets(), SWEEP_INTERVAL_MS).unref();

export class RateLimitTrippedError extends Error {
  constructor(
    public actor: string,
    public kind: "distinct-users" | "records",
  ) {
    super(`Decrypt rate limit tripped for actor ${actor} (${kind})`);
  }
}

function limitsFor(actor: string) {
  return JOB_ACTORS.has(actor) ? JOB_LIMITS : DEFAULT_LIMITS;
}

function bucketFor(actor: string): Bucket {
  const now = Date.now();
  const existing = buckets.get(actor);
  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    const fresh: Bucket = { windowStart: now, users: new Set(), records: 0 };
    buckets.set(actor, fresh);
    return fresh;
  }
  return existing;
}

/**
 * Record and authorize a decrypt operation for `actor` (a session id or a job
 * identity), touching `userId` and decrypting `recordCount` records. Throws
 * {@link RateLimitTrippedError} when a ceiling is exceeded — the caller should
 * alert and abort rather than complete the bulk read.
 */
export function chargeDecrypt(
  actor: string,
  userId: string,
  recordCount = 1,
): void {
  const bucket = bucketFor(actor);
  const limits = limitsFor(actor);

  const wouldBeUsers = bucket.users.has(userId)
    ? bucket.users.size
    : bucket.users.size + 1;
  if (wouldBeUsers > limits.distinctUsers) {
    throw new RateLimitTrippedError(actor, "distinct-users");
  }
  if (bucket.records + recordCount > limits.records) {
    throw new RateLimitTrippedError(actor, "records");
  }

  bucket.users.add(userId);
  bucket.records += recordCount;
}

/** Register an actor identity as a whitelisted batch job at runtime. */
export function whitelistJobActor(actor: string): void {
  JOB_ACTORS.add(actor);
}

/** Test/reset hook. */
export function resetRateLimiter(): void {
  buckets.clear();
}
