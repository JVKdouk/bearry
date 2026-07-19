/**
 * Google Calendar plugin (§6). Emits EventBlocks. Full OAuth2 authorization-code
 * flow when GOOGLE_CLIENT_ID/SECRET are set: `getAuthUrl` builds the consent URL
 * (offline access + forced consent so Google returns a refresh token), `connect`
 * exchanges the code for a refresh token (the stored credential), and `pull`
 * refreshes an access token and lists the primary calendar's events. Without
 * OAuth creds it still accepts a pasted refresh token so the pipeline is testable.
 */

import type { IntegrationProvider } from "../types";
import type { EventBlock } from "../schema/blocks";
import {
  HAS_OAUTH,
  IDENTITY_SCOPES,
  NO_REFRESH_TOKEN_HELP,
  accessTokenFromRefresh,
  authUrlFor,
  emailFromIdToken,
  exchangeCode,
  googleGet,
} from "./googleOAuth";

const PROVIDER_ID = "google-calendar";
const SCOPE = `${IDENTITY_SCOPES} https://www.googleapis.com/auth/calendar.events`;

type GTime = { dateTime?: string; date?: string };
type GEvent = {
  id: string; status?: string; summary?: string; description?: string;
  location?: string; htmlLink?: string; start?: GTime; end?: GTime;
};

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
  const json = await googleGet<{ items?: GEvent[] }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    accessToken,
  );
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
  id: PROVIDER_ID,
  name: "Google Calendar",
  version: "1.0.0",
  category: "calendar",
  description: "See your events and let BearAI schedule around them.",
  authType: HAS_OAUTH ? "oauth2" : "token",
  scopes: [SCOPE],
  capabilities: { pull: ["event"], push: [] },
  available: true,
  trust: "first-party",

  getAuthUrl: HAS_OAUTH ? (state) => authUrlFor(PROVIDER_ID, SCOPE, state) : undefined,

  async connect(input) {
    if (HAS_OAUTH) {
      if (!input.code) throw new Error("Missing Google authorization code");
      const tokens = await exchangeCode(PROVIDER_ID, input.code);
      if (!tokens.refresh_token) {
        throw new Error(NO_REFRESH_TOKEN_HELP);
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
