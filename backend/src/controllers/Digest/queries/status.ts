import { Endpoint } from "@/core/server/endpoints/types";
import { getSetting } from "@/src/lib/settings";
import { geminiEnabled } from "@/src/lib/ai/gemini";
import { emailEnabled, emailTransport } from "@/src/lib/email/send";

/** Digest configuration for the current user + server capability flags. */
const status: Endpoint = async (request) => {
  const uid = request.user.id;
  const [daily, weekly, aiConsent] = await Promise.all([
    getSetting(uid, "digest_daily"),
    getSetting(uid, "digest_weekly"),
    getSetting(uid, "digest_ai_consent"),
  ]);
  return {
    email: request.user.email,
    daily: daily === "on",
    weekly: weekly === "on",
    aiConsent: aiConsent === "on",
    serverEmail: emailEnabled(),
    // Which transport is actually wired up, so Settings can say "Gmail" rather
    // than leaving the user guessing why a digest didn't arrive.
    emailTransport: emailTransport(),
    serverGemini: geminiEnabled(),
  };
};

status.httpMethod = "GET";
status.path = "/status";

export default status;
