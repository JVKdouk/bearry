/**
 * Scheduled digest runner (§10). Iterates users opted into the daily/weekly
 * digest and emails their message. Wire to a cron (node-cron / BullMQ) — e.g.
 * daily at 07:00 local, weekly Sunday evening.
 *
 * NOT auto-started, so it never sends unexpectedly in dev. Requires MAILER_*;
 * Gemini phrasing applies per-user consent (§9.7).
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
        slice.map(({ userId }) => sendOne(userId, actor, range, subject)),
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

/** Compose + deliver one user's digest. Returns false when there's nothing to send. */
async function sendOne(
  userId: string,
  actor: string,
  range: DigestRange,
  subject: string,
): Promise<boolean> {
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
