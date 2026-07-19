/**
 * TickTick import plugin — first-party, token-based. The user pastes a TickTick
 * Open API access token; we list their projects and import each project's tasks
 * as canonical TaskBlocks (the platform validates + ingests them into Todos).
 *
 * This is the reference for future task-service importers (Todoist, Google Tasks,
 * …): each just maps its own API shape into TaskBlocks — the ingest/dedupe path
 * is shared. Only the fixed TickTick host is contacted, over the SSRF-guarded
 * JSON fetch, with the token sent as a Bearer header (never in the URL).
 */

import type { IntegrationProvider } from "../types";
import { safeFetchJson } from "../safeFetch";
import { parseRRule } from "@/src/lib/recurrence/rrule";

const API = "https://api.ticktick.com/open/v1";

/** `kind` is "TASK" or "NOTE" — a NOTE project holds notes, not to-dos. */
type TTProject = { id: string; name?: string; kind?: string };
type TTTask = {
  id: string;
  title?: string;
  content?: string;
  desc?: string;
  dueDate?: string;
  priority?: number;
  status?: number;
  /** "TEXT" | "NOTE" | "CHECKLIST" — NOTE items aren't to-dos either. */
  kind?: string;
  /** An RRULE string, e.g. "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO". */
  repeatFlag?: string;
};

/**
 * TickTick's repeat field is mostly RFC 5545, but it also emits proprietary
 * forms ("ERULE:NAME=CUSTOM;..." and lunar-calendar rules) that look close
 * enough to parse but don't mean what they appear to. Anything our engine
 * doesn't fully accept is dropped, so the task imports as a one-off rather than
 * repeating on dates nobody asked for.
 */
function repeatRuleOrUndefined(flag?: string): string | undefined {
  if (!flag) return undefined;
  return parseRRule(flag) ? flag.trim().replace(/^RRULE:/i, "") : undefined;
}
type TTProjectData = { tasks?: TTTask[] };

/** TickTick priority codes → our priorities (it has no "ASAP"). */
const PRIORITY: Record<number, "high" | "medium" | "low"> = { 5: "high", 3: "medium", 1: "low" };

/** Normalize any date TickTick returns (e.g. "+0000" offsets) to strict ISO. */
function isoOrUndefined(v?: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Map one project's items to canonical blocks.
 *
 * Exported and pure so the tests exercise the real mapping. It previously lived
 * inline in `pull`, which forced the test to keep its own copy — and a test that
 * mirrors the code it checks passes happily while the code is broken.
 *
 * TickTick serves notes and to-dos from the same endpoint, flagged by `kind` on
 * either the project or the item. Importing everything as a task filled the task
 * list with things that were never to-dos and — worse — made them schedulable,
 * so the planner started booking focus time for reference material.
 */
export function mapProjectItems(project: TTProject, items: TTTask[]): unknown[] {
  const blocks: unknown[] = [];
  const projectIsNotes = (project.kind ?? "").toUpperCase() === "NOTE";

  for (const t of items) {
    const title = (t.title ?? "").trim().slice(0, 1000);
    const body = (t.content || t.desc || "").slice(0, 10_000);
    if (!title && !body) continue;

    const isNote = projectIsNotes || (t.kind ?? "").toUpperCase() === "NOTE";
    if (isNote) {
      blocks.push({
        type: "note",
        sourceId: t.id,
        title: title || "(untitled note)",
        body: body || title,
      });
      continue;
    }

    if (!title) continue; // a to-do with no title is nothing to act on
    blocks.push({
      type: "task",
      sourceId: t.id,
      title,
      notes: body || undefined,
      due: isoOrUndefined(t.dueDate),
      priority: t.priority == null ? undefined : PRIORITY[t.priority],
      status: t.status === 2 ? "done" : "todo",
      recurrenceRule: repeatRuleOrUndefined(t.repeatFlag),
    });
  }

  return blocks;
}

export const tickTickProvider: IntegrationProvider = {
  id: "ticktick",
  name: "TickTick",
  version: "1.0.0",
  category: "tasks",
  description:
    "Import your TickTick tasks and notes. Paste an access token from the TickTick Open API.",
  authType: "token",
  secretLabel: "Access token",
  secretPlaceholder: "Paste your TickTick access token",
  secretHelp:
    "Create an app at developer.ticktick.com, then generate an access token for the Open API and paste it here.",
  // Notes are imported as notes, not to-dos — declare both so the manifest
  // matches what the plugin actually emits.
  capabilities: { pull: ["task", "note"], push: [] },
  available: true,
  trust: "first-party",

  async connect(input) {
    const token = input.secret?.trim();
    if (!token) throw new Error("Paste your TickTick access token");
    // Validate the token by listing projects before we store it, and remember
    // them as selectable import groups (the user can later narrow the selection).
    const projects = await safeFetchJson<TTProject[]>(`${API}/project`, token).catch(() => {
      throw new Error("Couldn’t reach TickTick with that token — check it and try again");
    });
    const groups = projects.map((p) => ({ id: p.id, label: (p.name ?? "").trim() || "Untitled list" }));
    return { credential: token, meta: { groups } };
  },

  async pull(ctx) {
    const token = await ctx.getCredential();
    if (!token) return { blocks: [] };
    // An explicit selection (from the options endpoint) narrows the import; a
    // null/absent selection means "all projects" (backwards-compatible default).
    const selected = ctx.meta?.selectedGroups;
    const only = Array.isArray(selected) ? new Set(selected.map(String)) : null;
    ctx.log("listing TickTick projects");
    const projects = await safeFetchJson<TTProject[]>(`${API}/project`, token);
    const blocks: unknown[] = [];
    for (const p of projects) {
      if (only && !only.has(p.id)) continue;
      const data = await safeFetchJson<TTProjectData>(`${API}/project/${encodeURIComponent(p.id)}/data`, token)
        .catch(() => ({ tasks: [] as TTTask[] }));
      blocks.push(...mapProjectItems(p, data.tasks ?? []));
    }

    const tasks = blocks.filter((b) => (b as { type: string }).type === "task").length;
    ctx.log(`imported ${tasks} tasks and ${blocks.length - tasks} notes`);
    return { blocks };
  },
};
