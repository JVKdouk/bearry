/**
 * ICS calendar subscription plugin — first-party, fully working, no external
 * credentials needed. Point it at any public `.ics` URL (Google/Outlook/Apple
 * all expose these) and it imports events as EventBlocks. It doubles as the
 * reference implementation of a complete plugin: fetch → map to canonical blocks
 * → return; the platform validates and ingests.
 */

import type { IntegrationProvider } from "../types";
import { safeFetchText } from "../safeFetch";
import { parseRRule } from "@/src/lib/recurrence/rrule";

/** Minimal, dependency-free VEVENT parser (enough for standard feeds). */
function parseIcs(text: string): {
  sourceId: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  recurrenceRule?: string;
}[] {
  const unfolded = text.replaceAll(/\r\n[ \t]/g, ""); // RFC 5545 line unfolding
  const events: ReturnType<typeof parseIcs> = [];
  const blocks = unfolded.split("BEGIN:VEVENT").slice(1);
  for (const b of blocks) {
    const body = b.split("END:VEVENT")[0];
    const get = (key: string) => {
      const m = body.match(new RegExp(String.raw`\n${key}(?:;[^:]*)?:(.*)`));
      return m ? m[1].trim() : undefined;
    };
    const uid = get("UID") ?? Math.random().toString(36).slice(2);
    const summary = get("SUMMARY") ?? "(untitled event)";
    const dtstart = toIso(get("DTSTART"));
    const dtend = toIso(get("DTEND")) ?? dtstart;
    if (!dtstart || !dtend) continue;
    // A repeating event is ONE commitment with a rule, not one row per
    // occurrence. Carrying the RRULE through means a weekly stand-up imports as
    // a single recurring event the scheduler can reason about, instead of the
    // feed's expanded copies (or, worse, only its first instance).
    const rrule = get("RRULE");

    events.push({
      sourceId: uid,
      title: summary,
      start: dtstart,
      end: dtend,
      location: get("LOCATION"),
      description: get("DESCRIPTION"),
      // Only pass rules the platform can actually evaluate; an unparseable one
      // is dropped so the event stays a reliable one-off rather than a guess.
      recurrenceRule: rrule && parseRRule(rrule) ? rrule : undefined,
    });
  }
  return events;
}

/** Convert an ICS date (YYYYMMDD or YYYYMMDDTHHMMSSZ) to ISO-8601. */
function toIso(v?: string): string | undefined {
  if (!v) return undefined;
  const m = v.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return undefined;
  const [, y, mo, d, h = "00", mi = "00", s = "00", z] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  return z ? `${iso}Z` : `${iso}Z`; // treat naive times as UTC for determinism
}

export const icsCalendarProvider: IntegrationProvider = {
  id: "ics-calendar",
  name: "Calendar (.ics URL)",
  version: "1.0.0",
  category: "calendar",
  description: "Subscribe to any public calendar link (Google, Outlook, Apple).",
  authType: "token", // the "token" here is the ICS URL
  secretLabel: "Calendar URL",
  secretPlaceholder: "https://calendar.google.com/calendar/ical/…/basic.ics",
  secretHelp:
    "Any public .ics link. In Google Calendar: Settings → your calendar → “Secret address in iCal format”. Add one link per calendar.",
  icon: "🔗",
  capabilities: { pull: ["event"], push: [] },
  available: true,
  trust: "first-party",

  async connect(input) {
    const url = input.secret?.trim();
    if (!url || !/^https?:\/\//.test(url)) throw new Error("Paste a public https .ics calendar URL");
    // The feed URL is the account identity, so several calendars can be
    // subscribed at once. Label with the file/host for something readable.
    let label = url;
    try {
      const u = new URL(url);
      const file = u.pathname.split("/").findLast(Boolean);
      label = file ? `${u.hostname} · ${decodeURIComponent(file)}` : u.hostname;
    } catch {
      /* keep the raw url */
    }
    return { credential: url, meta: { url }, accountKey: url, label };
  },

  async pull(ctx) {
    const url = await ctx.getCredential();
    if (!url) return { blocks: [] };
    ctx.log(`fetching ${url}`);
    // SSRF-hardened: blocks internal/metadata hosts, caps size, enforces timeout.
    const text = await safeFetchText(url, "text/calendar");
    const events = parseIcs(text);
    ctx.log(`parsed ${events.length} events`);
    // Map to canonical EventBlocks (the platform validates these).
    return { blocks: events.map((e) => ({ type: "event", ...e })) };
  },
};
