// Thin fetch wrapper for the Bearry backend. Auth is the httpOnly `token` cookie
// set by /auth/login|signup, so every call sends credentials. The backend CORS
// allowlist must name this origin (FRONT_END_ORIGIN) with credentials:true.

import type {
  AcceptOverrides,
  CaptureItem,
  Diagnosis,
  DigestStatus,
  Enrichment,
  Integration,
  Me,
  ScheduleProposal,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:20001";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * The network never carried the request — as opposed to ApiError, where the
 * server answered and said no.
 *
 * Keeping these distinct is what makes offline behaviour correct: a failed
 * *reach* means "queue it and try later", while a 4xx means "the server has
 * ruled on this, retrying changes nothing". Conflating them is how offline apps
 * end up either dropping writes or retrying rejected ones forever.
 */
export class OfflineError extends Error {
  constructor(message = "You're offline") {
    super(message);
    this.name = "OfflineError";
  }
}

export function isOfflineError(err: unknown): err is OfflineError {
  return err instanceof OfflineError;
}

/**
 * The message to show a user for a failed call.
 *
 * When the server explained itself, say what it said. "You've used this hour's
 * AI suggestions" tells someone what to do next; the generic fallback that
 * replaced it left them retrying into the same wall with no idea why. When the
 * request never left the device, say that instead — it's a different problem
 * with a different remedy.
 *
 * The fallback is for genuinely unknown failures, where a specific-sounding
 * message would be a guess.
 */
export function errText(err: unknown, fallback: string): string {
  if (isOfflineError(err)) return "You're offline — this will retry when you're back.";
  if (err instanceof ApiError && err.message) return err.message;
  return fallback;
}

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const url = new URL(API_BASE + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: opts.method ?? "GET",
      credentials: "include",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    // fetch only rejects on a transport failure (DNS, TCP, CORS preflight,
    // offline) — never on an HTTP error status. So this is definitively "could
    // not reach the server".
    reportNetwork(false);
    throw new OfflineError();
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  // A 5xx or 502 from the proxy means the backend is down: reachable network,
  // unusable API. Treat it as offline for queueing purposes so writes are kept
  // rather than discarded.
  if (res.status >= 500) {
    reportNetwork(false);
    throw new OfflineError("The server is unavailable");
  }
  reportNetwork(true);

  if (!res.ok) {
    const fromBody =
      data && typeof data === "object" && "message" in data
        ? String((data as { message: unknown }).message)
        : null;
    // HTTP/2 has no status text, so res.statusText is often "" — never surface
    // an empty error to the user; fall back to the status code.
    const msg = fromBody || res.statusText || `Request failed (HTTP ${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

/**
 * Feed request outcomes to the connectivity store. Imported lazily so this
 * module stays usable outside React and free of a circular import at load time.
 */
function reportNetwork(ok: boolean): void {
  if (typeof window === "undefined") return;
  void import("@/store/network").then(({ useNetwork }) => {
    const s = useNetwork.getState();
    if (ok) s.reportSuccess();
    else s.reportFailure();
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---- Sync engine ---------------------------------------------------------

export interface PushOp {
  entity: string;
  op: "upsert" | "delete";
  id?: string;
  clientUpdatedAt?: string;
  data?: Record<string, unknown>;
}

export interface PushOpResult {
  entity: string;
  id: string;
  status: "applied" | "skipped_stale" | "error";
  version?: number;
  message?: string;
}

export const api = {
  // Auth
  signup: (body: { email: string; password: string; first_name?: string }) =>
    request<{ id: string; email: string }>("/auth/signup", {
      method: "POST",
      body,
    }),
  login: (body: { email: string; password: string }) =>
    request<{ id: string; email: string }>("/auth/login", {
      method: "POST",
      body,
    }),
  logout: () => request<unknown>("/auth/logout", { method: "POST" }),
  /** Public: whether the signup form should be offered at all. */
  authConfig: () => request<{ signupsOpen: boolean }>("/auth/config"),
  me: () => request<Me>("/users/me"),

  // Sync
  // `hasMore` is set when the server capped the page; the caller keeps pulling
  // from the returned cursor until it clears.
  pull: (since?: string) =>
    request<{ cursor: string; changes: Record<string, unknown[]>; hasMore?: boolean }>(
      "/sync/pull",
      { query: { since } },
    ),
  push: (ops: PushOp[]) =>
    request<{ results: PushOpResult[] }>("/sync/push", {
      method: "POST",
      body: { ops },
    }),

  // Capture
  captureList: () => request<{ items: CaptureItem[] }>("/capture/"),
  // The endpoint names the raw field `text`; `rawContent` is the stored column.
  captureCreate: (body: { text: string; source?: string }) =>
    request<{ id: string; proposedType: string }>("/capture/", {
      method: "POST",
      body,
    }),
  captureAccept: (
    id: string,
    body?: AcceptOverrides,
  ) =>
    request<{ ok: boolean; createdType: string; createdId: string | null }>(
      `/capture/${id}/accept`,
      { method: "POST", body: body ?? {} },
    ),
  captureDismiss: (id: string) =>
    request<unknown>(`/capture/${id}/dismiss`, { method: "POST" }),

  // Schedule
  plan: (body?: { horizonStart?: string; horizonEnd?: string }) =>
    request<ScheduleProposal>("/schedule/plan", {
      method: "POST",
      body: body ?? {},
    }),
  applyPlan: (
    blocks: { taskId: string; start: string; end: string; reason: string }[],
  ) =>
    request<{ appliedBlockIds: string[] }>("/schedule/apply", {
      method: "POST",
      body: { blocks },
    }),
  undoPlan: () => request<unknown>("/schedule/undo", { method: "POST" }),

  // Calendar (read model with decrypted titles)
  calendarEvents: (from: string, to: string) =>
    request<{
      events: {
        id: string;
        source: string;
        title: string;
        description: string | null;
        location: string | null;
        start: string;
        end: string;
        isFixed: boolean;
        bearaiTaskId: string | null;
        scheduleReason: string | null;
      }[];
      timeBlocks: {
        id: string;
        label: string | null;
        start: string;
        end: string;
        type: string;
      }[];
      energyWindows: unknown[];
    }>("/calendar/events", { query: { from, to } }),

  // Integrations
  integrations: () =>
    request<{ integrations: Integration[] }>("/integrations/"),
  integrationConnect: (providerId: string, body?: unknown) =>
    request<unknown>(`/integrations/${providerId}/connect`, {
      method: "POST",
      body: body ?? {},
    }),
  integrationDisconnect: (providerId: string) =>
    request<unknown>(`/integrations/${providerId}/disconnect`, {
      method: "POST",
    }),
  integrationSync: (providerId: string) =>
    request<unknown>(`/integrations/${providerId}/sync`, { method: "POST" }),

  // Connection-scoped: act on ONE connected account.
  connectionSync: (connectionId: string) =>
    request<unknown>(`/integrations/connections/${connectionId}/sync`, { method: "POST" }),
  connectionDisconnect: (connectionId: string) =>
    request<unknown>(`/integrations/connections/${connectionId}/disconnect`, { method: "POST" }),
  connectionOptions: (connectionId: string, selectedGroups: string[] | null) =>
    request<unknown>(`/integrations/connections/${connectionId}/options`, {
      method: "POST",
      body: { selectedGroups },
    }),
  integrationAuthUrl: (providerId: string) =>
    request<{ url: string }>(`/integrations/${providerId}/auth-url`),

  // AI assist — all three return suggestions only; the client applies what the
  // user accepts through the normal sync path.
  aiEnrich: (body: { todoIds?: string[]; limit?: number }) =>
    request<{
      results: Enrichment[];
      usedAI: boolean;
      aiAvailable: boolean;
      version: string;
    }>("/ai/enrich", { method: "POST", body }),
  aiDiagnose: (body: { horizonStart?: string; horizonEnd?: string }) =>
    request<Diagnosis>("/ai/diagnose", { method: "POST", body }),
  aiFirstStep: (todoId: string) =>
    request<{ steps: string[]; available: boolean; source?: string; aiUsed?: boolean }>("/ai/first-step", {
      method: "POST",
      body: { todoId },
    }),

  // Digest
  digestStatus: () => request<DigestStatus>("/digest/status"),
  digestSettings: (body: {
    daily?: boolean;
    weekly?: boolean;
    aiConsent?: boolean;
  }) => request<unknown>("/digest/settings", { method: "POST", body }),
  digestPreview: () => request<{ html: string }>("/digest/preview", { method: "POST" }),
  digestSend: () => request<unknown>("/digest/send", { method: "POST" }),
};
