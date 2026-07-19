/**
 * Google Tasks plugin. Emits TaskBlocks.
 *
 * Shares the OAuth dance with Google Calendar (see googleOAuth.ts) but asks for
 * its own read-only scope, so connecting one doesn't quietly grant the other.
 * Task lists become selectable import groups, the same way TickTick projects do.
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
  googleGet,
} from "./googleOAuth";

const PROVIDER_ID = "google-tasks";
const API = "https://tasks.googleapis.com/tasks/v1";

/**
 * Read-only, deliberately. Nothing in this app writes back to Google Tasks, and
 * asking for write access we don't use is both a worse consent prompt and a
 * larger blast radius if the refresh token ever leaks.
 */
const SCOPE = `${IDENTITY_SCOPES} https://www.googleapis.com/auth/tasks.readonly`;

/** Google caps a page at 100; more than this is someone else's problem. */
const MAX_PAGES = 10;

type GTaskList = { id: string; title?: string };
type GTask = {
  id: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: string;
  deleted?: boolean;
  hidden?: boolean;
  parent?: string;
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
 * Map one Google task, or null to skip it.
 *
 * Google's `due` is a date with a zeroed time, not a moment — it means "this
 * day", so it's normalised to the end of that day rather than presented as a
 * midnight deadline the user never chose.
 */
export function toTaskBlock(t: GTask): MappedTask | null {
  if (t.deleted || !t.id) return null;

  const title = (t.title ?? "").trim().slice(0, 1000);
  // Google Tasks lets you save an untitled task; it's a placeholder, not work.
  if (!title) return null;

  // Subtasks arrive as separate rows pointing at a parent. Importing them as
  // top-level tasks would silently double the list and lose the relationship,
  // so they're skipped until steps can be reconstructed properly.
  if (t.parent) return null;

  let due: string | undefined;
  if (t.due) {
    const d = new Date(t.due);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCHours(23, 59, 59, 0);
      due = d.toISOString();
    }
  }

  return {
    type: "task",
    sourceId: t.id,
    title,
    notes: t.notes?.slice(0, 10_000) || undefined,
    due,
    status: t.status === "completed" ? "done" : "todo",
  };
}

async function listTaskLists(accessToken: string): Promise<GTaskList[]> {
  const json = await googleGet<{ items?: GTaskList[] }>(
    `${API}/users/@me/lists?maxResults=100`,
    accessToken,
  );
  return json.items ?? [];
}

async function listTasks(accessToken: string, listId: string): Promise<GTask[]> {
  const out: GTask[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      maxResults: "100",
      showCompleted: "true",
      showHidden: "false",
      ...(pageToken ? { pageToken } : {}),
    });
    const json = await googleGet<{ items?: GTask[]; nextPageToken?: string }>(
      `${API}/lists/${encodeURIComponent(listId)}/tasks?${params}`,
      accessToken,
    );
    out.push(...(json.items ?? []));
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }

  return out;
}

export const googleTasksProvider: IntegrationProvider = {
  id: PROVIDER_ID,
  name: "Google Tasks",
  version: "1.0.0",
  category: "tasks",
  icon: "☑️",
  description: "Import your Google Tasks lists and keep them in step.",
  authType: HAS_OAUTH ? "oauth2" : "token",
  scopes: [SCOPE],
  secretLabel: "Refresh token",
  secretPlaceholder: "Paste a Google OAuth refresh token",
  secretHelp:
    "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server to connect with one click instead.",
  capabilities: { pull: ["task"], push: [] },
  available: true,
  trust: "first-party",

  getAuthUrl: HAS_OAUTH ? (state) => authUrlFor(PROVIDER_ID, SCOPE, state) : undefined,

  async connect(input) {
    if (HAS_OAUTH) {
      if (!input.code) throw new Error("Missing Google authorization code");
      const tokens = await exchangeCode(PROVIDER_ID, input.code);
      if (!tokens.refresh_token) throw new Error(NO_REFRESH_TOKEN_HELP);

      const email = emailFromIdToken(tokens.id_token);

      // Fetch the lists now so the user can narrow the import straight away,
      // rather than discovering after a first sync that it pulled everything.
      // A failure here shouldn't block connecting — the lists reload on sync.
      let groups: { id: string; label: string }[] = [];
      try {
        const accessToken = await accessTokenFromRefresh(tokens.refresh_token);
        groups = (await listTaskLists(accessToken)).map((l) => ({
          id: l.id,
          label: (l.title ?? "").trim() || "Untitled list",
        }));
      } catch {
        groups = [];
      }

      return {
        credential: tokens.refresh_token,
        meta: { scopes: SCOPE, accountEmail: email, groups },
        // Distinct per Google account => connecting a second one adds a
        // connection instead of overwriting the first.
        accountKey: email ?? undefined,
        label: email ?? undefined,
      };
    }

    if (!input.secret) throw new Error("A Google refresh token is required");
    return { credential: input.secret, meta: { scopes: SCOPE } };
  },

  async pull(ctx) {
    const refreshToken = await ctx.getCredential();
    if (!refreshToken) {
      ctx.log("no credential; skipping");
      return { blocks: [] };
    }

    const accessToken = await accessTokenFromRefresh(refreshToken);

    // An explicit selection narrows the import; absent means "all lists".
    const selected = ctx.meta?.selectedGroups;
    const only = Array.isArray(selected) ? new Set(selected.map(String)) : null;

    const lists = await listTaskLists(accessToken);
    ctx.log(`found ${lists.length} task list(s)`);

    const blocks: unknown[] = [];
    for (const list of lists) {
      if (only && !only.has(list.id)) continue;
      // One failing list shouldn't lose the others' tasks.
      const tasks = await listTasks(accessToken, list.id).catch((err) => {
        ctx.log(`skipped list "${list.title ?? list.id}": ${(err as Error).message}`);
        return [] as GTask[];
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
    // Refresh tokens are revoked from the user's Google account page; we just
    // drop the stored credential (the service deletes the row).
  },
};
