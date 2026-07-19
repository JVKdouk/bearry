import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import { connectProvider } from "@/src/lib/integrations/service";
import { verifyOAuthState } from "@/src/lib/integrations/oauthState";

const Query = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

const FRONT = process.env.FRONT_END_ORIGIN ?? "http://localhost:8081";

/** A tiny self-closing page for the popup; falls back to returning to the app. */
function resultPage(status: "connected" | "error", message?: string): string {
  const back = `${FRONT}?integration=google-calendar&status=${status}`;
  const heading = status === "connected" ? "Google Calendar connected" : "Couldn’t connect";
  const detail = status === "connected" ? "You can close this window." : (message ?? "Please try again.");
  return `<!doctype html><meta charset="utf-8"><title>${heading}</title>
<body style="font-family:system-ui,sans-serif;background:#0b0b12;color:#e8e8ef;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<div style="text-align:center;max-width:340px;padding:24px">
<h2 style="margin:0 0 8px">${heading}${status === "connected" ? " ✓" : ""}</h2>
<p style="color:#9aa;margin:0">${detail}</p>
</div>
<script>try{window.close()}catch(e){}setTimeout(function(){location.replace(${JSON.stringify(back)})},1200)</script>`;
}

/**
 * OAuth2 redirect target for oauth providers. Google (or any oauth2 provider)
 * sends the browser here after consent. PUBLIC — there's no session cookie on a
 * cross-site redirect, so the user is re-identified from the signed `state`. We
 * exchange the code (inside the provider) and store the encrypted credential.
 */
const callback: Endpoint = async (request, reply) => {
  const { code, state, error } = Query.parse(request.query ?? {});
  reply.header("Content-Type", "text/html; charset=utf-8");

  if (error || !code || !state) {
    return reply.send(resultPage("error", error ? `Google reported: ${error}` : "Missing authorization code."));
  }

  let parsed;
  try {
    parsed = verifyOAuthState(state);
  } catch {
    return reply.send(resultPage("error", "This sign-in link expired. Start again from Integrations."));
  }

  try {
    // A synthetic session id keys the decrypt rate-limiter/audit; the DEK itself
    // is unwrapped from the user's stored wrappedDEK (no live session needed).
    await connectProvider(parsed.userId, parsed.providerId, `oauth:${parsed.userId}`, { code });
    return reply.send(resultPage("connected"));
  } catch (err) {
    return reply.send(resultPage("error", err instanceof Error ? err.message : undefined));
  }
};

callback.httpMethod = "GET";
callback.path = "/:providerId/callback";
callback.isPublic = true;

export default callback;
