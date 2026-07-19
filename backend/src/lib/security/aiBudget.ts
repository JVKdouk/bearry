/**
 * Per-user budget for the endpoints that spend money.
 *
 * The global limiter caps requests per IP (600/min) as an abuse control, and
 * each AI endpoint bounds its own batch size. Neither bounds *cost*: one
 * authenticated user issuing enrich calls at the global ceiling, 50 tasks a
 * time, drives tens of thousands of model requests a minute. At the scale this
 * app is being built for, one runaway client — or one enthusiastic retry loop —
 * exhausts the shared quota and every other user's AI features stop working.
 *
 * So the unit charged here is *items*, not requests: asking about 50 tasks
 * costs fifty times what asking about one does, and the limit should reflect
 * that. A user who trips it keeps every non-AI feature, because the whole point
 * of the heuristic fallbacks is that AI is never load-bearing.
 *
 * PRODUCTION NOTE: counters belong in Redis so they're shared across API
 * instances; this in-process map is the single-node stand-in, matching the
 * other limiters.
 */

const WINDOW_MS = Number(process.env.AI_BUDGET_WINDOW_SECONDS ?? 60 * 60) * 1000;

/**
 * Items per user per window. Sized so ordinary use never notices: enriching a
 * 40-task backlog, asking for steps on a dozen tasks and running a diagnosis
 * still leaves headroom, while a loop burns through it in seconds.
 */
const MAX_ITEMS = Number(process.env.AI_BUDGET_MAX_ITEMS ?? 300);

type Bucket = { windowStart: number; items: number };
const buckets = new Map<string, Bucket>();

export class AiBudgetExceededError extends Error {
  constructor(public retryAfterSeconds: number) {
    super("AI budget exceeded");
    this.name = "AiBudgetExceededError";
  }
}

function bucketFor(userId: string, now: number): Bucket {
  const existing = buckets.get(userId);
  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    const fresh = { windowStart: now, items: 0 };
    buckets.set(userId, fresh);
    return fresh;
  }
  return existing;
}

/**
 * Charge `items` against the user's budget, or throw.
 *
 * Charges only on the way in. An over-budget request is refused whole rather
 * than partially served — a half-enriched batch is harder to reason about than
 * a clean refusal, and the client already handles "AI unavailable".
 */
export function chargeAi(userId: string, items = 1, now = Date.now()): void {
  const bucket = bucketFor(userId, now);
  if (bucket.items + items > MAX_ITEMS) {
    const retryAfter = Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000);
    throw new AiBudgetExceededError(Math.max(retryAfter, 1));
  }
  bucket.items += items;
}

/** What's left in this window, for surfacing remaining budget to the client. */
export function remainingAi(userId: string, now = Date.now()): number {
  const bucket = buckets.get(userId);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) return MAX_ITEMS;
  return Math.max(0, MAX_ITEMS - bucket.items);
}

/**
 * Drop buckets that have aged out. Without this the map retains an entry per
 * user who ever used an AI feature, for the life of the process.
 */
export function sweepAiBuckets(now = Date.now()): number {
  let dropped = 0;
  for (const [userId, bucket] of buckets) {
    if (now - bucket.windowStart >= WINDOW_MS) {
      buckets.delete(userId);
      dropped += 1;
    }
  }
  return dropped;
}

setInterval(() => sweepAiBuckets(), Math.min(WINDOW_MS, 600_000)).unref();

/** Test hook. */
export function resetAiBudget(): void {
  buckets.clear();
}
