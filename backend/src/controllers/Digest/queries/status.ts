import { Endpoint } from "@/core/server/endpoints/types";
import { getSetting } from "@/src/lib/settings";
import { geminiEnabled } from "@/src/lib/ai/gemini";
import { emailEnabled, emailTransport, verifyEmail } from "@/src/lib/email/send";
import { z } from "zod";

const Query = z.object({ verify: z.enum(["1", "true"]).optional() });

/** Digest configuration for the current user + server capability flags. */
const status: Endpoint = async (request) => {
  const uid = request.user.id;
  const { verify } = Query.parse(request.query ?? {});
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
    // Only on request: verifying opens a real SMTP connection, which is far too
    // slow to do on every settings page load. Configuration being *present*
    // isn't the same as it working — a Gmail account password where an App
    // Password is required looks correctly configured and fails at send time,
    // so this is the difference between "we think it's fine" and "we checked".
    ...(verify ? { verified: await verifyEmail() } : {}),
  };
};

status.httpMethod = "GET";
status.path = "/status";

export default status;
