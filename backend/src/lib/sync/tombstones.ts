/**
 * Tombstone retention.
 *
 * Soft-deleted rows are kept so `pull` can tell clients "this was deleted"
 * rather than leaving a row that quietly persists on every device that ever saw
 * it. But nothing ever removed them, so they accumulated for the life of an
 * account: a user two years in has downloaded every task they ever deleted onto
 * every new device, and the tables grow without bound.
 *
 * The reason this is a protocol change and not just a DELETE: a client whose
 * cursor predates a pruned tombstone can never learn that row was deleted. It
 * keeps showing it, and — much worse — its next push can resurrect it, because
 * to that client the row is simply a local record the server has never seen.
 * Silently deleting old tombstones trades unbounded growth for undetectable
 * data corruption on exactly the devices least able to report it.
 *
 * So retention is a contract. Tombstones live for RETENTION_DAYS; a client that
 * has been away longer is told to re-bootstrap, which is correct by
 * construction because a full pull returns only live rows.
 */

import { SYNCABLES } from "./registry";

/**
 * How long a deletion stays visible to a returning client.
 *
 * Generous on purpose. The cost of being wrong in one direction is a resurrected
 * task; in the other, a slightly larger table. Ninety days also comfortably
 * exceeds any realistic offline period — a device away longer than a season is
 * a fresh-start case regardless.
 */
export const RETENTION_DAYS = Number(process.env.TOMBSTONE_RETENTION_DAYS ?? 90);

const DAY_MS = 86_400_000;

export function retentionHorizon(now = new Date()): Date {
  return new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
}

/**
 * Is this cursor old enough that we may have pruned a deletion it never saw?
 *
 * Deliberately compares against the same horizon the sweep uses, so the answer
 * is conservative: anything the sweep could have removed forces a reset, even
 * if the sweep hasn't actually run.
 */
export function needsFullResync(since: Date | null, now = new Date()): boolean {
  if (!since) return false; // already a full bootstrap
  return since < retentionHorizon(now);
}

export type SweepResult = { removed: number; byEntity: Record<string, number> };

/**
 * Hard-delete tombstones past the retention window.
 *
 * Runs per entity rather than as one statement so a failure on one table
 * doesn't abandon the rest, and so the counts are attributable.
 */
export async function sweepTombstones(now = new Date()): Promise<SweepResult> {
  const horizon = retentionHorizon(now);
  const result: SweepResult = { removed: 0, byEntity: {} };

  for (const s of SYNCABLES) {
    try {
      const { count } = await s.delegate.deleteMany({
        where: { deletedAt: { not: null, lt: horizon } },
      });
      if (count > 0) {
        result.byEntity[s.entity] = count;
        result.removed += count;
      }
    } catch (err) {
      // One table failing must not stop the others; the row stays put and the
      // next sweep retries it.
      console.error(`Tombstone sweep failed for ${s.entity}`, err);
    }
  }

  return result;
}

const SWEEP_INTERVAL_MS = Number(process.env.TOMBSTONE_SWEEP_HOURS ?? 24) * 3600_000;

export function startTombstoneSweep(): void {
  const run = async () => {
    try {
      const { removed, byEntity } = await sweepTombstones();
      if (removed > 0) {
        console.info(`Tombstone sweep removed ${removed} rows`, byEntity);
      }
    } catch (err) {
      console.error("Tombstone sweep failed", err);
    }
  };
  // Not at boot: a deploy restarting several instances would run this
  // concurrently on all of them. A few minutes in, staggered by startup jitter,
  // is enough to avoid the thundering herd.
  // `void run()` rather than passing the async function directly: a timer
  // callback that returns a promise leaves any rejection unhandled, and `run`
  // is the one place that must never take the process down.
  setTimeout(() => void run(), 5 * 60_000 + Math.random() * 60_000).unref();
  setInterval(() => void run(), SWEEP_INTERVAL_MS).unref();
}
