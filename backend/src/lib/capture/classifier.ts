/**
 * Capture triage — Stage 1, algorithmic (§8.6).
 *
 * Ships first, always works, needs no model and no decryption round-trip. Every
 * capture produces the SAME output shape as the future AI stage
 * (`proposedType`, `suggestedProjectId`, `extractedFields`, `confidence`,
 * `classifierVersion`), so the triage UI is identical and AI is a drop-in
 * upgrade, never a dependency. Low-confidence items present honestly as
 * "needs review", never as a confidently-wrong auto-task.
 *
 * This module is pure (no DB, no keys) so it's trivially unit-testable and can
 * run on-device or server-side unchanged.
 */

import * as chrono from "chrono-node";

export const CLASSIFIER_VERSION = "algo-v1";

export type ProposedType = "task" | "note" | "event" | "trash";

export type ProjectHint = {
  id: string;
  /** Lowercased keywords/name the matcher scores against. */
  keywords: string[];
};

export type ClassifierInput = {
  text: string;
  source: "share" | "email" | "voice" | "screenshot" | "manual";
  /** Sender/domain for email captures (e.g. "stripe.com"). */
  senderDomain?: string;
  /** Existing projects to suggest against. */
  projects?: ProjectHint[];
  /** Explicit user rules: domain/keyword → projectId ("stripe.com → Finances"). */
  rules?: { match: string; projectId: string }[];
  /** Reference "now" for deterministic date resolution (tests pass a fixed date). */
  now?: Date;
};

export type ExtractedFields = {
  title: string;
  date?: string; // ISO
  endDate?: string; // ISO (for ranged events)
  durationMinutes?: number;
  url?: string;
};

export type Classification = {
  proposedType: ProposedType;
  suggestedProjectId: string | null;
  extractedFields: ExtractedFields;
  confidence: number; // 0..1
  classifierVersion: string;
};

// Imperative verbs that signal a task ("send report", "call the dentist").
const ACTION_VERBS = [
  "send", "call", "email", "buy", "book", "schedule", "finish", "write", "fix",
  "review", "pay", "submit", "renew", "cancel", "pick up", "drop off", "reply",
  "read", "watch", "prepare", "plan", "check", "update", "clean", "order",
  "message", "text", "ask", "confirm", "print", "sign", "file", "return",
];

// Words that hint at a calendar event rather than a task.
const EVENT_WORDS = [
  "meeting", "appointment", "call with", "lunch with", "dinner with", "sync",
  "standup", "interview", "flight", "birthday", "party", "webinar", "class",
];

const PROMO_MARKERS = [
  "unsubscribe", "% off", "sale ends", "limited time", "act now", "click here",
  "you have won", "verify your account", "free trial", "promo code",
];

const URL_RE = /https?:\/\/[^\s]+/i;
const DURATION_RE =
  /\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/i;

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0]?.trim() ?? "";
}

function titleCaseFallback(text: string): string {
  const line = firstLine(text);
  return line.length > 80 ? line.slice(0, 77).trimEnd() + "…" : line;
}

function startsWithActionVerb(lower: string): boolean {
  return ACTION_VERBS.some((v) => lower === v || lower.startsWith(v + " "));
}

function containsAny(lower: string, words: string[]): boolean {
  return words.some((w) => lower.includes(w));
}

function parseDuration(text: string): number | undefined {
  const m = text.match(DURATION_RE);
  if (!m) return undefined;
  const value = Number.parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  return unit.startsWith("h") ? Math.round(value * 60) : Math.round(value);
}

/** Score a project suggestion; returns the best {id, score} or null. */
function suggestProject(input: ClassifierInput, lower: string): { id: string; score: number } | null {
  // 1. Explicit user rules win outright (domain or keyword match).
  for (const rule of input.rules ?? []) {
    const m = rule.match.toLowerCase();
    if ((input.senderDomain && input.senderDomain.toLowerCase().includes(m)) || lower.includes(m)) {
      return { id: rule.projectId, score: 1 };
    }
  }
  // 2. Keyword overlap against existing projects.
  let best: { id: string; score: number } | null = null;
  for (const p of input.projects ?? []) {
    let hits = 0;
    for (const kw of p.keywords) {
      if (kw && lower.includes(kw.toLowerCase())) hits += 1;
    }
    if (hits > 0) {
      const score = Math.min(0.9, 0.4 + 0.2 * hits);
      if (!best || score > best.score) best = { id: p.id, score };
    }
  }
  return best;
}

/**
 * Classify a single capture. Deterministic given `now`; the same input always
 * yields the same triage output — trust through legibility (§1.4 p5).
 */
export function classify(input: ClassifierInput): Classification {
  const text = input.text.trim();
  const lower = text.toLowerCase();
  const now = input.now ?? new Date();

  const urlMatch = text.match(URL_RE);
  const parsed = chrono.parse(text, now, { forwardDate: true });
  const hasDate = parsed.length > 0;
  const firstDate = hasDate ? parsed[0].start.date() : undefined;
  const endDate = hasDate && parsed[0].end ? parsed[0].end.date() : undefined;
  const durationMinutes = parseDuration(text);

  // ── Type detection by source + structure (§8.6 Stage 1) ──────────────────
  let proposedType: ProposedType;
  let confidence: number;

  const isPromo = containsAny(lower, PROMO_MARKERS);
  const isBareUrl = !!urlMatch && text.replace(URL_RE, "").trim().length <= 3;
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  if (isPromo && input.source !== "manual") {
    proposedType = "trash";
    confidence = 0.55; // honest: a trash *candidate*, still shown for review
  } else if (containsAny(lower, EVENT_WORDS) && hasDate) {
    proposedType = "event";
    confidence = 0.85;
  } else if (input.source === "share" && isBareUrl) {
    proposedType = "note"; // a bookmark
    confidence = 0.7;
  } else if (startsWithActionVerb(lower)) {
    proposedType = "task";
    confidence = hasDate ? 0.9 : 0.75;
  } else if (hasDate && wordCount <= 12) {
    // short + dated, no clear verb: lean task but flag for review
    proposedType = "task";
    confidence = 0.6;
  } else if (wordCount <= 6 && !hasDate) {
    proposedType = "note";
    confidence = 0.65;
  } else {
    proposedType = "note";
    confidence = 0.55;
  }

  // ── Title extraction: strip the URL, keep it human ───────────────────────
  let title = titleCaseFallback(isBareUrl ? "Bookmark" : text);
  if (isBareUrl) {
    // Best-effort readable label from the URL host/path.
    try {
      const u = new URL(urlMatch![0]);
      title = (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/$/, "");
    } catch {
      /* keep fallback */
    }
  }

  const suggestion = suggestProject(input, lower);
  // A strong project match nudges confidence up a touch.
  if (suggestion) confidence = Math.min(0.95, confidence + 0.05);

  const extractedFields: ExtractedFields = {
    title,
    ...(firstDate ? { date: firstDate.toISOString() } : {}),
    ...(endDate ? { endDate: endDate.toISOString() } : {}),
    ...(durationMinutes ? { durationMinutes } : {}),
    ...(urlMatch ? { url: urlMatch[0] } : {}),
  };

  return {
    proposedType,
    suggestedProjectId: suggestion?.id ?? null,
    extractedFields,
    confidence: Math.round(confidence * 100) / 100,
    classifierVersion: CLASSIFIER_VERSION,
  };
}
