/**
 * Integration service: glue between the registry (plugin logic), the encrypted
 * credential store, and ingestion. It builds the minimal ProviderContext, runs
 * the pull → validate → ingest → persist-cursor pipeline, and never lets a
 * plugin see the DB or another user's data.
 *
 * A provider may be connected MULTIPLE times (two Google accounts, several .ics
 * feeds). Each row in `Integration` is one *connection*, identified by
 * `accountKey`; everything below operates on a connection, not a provider.
 */

import database from "@/core/database";
import { getUserDEK } from "@/src/lib/security/dekGuard";
import { sealToString, openFromString } from "@/src/lib/crypto/aead";
import { listProviders, getProvider } from "./registry";
import { validateBlocks } from "./schema/blocks";
import { ingestBlocks } from "./ingest";
import type { ProviderContext, ConnectInput } from "./types";

const AAD = (userId: string) => Buffer.from(`${userId}:Integration:encryptedCredential`, "utf8");

type Meta = { groups?: { id: string; label: string }[]; selectedGroups?: string[] | null; [k: string]: unknown };

type Row = {
  id: string;
  userId: string;
  providerId: string;
  accountKey: string;
  label: string | null;
  encryptedCredential: string;
  meta: string | null;
  status: string;
  syncToken: string | null;
  lastSyncedAt: Date | null;
};

/** Parse the cleartext meta JSON, tolerating null/garbage. */
function parseMeta(raw: string | null | undefined): Meta | null {
  if (!raw) return null;
  try { const o = JSON.parse(raw); return o && typeof o === "object" ? (o as Meta) : null; } catch { return null; }
}

/** Fetch one connection, scoped to the user so ids can't be probed. */
async function connectionFor(userId: string, connectionId: string): Promise<Row | null> {
  const row = await database.integration.findFirst({ where: { id: connectionId, userId } });
  return (row as Row | null) ?? null;
}

/**
 * The provider-descriptive half of the list response is identical for every user
 * and never changes after boot (the registry is sealed once
 * `registerAllProviders()` runs). Build it once instead of rebuilding eight
 * manifests on every call — this endpoint is hit on every app load.
 */
type StaticProviderView = ReturnType<typeof buildStaticProviderView>;
let staticProviderViews: StaticProviderView[] | null = null;

function buildStaticProviderView(p: ReturnType<typeof listProviders>[number]) {
  return {
    id: p.id,
    name: p.name,
    version: p.version,
    category: p.category,
    description: p.description,
    authType: p.authType,
    icon: p.icon ?? null,
    // How the client should prompt for a token/apikey credential.
    secretLabel: p.secretLabel ?? null,
    secretPlaceholder: p.secretPlaceholder ?? null,
    secretHelp: p.secretHelp ?? null,
    capabilities: p.capabilities,
    trust: p.trust,
    available: p.available,
    /** Providers that identify their account can be added more than once. */
    multiAccount: p.authType === "oauth2" || p.id === "ics-calendar",
  };
}

function staticViews(): StaticProviderView[] {
  if (!staticProviderViews) staticProviderViews = listProviders().map((p) => buildStaticProviderView(p));
  return staticProviderViews;
}

export async function listForUser(userId: string) {
  const rows = (await database.integration.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  })) as Row[];

  const byProvider = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byProvider.get(r.providerId) ?? [];
    list.push(r);
    byProvider.set(r.providerId, list);
  }

  return staticViews().map((p) => {
    const conns = byProvider.get(p.id) ?? [];
    const connections = conns.map((row) => {
      const meta = parseMeta(row.meta);
      return {
        id: row.id,
        accountKey: row.accountKey,
        label: row.label ?? (row.accountKey === "default" ? p.name : row.accountKey),
        status: row.status,
        connected: row.status === "connected",
        lastSyncedAt: row.lastSyncedAt,
        groups: meta?.groups ?? null,
        selectedGroups: meta?.selectedGroups ?? null,
      };
    });
    const first = connections[0];
    return {
      // Immutable provider manifest, built once at first call.
      ...p,
      /** True when at least one account is connected. */
      connected: connections.some((c) => c.connected),
      /** Every connected account for this provider. */
      connections,
      // --- legacy single-connection fields, kept so older clients keep working
      status: first?.status ?? "disconnected",
      lastSyncedAt: first?.lastSyncedAt ?? null,
      groups: first?.groups ?? null,
      selectedGroups: first?.selectedGroups ?? null,
    };
  });
}

/** Persist which import groups (project ids) the user wants, per connection. */
export async function setImportGroups(
  userId: string,
  connectionId: string,
  selectedGroups: string[] | null,
): Promise<void> {
  const row = await connectionFor(userId, connectionId);
  if (!row) throw new Error("NOT_CONNECTED");
  const meta = parseMeta(row.meta) ?? {};
  const valid = Array.isArray(selectedGroups)
    ? selectedGroups.filter((id) => (meta.groups ?? []).some((g) => g.id === id))
    : null;
  meta.selectedGroups = valid;
  await database.integration.update({
    where: { id: row.id },
    data: { meta: JSON.stringify(meta) },
  });
}

async function credentialFor(userId: string, row: Row, actorSessionId: string): Promise<string | null> {
  const dek = await getUserDEK(userId, {
    sessionId: actorSessionId,
    context: `integration:${row.providerId}`,
  });
  return openFromString(dek, row.encryptedCredential, AAD(userId));
}

function makeContext(
  userId: string,
  row: Row,
  actorSessionId: string,
  logs: string[],
): ProviderContext {
  return {
    cursor: row.syncToken ?? null,
    meta: parseMeta(row.meta),
    getCredential: () => credentialFor(userId, row, actorSessionId),
    log: (m) => logs.push(m),
  };
}

/**
 * Connect an account. Providers that report an `accountKey` (Google email, feed
 * URL) get a NEW connection per account; the upsert only overwrites when the
 * same account is reconnected.
 */
export async function connectProvider(
  userId: string,
  providerId: string,
  actorSessionId: string,
  input: ConnectInput,
): Promise<{ connectionId: string; accountKey: string; label: string | null }> {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("UNKNOWN_PROVIDER");
  if (!provider.available) throw new Error("PROVIDER_UNAVAILABLE");

  const { credential, meta, accountKey, label } = await provider.connect(input);
  const key = accountKey?.trim() || "default";
  const dek = await getUserDEK(userId, { sessionId: actorSessionId, context: `integration:connect:${providerId}` });
  const encrypted = sealToString(dek, credential, AAD(userId));

  const row = await database.integration.upsert({
    where: { userId_providerId_accountKey: { userId, providerId, accountKey: key } },
    create: {
      userId, providerId, accountKey: key, label: label ?? null,
      encryptedCredential: encrypted,
      meta: meta ? JSON.stringify(meta) : null,
      status: "connected",
    },
    update: {
      encryptedCredential: encrypted,
      label: label ?? undefined,
      meta: meta ? JSON.stringify(meta) : undefined,
      status: "connected",
    },
    select: { id: true, accountKey: true, label: true },
  });
  return { connectionId: row.id, accountKey: row.accountKey, label: row.label };
}

export type SyncReport = {
  pulled: number;
  created: number;
  updated: number;
  skipped: number;
  rejected: number;
  byType: Record<string, number>;
  errors: { index: number; sourceId?: string; message: string }[];
  logs: string[];
  note?: string;
};

const EMPTY: SyncReport = {
  pulled: 0, created: 0, updated: 0, skipped: 0, rejected: 0, byType: {}, errors: [], logs: [],
};

/** The full pipeline for ONE connection: pull → validate → ingest → cursor. */
export async function syncConnection(
  userId: string,
  connectionId: string,
  actorSessionId: string,
): Promise<SyncReport> {
  const row = await connectionFor(userId, connectionId);
  if (!row) return { ...EMPTY, note: "Not connected" };

  const provider = getProvider(row.providerId);
  if (!provider) throw new Error("UNKNOWN_PROVIDER");
  if (!provider.pull) return { ...EMPTY, note: "This plugin does not import data" };

  const logs: string[] = [];
  const ctx = makeContext(userId, row, actorSessionId, logs);
  const { blocks: raw, cursor } = await provider.pull(ctx);

  // Strict boundary: validate every block before it can touch an entity.
  const { valid, errors } = validateBlocks(raw ?? []);

  const dek = await getUserDEK(
    userId,
    { sessionId: actorSessionId, context: `integration:ingest:${row.providerId}` },
    Math.max(valid.length, 1),
  );
  // accountKey scopes dedupe, so two accounts sharing an event id don't clash.
  const summary = await ingestBlocks(userId, row.providerId, row.accountKey, valid, dek);

  await database.integration.update({
    where: { id: row.id },
    data: { syncToken: cursor ?? row.syncToken, lastSyncedAt: new Date(), status: "connected" },
  });

  return {
    pulled: (raw ?? []).length,
    created: summary.created,
    updated: summary.updated,
    skipped: summary.skipped,
    rejected: errors.length,
    byType: summary.byType,
    errors,
    logs,
    note: errors.length > 0 ? `${errors.length} item(s) rejected by schema validation` : undefined,
  };
}

/** Sync every connected account of a provider, merged into one report. */
export async function syncProvider(
  userId: string,
  providerId: string,
  actorSessionId: string,
): Promise<SyncReport> {
  const rows = await database.integration.findMany({
    where: { userId, providerId },
    select: { id: true },
  });
  if (rows.length === 0) return { ...EMPTY, note: "Not connected" };

  const merged: SyncReport = { ...EMPTY, byType: {}, errors: [], logs: [] };
  for (const r of rows) {
    const rep = await syncConnection(userId, r.id, actorSessionId);
    merged.pulled += rep.pulled;
    merged.created += rep.created;
    merged.updated += rep.updated;
    merged.skipped += rep.skipped;
    merged.rejected += rep.rejected;
    merged.errors.push(...rep.errors);
    merged.logs.push(...rep.logs);
    for (const [k, v] of Object.entries(rep.byType)) merged.byType[k] = (merged.byType[k] ?? 0) + v;
    if (rep.note) merged.note = rep.note;
  }
  return merged;
}

/** Disconnect one account. */
export async function disconnectConnection(
  userId: string,
  connectionId: string,
  actorSessionId: string,
): Promise<void> {
  const row = await connectionFor(userId, connectionId);
  if (!row) return;
  const provider = getProvider(row.providerId);
  if (provider?.disconnect) {
    const logs: string[] = [];
    await provider.disconnect(makeContext(userId, row, actorSessionId, logs)).catch(() => {});
  }
  await database.integration.delete({ where: { id: row.id } });
  // Leave ImportedItem rows so already-ingested entities keep their provenance.
}

/** Disconnect every account of a provider. */
export async function disconnectProvider(
  userId: string,
  providerId: string,
  actorSessionId: string,
): Promise<void> {
  const rows = await database.integration.findMany({
    where: { userId, providerId },
    select: { id: true },
  });
  for (const r of rows) await disconnectConnection(userId, r.id, actorSessionId);
}

export async function authUrlFor(providerId: string, state: string): Promise<string | null> {
  const provider = getProvider(providerId);
  if (!provider?.getAuthUrl) return null;
  return provider.getAuthUrl(state);
}
