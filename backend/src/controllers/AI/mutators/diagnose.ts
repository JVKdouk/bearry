import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import { planForUser } from "@/src/lib/scheduler/service";
import { diagnosePlan } from "@/src/lib/ai/diagnose";

import { chargeAi } from "@/src/lib/security/aiBudget";

const Body = z.object({
  horizonStart: z.string().datetime().optional(),
  horizonEnd: z.string().datetime().optional(),
});

/**
 * Explain a plan: why nothing could be scheduled, what's over capacity, what to
 * do next. Findings are computed arithmetically from the solver's own output,
 * so this works with no API key and no consent; AI only softens the headline.
 *
 * Uses cleartext metadata only — no titles are read or sent anywhere.
 */
const diagnose: Endpoint = async (request) => {
  const b = Body.parse(request.body ?? {});
  // One model call at most, and only to soften the headline — the diagnosis
  // itself is deterministic, so a refused charge costs nothing but polish.
  chargeAi(request.user.id, 1);
  const horizonStart = b.horizonStart ? new Date(b.horizonStart) : new Date();
  const horizonEnd = b.horizonEnd
    ? new Date(b.horizonEnd)
    : new Date(horizonStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const proposal = await planForUser(request.user.id, horizonStart, horizonEnd);

  // How much of the capacity maths rests on untouched default estimates.
  const defaultDurationCount = await database.block.count({
    where: {
      userId: request.user.id,
      deletedAt: null,
      letGoAt: null,
      status: { not: "done" },
      startTime: null,
      estimatedDuration: 30,
      category: null,
    },
  });

  const diagnosis = await diagnosePlan(
    request.user.id,
    proposal,
    horizonStart,
    horizonEnd,
    defaultDurationCount,
  );
  return diagnosis;
};

diagnose.httpMethod = "POST";
diagnose.path = "/diagnose";

export default diagnose;
