/**
 * Credential brute-force limiter (§5 auth). The global per-IP limit (600/min) is
 * for abuse/DoS; this is tighter and specific to auth, so password guessing is
 * throttled well before the global limit. Keyed per-IP with a sliding window;
 * on trip it answers 429 + Retry-After so honest clients back off.
 *
 * PRODUCTION NOTE: counters belong in Redis to be shared across instances; this
 * in-process map is the single-node stand-in, matching the other limiters.
 */

import type { FastifyRequest, FastifyReply } from "fastify";

const WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS ?? 5 * 60_000); // 5 min
const MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS ?? 15);

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export async function loginRateLimit(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const now = Date.now();
  const key = req.ip || "unknown";
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    reply.header("Retry-After", String(retryAfter));
    return reply.status(429).send({ message: "Too many attempts. Please wait a moment and try again." });
  }
}

/** Occasional cleanup so the map doesn't grow unbounded. */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
}, WINDOW_MS).unref();
