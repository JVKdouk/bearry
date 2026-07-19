/**
 * The work personality (§9.1a).
 *
 * The solver used to know *when* you're available and nothing about *how* you
 * work, so it did the only thing it could: fill every open minute. That produces
 * the wall-of-blocks schedule — eighteen back-to-back items with a token
 * ten-minute gap — which is precisely the plan an ADHD brain bounces off.
 *
 * A persona answers the questions availability can't: how long can you actually
 * focus, how much rest do you need between sessions, how much work in a day is
 * realistic, how costly is *starting*, how hard is *stopping*, and how much of
 * your weekend is fair game.
 *
 * Stored as ordinary synced `setting` rows: no bespoke endpoint, edits work
 * offline like everything else, and the values stay cleartext so the solver
 * reads them without a decryption round-trip (§9.7).
 */

import database from "@/core/database";

export type Difficulty = "easy" | "moderate" | "hard";
export type WeekendMode = "none" | "light" | "full";
export type Flexibility = "rigid" | "balanced" | "fluid";

export type Persona = {
  /** Minutes of one focused work session. */
  sessionLength: number;
  /** Minutes of rest between sessions. */
  breakLength: number;
  /** Take a longer break after this many sessions. */
  longBreakEvery: number;
  longBreakLength: number;
  /** Ceiling on scheduled work per day — the main defence against overfilling. */
  dailyMaxMinutes: number;
  /** Ceiling on how many separate blocks land in one day (context switches). */
  maxSessionsPerDay: number;
  /** How hard it is to *begin* a task. */
  startDifficulty: Difficulty;
  /** How hard it is to *stop* once started (hyperfocus). */
  stopDifficulty: Difficulty;
  /** How much of the weekend the scheduler may use. */
  weekendMode: WeekendMode;
  /** How willing the planner is to move things around. */
  flexibility: Flexibility;
};

/**
 * Deliberately conservative. A schedule that under-promises and gets finished
 * builds trust; one that over-promises and gets abandoned destroys it — and for
 * this audience specifically, an unfinishable plan is worse than no plan.
 *
 * 4 sessions × 50 min = 3h20 of *actual* placed work per day. That reads low
 * next to an 8-hour working day, and that is the point: the rest of the day is
 * meetings, overrun, admin and life.
 */
export const DEFAULT_PERSONA: Persona = {
  sessionLength: 50,
  breakLength: 15,
  longBreakEvery: 3,
  longBreakLength: 30,
  dailyMaxMinutes: 240,
  maxSessionsPerDay: 5,
  startDifficulty: "moderate",
  stopDifficulty: "moderate",
  weekendMode: "light",
  flexibility: "balanced",
};

const KEY_PREFIX = "persona.";

function num(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function pick<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;
}

/** Build a persona from raw key/value settings, clamping anything nonsensical. */
export function personaFromSettings(rows: { key: string; value: string }[]): Persona {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.key.startsWith(KEY_PREFIX)) map.set(r.key.slice(KEY_PREFIX.length), r.value);
  }
  const d = DEFAULT_PERSONA;
  return {
    sessionLength: num(map.get("sessionLength"), d.sessionLength, 10, 240),
    breakLength: num(map.get("breakLength"), d.breakLength, 0, 120),
    longBreakEvery: num(map.get("longBreakEvery"), d.longBreakEvery, 1, 12),
    longBreakLength: num(map.get("longBreakLength"), d.longBreakLength, 0, 180),
    dailyMaxMinutes: num(map.get("dailyMaxMinutes"), d.dailyMaxMinutes, 30, 960),
    maxSessionsPerDay: num(map.get("maxSessionsPerDay"), d.maxSessionsPerDay, 1, 20),
    startDifficulty: pick(map.get("startDifficulty"), ["easy", "moderate", "hard"] as const, d.startDifficulty),
    stopDifficulty: pick(map.get("stopDifficulty"), ["easy", "moderate", "hard"] as const, d.stopDifficulty),
    weekendMode: pick(map.get("weekendMode"), ["none", "light", "full"] as const, d.weekendMode),
    flexibility: pick(map.get("flexibility"), ["rigid", "balanced", "fluid"] as const, d.flexibility),
  };
}

/** Load the user's persona (falling back to defaults for anything unset). */
export async function loadPersona(userId: string): Promise<Persona> {
  const rows = await database.setting.findMany({
    where: { userId, deletedAt: null, key: { startsWith: KEY_PREFIX } },
    select: { key: true, value: true },
  });
  return personaFromSettings(rows);
}

// --- Derived behaviour ----------------------------------------------------
// The two difficulty dials don't act directly; they shift concrete numbers the
// solver uses. Keeping that translation here means the solver stays readable and
// the reasoning is stated once, in words, where it can be argued with.

/**
 * Hard-to-start means every *separate* block costs real activation energy. So
 * fewer, longer sessions beat many short ones, and fragments below this size are
 * not worth scheduling at all — the start costs more than the work.
 */
export function minChunkFor(p: Persona): number {
  if (p.startDifficulty === "hard") return Math.min(45, p.sessionLength);
  if (p.startDifficulty === "easy") return 15;
  return 25;
}

/** Hard-to-start users get fewer, bigger blocks; easy starters can take more. */
export function sessionCapFor(p: Persona): number {
  if (p.startDifficulty === "hard") return Math.max(2, p.maxSessionsPerDay - 2);
  if (p.startDifficulty === "easy") return p.maxSessionsPerDay + 1;
  return p.maxSessionsPerDay;
}

/**
 * Hard-to-stop means a block reliably runs over. Rather than pretend it won't,
 * leave a landing strip after every session so the overrun lands in empty space
 * instead of colliding with the next commitment.
 */
export function overrunBufferFor(p: Persona): number {
  if (p.stopDifficulty === "hard") return 20;
  if (p.stopDifficulty === "moderate") return 10;
  return 0;
}

/** Hyperfocus can sustain a longer session; easy-stoppers do better in shorter ones. */
export function effectiveSessionLength(p: Persona): number {
  if (p.stopDifficulty === "hard") return Math.round(p.sessionLength * 1.25);
  return p.sessionLength;
}

/** Weekend appetite as a fraction of the weekday daily budget. */
export function weekendFactor(p: Persona): number {
  if (p.weekendMode === "none") return 0;
  if (p.weekendMode === "light") return 0.4;
  return 1;
}

/**
 * How much of the day's budget to actually commit. A rigid planner wants its
 * plan to hold, so it leaves more slack; a fluid one is happy to re-plan and can
 * run closer to the line.
 */
export function commitmentFactor(p: Persona): number {
  if (p.flexibility === "rigid") return 0.8;
  if (p.flexibility === "fluid") return 1;
  return 0.9;
}
