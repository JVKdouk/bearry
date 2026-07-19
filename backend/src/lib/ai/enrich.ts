/**
 * Task enrichment — better *inputs* for the deterministic solver (§9).
 *
 * The scheduler is good but starved: almost every task arrives with the
 * defaults (30 min, medium energy, no category), so `energyFit()` and
 * `categoryFit()` have nothing to work with, and imported date-markers like
 * "Udai's Birthday" get scheduled as 30-minute work blocks.
 *
 * Two stages, mirroring capture/classifier.ts: an algorithmic pass that always
 * works, and an AI pass that upgrades it when the user has opted in. The AI is
 * never a dependency. Nothing is written here — suggestions go back to the
 * client, which applies them through the normal sync path (approve-don't-impose).
 */

import { z } from "zod";
import { generateJSON, aiAvailable } from "./gemini";
import { SAFETY_RULES, dataBlock } from "./prompt";

export const ENRICHER_VERSION = "enrich-v1";

export type TaskKind = "task" | "reminder";
export type Energy = "high" | "medium" | "low";
export type LifeArea =
  | "work" | "focus" | "personal" | "family"
  | "errand" | "sleep" | "meal" | "other";

export interface EnrichInput {
  id: string;
  title: string;
  notes?: string | null;
  estimatedDuration: number;
  energyDemand: Energy;
  category: LifeArea | null;
}

export interface Enrichment {
  todoId: string;
  /** "reminder" = a date marker (birthday, anniversary) with no work to do. */
  kind: TaskKind;
  estimatedDuration: number;
  energyDemand: Energy;
  category: LifeArea | null;
  confidence: number;
  reason: string;
  source: "ai" | "heuristic";
}

// Date-markers masquerading as tasks. Multilingual because imports are.
const REMINDER_PATTERNS = [
  /\bbirthday\b/i, /\bb-?day\b/i, /\banniversar/i,
  /\bania?versário\b/i, /\bcumplea/i, /\bgeburtstag\b/i,
];

const ERRAND_HINTS = /\b(pay|buy|pick up|drop off|renew|book|call|email|schedule|comprar|pagar|marcar)\b/i;
const FOCUS_HINTS = /\b(write|draft|design|plan|review|analy[sz]e|study|research|code|escrever|estudar)\b/i;
const HEALTH_HINTS = /\b(gym|pilates|therapy|physio|workout|run|dentist|doctor|terapia|academia|m[ée]dico)\b/i;
const WORK_HINTS = /\b(invoice|client|meeting|report|deploy|standup|taxes|accountant|contrato|imposto)\b/i;

/** Always-available pass: catches the cases that actually hurt the scheduler. */
export function heuristicEnrich(t: EnrichInput): Enrichment {
  const text = `${t.title} ${t.notes ?? ""}`;

  if (REMINDER_PATTERNS.some((re) => re.test(text))) {
    return {
      todoId: t.id,
      kind: "reminder",
      // Zero duration => the solver treats it as a date marker, not work.
      estimatedDuration: 0,
      energyDemand: "low",
      category: t.category ?? "personal",
      confidence: 0.8,
      reason: "Looks like a date to remember rather than work to do.",
      source: "heuristic",
    };
  }

  let category: LifeArea | null = t.category;
  if (!category) {
    if (HEALTH_HINTS.test(text)) category = "personal";
    else if (WORK_HINTS.test(text)) category = "work";
    else if (FOCUS_HINTS.test(text)) category = "focus";
    else if (ERRAND_HINTS.test(text)) category = "errand";
  }

  const energy: Energy = FOCUS_HINTS.test(text)
    ? "high"
    : ERRAND_HINTS.test(text)
      ? "low"
      : t.energyDemand;

  // Short admin verbs are rarely a 30-minute block.
  const duration = ERRAND_HINTS.test(text) && t.estimatedDuration === 30 ? 15 : t.estimatedDuration;

  return {
    todoId: t.id,
    kind: "task",
    estimatedDuration: duration,
    energyDemand: energy,
    category,
    confidence: 0.4,
    reason: "Estimated from the wording of the task.",
    source: "heuristic",
  };
}

const AiItem = z.object({
  id: z.string(),
  kind: z.enum(["task", "reminder"]),
  minutes: z.number().int().min(0).max(480),
  energy: z.enum(["high", "medium", "low"]),
  category: z.enum([
    "work", "focus", "personal", "family",
    "errand", "sleep", "meal", "other",
  ]).nullable(),
  confidence: z.number().min(0).max(1),
  why: z.string().max(200),
});
const AiResponse = z.object({ items: z.array(AiItem) });

function buildPrompt(tasks: EnrichInput[]): string {
  const lines = tasks.map((t) =>
    `${t.id} :: ${t.title}${t.notes ? ` :: ${t.notes.slice(0, 160)}` : ""}`,
  );
  return [
    "You estimate scheduling metadata for tasks belonging to a person with ADHD.",
    "",
    "RULES:",
    SAFETY_RULES,
    '- "reminder" = a date to remember with no work to perform (birthdays, anniversaries, renewals that only need noting). Reminders MUST have minutes = 0.',
    '- "task" = something requiring working time. Estimate realistic focused minutes (5-480), erring slightly generous; ADHD users under-estimate.',
    "- energy: high = deep focus/cognitively demanding, low = mechanical admin.",
    "- category must be one of work, focus, personal, family, errand, sleep, meal, other, or null when genuinely unclear.",
    "- confidence 0-1. Be honest; low confidence is fine.",
    "- Return one item per input id, ids copied exactly.",
    "",
    "Each DATA line is: id :: title :: optional notes",
    dataBlock(lines.join("\n")),
    "",
    'Respond as: {"items":[{"id":"...","kind":"task","minutes":30,"energy":"medium","category":"work","confidence":0.7,"why":"short reason"}]}',
  ].join("\n");
}

/**
 * Enrich a batch. Falls back to the heuristic per-item whenever AI is
 * unavailable, unparseable, or silent about an id.
 */
export async function enrichTasks(
  userId: string,
  tasks: EnrichInput[],
): Promise<Enrichment[]> {
  const fallback = tasks.map(heuristicEnrich);
  if (tasks.length === 0 || !(await aiAvailable(userId))) return fallback;

  const ai = await generateJSON(buildPrompt(tasks), AiResponse).catch(() => null);
  if (!ai) return fallback;

  const byId = new Map(ai.items.map((i) => [i.id, i]));
  return tasks.map((t, i) => {
    const got = byId.get(t.id);
    if (!got) return fallback[i];
    return {
      todoId: t.id,
      kind: got.kind,
      // Enforce the invariant rather than trusting the model to hold it.
      estimatedDuration: got.kind === "reminder" ? 0 : Math.max(5, got.minutes),
      energyDemand: got.energy,
      category: got.category,
      confidence: got.confidence,
      reason: got.why,
      source: "ai" as const,
    };
  });
}
