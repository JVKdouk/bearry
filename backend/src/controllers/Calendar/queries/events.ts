import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";
import { ensureEnergyWindows } from "@/src/lib/scheduler/defaults";

const Query = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

/**
 * Everything needed to render the calendar grid for a window (§8.4): events
 * (Google + BearAI blocks), time blocks, and the energy windows drawn as a
 * subtle tint (§9.4a). Titles/labels are decrypted; energy windows are
 * cleartext config.
 */
const calendarEvents: Endpoint = async (request) => {
  const { from, to } = Query.parse(request.query ?? {});
  const start = new Date(from);
  const end = new Date(to);

  const [eventRows, blockRows, energy] = await Promise.all([
    database.calendarEvent.findMany({
      where: { userId: request.user.id, deletedAt: null, start: { lt: end }, end: { gt: start } },
      orderBy: { start: "asc" },
    }),
    database.timeBlock.findMany({
      where: { userId: request.user.id, deletedAt: null, start: { lt: end }, end: { gt: start } },
      orderBy: { start: "asc" },
    }),
    ensureEnergyWindows(request.user.id),
  ]);

  const crypto = await requestCrypto(request, Math.max(eventRows.length + blockRows.length, 1));

  const events = crypto.decryptMany("CalendarEvent", eventRows as Record<string, unknown>[]).map((e) => ({
    id: e.id,
    source: e.source,
    title: e.title,
    description: e.description ?? null,
    location: e.location ?? null,
    start: e.start,
    end: e.end,
    isFixed: e.isFixed,
    bearaiTaskId: e.bearaiTaskId ?? null,
    scheduleReason: e.scheduleReason ?? null,
  }));

  const timeBlocks = crypto.decryptMany("TimeBlock", blockRows as Record<string, unknown>[]).map((b) => ({
    id: b.id,
    label: b.label ?? null,
    start: b.start,
    end: b.end,
    type: b.type,
  }));

  const energyWindows = energy.map((w) => ({
    id: w.id,
    dayMask: w.dayMask,
    start: w.start,
    end: w.end,
    energyLevel: w.energyLevel,
  }));

  return { events, timeBlocks, energyWindows };
};

calendarEvents.httpMethod = "GET";
calendarEvents.path = "/events";

export default calendarEvents;
