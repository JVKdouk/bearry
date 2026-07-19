/**
 * Plan diagnosis — turn "couldn't place 21" into causes and next actions.
 *
 * Deliberately algorithmic first: the solver already emits *structured* failure
 * data, and the most valuable findings (no working hours on this day,
 * overcommitted by 3h, deadlines that can't be met) are pure arithmetic. Those
 * always work — no API key, no consent, no network.
 *
 * The model only rephrases the headline in a warm, non-shaming voice when the
 * user has opted in. It never invents findings.
 */

import { z } from "zod";
import database from "@/core/database";
import { ensureScheduleProfile } from "@/src/lib/scheduler/defaults";
import { generateJSON, aiAvailable } from "./gemini";
import { SAFETY_RULES, dataBlock } from "./prompt";
import type { ScheduleProposal } from "@/src/lib/scheduler/types";

export type Severity = "blocker" | "warning" | "info";
/** Machine-readable so the client can offer a real button, not just prose. */
export type ActionCode =
  | "add_working_hours"
  | "plan_next_working_day"
  | "extend_deadlines"
  | "let_something_go"
  | "enrich_estimates"
  | "adjust_rhythm"
  | "none";

export interface Finding {
  severity: Severity;
  title: string;
  detail: string;
  action: ActionCode;
}

export interface Diagnosis {
  headline: string;
  findings: Finding[];
  usedAI: boolean;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function hoursLabel(minutes: number): string {
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** Which weekdays in the horizon have no working hours configured at all. */
async function daysWithoutHours(
  userId: string,
  horizonStart: Date,
  horizonEnd: Date,
): Promise<string[]> {
  const profile = await ensureScheduleProfile(userId);
  const wh = JSON.parse(profile.workingHours) as Record<string, { start: string; end: string }[]>;
  const regions = await database.blockRegion.findMany({
    where: { userId, deletedAt: null },
    select: { category: true, dayMask: true },
  });
  const availableMask = regions
    .filter((r) => r.category !== "sleep" && r.category !== "meal")
    .reduce((m, r) => m | r.dayMask, 0);

  const out = new Set<string>();
  const d = new Date(horizonStart);
  d.setHours(0, 0, 0, 0);
  while (d <= horizonEnd) {
    const dow = d.getDay();
    const hasHours = (wh[String(dow)] ?? []).length > 0;
    const hasRegion = (availableMask & (1 << dow)) !== 0;
    if (!hasHours && !hasRegion) out.add(DAY_NAMES[dow]);
    d.setDate(d.getDate() + 1);
  }
  return [...out];
}

/** Pure arithmetic over the proposal — always available. */
export async function findFindings(
  userId: string,
  proposal: ScheduleProposal,
  horizonStart: Date,
  horizonEnd: Date,
  defaultDurationCount: number,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const cap = proposal.capacity;

  if (cap.capacityMinutes === 0) {
    const bare = await daysWithoutHours(userId, horizonStart, horizonEnd);
    findings.push({
      severity: "blocker",
      title: bare.length > 0
        ? `No working hours on ${bare.join(" or ")}`
        : "No open time in this range",
      detail: bare.length > 0
        ? `Your schedule has no availability on ${bare.join(" or ")}, so nothing can be placed. Add hours for those days, or plan a day that has them.`
        : "Every hour in this range is already committed.",
      action: bare.length > 0 ? "add_working_hours" : "plan_next_working_day",
    });
  } else if (cap.overcommitted && cap.demandMinutes > cap.capacityMinutes) {
    findings.push({
      severity: "warning",
      title: `Over capacity by ${hoursLabel(cap.demandMinutes - cap.capacityMinutes)}`,
      detail: `You have ${hoursLabel(cap.demandMinutes)} of work and ${hoursLabel(cap.capacityMinutes)} of open time. Something has to move or go.`,
      action: "let_something_go",
    });
  }

  // The common new case: there IS open time, but the persona's daily budget is
  // spent. That's a deliberate choice, not a shortfall, so it's framed as a
  // choice the user can revisit rather than a problem to fix.
  const budget = cap.budgetMinutes;
  if (budget !== undefined && budget < cap.capacityMinutes && cap.demandMinutes > budget) {
    findings.push({
      severity: "info",
      title: "Your days are full by your own settings",
      detail: `You have ${hoursLabel(cap.capacityMinutes)} of open time, but you've told Bearry ${hoursLabel(budget)} of focused work is a realistic load. The rest is protected breathing room. If that feels too cautious, raise your daily focus budget under Settings → How you work.`,
      action: "adjust_rhythm",
    });
  }

  const missedDeadline = proposal.unscheduled.filter((u) => /deadline/i.test(u.reason)).length;
  if (missedDeadline > 0) {
    findings.push({
      severity: "blocker",
      title: `${missedDeadline} ${missedDeadline === 1 ? "task can't" : "tasks can't"} fit before their deadline`,
      detail:
        "There is no open, energy-appropriate slot left before they're due. Extending the deadline or letting one go will unblock the rest.",
      action: "extend_deadlines",
    });
  }

  const heldBack = proposal.unscheduled.filter((u) =>
    /limit|session|avoided/i.test(u.reason),
  ).length;
  const noSlot = proposal.unscheduled.length - missedDeadline - heldBack;

  if (heldBack > 0) {
    findings.push({
      severity: "info",
      title: `${heldBack} ${heldBack === 1 ? "task" : "tasks"} held back on purpose`,
      detail:
        "These fit in the clock but not in your rhythm — the plan stops before it becomes a wall of blocks. They roll forward to the next one.",
      action: "adjust_rhythm",
    });
  }

  if (noSlot > 0) {
    findings.push({
      severity: "info",
      title: `${noSlot} ${noSlot === 1 ? "task" : "tasks"} didn't fit in this range`,
      detail: "They have no deadline pressure, so they'll roll forward to the next plan.",
      action: "none",
    });
  }

  if (defaultDurationCount >= 5) {
    findings.push({
      severity: "info",
      title: `${defaultDurationCount} tasks still use the default 30-minute estimate`,
      detail:
        "Capacity maths is only as good as the estimates behind it. Enriching them makes this plan considerably more honest.",
      action: "enrich_estimates",
    });
  }

  if (findings.length === 0 && proposal.blocks.length > 0) {
    findings.push({
      severity: "info",
      title: "Everything fits",
      detail: `${proposal.blocks.length} ${proposal.blocks.length === 1 ? "block" : "blocks"} planned across ${hoursLabel(
        proposal.blocks.reduce(
          (n, b) => n + (new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000,
          0,
        ),
      )}.`,
      action: "none",
    });
  }

  return findings;
}

function deterministicHeadline(findings: Finding[]): string {
  const blocker = findings.find((f) => f.severity === "blocker");
  if (blocker) return blocker.title;
  const warn = findings.find((f) => f.severity === "warning");
  if (warn) return warn.title;
  return findings[0]?.title ?? "Nothing to plan right now";
}

const AiHeadline = z.object({ headline: z.string().max(180) });

/**
 * Findings are computed first and passed to the model as *facts to phrase*, not
 * as a question to answer — so the model can soften the tone but cannot change
 * what's true. Only counts and durations are sent; no task titles.
 */
export async function diagnosePlan(
  userId: string,
  proposal: ScheduleProposal,
  horizonStart: Date,
  horizonEnd: Date,
  defaultDurationCount: number,
): Promise<Diagnosis> {
  const findings = await findFindings(
    userId, proposal, horizonStart, horizonEnd, defaultDurationCount,
  );
  const headline = deterministicHeadline(findings);

  if (!(await aiAvailable(userId))) return { headline, findings, usedAI: false };

  const prompt = [
    "You phrase scheduling findings for a person with ADHD.",
    "",
    "RULES:",
    SAFETY_RULES,
    "- Write ONE sentence, max 20 words, summarising the findings below.",
    "- Warm, calm, practical. Never shame the user about overdue or unfinished work.",
    "- State only what the findings say. Do not invent numbers, causes or advice.",
    "",
    dataBlock(findings.map((f) => `[${f.severity}] ${f.title} — ${f.detail}`).join("\n")),
    "",
    'Respond as: {"headline":"..."}',
  ].join("\n");

  const ai = await generateJSON(prompt, AiHeadline).catch(() => null);
  return { headline: ai?.headline?.trim() || headline, findings, usedAI: !!ai };
}
