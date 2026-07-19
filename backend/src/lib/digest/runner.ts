/**
 * Scheduled digest runner (§10). Emails the daily/weekly digest to the users
 * who opted in.
 *
 * This existed for a long time with no caller: the setting was togglable and
 * the runner was complete, but nothing ever invoked it, so opting into a daily
 * digest silently did nothing. `startDigestSchedule` is the missing half.
 *
 * Delivery is idempotent per user per period, recorded as a Setting after each
 * successful send. That marker — not the timer — is what guarantees a user gets
 * one digest a day: the schedule can fire repeatedly, the process can restart
 * mid-run, and several instances can run concurrently, and none of that
 * produces a second email. A digest system that double-sends is worse than one
 * that never sends at all, because the second failure erodes trust in every
 * email the app will ever send.
 *
 * Requires an email transport; Gemini phrasing applies per-user consent (§9.7).
 */

import database from "@/core/database";
import { jobCrypto } from "@/src/lib/crypto/requestCrypto";
import { composeDigest } from "./compose";
import { mdLiteToHtml, emailShell } from "./build";
import { sendEmail, emailEnabled } from "@/src/lib/email/send";
import type { DigestRange } from "./build";

export type RunResult = { attempted: number; sent: number; failed: number };

export async function runDigests(range: DigestRange): Promise<RunResult> {
  if (!emailEnabled()) return { attempted: 0, sent: 0, failed: 0 };

  const key = range === "day" ? "digest_daily" : "digest_weekly";
  const actor = `job:digest:${range}`;
  const subject = range === "day" ? "Your day with BearAI ☀️" : "Your week with BearAI 🗓️";

  const period = periodKey(range);
  let attempted = 0;
  let sent = 0;
  let failed = 0;

  // Walk opted-in users in pages rather than loading the whole opted-in set into
  // memory, and send a bounded number concurrently. Strictly serial delivery
  // meant the run took (users × round-trip); at tens of thousands of users the
  // daily digest would still be sending when the next day's run began.
  let cursor: string | undefined;
  for (;;) {
    const page = await database.setting.findMany({
      where: { key, value: "on" },
      select: { userId: true },
      orderBy: { userId: "asc" },
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { userId_key: { userId: cursor, key } } } : {}),
    });
    if (page.length === 0) break;
    cursor = page.at(-1)!.userId; // guarded by the length check above
    attempted += page.length;

    for (let i = 0; i < page.length; i += CONCURRENCY) {
      const slice = page.slice(i, i + CONCURRENCY);
      const outcomes = await Promise.allSettled(
        slice.map(({ userId }) => sendOne(userId, actor, range, subject, period)),
      );
      for (const [idx, o] of outcomes.entries()) {
        if (o.status === "fulfilled") {
          if (o.value) sent += 1;
          continue;
        }
        failed += 1;
        // One user's failure must never abort the run, but it must be visible.
        console.error(`Digest email failed for ${slice[idx].userId}`, o.reason);
      }
    }

    if (page.length < PAGE_SIZE) break;
  }

  return { attempted, sent, failed };
}

/** Page size for the opted-in scan, and how many emails are in flight at once. */
const PAGE_SIZE = 500;
const CONCURRENCY = Number(process.env.DIGEST_CONCURRENCY ?? 10);

/**
 * Identifies the period a digest belongs to, so a repeat run recognises it has
 * already been sent. Daily is the calendar date; weekly is the ISO-ish year and
 * week, which is enough to distinguish consecutive weeks.
 */
export function periodKey(range: DigestRange, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  if (range === "day") return date;

  // Anchor on the date of the week's own Sunday rather than counting weeks from
  // 1 January. Counting from the year's start puts a boundary at an arbitrary
  // point mid-week, so two days of the SAME week can land in different buckets
  // — which would send a second weekly digest days after the first.
  const sunday = new Date(now);
  sunday.setUTCDate(sunday.getUTCDate() - sunday.getUTCDay());
  return `W${sunday.toISOString().slice(0, 10)}`;
}

const SENT_KEY: Record<DigestRange, string> = {
  day: "digest_sent_day",
  week: "digest_sent_week",
};

/** Compose + deliver one user's digest. Returns false when there's nothing to send. */
async function sendOne(
  userId: string,
  actor: string,
  range: DigestRange,
  subject: string,
  period: string,
): Promise<boolean> {
  const sentKey = SENT_KEY[range];

  // Claim the period BEFORE sending. Writing the marker afterwards would leave
  // a window where a restart (or a second instance) resends, and a duplicate
  // email is the one outcome worth trading a missed digest to avoid.
  const claimed = await database.setting.updateMany({
    where: { userId, key: sentKey, value: { not: period } },
    data: { value: period },
  });
  if (claimed.count === 0) {
    // Either already sent this period, or the marker doesn't exist yet.
    const existing = await database.setting.findUnique({
      where: { userId_key: { userId, key: sentKey } },
      select: { value: true },
    });
    if (existing) return false; // already sent
    try {
      await database.setting.create({ data: { userId, key: sentKey, value: period } });
    } catch {
      return false; // lost the race to another instance; it will send
    }
  }

  const user = await database.user.findUnique({
    where: { id: userId },
    select: { email: true, first_name: true },
  });
  if (!user?.email) return false;
  const crypto = await jobCrypto(userId, actor);
  const { text } = await composeDigest(userId, range, crypto, user.first_name);
  await sendEmail(user.email, subject, emailShell(mdLiteToHtml(text)), text);
  return true;
}

/**
 * Start the digest schedule.
 *
 * Checks hourly rather than firing once a day at a precise moment, because a
 * once-a-day timer is only correct if the process happens to be up at that
 * instant — a deploy at 06:59 would skip the day entirely. Since delivery is
 * idempotent per period, checking often is free and missing a window isn't.
 *
 * Opt-in via DIGEST_SCHEDULE_ENABLED so a developer running the server locally
 * never emails real users.
 */
const DAILY_HOUR = Number(process.env.DIGEST_DAILY_HOUR ?? 7);
const WEEKLY_HOUR = Number(process.env.DIGEST_WEEKLY_HOUR ?? 18);
/** 0 = Sunday. A week-ahead digest lands the evening before the week starts. */
const WEEKLY_DAY = Number(process.env.DIGEST_WEEKLY_DAY ?? 0);

export function startDigestSchedule(): void {
  if (process.env.DIGEST_SCHEDULE_ENABLED !== "true") return;

  const tick = async () => {
    const now = new Date();
    try {
      if (now.getHours() >= DAILY_HOUR) {
        const r = await runDigests("day");
        if (r.sent > 0) console.info(`Daily digest sent to ${r.sent} user(s)`, r);
      }
      if (now.getDay() === WEEKLY_DAY && now.getHours() >= WEEKLY_HOUR) {
        const r = await runDigests("week");
        if (r.sent > 0) console.info(`Weekly digest sent to ${r.sent} user(s)`, r);
      }
    } catch (err) {
      console.error("Digest schedule tick failed", err);
    }
  };

  // Stagger the first tick so several instances restarting together don't all
  // scan the opted-in set at once.
  setTimeout(() => void tick(), 60_000 + Math.random() * 120_000).unref();
  setInterval(() => void tick(), 3600_000).unref();
}
