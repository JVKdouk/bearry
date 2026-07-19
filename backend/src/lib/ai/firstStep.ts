/**
 * First-step generation — the ADHD "doing" layer (§ Phase 6).
 *
 * Task initiation, not planning, is the usual blocker: a task sits untouched
 * because its first move is undefined. The schema already anticipates this
 * (`TaskStep.isFirstStep`); this fills it.
 *
 * This used to be AI-only, on the reasoning that decomposing a task needs
 * language understanding. In practice that made the feature fail closed: when
 * Gemini was rate-limited (429) the button returned nothing and the UI blamed
 * the user's content — "no steps suggested", no matter what the task said.
 *
 * So there are two tiers, matching how enrichment and diagnosis already work:
 * a deterministic pass that always produces *something* actionable, and an AI
 * pass that produces something better when it's available. The deterministic
 * one leans on the fact that the highest-value first step is usually mechanical
 * — open the thing, find the number, get it in front of you — which is exactly
 * the part a template can supply.
 */

import { z } from "zod";
import { generateJSON, aiAvailable } from "./gemini";
import { SAFETY_RULES, dataBlock } from "./prompt";

export interface FirstStepInput {
  title: string;
  notes?: string | null;
  estimatedDuration: number;
}

const AiSteps = z.object({
  steps: z.array(z.string().min(1).max(140)).min(1).max(4),
});

export interface StepSuggestion {
  /** Ordered; the first is deliberately tiny enough to start right now. */
  steps: string[];
  /**
   * Where these came from. Worth reporting honestly: "AI suggested these" and
   * "we reformatted your own notes" deserve different trust from the user, and
   * silently calling both "AI" is how a rate-limited provider ends up looking
   * like a bad model.
   */
  source: "ai" | "notes" | "template";
}

/**
 * Verb patterns worth recognising, each with the concrete opening move that
 * usually unsticks it. Order matters — the first match wins — so the more
 * specific patterns come first.
 */
const PATTERNS: { test: RegExp; steps: (subject: string) => string[] }[] = [
  {
    test: /\b(pay|invoice|bill|renew|subscription|fatura|pagar)\b/i,
    steps: (s) => [`Open the app or site for ${s}`, "Find the exact amount and due date", "Make the payment and screenshot the confirmation"],
  },
  {
    test: /\b(email|reply|respond|write to|send.*(message|note)|responder)\b/i,
    steps: (s) => [`Open a blank draft addressed to whoever ${s} concerns`, "Write one sentence saying what you need", "Send it — it doesn't need to be polished"],
  },
  {
    test: /\b(call|phone|ring|ligar|telefonar)\b/i,
    steps: (s) => [`Find the phone number for ${s}`, "Write the one thing you need to ask", "Make the call"],
  },
  {
    test: /\b(book|schedule|appointment|reserve|agendar|marcar)\b/i,
    steps: (s) => [`Open the booking page or contact for ${s}`, "Pick two dates that would work", "Confirm the booking"],
  },
  {
    test: /\b(submit|upload|send.*(form|document)|file|claim|enviar)\b/i,
    steps: (s) => [`Locate the file or form needed for ${s}`, "Check the required fields are filled", "Submit it and save the receipt"],
  },
  {
    test: /\b(buy|order|purchase|shop|comprar)\b/i,
    steps: (s) => [`Open the shop or list for ${s}`, "Add it to the basket", "Complete the checkout"],
  },
  {
    test: /\b(write|draft|report|document|escrever)\b/i,
    steps: (s) => [`Create the empty document for ${s}`, "Write only the headings", "Fill in the easiest section first"],
  },
  {
    test: /\b(fix|repair|debug|troubleshoot|consertar)\b/i,
    steps: (s) => [`Reproduce the problem with ${s} once`, "Write down exactly what happens", "Change the single most likely cause"],
  },
  {
    test: /\b(clean|tidy|organi[sz]e|sort|declutter|limpar|organizar)\b/i,
    steps: (s) => [`Clear one small surface in ${s}`, "Set a 10-minute timer and work only there", "Put back only what belongs"],
  },
  {
    test: /\b(read|review|study|revisar|ler)\b/i,
    steps: (s) => [`Open ${s} to the first page`, "Read for five minutes without taking notes", "Mark the one part you'll come back to"],
  },
  {
    test: /\b(plan|prepare|prep|organi[sz]e.*(trip|event)|planejar)\b/i,
    steps: (s) => [`Write the single outcome ${s} needs to reach`, "List the three things that must be true for it", "Pick the one you can do today"],
  },
  {
    test: /\b(gym|run|walk|exercise|workout|train|treino|pilates)\b/i,
    steps: (s) => ["Put the clothes and shoes where you'll see them", `Decide the time you'll leave for ${s}`, "Go, even if it's a short one"],
  },
];

/**
 * Strip filler and the leading verb so the subject reads naturally inside a
 * sentence: "Pay Therapist" becomes "Therapist", giving "Open the app or site
 * for Therapist" rather than "…for Pay Therapist".
 */
function subjectOf(title: string, matched?: RegExp): string {
  let cleaned = title
    .trim()
    .replace(/^(to|the|a|an)\s+/i, "")
    .replace(/[.!?]+$/, "");

  if (matched) {
    // Drop the action word only when the title *opens* with it — mid-sentence
    // it's usually carrying meaning ("Fix the invoice email").
    const firstWord = cleaned.split(/\s+/)[0] ?? "";
    if (matched.test(firstWord)) {
      cleaned = cleaned.slice(firstWord.length).trim().replace(/^(the|a|an|my|for|to)\s+/i, "");
    }
  }

  const short = cleaned.length > 48 ? `${cleaned.slice(0, 45).trimEnd()}…` : cleaned;
  return short || "this";
}

const MAX_STEPS = 4;
const MAX_STEP_LEN = 140;

function tidyStep(line: string): string {
  const cleaned = line
    .trim()
    // Strip list markers: "-", "*", "•", "1.", "1)", "[ ]", "[x]".
    .replace(/^[-*•–—]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^\[[ xX]?\]\s*/, "")
    .replace(/^#+\s+/, "")
    .trim();
  return cleaned.length > MAX_STEP_LEN
    ? `${cleaned.slice(0, MAX_STEP_LEN - 1).trimEnd()}…`
    : cleaned;
}

/**
 * Pull steps out of what the user actually wrote.
 *
 * If someone has typed a list into the notes, that list *is* the decomposition —
 * inventing generic steps alongside it ignores the most specific information
 * available. This runs before the title templates for exactly that reason: the
 * user's own words outrank a guess keyed off one verb.
 */
function stepsFromNotes(notes: string | null | undefined): string[] | null {
  if (!notes) return null;
  const lines = notes
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const listLines = lines.filter((l) => /^([-*•–—]\s+|\d+[.)]\s+|\[[ xX]?\]\s*)/.test(l));

  // An explicit list: take it as written.
  if (listLines.length >= 2) {
    const steps = listLines.map((s) => tidyStep(s)).filter((l) => l.length >= 3);
    if (steps.length >= 2) return steps.slice(0, MAX_STEPS);
  }

  // No markers, but several short lines still reads as a checklist.
  const shortLines = lines.filter((l) => l.length >= 3 && l.length <= MAX_STEP_LEN);
  if (lines.length >= 2 && shortLines.length >= 2) {
    return shortLines.map((s) => tidyStep(s)).slice(0, MAX_STEPS);
  }

  // A single prose blob: split into sentences and use the first few, but only
  // when they're short enough to read as actions rather than paragraphs.
  const sentences = notes
    .replaceAll(/\s+/g, " ")
    .split(/(?<=[.!?;])\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 8 && x.length <= MAX_STEP_LEN);
  if (sentences.length >= 2) return sentences.map((s) => tidyStep(s)).slice(0, MAX_STEPS);

  return null;
}

/**
 * Always-available decomposition. Not as good as a model that understands the
 * task, but never worse than nothing — and it always answers.
 */
export function heuristicFirstSteps(task: FirstStepInput): StepSuggestion {
  // The user's own notes are the most specific thing we have — use them before
  // falling back to templates keyed off the title.
  const fromNotes = stepsFromNotes(task.notes);
  if (fromNotes && fromNotes.length > 0) return { steps: fromNotes, source: "notes" };

  const haystack = `${task.title} ${task.notes ?? ""}`;
  const firstWord = task.title.trim().replace(/^(to|the|a|an)\s+/i, "").split(/\s+/)[0] ?? "";

  // The *leading* verb is the strongest signal of what a task actually is, so
  // try it before scanning the whole text. Without this, "Email Ultra about the
  // invoice" matched the payment pattern on the word "invoice" and produced
  // payment steps for what is plainly an email.
  for (const p of PATTERNS) {
    if (firstWord && p.test.test(firstWord)) {
      return { steps: p.steps(subjectOf(task.title, p.test)), source: "template" };
    }
  }
  for (const p of PATTERNS) {
    if (p.test.test(haystack)) {
      return { steps: p.steps(subjectOf(task.title, p.test)), source: "template" };
    }
  }

  // No pattern matched. Fall back to the shape that works for almost anything:
  // make it visible, make the first move trivially small, then commit.
  const subject = subjectOf(task.title);
  const short = task.estimatedDuration > 0 && task.estimatedDuration <= 15;
  return {
    steps: short
      ? [`Do ${subject} now — it's a ${task.estimatedDuration}-minute job`, "Mark it done"]
      : [
          `Open whatever you need for ${subject} and leave it on screen`,
          "Write the very next physical action in one line",
          "Set a 10-minute timer and do only that",
        ],
    source: "template",
  };
}

/**
 * Suggest first steps. Tries AI when the user has consented and the provider is
 * reachable; otherwise (and on any AI failure) returns the deterministic set.
 * Never returns null — the caller always has something to offer.
 */
export async function suggestFirstSteps(
  userId: string,
  task: FirstStepInput,
): Promise<StepSuggestion> {
  const fallback = heuristicFirstSteps(task);
  if (!(await aiAvailable(userId))) return fallback;

  const prompt = [
    "You break a stalled task into its first concrete moves for a person with ADHD.",
    "",
    "RULES:",
    SAFETY_RULES,
    "- Return 2-4 steps in the order they'd be done.",
    "- The FIRST step must be doable in about two minutes and require no decisions — the point is to defeat inertia, not to plan.",
    "- Every step starts with a concrete verb and names exactly one action.",
    "- Physical/observable where possible (open the file, find the number, send the message).",
    "- No pep talk, no meta-advice like 'break it down' or 'set a timer'.",
    "- If the task is already a single trivial action, return just that one step.",
    "",
    dataBlock(
      [
        `Task: ${task.title}`,
        task.notes ? `Notes: ${task.notes.slice(0, 500)}` : "",
        `Estimated: ${task.estimatedDuration} minutes`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    "",
    'Respond as: {"steps":["Open …","Then …"]}',
  ].join("\n");

  const ai = await generateJSON(prompt, AiSteps).catch(() => null);
  if (!ai) return fallback; // quota, timeout, malformed output — all recoverable
  const steps = ai.steps.map((s) => s.trim()).filter(Boolean);
  return steps.length > 0 ? { steps, source: "ai" } : fallback;
}
