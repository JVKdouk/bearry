/**
 * The integration plugin contract.
 *
 * A plugin is a MANIFEST (pure data, validated at registration) plus a small set
 * of methods. Crucially, a plugin **never touches the database, crypto, or other
 * users' data** — it only:
 *   • receives its own decrypted credential + last cursor via `ProviderContext`
 *   • returns CANONICAL BLOCKS (schema/blocks.ts) from `pull()`
 * The platform validates every block and does all persistence (ingest.ts). This
 * boundary is what makes a future third-party plugin ecosystem safe: today every
 * plugin is first-party (T0) and lives in-source, but because the contract is
 * "credential in → validated blocks out" with no ambient authority, a plugin can
 * later be moved behind a sandbox/worker/RPC boundary without changing a line of
 * this interface.
 */

import { z } from "zod";


export type IntegrationCategory = "calendar" | "tasks" | "notes";
export type AuthType = "oauth2" | "token" | "apikey";

/** The declarative, validatable description of a plugin. */
export const ManifestSchema = z
  .object({
    /** Stable kebab id, e.g. "google-calendar". */
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be kebab-case"),
    name: z.string().min(1).max(80),
    /** Plugin version (semver-ish) — surfaced to users and used for migrations. */
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "version must be semver"),
    category: z.enum(["calendar", "tasks", "notes"]),
    description: z.string().min(1).max(280),
    authType: z.enum(["oauth2", "token", "apikey"]),
    icon: z.string().max(8).optional(),
    scopes: z.array(z.string()).optional(),
    /**
     * For token/apikey providers: how the client should ask for the credential.
     * Keeps the UI registry-driven — a new provider describes its own input
     * instead of the frontend hard-coding a per-provider form.
     */
    secretLabel: z.string().max(60).optional(),
    secretPlaceholder: z.string().max(120).optional(),
    secretHelp: z.string().max(240).optional(),
    /** Which block types this plugin can import (pull) / export (push). */
    capabilities: z.object({
      pull: z.array(z.enum(["event", "task", "note"])).default([]),
      push: z.array(z.enum(["event", "task", "note"])).default([]),
    }),
    /** False until real credentials/logic are wired (client shows "coming soon"). */
    available: z.boolean(),
    /** T0 = first-party (in-source). Reserved for a future third-party tier. */
    trust: z.enum(["first-party", "third-party"]).default("first-party"),
  })
  .strict();

export type IntegrationManifest = z.infer<typeof ManifestSchema>;

/** A selectable import source within a provider (a TickTick project / a list). */
export type ImportGroup = { id: string; label: string };

/** Per-request/job context handed to a plugin. Deliberately minimal. */
export type ProviderContext = {
  /** Decrypt THIS user's credential for THIS provider (null if unconnected). */
  getCredential: () => Promise<string | null>;
  /** The cursor persisted from the last successful pull (for incremental sync). */
  cursor: string | null;
  /** Parsed cleartext bookkeeping (Integration.meta): import groups, selection… */
  meta: Record<string, unknown> | null;
  /** Structured log line, captured into the sync report. */
  log: (message: string) => void;
};

export type ConnectInput = {
  code?: string; // oauth2
  secret?: string; // token / apikey
  scopes?: string;
  redirectUri?: string;
};

/** What `connect` produced. */
export type ConnectResult = {
  credential: string;
  meta?: Record<string, unknown>;
  /**
   * Stable identity of the connected account within this provider (Google
   * account email, .ics URL). Distinct values create separate connections;
   * omitted means the provider is single-account and uses "default".
   */
  accountKey?: string;
  /** Human-friendly name for the UI (defaults to accountKey). */
  label?: string;
};

/** What a pull produced. `blocks` is RAW — the platform validates it. */
export type PullResult = {
  blocks: unknown[];
  /** New cursor to persist for the next incremental pull. */
  cursor?: string | null;
};

/** A plugin = manifest + behavior. */
export type IntegrationProvider = IntegrationManifest & {
  /** oauth2 only: build the consent URL, embedding a signed `state`. */
  getAuthUrl?: (state: string) => string;

  /**
   * Validate `input` → return the credential string to store encrypted.
   *
   * `accountKey` identifies *which* account was connected (Google email, feed
   * URL…). It's the uniqueness key, so returning a distinct one lets a provider
   * be connected several times; omit it and the provider stays single-account
   * ("default"). `label` is what the UI shows.
   */
  connect: (input: ConnectInput) => Promise<ConnectResult>;

  /** Import data as canonical blocks. The platform validates + ingests them. */
  pull?: (ctx: ProviderContext) => Promise<PullResult>;

  /** Revoke remote access on disconnect. */
  disconnect?: (ctx: ProviderContext) => Promise<void>;
};

/** Split a provider into its manifest fields (for validation/serialization). */
export function manifestOf(p: IntegrationProvider): IntegrationManifest {
  return {
    id: p.id,
    name: p.name,
    version: p.version,
    category: p.category,
    description: p.description,
    authType: p.authType,
    icon: p.icon,
    scopes: p.scopes,
    capabilities: p.capabilities,
    available: p.available,
    trust: p.trust,
  };
}



export {type BlockType} from "./schema/blocks";