/**
 * Deciding when reminders fire, and firing them.
 *
 * Two separable problems, kept separate on purpose:
 *
 *  • `dueReminders` / `claimReminder` — pure-ish scheduling logic, tested.
 *  • the sweep — the loop that runs it.
 *
 * The scheduling rules exist because a reminder system that is merely
 * approximately right is worse than none. Firing late is forgivable; firing
 * twice, or firing at 3am for something that already happened, is how people
 * end up disabling notifications for good.
 */

import database from "@/core/database";
import { jobCrypto } from "@/src/lib/crypto/requestCrypto";
import { whitelistJobActor } from "@/src/lib/security/rateLimiter";
import { pushEnabled, sendToUser } from "./push";

/**
 * How stale a reminder can be and still be worth sending.
 *
 * A server that was down overnight comes back to a queue of reminders whose
 * moment has passed. Delivering them all is a burst of notifications for
 * things that already happened — the single most trust-destroying thing a
 * reminder system can do. Anything older than this is marked delivered and
 * dropped silently.
 */
export const MAX_LATENESS_MINUTES = Number(process.env.REMINDER_MAX_LATENESS_MINUTES ?? 60);

/** Reminders looked at per tick, so one enormous backlog can't stall the loop. */
const BATCH = Number(process.env.REMINDER_BATCH ?? 200);

export interface DueReminder {
  id: string;
  userId: string;
  targetType: string;
  targetId: string;
  fireAt: Date;
  offsetMinutes: number;
}

/**
 * Is this reminder still worth delivering at `now`?
 *
 * Separated from the query so the staleness rule can be tested directly — it's
 * the rule most likely to be got wrong, and the one whose failure is loudest.
 */
export function isStillRelevant(fireAt: Date, now: Date, maxLatenessMinutes = MAX_LATENESS_MINUTES): boolean {
  const lateBy = (now.getTime() - fireAt.getTime()) / 60_000;
  return lateBy >= 0 && lateBy <= maxLatenessMinutes;
}

/** How a reminder should read, given how far ahead of the thing it is. */
export function reminderBody(title: string, offsetMinutes: number): string {
  if (offsetMinutes <= 0) return `${title} — starting now`;
  if (offsetMinutes < 60) return `${title} — in ${offsetMinutes} minutes`;
  if (offsetMinutes < 60 * 24) {
    const hours = Math.round(offsetMinutes / 60);
    return `${title} — in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.round(offsetMinutes / (60 * 24));
  if (days === 7) return `${title} — in a week`;
  return `${title} — in ${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Claim a reminder for delivery.
 *
 * Marks it delivered BEFORE sending, and only if it wasn't already. A push that
 * fails after being claimed is lost, which is the right trade: the alternative
 * is a crash between send and mark producing a duplicate on every restart, and
 * a duplicate is the failure users actually punish.
 *
 * The conditional update is also what makes several server instances safe —
 * only one of them can win the row.
 */
export async function claimReminder(id: string): Promise<boolean> {
  const { count } = await database.reminder.updateMany({
    where: { id, delivered: false },
    data: { delivered: true },
  });
  return count === 1;
}

/** Reminders whose moment has arrived and hasn't long passed. */
export async function dueReminders(now: Date, limit = BATCH): Promise<DueReminder[]> {
  const rows = await database.reminder.findMany({
    where: {
      delivered: false,
      deletedAt: null,
      fireAt: {
        not: null,
        lte: now,
        // Bounded below so the query itself skips an ancient backlog rather
        // than loading it just to discard it.
        gte: new Date(now.getTime() - MAX_LATENESS_MINUTES * 60_000),
      },
    },
    orderBy: { fireAt: "asc" },
    take: limit,
    select: {
      id: true,
      userId: true,
      targetType: true,
      targetId: true,
      fireAt: true,
      offsetMinutes: true,
    },
  });
  return rows.filter((r): r is DueReminder => r.fireAt !== null);
}

/**
 * Mark everything too old to be worth sending as delivered.
 *
 * Without this the backlog is re-examined on every tick forever, and the
 * bounded query above means they'd never be cleared by delivery either.
 */
export async function discardStaleReminders(now: Date): Promise<number> {
  const { count } = await database.reminder.updateMany({
    where: {
      delivered: false,
      deletedAt: null,
      fireAt: { not: null, lt: new Date(now.getTime() - MAX_LATENESS_MINUTES * 60_000) },
    },
    data: { delivered: true },
  });
  return count;
}

export type SweepResult = { considered: number; sent: number; skipped: number; discarded: number };

/** One pass: deliver what's due, retire what's too late. */
export async function deliverDueReminders(now = new Date()): Promise<SweepResult> {
  const result: SweepResult = { considered: 0, sent: 0, skipped: 0, discarded: 0 };
  if (!pushEnabled()) return result;

  result.discarded = await discardStaleReminders(now);

  const due = await dueReminders(now);
  result.considered = due.length;

  for (const reminder of due) {
    try {
      if (!isStillRelevant(reminder.fireAt, now)) {
        result.skipped += 1;
        continue;
      }
      if (!(await claimReminder(reminder.id))) {
        // Another instance got there first.
        result.skipped += 1;
        continue;
      }

      const target = await targetInfo(reminder);
      if (!target) {
        // The target was deleted or completed after the reminder was set.
        // Reminding someone about something that no longer exists is worse
        // than staying quiet.
        result.skipped += 1;
        continue;
      }

      await sendToUser(reminder.userId, {
        title: "Bearry",
        body: reminderBody(target.title, reminder.offsetMinutes),
        // Every reminder now targets a block, so the deep link follows its
        // kind rather than a targetType that is always the same string.
        url: target.kind === "event" ? "/calendar" : "/today",
        tag: `block:${reminder.targetId}`,
      });
      result.sent += 1;
    } catch (err) {
      // One user's failure must never stop the rest of the sweep.
      console.error(`Reminder ${reminder.id} failed`, err);
    }
  }

  return result;
}

/**
 * The target's title and kind, or null when there's nothing to remind about.
 *
 * Runs under a whitelisted job actor: this legitimately touches many users in
 * one sweep, which is exactly the shape the decrypt limiter is built to stop,
 * so it needs its own audited ceiling rather than a session's.
 */
async function targetInfo(
  reminder: DueReminder,
): Promise<{ title: string; kind: string } | null> {
  const actor = `job:reminders`;
  whitelistJobActor(actor);
  const crypto = await jobCrypto(reminder.userId, actor);

  // One lookup for every kind. This used to branch on targetType and query a
  // different table for each, which meant a reminder pointing at something
  // that had since been converted from a task to an event silently found
  // nothing and never fired.
  const row = await database.block.findFirst({
    where: { id: reminder.targetId, userId: reminder.userId, deletedAt: null },
  });
  if (!row) return null;
  // A finished or abandoned task doesn't need reminding about. Events have no
  // "done" of their own, so this only ever excludes what it should.
  if (row.status === "done" || row.letGoAt) return null;
  const decrypted = crypto.decrypt("Block", row as Record<string, unknown>);
  const title = String(decrypted.title ?? "");
  return title ? { title, kind: String(row.kind) } : null;
}

const TICK_MS = Number(process.env.REMINDER_TICK_SECONDS ?? 60) * 1000;

export function startReminderSweep(): void {
  if (!pushEnabled()) return;

  const run = async () => {
    try {
      const r = await deliverDueReminders();
      if (r.sent > 0 || r.discarded > 0) console.info("Reminder sweep", r);
    } catch (err) {
      console.error("Reminder sweep failed", err);
    }
  };

  // Jittered so several instances don't all sweep on the same second and
  // contend for the same rows.
  setTimeout(() => void run(), 15_000 + Math.random() * 15_000).unref();
  setInterval(() => void run(), TICK_MS).unref();
}
