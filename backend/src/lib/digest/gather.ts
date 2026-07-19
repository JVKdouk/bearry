/**
 * Gather a user's schedule for a digest and decrypt the titles in-memory (§10).
 * Runs inside an authorized request/job where the user's DEK is available.
 */

import database from "@/core/database";
import type { RequestCrypto } from "@/src/lib/crypto/requestCrypto";
import type { DigestData, DigestRange } from "./build";

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  s.setDate(s.getDate() - s.getDay());
  return s;
}

export async function gatherDigest(
  userId: string,
  range: DigestRange,
  crypto: RequestCrypto,
  firstName: string | null,
  timezone = "UTC",
): Promise<DigestData> {
  const now = new Date();
  const from = range === "day" ? startOfDay(now) : startOfWeek(now);
  const to = new Date(from);
  to.setDate(to.getDate() + (range === "day" ? 1 : 7));

  const [eventRows, taskRows, overdueCount, profile] = await Promise.all([
    // Anything that occupies time in the window, whatever kind — a timed task
    // is as much a part of your day as a meeting, and the digest was omitting
    // it purely because it lived in the other table.
    database.block.findMany({
      where: {
        userId,
        deletedAt: null,
        letGoAt: null,
        startTime: { not: null, gte: from, lt: to },
      },
      orderBy: { startTime: "asc" },
      take: 50,
    }),
    database.block.findMany({
      where: { userId, kind: "task", deletedAt: null, letGoAt: null, status: { not: "done" }, deadline: { gte: from, lt: to } },
      orderBy: [{ priority: "asc" }, { deadline: "asc" }],
      take: 50,
    }),
    database.block.count({
      where: { userId, kind: "task", deletedAt: null, letGoAt: null, status: { not: "done" }, deadline: { lt: startOfDay(now) } },
    }),
    database.scheduleProfile.findFirst({ where: { userId, deletedAt: null }, select: { timezone: true } }),
  ]);

  const tz = profile?.timezone || timezone;
  const fmtTime = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", timeZone: tz });

  const events = crypto.decryptMany("CalendarEvent", eventRows as Record<string, unknown>[]).map((e) => ({
    time: `${range === "week" ? fmtDay(new Date(e.start as string)) + " " : ""}${fmtTime(new Date(e.start as string))}`,
    title: String(e.title),
  }));

  const tasks = crypto.decryptMany("Todo", taskRows as Record<string, unknown>[]).map((t) => ({
    title: String(t.title),
    priority: String(t.priority),
    due: t.deadline ? fmtDay(new Date(t.deadline as string)) : undefined,
  }));

  const label =
    range === "day"
      ? now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: tz })
      : `${from.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz })} – ${new Date(to.getTime() - 1).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz })}`;

  return {
    range,
    label,
    firstName,
    events,
    tasks,
    overdue: overdueCount,
    freeTime: events.length + tasks.length <= 2,
  };
}
