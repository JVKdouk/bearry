// Domain types mirroring the backend Prisma models (decrypted shapes as seen on
// the /sync/pull wire). Only fields the frontend reads/writes are typed.

export type Priority = "ASAP" | "high" | "medium" | "low";
export type EnergyLevel = "high" | "medium" | "low";
/** How much you want to do something — separate from how demanding it is. */
export type Desire = "wanted" | "neutral" | "avoided";
export type TodoStatus = "todo" | "in_progress" | "done";
export type LifeArea =
  | "work"
  | "focus"
  | "personal"
  | "family"
  | "errand"
  | "sleep"
  | "meal"
  | "other";

export interface SyncBase {
  id: string;
  version?: number;
  updatedAt?: string;
  createdAt?: string;
  deletedAt?: string | null;
}

export interface Project extends SyncBase {
  name: string;
  color: string;
  order: number;
  archived: boolean;
}

export interface Todo extends SyncBase {
  projectId?: string | null;
  parentTodoId?: string | null;
  title: string;
  notes?: string | null;
  status: TodoStatus;
  priority: Priority;
  deadline?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  category?: LifeArea | null;
  estimatedDuration: number;
  energyDemand: EnergyLevel;
  desire?: Desire;
  chunkable: boolean;
  minChunk?: number | null;
  maxChunk?: number | null;
  recurrenceRule?: string | null;
  preferredWindows?: string | null;
  letGoAt?: string | null;
  order: number;
}

export interface Note extends SyncBase {
  title: string;
  bodyMarkdown: string;
}

export interface TaskStep extends SyncBase {
  todoId: string;
  text: string;
  order: number;
  isFirstStep: boolean;
  done: boolean;
}

export interface CalendarEventEntity extends SyncBase {
  source: "google" | "bearai";
  externalId?: string | null;
  /** Set on blocks the planner created — links the block back to its task. */
  bearaiTaskId?: string | null;
  scheduleReason?: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  start: string;
  end: string;
  isFixed: boolean;
}

export interface TimeBlock extends SyncBase {
  label?: string | null;
  start: string;
  end: string;
  type: "focus" | "personal" | "buffer" | "busy";
  recurrenceRule?: string | null;
}

export interface EnergyWindow extends SyncBase {
  dayMask: number;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  energyLevel: EnergyLevel;
  source: "user" | "inferred";
}

export interface BlockRegion extends SyncBase {
  label?: string | null;
  category: LifeArea;
  dayMask: number;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

/** A relationship between two records (§8.7). `blocks` drives dependencies. */
export interface Link extends SyncBase {
  fromType: "todo" | "note" | "event" | "capture";
  fromId: string;
  toType: "todo" | "note" | "event" | "capture";
  toId: string;
  linkType: "reference" | "derived_from" | "blocks";
}

export interface Setting extends SyncBase {
  key: string;
  value: string;
}

// Map of entity name -> record type. Mirrors backend SYNCABLES.
export interface SyncEntities {
  project: Project;
  todo: Todo;
  note: Note;
  taskStep: TaskStep;
  calendarEvent: CalendarEventEntity;
  timeBlock: TimeBlock;
  energyWindow: EnergyWindow;
  blockRegion: BlockRegion;
  link: Link;
  setting: Setting;
}

export type EntityName = keyof SyncEntities;

// Non-syncable / read endpoints -------------------------------------------

/**
 * What the user chose in triage, overriding what the classifier guessed.
 *
 * `null` clears a suggestion outright; leaving a field out keeps whatever was
 * extracted. That distinction matters — "no date" and "the date it found" are
 * different answers, and collapsing them means a wrongly-detected date can only
 * be escaped by throwing the capture away.
 */
export interface AcceptOverrides {
  type?: string;
  projectId?: string | null;
  date?: string | null;
  durationMinutes?: number | null;
}

export interface CaptureItem {
  id: string;
  rawContent: string;
  source: string;
  proposedType: "task" | "note" | "event" | "trash";
  suggestedProjectId?: string | null;
  extractedFields?: Record<string, unknown> | null;
  confidence: number;
  classifierVersion: string;
  createdAt: string;
  /** Set on captures made offline that haven't reached the server yet. */
  pending?: boolean;
}

export interface ScheduledBlock {
  taskId: string;
  start: string;
  end: string;
  reason: string;
  isChunk: boolean;
  chunkIndex?: number;
  chunkCount?: number;
}

export interface ScheduleProposal {
  blocks: ScheduledBlock[];
  unscheduled: { taskId: string; reason: string }[];
  capacity: {
    demandMinutes: number;
    capacityMinutes: number;
    /** What your persona actually permits — the honest denominator. */
    budgetMinutes?: number;
    overcommitted: boolean;
    atRiskTaskIds: string[];
  };
}

// ---- AI assist -----------------------------------------------------------

export interface Enrichment {
  todoId: string;
  /** "reminder" = a date marker with no work to do; duration is 0. */
  kind: "task" | "reminder";
  estimatedDuration: number;
  energyDemand: EnergyLevel;
  desire?: Desire;
  category: LifeArea | null;
  confidence: number;
  reason: string;
  source: "ai" | "heuristic";
}

export type FindingAction =
  | "add_working_hours"
  | "plan_next_working_day"
  | "extend_deadlines"
  | "let_something_go"
  | "enrich_estimates"
  | "adjust_rhythm"
  | "none";

export interface Finding {
  severity: "blocker" | "warning" | "info";
  title: string;
  detail: string;
  action: FindingAction;
}

export interface Diagnosis {
  headline: string;
  findings: Finding[];
  usedAI: boolean;
}

export interface Me {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
}

/** One connected account of a provider (a provider may have several). */
export interface IntegrationConnection {
  id: string;
  accountKey: string;
  label: string;
  status: string;
  connected: boolean;
  lastSyncedAt?: string | null;
  groups?: { id: string; label: string }[] | null;
  selectedGroups?: string[] | null;
}

export interface Integration {
  id: string;
  connections?: IntegrationConnection[];
  /** Provider can hold more than one account (Google, ICS…). */
  multiAccount?: boolean;
  /** For token/apikey providers: how to prompt for the credential. */
  secretLabel?: string | null;
  secretPlaceholder?: string | null;
  secretHelp?: string | null;
  name?: string;
  description?: string;
  category?: string;
  version?: string;
  authType?: string;
  available?: boolean;
  capabilities?: { pull?: boolean; push?: boolean };
  connected?: boolean;
  status?: string;
  lastSyncedAt?: string | null;
  groups?: { id: string; label: string }[];
  selectedGroups?: string[] | null;
  [k: string]: unknown;
}

export interface DigestStatus {
  /** Present only when the caller asked for a live check of the mail transport. */
  verified?: { ok: boolean; error?: string };
  email: boolean;
  daily: boolean;
  weekly: boolean;
  aiConsent: boolean;
  serverEmail: boolean;
  serverGemini: boolean;
}
