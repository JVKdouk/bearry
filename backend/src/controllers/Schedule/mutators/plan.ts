import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import { planForUser } from "@/src/lib/scheduler/service";

const Body = z.object({
  // Default horizon: now → +7 days. "Plan my day" passes a 1-day horizon.
  horizonStart: z.string().datetime().optional(),
  horizonEnd: z.string().datetime().optional(),
  // Plan only these tasks (swipe-to-plan one card, or a bulk selection).
  // Omitted / empty ⇒ plan everything schedulable in the horizon.
  taskIds: z.array(z.string()).max(200).optional(),
  // The device's IANA timezone, so working hours and days resolve in the user's
  // zone rather than the server's. Persisted to the profile on the way through.
  timezone: z.string().max(64).optional(),
  // Allow the planner to spill into evenings/weekends to fit a full week.
  overtime: z.boolean().optional(),
});

/**
 * "Plan my day/week" (§9.6). Runs the deterministic solver on cleartext metadata
 * (no decryption round-trip, §9.7) and returns a proposal the client reviews as a
 * diff — approve-don't-impose. Each block carries the solver's own plain-language
 * reason; nothing is written until the user accepts (see /schedule/apply).
 */
const plan: Endpoint = async (request) => {
  const b = Body.parse(request.body ?? {});
  const horizonStart = b.horizonStart ? new Date(b.horizonStart) : new Date();
  const horizonEnd = b.horizonEnd
    ? new Date(b.horizonEnd)
    : new Date(horizonStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const proposal = await planForUser(request.user.id, horizonStart, horizonEnd, {
    taskIds: b.taskIds,
    timezone: b.timezone,
    overtime: b.overtime,
  });
  return proposal;
};

plan.httpMethod = "POST";
plan.path = "/plan";

export default plan;
