/**
 * Google Calendar plugin (§6). Emits EventBlocks. Full OAuth2 authorization-code
 * flow when GOOGLE_CLIENT_ID/SECRET are set: `getAuthUrl` builds the consent URL
 * (offline access + forced consent so Google returns a refresh token), `connect`
 * exchanges the code for a refresh token (the stored credential), and `pull`
 * refreshes an access token and lists the primary calendar's events. Without
 * OAuth creds it still accepts a pasted refresh token so the pipeline is testable.
 */

// Side-effect import: guarantees dotenv has populated process.env before the
// module-level reads below. Without it the bundled build can evaluate this file
// before core/config runs, silently leaving OAuth "unconfigured" in production
// even though the credentials are present in .env.
import "@/core/config";

import type { IntegrationProvider } from "../types";
import type { EventBlock } from "../schema/blocks";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const HAS_OAUTH = !!(CLIENT_ID && CLIENT_SECRET);
// `openid email` lets us learn WHICH Google account was just connected, so the
// same user can attach several accounts and tell them apart. The identity comes
// back in the id_token of the token exchange — no extra API call, and no access
// to anything beyond the address itself.
const SCOPE = "openid email https://www.googleapis.com/auth/calendar.events";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Where Google sends the browser after consent — must EXACTLY match a redirect
 *  URI registered on the OAuth client in Google Cloud Console. */
const REDIRECT_URI =
  `${process.env.OAUTH_REDIRECT_BASE ?? `http://localhost:${process.env.SERVER_PORT ?? 20001}`}` +
  `/integrations/google-calendar/callback`;

type GTime = { dateTime?: string; date?: string };
type GEvent = {
  id: string; status?: string; summary?: string; description?: string;
  location?: string; htmlLink?: string; start?: GTime; end?: GTime;
};

async function postForm(body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail = (json.error_description ?? json.error ?? res.statusText) as string;
    throw new Error(`Google auth failed (${res.status}): ${detail}`);
  }
  return json;
}

async function exchangeCode(code: string): Promise<{ refresh_token?: string; id_token?: string }> {
  return postForm({
    code, client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!,
    redirect_uri: REDIRECT_URI, grant_type: "authorization_code",
  });
}

/**
 * Read the account email out of the id_token. The token came straight from
 * Google's token endpoint over TLS, so we decode the payload for its claim
 * rather than verifying a signature we already trust the transport for; it is
 * used only as a local label/dedupe key, never as an authorization decision.
 */
function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const email = typeof json.email === "string" ? json.email.trim().toLowerCase() : null;
    return email || null;
  } catch {
    return null;
  }
}

async function accessTokenFromRefresh(refreshToken: string): Promise<string> {
  const json = await postForm({
    refresh_token: refreshToken, client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
  const token = json.access_token as string | undefined;
  if (!token) throw new Error("Google did not return an access token");
  return token;
}

/**
 * `singleEvents: true` asks Google to expand recurring events into concrete
 * instances, and that is deliberate — do not "optimise" it into importing the
 * master with its RRULE.
 *
 * We do have our own RRULE engine, and one row would certainly be tidier than
 * sixty. But Google's expansion also applies the things our engine does not
 * model: EXDATE cancellations and individually-moved instances. Importing the
 * bare rule would mean showing a stand-up that the user cancelled last Tuesday,
 * or showing it at the old time after they moved that one instance. A phantom
 * meeting is worse than a redundant row: you plan around it.
 *
 * ICS feeds are handled the other way (rule carried through, expanded client-
 * side) because those feeds are typically small, static, and exception-free.
 */
async function listEvents(accessToken: string): Promise<GEvent[]> {
  const now = Date.now();
  const params = new URLSearchParams({
    singleEvents: "true", orderBy: "startTime", maxResults: "250",
    timeMin: new Date(now - 7 * 86_400_000).toISOString(),
    timeMax: new Date(now + 60 * 86_400_000).toISOString(),
  });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Google events.list failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { items?: GEvent[] };
  return json.items ?? [];
}

/** Map one Google event to a canonical EventBlock (or null to skip). */
function toEventBlock(ev: GEvent): EventBlock | null {
  if (ev.status === "cancelled" || !ev.id) return null;
  const allDay = !!ev.start?.date && !ev.start?.dateTime;
  const startRaw = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
  const endRaw = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null);
  if (!startRaw || !endRaw) return null;
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
  return {
    type: "event",
    sourceId: ev.id,
    title: (ev.summary ?? "(no title)").slice(0, 1000),
    start: start.toISOString(),
    end: end.toISOString(),
    allDay,
    location: ev.location?.slice(0, 1000) || undefined,
    description: ev.description?.slice(0, 10_000) || undefined,
    url: ev.htmlLink && /^https?:\/\//.test(ev.htmlLink) ? ev.htmlLink.slice(0, 2000) : undefined,
  };
}

export const googleCalendarProvider: IntegrationProvider = {
  id: "google-calendar",
  name: "Google Calendar",
  version: "1.0.0",
  category: "calendar",
  description: "See your events and let BearAI schedule around them.",
  authType: HAS_OAUTH ? "oauth2" : "token",
  scopes: [SCOPE],
  capabilities: { pull: ["event"], push: [] },
  available: true,
  trust: "first-party",

  getAuthUrl: HAS_OAUTH
    ? (state) => {
        const params = new URLSearchParams({
          client_id: CLIENT_ID!,
          redirect_uri: REDIRECT_URI,
          response_type: "code",
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
          scope: SCOPE,
          state,
        });
        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      }
    : undefined,

  async connect(input) {
    if (HAS_OAUTH) {
      if (!input.code) throw new Error("Missing Google authorization code");
      const tokens = await exchangeCode(input.code);
      if (!tokens.refresh_token) {
        throw new Error("Google didn't return a refresh token. Remove BearAI under your Google Account → Security → Third-party access, then reconnect.");
      }
      const email = emailFromIdToken(tokens.id_token);
      return {
        credential: tokens.refresh_token,
        meta: { scopes: SCOPE, accountEmail: email },
        // Distinct per Google account => connecting a second one adds a
        // connection instead of overwriting the first.
        accountKey: email ?? undefined,
        label: email ?? undefined,
      };
    }
    if (!input.secret) throw new Error("A Google refresh token is required");
    return { credential: input.secret, meta: { scopes: input.scopes ?? "calendar.events" } };
  },

  async pull(ctx) {
    const refreshToken = await ctx.getCredential();
    if (!refreshToken) {
      ctx.log("no credential; skipping");
      return { blocks: [] };
    }
    const accessToken = await accessTokenFromRefresh(refreshToken);
    ctx.log("fetching Google Calendar events");
    const events = await listEvents(accessToken);
    const blocks = events.map(toEventBlock).filter((b): b is EventBlock => b !== null);
    ctx.log(`fetched ${blocks.length} events`);
    return { blocks, cursor: null };
  },

  async disconnect() {
    // Best-effort: Google refresh tokens are revoked from the user's account page;
    // we simply drop the stored credential (service deletes the row).
  },
};
