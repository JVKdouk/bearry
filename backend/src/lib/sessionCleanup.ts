/**
 * Periodic sweep of expired sessions. Keeps the session table (and its DEK
 * lifecycle) tidy — an expired session's DEK has already aged out of the cache
 * by TTL, this just removes the durable row.
 */

import database from "@/core/database";

const SWEEP_INTERVAL_MS = 1000 * 60 * 30; // every 30 minutes

export function startSessionSweep(): void {
  const sweep = async () => {
    try {
      const { count } = await database.session.deleteMany({
        where: { expires_at: { lt: new Date() } },
      });
      if (count > 0) console.info(`Session sweep removed ${count} expired sessions`);
    } catch (err) {
      console.error("Session sweep failed", err);
    }
  };
  // Fire once shortly after boot, then on an interval. `unref` so the timer
  // never keeps the process alive on its own.
  setTimeout(() => void sweep(), 5_000).unref();
  setInterval(() => void sweep(), SWEEP_INTERVAL_MS).unref();
}
