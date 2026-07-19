import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import { setSetting } from "@/src/lib/settings";

const Body = z.object({
  daily: z.boolean().optional(),
  weekly: z.boolean().optional(),
  aiConsent: z.boolean().optional(),
});

const onoff = (b: boolean) => (b ? "on" : "off");

/** Toggle daily/weekly email digests and Gemini phrasing consent. */
const settings: Endpoint = async (request) => {
  const b = Body.parse(request.body ?? {});
  const uid = request.user.id;
  if (b.daily !== undefined) await setSetting(uid, "digest_daily", onoff(b.daily));
  if (b.weekly !== undefined) await setSetting(uid, "digest_weekly", onoff(b.weekly));
  if (b.aiConsent !== undefined) await setSetting(uid, "digest_ai_consent", onoff(b.aiConsent));
  return { ok: true };
};

settings.httpMethod = "POST";
settings.path = "/settings";

export default settings;
