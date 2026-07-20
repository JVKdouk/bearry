/**
 * Backfill the default "at the time" reminder onto existing items.
 *
 * The app now seeds a reminder whenever something first gets a time — the create
 * flow for hand-made items (TaskDetail), and import ingestion for external ones.
 * Everything that predates those has none. This gives them a one-time default so
 * they notify like a freshly created one would.
 *
 * Scope (matches the shared rule in defaultReminder.ts, so backfill and the live
 * paths can't drift):
 *
 *  • Events with a future start — local AND imported. The user asked for
 *    imported events too; an imported calendar's own notifications are a
 *    separate channel this doesn't try to replace.
 *  • Deadline-only tasks — a reminder at 9am local on the due date (never the
 *    stored midnight/end-of-day), local and imported alike.
 *  • Recurring events and tasks — fired at their next occurrence at/after now,
 *    skipping any already past. Recurring EVENTS then re-arm themselves each time
 *    they fire (the delivery sweep), so this one row keeps the series going.
 *  • Reminderless only, and never done / let go / deleted. Idempotent: a second
 *    run adds nothing, because the first run's rows now count as "has a reminder".
 *
 * triggerSpec is a per-user encrypted field, so each reminder is sealed under the
 * owner's DEK exactly as the app seals it — a raw SQL insert can't, which is why
 * this is a script and not a migration.
 *
 * Run with --dry-run first. It reports exactly what it would create and writes
 * nothing.
 */

import database from "@/core/database";
import { bootstrapKekFromEnv } from "@/src/lib/crypto/kek";
import { getUserDEK } from "@/src/lib/security/dekGuard";
import { whitelistJobActor } from "@/src/lib/security/rateLimiter";
import { encryptRecord } from "@/src/lib/crypto/fieldCrypto";
import { defaultReminderFireAt } from "@/src/lib/notifications/defaultReminder";

const ACTOR = "job:backfill-default-reminders";

export type BackfillResult = {
  candidates: number;
  created: number;
  skippedExisting: number;
  skippedNoMoment: number;
  byKind: { task: number; event: number };
};

export async function backfillDefaultReminders(
  dryRun = false,
  now: Date = new Date(),
): Promise<BackfillResult> {
  const result: BackfillResult = {
    candidates: 0,
    created: 0,
    skippedExisting: 0,
    skippedNoMoment: 0,
    byKind: { task: 0, event: 0 },
  };
  whitelistJobActor(ACTOR);

  // Actionable tasks/events that could still yield a FUTURE reminder. The OR
  // keeps the query off the huge backlog of past one-off events: a recurring row
  // (any age — its next occurrence may be ahead), a future start, or a due date
  // recent enough that 9am-local on it hasn't passed.
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const candidates = await database.block.findMany({
    where: {
      kind: { in: ["task", "event"] },
      deletedAt: null,
      letGoAt: null,
      status: { not: "done" },
      OR: [
        { recurrenceRule: { not: null } },
        { startTime: { gt: now } },
        { deadline: { gt: dayAgo } },
      ],
    },
    select: {
      id: true,
      userId: true,
      kind: true,
      startTime: true,
      deadline: true,
      recurrenceRule: true,
    },
    orderBy: { id: "asc" },
  });
  result.candidates = candidates.length;
  if (candidates.length === 0) return result;

  // Which already have a live reminder — one query, not one per block.
  const existing = await database.reminder.findMany({
    where: { targetType: "block", targetId: { in: candidates.map((b) => b.id) }, deletedAt: null },
    select: { targetId: true },
  });
  const hasReminder = new Set(existing.map((r) => r.targetId));

  // The deadline rule fires at 9am local, so each owner's zone is needed.
  const profiles = await database.scheduleProfile.findMany({
    select: { userId: true, timezone: true },
  });
  const tzByUser = new Map(profiles.map((p) => [p.userId, p.timezone || "UTC"]));

  // One DEK unwrap per user (the expensive part; the limiter counts users).
  const deks = new Map<string, Buffer>();

  for (const b of candidates) {
    if (hasReminder.has(b.id)) {
      result.skippedExisting += 1;
      continue;
    }

    const fireAt = defaultReminderFireAt(b, tzByUser.get(b.userId) ?? "UTC", now);
    if (!fireAt) {
      // Past one-off, or a recurring series with nothing left ahead.
      result.skippedNoMoment += 1;
      continue;
    }

    let dek = deks.get(b.userId);
    if (!dek) {
      dek = await getUserDEK(b.userId, { sessionId: ACTOR, context: ACTOR }, candidates.length);
      deks.set(b.userId, dek);
    }

    // Sealed exactly as the app seals it: JSON {offsetMinutes} under
    // Reminder:triggerSpec, so the client opens it as a normal reminder.
    const { triggerSpec } = encryptRecord("Reminder", b.userId, dek, {
      triggerSpec: JSON.stringify({ offsetMinutes: 0 }),
    });

    if (!dryRun) {
      await database.reminder.create({
        data: {
          userId: b.userId,
          targetType: "block",
          targetId: b.id,
          kind: "time",
          triggerSpec,
          offsetMinutes: 0,
          fireAt,
          // The helper only returns future moments, so this is false in practice
          // — but derive it from the same `now` so a moment that slips into the
          // past between query and insert is born delivered and never fires late.
          delivered: fireAt.getTime() <= now.getTime(),
        },
      });
    }

    result.created += 1;
    result.byKind[b.kind as "task" | "event"] += 1;
  }

  return result;
}

const isDirect = process.argv[1]?.includes("backfill-default-reminders");
if (isDirect) {
  const dryRun = process.argv.includes("--dry-run");
  bootstrapKekFromEnv();
  backfillDefaultReminders(dryRun)
    .then((r) => {
      console.info(dryRun ? "DRY RUN — nothing written" : "Backfill complete");
      console.info(`  candidates:        ${r.candidates}`);
      console.info(`  created:           ${r.created}  (tasks ${r.byKind.task}, events ${r.byKind.event})`);
      console.info(`  skipped existing:  ${r.skippedExisting}`);
      console.info(`  skipped no-moment: ${r.skippedNoMoment}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Backfill failed", err);
      process.exit(1);
    });
}
