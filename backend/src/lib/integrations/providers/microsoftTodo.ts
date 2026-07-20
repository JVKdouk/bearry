/**
 * Microsoft To Do plugin. Emits TaskBlocks.
 *
 * Reads task lists and their tasks through Microsoft Graph's `/me/todo` API,
 * the same shape as Google Tasks: lists become selectable import groups, tasks
 * become read-only imports. Read-only by design — nothing here writes back.
 */

import type { IntegrationProvider } from "../types";
import {
  HAS_OAUTH,
  IDENTITY_SCOPES,
  NO_REFRESH_TOKEN_HELP,
  accessTokenFromRefresh,
  authUrlFor,
  emailFromIdToken,
  exchangeCode,
  graphGet,
} from "./microsoftOAuth";

const PROVIDER_ID = "microsoft-todo";
const GRAPH = "https://graph.microsoft.com/v1.0";

/** Read-only: we never write back to Microsoft To Do, so we don't ask to. */
const SCOPE = `${IDENTITY_SCOPES} Tasks.Read`;

/** Graph pages default to a modest size; cap the follow so one list can't loop. */
const MAX_PAGES = 20;

type MSList = { id: string; displayName?: string };
type MSTask = {
  id: string;
  title?: string;
  status?: string; // notStarted | inProgress | completed | waitingOnOthers | deferred
  body?: { content?: string; contentType?: string };
  dueDateTime?: { dateTime?: string; timeZone?: string };
};

export interface MappedTask {
  type: "task";
  sourceId: string;
  title: string;
  notes?: string;
  due?: string;
  status: "todo" | "done";
}

/**
 * Map one Microsoft To Do task, or null to skip it.
 *
 * `dueDateTime` is a date (midnight in its zone), meaning "this day", so it's
 * normalised to end of day at the timezone-invariant `:59:59.999` fingerprint —
 * the scheduler reads that as a due-by date, not a midnight appointment.
 */
export function toTaskBlock(t: MSTask): MappedTask | null {
  if (!t.id) return null;
  const title = (t.title ?? "").trim().slice(0, 1000);
  if (!title) return null;

  let due: string | undefined;
  const raw = t.dueDateTime?.dateTime;
  if (raw) {
    // Graph returns e.g. "2026-07-24T00:00:00.0000000"; take the calendar day.
    const datePart = raw.slice(0, 10);
    const d = new Date(`${datePart}T23:59:59.999Z`);
    if (!Number.isNaN(d.getTime())) due = d.toISOString();
  }

  const notes = t.body?.content?.trim();
  return {
    type: "task",
    sourceId: t.id,
    title,
    notes: notes ? notes.slice(0, 10_000) : undefined,
    due,
    status: t.status === "completed" ? "done" : "todo",
  };
}

async function listTaskLists(accessToken: string): Promise<MSList[]> {
  const out: MSList[] = [];
  let url: string | undefined = `${GRAPH}/me/todo/lists?$top=100`;
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const json: { value?: MSList[]; "@odata.nextLink"?: string } = await graphGet(url, accessToken);
    out.push(...(json.value ?? []));
    url = json["@odata.nextLink"];
  }
  return out;
}

async function listTasks(accessToken: string, listId: string): Promise<MSTask[]> {
  const out: MSTask[] = [];
  let url: string | undefined = `${GRAPH}/me/todo/lists/${encodeURIComponent(listId)}/tasks?$top=100`;
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const json: { value?: MSTask[]; "@odata.nextLink"?: string } = await graphGet(url, accessToken);
    out.push(...(json.value ?? []));
    url = json["@odata.nextLink"];
  }
  return out;
}

export const microsoftTodoProvider: IntegrationProvider = {
  id: PROVIDER_ID,
  name: "Microsoft To Do",
  version: "1.0.0",
  category: "tasks",
  icon: "✅",
  description: "Import your Microsoft To Do lists and keep them in step.",
  authType: HAS_OAUTH ? "oauth2" : "token",
  scopes: [SCOPE],
  secretLabel: "Refresh token",
  secretPlaceholder: "Paste a Microsoft OAuth refresh token",
  secretHelp:
    "Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET on the server to connect with one click instead.",
  capabilities: { pull: ["task"], push: [] },
  available: true,
  trust: "first-party",

  getAuthUrl: HAS_OAUTH ? (state) => authUrlFor(PROVIDER_ID, SCOPE, state) : undefined,

  async connect(input) {
    if (HAS_OAUTH) {
      if (!input.code) throw new Error("Missing Microsoft authorization code");
      const tokens = await exchangeCode(PROVIDER_ID, input.code, SCOPE);
      if (!tokens.refresh_token) throw new Error(NO_REFRESH_TOKEN_HELP);

      const email = emailFromIdToken(tokens.id_token);

      // Fetch the lists now so the user can narrow the import straight away.
      // A failure here shouldn't block connecting — the lists reload on sync.
      let groups: { id: string; label: string }[] = [];
      try {
        const accessToken = await accessTokenFromRefresh(tokens.refresh_token, SCOPE);
        const lists = await listTaskLists(accessToken);
        groups = lists.map((l) => ({
          id: l.id,
          label: (l.displayName ?? "").trim() || "Untitled list",
        }));
      } catch {
        groups = [];
      }

      return {
        credential: tokens.refresh_token,
        meta: { scopes: SCOPE, accountEmail: email, groups },
        accountKey: email ?? undefined,
        label: email ?? undefined,
      };
    }

    if (!input.secret) throw new Error("A Microsoft refresh token is required");
    return { credential: input.secret, meta: { scopes: SCOPE } };
  },

  async pull(ctx) {
    const refreshToken = await ctx.getCredential();
    if (!refreshToken) {
      ctx.log("no credential; skipping");
      return { blocks: [] };
    }

    const accessToken = await accessTokenFromRefresh(refreshToken, SCOPE);

    const selected = ctx.meta?.selectedGroups;
    const only = Array.isArray(selected) ? new Set(selected.map(String)) : null;

    const lists = await listTaskLists(accessToken);
    ctx.log(`found ${lists.length} task list(s)`);

    const blocks: unknown[] = [];
    for (const list of lists) {
      if (only && !only.has(list.id)) continue;
      const tasks = await listTasks(accessToken, list.id).catch((err) => {
        ctx.log(`skipped list "${list.displayName ?? list.id}": ${(err as Error).message}`);
        return [] as MSTask[];
      });
      for (const t of tasks) {
        const block = toTaskBlock(t);
        if (block) blocks.push(block);
      }
    }

    ctx.log(`imported ${blocks.length} tasks`);
    return { blocks, cursor: null };
  },

  async disconnect() {
    // Refresh tokens are revoked from the user's Microsoft account; we just drop
    // the stored credential (the service deletes the row).
  },
};
