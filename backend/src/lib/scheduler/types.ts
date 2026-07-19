/** Pure data types for the scheduler (§9). No DB, no crypto — cleartext only. */

import type { Persona } from "./persona";
export type { Persona } from "./persona";

export type Priority = "ASAP" | "high" | "medium" | "low";
export type EnergyLevel = "high" | "medium" | "low";
/** How much the user wants to do the task — orthogonal to how demanding it is. */
export type Desire = "wanted" | "neutral" | "avoided";

/** Life areas for time blocking (§8.4). `sleep`/`meal` are protected (off). */
export type LifeArea = "work" | "focus" | "personal" | "family" | "errand" | "sleep" | "meal" | "other";

export type SchedulableTask = {
  id: string;
  /** minutes */
  estimatedDuration: number;
  deadline?: Date | null;
  priority: Priority;
  energyDemand: EnergyLevel;
  /** Appetite for the task. `avoided` work gets protected placement (§9.1a). */
  desire: Desire;
  /** Preferred life area — the scheduler favors matching regions (§8.4). */
  category?: LifeArea | null;
  /** null = undecided; the duration rule in chunking.ts applies. */
  chunkable: boolean | null;
  minChunk?: number | null;
  maxChunk?: number | null;
  /** Older tasks get a small age boost so nothing rots forever. */
  createdAt: Date;
};

/** An immovable commitment the scheduler works around (§9.3). */
export type FixedInterval = { start: Date; end: Date };

/** A recurring weekly time-blocking region (§8.4): work/sleep/family windows. */
export type Region = {
  category: LifeArea;
  /** 7-bit weekday mask, bit0 = Sunday. */
  dayMask: number;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
};

/** Per-weekday working windows (0 = Sunday). Local wall-clock "HH:MM". */
export type WorkingHours = Record<string, { start: string; end: string }[]>;

export type EnergyWindow = {
  /** 7-bit weekday mask, bit0 = Sunday. */
  dayMask: number;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  energyLevel: EnergyLevel;
};

export type SchedulerInput = {
  tasks: SchedulableTask[];
  busy: FixedInterval[];
  workingHours: WorkingHours;
  energyWindows: EnergyWindow[];
  /** Recurring time-blocking regions (§8.4). Empty = classic working-hours only. */
  regions?: Region[];
  /** Planning horizon. */
  horizonStart: Date;
  horizonEnd: Date;
  /** Minimum minutes between focus blocks (soft). */
  minBreak?: number;
  /** Longest single focus block (chunk cap fallback). */
  maxFocus?: number;
  /** How this person works (§9.1a). Absent = DEFAULT_PERSONA. */
  persona?: Persona;
  /** "blockerId must finish before blockedId can start" (§7.4). */
  dependencies?: TaskDependency[];
  /**
   * Blockers that are already on the calendar, mapped to when they finish.
   * The dependent must start at or after this — "already scheduled" is a
   * constraint, not an exemption.
   */
  blockerEnds?: Record<string, Date | string>;
};

/** A hard ordering constraint between two tasks. */
export type TaskDependency = {
  blockerId: string;
  blockedId: string;
};

/** One placed block, with the solver's own reason (§9.6). */
export type ScheduledBlock = {
  taskId: string;
  start: Date;
  end: Date;
  /** Plain-language reason, template-filled from the decision trace. */
  reason: string;
  /** True when this is one chunk of a split task. */
  isChunk: boolean;
  chunkIndex?: number;
  chunkCount?: number;
};

export type UnscheduledTask = {
  taskId: string;
  reason: string;
};

export type CapacityReport = {
  demandMinutes: number;
  capacityMinutes: number;
  /**
   * Minutes the persona actually permits across the horizon (daily budget ×
   * days). Distinct from `capacityMinutes`, which is raw open time: the gap
   * between the two IS the breathing room, and reporting both is what lets the
   * UI explain why a mostly-empty calendar can still be "full".
   */
  budgetMinutes?: number;
  /** Energy-weighted capacity (§9.4a) — high-demand time only counts high windows. */
  overcommitted: boolean;
  atRiskTaskIds: string[];
};

export type ScheduleProposal = {
  blocks: ScheduledBlock[];
  unscheduled: UnscheduledTask[];
  capacity: CapacityReport;
};
