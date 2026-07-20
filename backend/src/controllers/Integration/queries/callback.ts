import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import { connectProvider } from "@/src/lib/integrations/service";
import { getProvider } from "@/src/lib/integrations/registry";
import { verifyOAuthState } from "@/src/lib/integrations/oauthState";

const Query = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

const FRONT = process.env.FRONT_END_ORIGIN ?? "http://localhost:8081";

/** A human name for the card, falling back to the raw id when unknown. */
function providerName(providerId?: string): string {
  if (!providerId) return "your account";
  return getProvider(providerId)?.name ?? providerId;
}

/**
 * The tiny page the popup lands on.
 *
 * Success closes itself and returns to the app. FAILURE stays open with the real
 * reason shown — a provider's OAuth error (redirect-URI mismatch, consent
 * declined, bad secret) is exactly what the person needs to read, and the old
 * page auto-closed it out of sight, so every failure looked like "nothing
 * happened". The heading/return link now follow the real provider instead of
 * being hardcoded to Google.
 */
function resultPage(
  status: "connected" | "error",
  opts: { providerId?: string; message?: string } = {},
): string {
  const name = providerName(opts.providerId);
  const back = `${FRONT}?integration=${encodeURIComponent(opts.providerId ?? "")}&status=${status}`;
  const ok = status === "connected";
  const heading = ok ? `${name} connected` : `Couldn’t connect ${name}`;
  const detail = ok ? "You can close this window." : (opts.message ?? "Please try again.");
  // Success returns automatically. An error stays put so the reason is readable,
  // with a manual close — auto-closing is what hid every failure before.
  const script = ok
    ? `<script>try{window.close()}catch(e){}setTimeout(function(){location.replace(${JSON.stringify(back)})},1200)</script>`
    : "";
  const closeBtn = ok
    ? ""
    : `<button onclick="try{window.close()}catch(e){}" style="margin-top:18px;background:#2a2a37;color:#e8e8ef;border:none;border-radius:8px;padding:9px 18px;font-size:14px;cursor:pointer">Close</button>`;
  return `<!doctype html><meta charset="utf-8"><title>${heading}</title>
<body style="font-family:system-ui,sans-serif;background:#0b0b12;color:#e8e8ef;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<div style="text-align:center;max-width:400px;padding:24px">
<h2 style="margin:0 0 8px">${heading}${ok ? " ✓" : ""}</h2>
<p style="color:#9aa;margin:0;line-height:1.5;word-break:break-word">${detail}</p>
${closeBtn}
</div>
${script}`;
}

/**
 * OAuth2 redirect target. A provider sends the browser here after consent.
 * PUBLIC — there's no session cookie on a cross-site redirect, so the user is
 * re-identified from the signed `state`. We exchange the code (inside the
 * provider) and store the encrypted credential.
 */
const callback: Endpoint = async (request, reply) => {
  const { code, state, error, error_description } = Query.parse(request.query ?? {});
  reply.header("Content-Type", "text/html; charset=utf-8");

  // The provider that failed before we can trust `state`: unknown, so generic.
  if (error || !code || !state) {
    const detail = error
      ? `The provider reported: ${error_description || error}`
      : "No authorization code came back — the sign-in didn't complete.";
    return reply.send(resultPage("error", { message: detail }));
  }

  let parsed;
  try {
    parsed = verifyOAuthState(state);
  } catch {
    return reply.send(
      resultPage("error", { message: "This sign-in link expired. Start again from Integrations." }),
    );
  }

  try {
    // A synthetic session id keys the decrypt rate-limiter/audit; the DEK itself
    // is unwrapped from the user's stored wrappedDEK (no live session needed).
    await connectProvider(parsed.userId, parsed.providerId, `oauth:${parsed.userId}`, { code });
    return reply.send(resultPage("connected", { providerId: parsed.providerId }));
  } catch (err) {
    // Log it too: the popup shows the user a reason, and the server keeps the
    // full one for diagnosis (provider error strings can be long/opaque).
    const message = err instanceof Error ? err.message : "Something went wrong.";
    console.error(`Integration connect failed [${parsed.providerId}]:`, message);
    return reply.send(resultPage("error", { providerId: parsed.providerId, message }));
  }
};

callback.httpMethod = "GET";
callback.path = "/:providerId/callback";
callback.isPublic = true;

export default callback;
